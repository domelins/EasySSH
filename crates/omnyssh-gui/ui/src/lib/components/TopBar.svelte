<script lang="ts">
  import HostTransferModal from './HostTransferModal.svelte';
  import { Icon, StatusDot } from '$lib/theme';
  import type { IconName } from '$lib/theme/icons';
  import { theme, themeMode } from '$lib/stores/theme';
  import { activeEntity } from '$lib/stores/activeEntity';
  import { sessions, sessionStatusDot, sessionTitle } from '$lib/stores/sessions';
  import { closeHost, spawnSession } from '$lib/stores/navigation';
  import { palette } from '$lib/stores/palette';
  import { streamerMode } from '$lib/stores/streamer';
  import { support } from '$lib/stores/support';

  let transferOpen = $state(false);

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
    { kind: 'snippets', text: '片段', icon: 'snippets', label: 'Snippets', open: () => activeEntity.selectSnippets() }
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
  <nav aria-label="Workspace" class="flex shrink-0 items-center gap-0.5">
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
    aria-label="Open sessions"
    data-tauri-drag-region
    class="ml-2 flex min-w-0 flex-1 items-end gap-0.5 self-stretch overflow-x-auto"
  >
    {#each hostEntries as entry (entry.hostName)}
      {@const active = entry.rep
        ? $activeEntity.kind === 'session' && $activeEntity.id === entry.rep.id
        : $activeEntity.kind === 'host' && $activeEntity.hostName === entry.hostName}
      {@const label = entry.rep ? sessionTitle(entry.rep) : `${entry.hostName} · terminal`}
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
          title="Close {entry.hostName}"
          aria-label="Close {entry.hostName}"
          onclick={() => closeHost(entry.hostName)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    {/each}
  </nav>

  <div class="flex shrink-0 items-center gap-0.5">
    <button type="button" class={iconButton} title="Terminal" aria-label="Terminal" onclick={openTerminal}>
      <Icon name="terminal" size={16} />
    </button>
    <button type="button" class={iconButton} title="Command palette (⌘K)" aria-label="Search commands" onclick={() => palette.open()}>
      <Icon name="search" size={16} />
    </button>
    <button
      type="button"
      class="{iconButton} {$streamerMode ? 'bg-header-active text-header-fg' : ''}"
      title={$streamerMode ? 'Disable streamer mode' : 'Enable streamer mode'}
      aria-label={$streamerMode ? 'Disable streamer mode' : 'Enable streamer mode'}
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
      title={themeMode($theme) === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={themeMode($theme) === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      onclick={() => theme.toggle()}
    ><Icon name={themeMode($theme) === 'dark' ? 'sun' : 'moon'} size={16} /></button>
    <button type="button" class={iconButton} title="Support OmnySSH" aria-label="Support OmnySSH" onclick={() => support.open()}>
      <Icon name="telegram" size={15} />
    </button>
    <button
      type="button"
      class="{iconButton} {$activeEntity.kind === 'settings' ? 'bg-header-active text-header-fg' : ''}"
      title="Settings"
      aria-label="Settings"
      aria-current={$activeEntity.kind === 'settings' ? 'page' : undefined}
      onclick={() => activeEntity.selectSettings()}
    >
      <Icon name="settings" size={16} />
    </button>
  </div>
</header>

{#if transferOpen}
  <HostTransferModal onClose={() => (transferOpen = false)} />
{/if}
