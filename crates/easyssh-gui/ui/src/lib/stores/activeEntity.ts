import { writable } from 'svelte/store';

// The one entity Content shows (tech-gui.md §2, §3.5): a selector screen or one
// session, never both. This store is the sole writer of "what's active", so the
// exactly-one-active invariant holds by construction — a new active value replaces
// the previous one whatever its kind. Switching selectors deactivates any session;
// activating a session deactivates the selectors.
export type ActiveEntity =
  | { kind: 'dashboard' }
  | { kind: 'tunnels' }
  | { kind: 'snippets' }
  | { kind: 'settings' }
  | { kind: 'session'; id: number }
  // A host whose last terminal was closed: its workspace stays on screen (empty, with
  // a "new terminal" action) instead of bouncing the user back to the host list.
  | { kind: 'host'; hostName: string };

function createActiveEntity() {
  const { subscribe, set, update } = writable<ActiveEntity>({ kind: 'dashboard' });
  return {
    subscribe,
    selectDashboard: () => set({ kind: 'dashboard' }),
    selectTunnels: () => set({ kind: 'tunnels' }),
    selectSnippets: () => set({ kind: 'snippets' }),
    selectSettings: () => set({ kind: 'settings' }),
    activateSession: (id: number) => set({ kind: 'session', id }),
    activateHost: (hostName: string) => set({ kind: 'host', hostName }),
    renameHost: (from: string, to: string) => {
      if (from === to) return;
      update((current) =>
        current.kind === 'host' && current.hostName === from ? { kind: 'host', hostName: to } : current
      );
    }
  };
}

export const activeEntity = createActiveEntity();
