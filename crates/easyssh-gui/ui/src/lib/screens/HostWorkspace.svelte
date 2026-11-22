<script lang="ts">
  // One host's connection workspace (tech-gui.md §2, §3.1): the remote file system on the
  // left, that host's terminal tabs in the middle, live monitoring on the right. The
  // panes share the host and nothing else — a second host gets its own workspace, its own
  // SFTP session and its own tabs — and the splitter/collapse state is stored per host
  // (./workspace/store.ts). Terminals are the app's existing sessions, so opening a new
  // one also adds the top bar's connection tab.
  import { Icon, StatusDot } from '$lib/theme';
  import { sessions, sessionStatusDot } from '$lib/stores/sessions';  import { activeEntity } from '$lib/stores/activeEntity';
  import { closeSession, spawnSession } from '$lib/stores/navigation';
  import { workspaceLayouts } from '$lib/workspace/store';
  import {
    DEFAULT_LAYOUT,
    MIN_PANE,
    computePanes,
    resizePane,
    toggleCollapse,
    toggleMaximize,
    type WorkspaceLayout
  } from '$lib/workspace/layout';
  import TerminalView from '$lib/screens/TerminalView.svelte';
  import RemoteExplorer from '$lib/components/RemoteExplorer.svelte';
  import MonitorPanel from '$lib/components/MonitorPanel.svelte';
  import Splitter from '$lib/components/Splitter.svelte';

  let {
    hostName,
    active,
    activeSessionId
  }: {
    hostName: string;
    /** This host's workspace is the one on screen. */
    active: boolean;
    /** The connection tab that is active, which picks the visible terminal. */
    activeSessionId: number | null;
  } = $props();

  let width = $state(0);

  const layout = $derived<WorkspaceLayout>($workspaceLayouts.get(hostName) ?? DEFAULT_LAYOUT);
  const panes = $derived(computePanes(layout, width));
  const terminals = $derived(
    $sessions.filter((session) => session.kind === 'terminal' && session.hostName === hostName)
  );
  const terminalVisible = $derived(panes.center > 0);
  const activeTerminal = $derived(
    terminals.find((session) => session.id === activeSessionId)?.id ?? terminals[0]?.id ?? null
  );
  const activeTerminalSession = $derived(
    terminals.find((session) => session.id === activeTerminal)
  );
  // A remote exit keeps the tab readable; its shell is gone though. Reconnecting
  // is a fresh session on the same host, so the old tab is closed behind it.
  const ended = $derived(
    activeTerminalSession?.status === 'closed' || activeTerminalSession?.status === 'failed'
  );

  function reconnect(): void {
    // Read the id before spawning: the new session becomes active immediately, so
    // a later read of `activeTerminalSession` would name the replacement instead.
    const dead = activeTerminalSession?.id;
    if (dead == null) return;
    spawnSession('terminal', hostName);
    closeSession(dead);
  }

  // Opening a parked tab is the user asking for that connection: wake it once the
  // workspace showing it is the active one (never on a hidden workspace).
  $effect(() => {
    if (!active) return;
    const session = activeTerminalSession;
    if (session?.status === 'dormant') sessions.wake(session.id);
  });

  function update(next: WorkspaceLayout): void {
    workspaceLayouts.setLayout(hostName, next);
  }

  function resize(side: 'left' | 'right', next: number): void {
    update(resizePane(layout, side, next, width));
  }

  function toggle(side: 'left' | 'right'): void {
    update(toggleCollapse(layout, side));
  }

  function maximize(panel: 'files' | 'terminal' | 'monitor'): void {
    update(toggleMaximize(layout, panel));
  }

  function newTerminal(): void {
    spawnSession('terminal', hostName);
  }

  const iconButton =
    'grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition hover:bg-surface-inset ' +
    'hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
</script>

<div class="flex h-full min-h-0 w-full overflow-hidden bg-bg" class:hidden={!active} bind:clientWidth={width}>
  {#if panes.leftVisible}
    <aside
      class="min-h-0 min-w-0 shrink-0 overflow-hidden border-r border-default"
      style="width: {panes.left}px"
      aria-label="远程文件面板"
    >
      <RemoteExplorer
        {hostName}
        active={active && panes.leftVisible}
        maximized={panes.maximized === 'files'}
        onCollapse={() => toggle('left')}
        onMaximize={() => maximize('files')}
      />
    </aside>
    <Splitter
      side="left"
      width={layout.leftWidth}
      min={MIN_PANE}
      max={560}
      label="调整远程文件面板宽度"
      onResize={(next) => resize('left', next)}
      onToggle={() => toggle('left')}
    />
  {/if}

  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- Workspace header: the host, its terminal tabs, and the panel switches. -->
    <div class="flex h-9 shrink-0 items-stretch gap-1 border-b border-default bg-surface pr-2">
      <div class="flex shrink-0 items-center gap-1.5 pl-3 pr-2">
        <span class="max-w-40 truncate text-[0.6875rem] font-semibold text-fg" title={hostName}>{hostName}</span>
      </div>

      <div class="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto" role="tablist" aria-label="终端标签">
        {#each terminals as terminal, i (terminal.id)}
          {@const selected = terminal.id === activeTerminal}
          <div
            class="group flex h-full min-w-24 max-w-44 shrink-0 items-center border-b-2 {selected
              ? 'border-accent bg-surface-inset'
              : 'border-transparent hover:bg-surface-inset'}"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-[0.6875rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
              title="终端 {i + 1} · {hostName}"
              onclick={() => activeEntity.activateSession(terminal.id)}
            >
              <StatusDot status={sessionStatusDot[terminal.status]} size={6} />
              <span class="truncate">终端 {i + 1}</span>
            </button>
            <button
              type="button"
              class="mr-1 grid h-4 w-4 shrink-0 place-items-center rounded text-faint opacity-0 transition hover:bg-surface hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              title="关闭终端 {i + 1}"
              aria-label="关闭终端 {i + 1}"
              onclick={() => closeSession(terminal.id)}
            >
              <Icon name="close" size={10} />
            </button>
          </div>
        {/each}
      </div>

      <div class="flex shrink-0 items-center gap-0.5">
        {#if ended}
          <button
            type="button"
            class="flex h-6 shrink-0 items-center gap-1 rounded border border-default px-2 text-[0.6875rem] text-muted transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            title="重新连接 {hostName}"
            aria-label="重连 {hostName}"
            onclick={reconnect}
          >
            <Icon name="refresh" size={11} /> 重连
          </button>
        {/if}
        <button type="button" class={iconButton} title="新建终端" aria-label="新建终端" onclick={newTerminal}>
          <Icon name="plus" size={14} />
        </button>
        <span class="mx-1 h-4 w-px bg-default" aria-hidden="true"></span>
        <button
          type="button"
          class="{iconButton} {layout.leftCollapsed ? '' : 'text-accent'}"
          title={layout.leftCollapsed ? '显示文件面板' : '隐藏文件面板'}
          aria-label={layout.leftCollapsed ? '显示文件面板' : '隐藏文件面板'}
          aria-pressed={!layout.leftCollapsed}
          onclick={() => toggle('left')}
        >
          <Icon name="sftp" size={14} />
        </button>
        <button
          type="button"
          class="{iconButton} {layout.rightCollapsed ? '' : 'text-accent'}"
          title={layout.rightCollapsed ? '显示监控面板' : '隐藏监控面板'}
          aria-label={layout.rightCollapsed ? '显示监控面板' : '隐藏监控面板'}
          aria-pressed={!layout.rightCollapsed}
          onclick={() => toggle('right')}
        >
          <Icon name="dashboard" size={14} />
        </button>
        <button
          type="button"
          class={iconButton}
          title={panes.maximized === 'terminal' ? '还原终端' : '最大化终端'}
          aria-label={panes.maximized === 'terminal' ? '还原终端' : '最大化终端'}
          onclick={() => maximize('terminal')}
        >
          <Icon name={panes.maximized === 'terminal' ? 'restore' : 'maximize'} size={13} />
        </button>
      </div>
    </div>

    <div class="relative min-h-0 flex-1" class:hidden={!terminalVisible}>
      {#each terminals as terminal (terminal.id)}
        {#if terminal.status === 'dormant'}
          <!-- A tab restored from the last run: it holds the place, not a connection.
               Opening it wakes it (the effect above), so this also covers the frame
               before that happens. -->
          <div
            class="absolute inset-0 grid place-items-center px-6 text-center"
            class:hidden={terminalVisible ? terminal.id !== activeTerminal : true}
          >
            <div>
              <p class="text-sm text-muted">上次退出时这个终端还开着</p>
              <p class="mt-1 text-xs text-faint">连接 {hostName} 以恢复会话，或关闭这个标签。</p>
              <button
                type="button"
                class="mt-3 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                onclick={() => sessions.wake(terminal.id)}
              >
                <Icon name="play" size={12} /> 连接终端
              </button>
            </div>
          </div>
        {:else}
          <TerminalView
            session={terminal}
            active={terminalVisible && terminal.id === activeTerminal}
          />
        {/if}
      {/each}

      {#if terminals.length === 0}
        <div class="absolute inset-0 grid place-items-center px-6 text-center">
          <div>
            <p class="text-sm text-muted">这个主机还没有打开的终端</p>
            <button
              type="button"
              class="mt-3 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              onclick={newTerminal}
            >
              <Icon name="plus" size={13} /> 新建终端
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if panes.rightVisible}
    <Splitter
      side="right"
      width={layout.rightWidth}
      min={MIN_PANE}
      max={560}
      label="调整监控面板宽度"
      onResize={(next) => resize('right', next)}
      onToggle={() => toggle('right')}
    />
    <aside
      class="min-h-0 min-w-0 shrink-0 overflow-hidden border-l border-default"
      style="width: {panes.right}px"
      aria-label="监控面板"
    >
      <MonitorPanel
        {hostName}
        active={active && panes.rightVisible}
        maximized={panes.maximized === 'monitor'}
        onCollapse={() => toggle('right')}
        onMaximize={() => maximize('monitor')}
      />
    </aside>
  {/if}
</div>
