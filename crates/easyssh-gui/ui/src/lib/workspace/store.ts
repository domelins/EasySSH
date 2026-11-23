import { writable } from 'svelte/store';
import { loadSettingsStore } from '$lib/stores/settingsStore';
import {
  DEFAULT_LAYOUT,
  layoutFor,
  parseLayouts,
  serializeLayouts,
  type WorkspaceLayout
} from './layout';

// Per-host workspace layout, persisted across restarts (tech-gui.md §2, §3.5). The
// terminal tabs themselves live in the sessions store — this store owns only how the
// three panes sit, so a closed and reopened connection to the same host comes back to
// the layout the user left it in.
//
// Persistence mirrors the sidebar/dashboard prefs: tauri-plugin-store is canonical, and
// a localStorage copy renders the right widths on first paint (and in a plain browser
// under Playwright). Writes are debounced because a gutter drag emits a value per frame.

const LOCAL_KEY = 'easyssh-workspace-layouts';
const STORE_KEY = 'workspaceLayouts';
export const WRITE_DELAY_MS = 250;

function mirroredLayouts(): Map<string, WorkspaceLayout> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return parseLayouts(raw ? JSON.parse(raw) : null);
  } catch {
    return new Map(); // localStorage unavailable or corrupt: defaults for every host.
  }
}

function mirrorLocal(map: Map<string, WorkspaceLayout>): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(serializeLayouts(map)));
  } catch {
    // localStorage unavailable (hardened webview): the store copy is canonical.
  }
}

async function persistStore(map: Map<string, WorkspaceLayout>): Promise<void> {
  try {
    const store = await loadSettingsStore();
    await store.set(STORE_KEY, serializeLayouts(map));
    await store.save();
  } catch {
    // Not under Tauri (tests, vite preview): the localStorage mirror suffices.
  }
}

/** Build an independent store over an initial layout map (exported for tests). */
export function createWorkspaceLayouts(initial: Map<string, WorkspaceLayout>) {
  const { subscribe, set: setStore } = writable<Map<string, WorkspaceLayout>>(initial);
  let current = initial;
  let interacted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // `user` marks a deliberate change: it arms persistence and blocks a late hydrate from
  // reverting it. Hydration and tests seed state without marking it user-driven.
  function apply(next: Map<string, WorkspaceLayout>, user: boolean): void {
    current = next;
    setStore(next);
    mirrorLocal(next);
    if (!user) return;
    interacted = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void persistStore(current);
    }, WRITE_DELAY_MS);
  }

  function write(hostName: string, layout: WorkspaceLayout): void {
    apply(new Map(current).set(hostName, layout), true);
  }

  return {
    subscribe,
    /** The host's saved layout, or the defaults when it has none. */
    layout: (hostName: string): WorkspaceLayout => layoutFor(current, hostName),
    setLayout: write,
    patchLayout: (hostName: string, patch: Partial<WorkspaceLayout>): void =>
      write(hostName, { ...layoutFor(current, hostName), ...patch }),
    /** Drop a host's layout (a deleted host, or a reset from settings). */
    forget: (hostName: string): void => {
      if (!current.has(hostName)) return;
      const next = new Map(current);
      next.delete(hostName);
      apply(next, true);
    },
    /** Reconcile with the canonical tauri-plugin-store value (called on mount). */
    async hydrate(): Promise<void> {
      try {
        const store = await loadSettingsStore();
        const saved = await store.get<unknown>(STORE_KEY);
        if (interacted || saved === undefined) return;
        const parsed = parseLayouts(saved);
        if (parsed.size > 0) apply(new Map([...parsed, ...current]), false);
      } catch {
        // Store unreachable: keep the mirrored value.
      }
    }
  };
}

export type WorkspaceLayouts = ReturnType<typeof createWorkspaceLayouts>;

export const workspaceLayouts = createWorkspaceLayouts(mirroredLayouts());
export { DEFAULT_LAYOUT };
