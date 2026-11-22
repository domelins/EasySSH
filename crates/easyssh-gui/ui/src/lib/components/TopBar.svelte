<script lang="ts">
  import { onMount } from 'svelte';
  import type { Window } from '@tauri-apps/api/window';
  import HostTransferModal from './HostTransferModal.svelte';
  import { Icon, StatusDot } from '$lib/theme';
  import type { IconName } from '$lib/theme/icons';
  import { isWindows } from '$lib/platform';
  import { theme, themeMode } from '$lib/stores/theme';
  import { activeEntity } from '$lib/stores/activeEntity';
  import { sessions, sessionStatusDot, sessionTitle } from '$lib/stores/sessions';
  import { closeHost, spawnSession } from '$lib/stores/navigation';
  import { palette } from '$lib/stores/palette';
  import { streamerMode } from '$lib/stores/streamer';
  import { support } from '$lib/stores/support';

  let transferOpen = $state(false);

  // Windows draws the app without a native frame (main.rs set_decorations(false)),
  // so the bar carries the caption buttons itself. Hidden off Tauri: the first
  // isMaximized() probe rejects in a plain browser and the controls never appear.
  let captionWindow = $state<Window | null>(null);
  let maximized = $state(false);

  onMount(() => {
    if (!isWindows) return;
    let disposed = false;
    let off: (() => void) | undefined;
    import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        const isMax = await win.isMaximized();
        if (disposed) return;
        maximized = isMax;
        captionWindow = win;
        const unlisten = await win.onResized(() => {
          void win
            .isMaximized()
            .then((value) => {
              if (!disposed) maximized = value;
            })
            .catch(() => {});
        });
        // Unmount may land while the listener registration is in flight; the
        // cleanup already ran, so release this late registration here.
        if (disposed) {
          unlisten();
          return;
        }
        off = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
    };
  });

  async function openTerminal(): Promise<void> {
    const host = await palette.pickHost();
    if (host) spawnSession('terminal', host.name);
  }

  const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-header-fg';
  const iconButton = `grid h-8 w-8 shrink-0 place-items-center rounded-md text-header-muted transition hover:bg-header-hover hover:text-header-fg ${focusRing}`;
  const navItem = `flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${focusRing}`;
  const navOn = 'bg-header-active text-header-fg';
  const navOff = 'text-header-muted hover:bg-header-hover hover:text-header-fg';

  type Workspace = 'dashboard' | 'tunnels' | 'snippets';
  const workspaces: { kind: Workspace; text: string; icon: IconName; label?: string; open: () => void }[] = [
    { kind: 'dashboard', text: 'SSH', icon: 'dashboard', open: () => activeEntity.selectDashboard() },
    { kind: 'tunnels', text: '隧道', icon: 'tunnel', open: () => activeEntity.selectTunnels() },
    { kind: 'snippets', text: '片段', icon: 'snippets', label: '命令片段', open: () => activeEntity.selectSnippets() }
  ];

  // One tab per host, not per terminal: a second terminal on the same host lives in the
  // workspace's own tab strip. The representative session carries the status dot.
  const hostEntries = $derived.by(() => {
    const order: string[] = [];
    for (const session of $sessions) {
      if (!order.includes(session.hostName)) order.push(session.hostName);
    }
    if ($activeEntity.kind === 'host' && !order.includes($activeEntity.hostName)) {
      order.push($activeEntity.hostName);
    }
    return order.map((hostName) => {
      const mine = $sessions.filter((session) => session.hostName === hostName);
      const rep =
        ($activeEntity.kind === 'session'
          ? mine.find((session) => session.id === $activeEntity.id)
          : undefined) ?? mine[0];
      return { hostName, rep };
    });
  });
</script>

<header
  data-tauri-drag-region
  class="flex h-[calc(2.75rem+var(--titlebar-h))] shrink-0 items-center gap-1 bg-header pl-[calc(var(--titlebar-left)+0.75rem)] pr-2 pt-[var(--titlebar-h)] text-header-fg"
>
  {#if isWindows}
    <span
      data-tauri-drag-region
      class="shrink-0 select-none pl-1 pr-2 text-xs font-semibold tracking-wide text-header-fg"
      >EasySSH</span
    >
  {/if}
  <nav aria-label="工作区" class="flex shrink-0 items-center gap-0.5">
    {#each workspaces as item (item.kind)}
      {@const on = $activeEntity.kind === item.kind}
      <button
        type="button"
        class="{navItem} {on ? navOn : navOff}"
        aria-label={item.label}
        aria-current={on ? 'page' : undefined}
        onclick={item.open}
      >
        <Icon name={item.icon} size={14} />
        {item.text}
      </button>
    {/each}
  </nav>

  <!-- Tabs sit on the bar's bottom edge, so the active one reads as part of the page below. -->
  <nav
    aria-label="已打开会话"
    data-tauri-drag-region
    class="ml-2 flex min-w-0 flex-1 items-end gap-0.5 self-stretch overflow-x-auto"
  >
    {#each hostEntries as entry (entry.hostName)}
      {@const active = entry.rep
        ? $activeEntity.kind === 'session' && $activeEntity.id === entry.rep.id
        : $activeEntity.kind === 'host' && $activeEntity.hostName === entry.hostName}
      {@const label = entry.rep ? sessionTitle(entry.rep) : `${entry.hostName} · 终端`}
      <div
        class="group flex h-9 min-w-24 max-w-48 shrink-0 items-center rounded-t-lg transition {active
          ? 'bg-surface text-fg'
          : 'text-header-muted hover:bg-header-hover hover:text-header-fg'}"
      >
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-tl-lg pl-3 pr-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset {active
            ? 'font-medium focus-visible:ring-focus'
            : 'focus-visible:ring-header-fg'}"
          title={label}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onclick={() =>
            entry.rep
              ? activeEntity.activateSession(entry.rep.id)
              : activeEntity.activateHost(entry.hostName)}
        >
          <StatusDot status={entry.rep ? sessionStatusDot[entry.rep.status] : 'off'} size={7} />
          <span class="truncate">{entry.hostName}</span>
        </button>
        <button
          type="button"
          class="mr-1.5 grid h-5 w-5 shrink-0 place-items-center rounded opacity-60 transition hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 {active
            ? 'hover:bg-surface-inset focus-visible:ring-focus'
            : 'hover:bg-header-hover focus-visible:ring-header-fg'}"
          title="关闭 {entry.hostName}"
          aria-label="关闭 {entry.hostName}"
          onclick={() => closeHost(entry.hostName)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    {/each}
  </nav>

  <div class="flex shrink-0 items-center gap-0.5">
    <button type="button" class={iconButton} title="终端" aria-label="终端" onclick={openTerminal}>
      <Icon name="terminal" size={16} />
    </button>
    <button type="button" class={iconButton} title="命令面板 (Ctrl/⌘+K)" aria-label="搜索命令" onclick={() => palette.open()}>
      <Icon name="search" size={16} />
    </button>
    <button
      type="button"
      class="{iconButton} {$streamerMode ? 'bg-header-active text-header-fg' : ''}"
      title={$streamerMode ? '关闭直播模式' : '开启直播模式'}
      aria-label={$streamerMode ? '关闭直播模式' : '开启直播模式'}
      aria-pressed={$streamerMode}
      onclick={() => streamerMode.toggle()}
    >
      <Icon name="eye" size={16} />
    </button>
    <button
      type="button"
      class="{navItem} whitespace-nowrap text-header-fg hover:bg-header-hover"
      title="导入 / 导出主机"
      aria-label="导入 / 导出主机"
      onclick={() => (transferOpen = true)}
    >
      <Icon name="transfer" size={16} />
      <span>导入 / 导出</span>
    </button>

    <div class="mx-1 h-4 w-px shrink-0 bg-header-fg opacity-20"></div>

    <button
      type="button"
      class={iconButton}
      title={themeMode($theme) === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      aria-label={themeMode($theme) === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      onclick={() => theme.toggle()}
    ><Icon name={themeMode($theme) === 'dark' ? 'sun' : 'moon'} size={16} /></button>
    <button type="button" class={iconButton} title="支持 EasySSH" aria-label="支持 EasySSH" onclick={() => support.open()}>
      <Icon name="telegram" size={15} />
    </button>
    <button
      type="button"
      class="{iconButton} {$activeEntity.kind === 'settings' ? 'bg-header-active text-header-fg' : ''}"
      title="设置"
      aria-label="设置"
      aria-current={$activeEntity.kind === 'settings' ? 'page' : undefined}
      onclick={() => activeEntity.selectSettings()}
    >
      <Icon name="settings" size={16} />
    </button>
  </div>

  {#if captionWindow}
    <!-- Caption buttons replace the native Windows frame; no drag attribute here so
         clicks never start a window drag. Close goes through close() to keep the
         quit confirmation and tray logic in +layout.svelte. -->
    <div class="ml-1 flex shrink-0 items-center">
      <button
        type="button"
        class={iconButton}
        title="最小化"
        aria-label="最小化"
        onclick={() => void captionWindow?.minimize().catch(() => {})}
      >
        <Icon name="minimize" size={14} />
      </button>
      <button
        type="button"
        class={iconButton}
        title={maximized ? '还原' : '最大化'}
        aria-label={maximized ? '还原' : '最大化'}
        onclick={() => void captionWindow?.toggleMaximize().catch(() => {})}
      >
        <Icon name={maximized ? 'restore' : 'maximize'} size={14} />
      </button>
      <button
        type="button"
        class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-header-muted transition hover:bg-red-500 hover:text-white {focusRing}"
        title="关闭"
        aria-label="关闭"
        onclick={() => void captionWindow?.close().catch(() => {})}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  {/if}
</header>

{#if transferOpen}
  <HostTransferModal onClose={() => (transferOpen = false)} />
{/if}
