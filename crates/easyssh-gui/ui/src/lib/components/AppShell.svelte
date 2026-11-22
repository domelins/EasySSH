<script lang="ts">
  import type { Snippet } from 'svelte';
  import TopBar from './TopBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import SupportModal from './SupportModal.svelte';
  import KeySetupProgress from '$lib/screens/KeySetupProgress.svelte';
  import PassphrasePrompt from '$lib/screens/PassphrasePrompt.svelte';
  import PasswordPrompt from '$lib/screens/PasswordPrompt.svelte';
  import UpdateBanner from './UpdateBanner.svelte';
  import { support } from '$lib/stores/support';
  import { get } from 'svelte/store';
  import { sidebarCollapsed, isCollapseChord, isCloseTabChord, isStreamerChord } from '$lib/stores/ui';
  import { activeEntity } from '$lib/stores/activeEntity';
  import { palette } from '$lib/stores/palette';
  import { dialogs } from '$lib/stores/dialogs';
  import { closeHost, closeSession } from '$lib/stores/navigation';
  import { isMac } from '$lib/platform';
  import { streamerMode } from '$lib/stores/streamer';

  let { children }: { children: Snippet } = $props();

  function onKeydown(e: KeyboardEvent): void {
    if (isCollapseChord(e)) {
      e.preventDefault();
      sidebarCollapsed.toggle();
    } else if (isMac && isCloseTabChord(e)) {
      e.preventDefault();
      if (get(palette).open) return;
      const active = get(activeEntity);
      if (get(dialogs).length === 0) {
        if (active.kind === 'session') closeSession(active.id);
        else if (active.kind === 'host') closeHost(active.hostName);
      }
    } else if (isStreamerChord(e)) {
      e.preventDefault();
      streamerMode.toggle();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex h-screen flex-col overflow-hidden bg-bg text-fg">
  <TopBar />
  <main class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </main>
  <StatusBar />
  <CommandPalette />
  {#if $support}
    <SupportModal />
  {/if}
  <KeySetupProgress />
  <PassphrasePrompt />
  <PasswordPrompt />
  <UpdateBanner />
</div>
