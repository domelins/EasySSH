<script lang="ts">
  import { onMount } from 'svelte';
  import { listHosts } from '$lib/ipc/commands';
  import { hosts } from '$lib/stores/hosts';
  import { lastError } from '$lib/stores/notifications';
  import { activeEntity } from '$lib/stores/activeEntity';
  import { sessions } from '$lib/stores/sessions';
  import AppShell from '$lib/components/AppShell.svelte';
  import Dashboard from '$lib/screens/Dashboard.svelte';
  import Snippets from '$lib/screens/Snippets.svelte';
  import Settings from '$lib/screens/Settings.svelte';
  import HostWorkspace from '$lib/screens/HostWorkspace.svelte';
  import MonitorPanel from '$lib/components/MonitorPanel.svelte';
  import RemoteExplorer from '$lib/components/RemoteExplorer.svelte';
  import { detachedTarget } from '$lib/workspace/panel';
  import { openTabs, parkedFromSessions, restorePlan } from '$lib/workspace/tabs';

  // A detached panel window loads the same SPA with `?panel=…&host=…` and renders
  // that panel alone — no workspace chrome, so it can sit beside the main window.
  const detached = detachedTarget(new URL(window.location.href));

  function closeDetached(): void {
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().close())
      .catch(() => {});
  }

  // Parked tabs are restored only once the persisted counts are in; until then a
  // save from the empty first render would wipe them.
  let restoreDone = $state(detached !== null);

  onMount(async () => {
    try {
      hosts.set(await listHosts());
    } catch (err) {
      lastError.set(err instanceof Error ? err.message : String(err));
    }
    if (detached) return;
    await openTabs.hydrate();
    for (const { hostName, count } of restorePlan(openTabs.parked(), new Set())) {
      for (let index = 0; index < count; index += 1) sessions.park(hostName);
    }
    restoreDone = true;
  });

  // Remember the tab strip between runs. Parked tabs count like open ones: they are
  // the same tabs, restored on the next start.
  $effect(() => {
    const counts = parkedFromSessions($sessions);
    if (!restoreDone) return;
    openTabs.save(counts);
  });

  const activeSessionId = $derived($activeEntity.kind === 'session' ? $activeEntity.id : null);
  const selectorActive = $derived($activeEntity.kind !== 'session' && $activeEntity.kind !== 'host');
  const activeSession = $derived(
    activeSessionId == null ? undefined : $sessions.find((session) => session.id === activeSessionId)
  );
  // One workspace per host, mount for as long as that host has any terminal open: the
  // terminal instances inside must survive a switch to another host, so the workspaces
  // are hidden rather than unmounted (tech-gui.md §3.1).
  const terminalHosts = $derived([
    ...new Set(
      $sessions.filter((session) => session.kind === 'terminal').map((session) => session.hostName)
    )
  ]);
  const activeHost = $derived(
    activeSession?.kind === 'terminal'
      ? activeSession.hostName
      : $activeEntity.kind === 'host'
        ? $activeEntity.hostName
        : null
  );
  // The empty workspace of a host whose last terminal was closed stays mounted too.
  const workspaceHosts = $derived(
    activeHost && !terminalHosts.includes(activeHost) ? [...terminalHosts, activeHost] : terminalHosts
  );
</script>

{#if detached}
  <div class="h-screen overflow-hidden bg-bg text-fg">
    {#if detached.panel === 'monitor'}
      <MonitorPanel
        hostName={detached.host}
        active={true}
        detached={true}
        onCollapse={closeDetached}
        onMaximize={() => {}}
      />
    {:else}
      <RemoteExplorer
        hostName={detached.host}
        active={true}
        detached={true}
        onCollapse={closeDetached}
        onMaximize={() => {}}
      />
    {/if}
  </div>
{:else}
  <AppShell>
    <div class="relative h-full">
    {#each workspaceHosts as host (host)}
      <div class="absolute inset-0" class:hidden={activeHost !== host}>
        <HostWorkspace
          hostName={host}
          active={activeHost === host}
          activeSessionId={activeHost === host ? (activeSession?.id ?? null) : null}
        />
      </div>
    {/each}

    {#if selectorActive}
      <div class="absolute inset-0">
        {#if $activeEntity.kind === 'dashboard'}
          <Dashboard />
        {:else if $activeEntity.kind === 'tunnels'}
          <Dashboard tunnelOnly={true} />
        {:else}
          <div class="h-full overflow-auto overscroll-contain">
            {#if $activeEntity.kind === 'snippets'}
              <Snippets />
            {:else if $activeEntity.kind === 'settings'}
              <Settings />
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
  </AppShell>
{/if}
