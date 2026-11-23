import { writable } from 'svelte/store';
import { loadSettingsStore } from '$lib/stores/settingsStore';
import type { Session } from '$lib/stores/sessions';

// Which terminal tabs were open per host when the app last ran (tech-gui.md §2).
// The count is persisted, not the connections: on the next start the tabs come
// back parked (`SessionStatus::dormant`) and only connect when the user opens one,
// so a restart never dials every host in the list.
//
// Persistence mirrors the other UI prefs: tauri-plugin-store canonical, a
// localStorage copy for the first paint, writes debounced like a layout drag.

const LOCAL_KEY = 'easyssh-open-tabs';
const STORE_KEY = 'openTabs';
const WRITE_DELAY_MS = 250;

/** How many parked tabs one start may create, across all hosts. */
export const MAX_RESTORED_TABS = 12;
/** A sanity cap per host: a corrupt store must not create an unbounded list. */
const MAX_TABS_PER_HOST = 12;

/** Terminal tab count per host. */
export type ParkedTabs = Record<string, number>;

/** Count the terminal tabs currently open, per host. */
export function parkedFromSessions(sessions: Session[]): ParkedTabs {
  const counts: ParkedTabs = {};
  for (const session of sessions) {
    counts[session.hostName] = (counts[session.hostName] ?? 0) + 1;
  }
  return counts;
}

/**
 * What a start should restore: hosts that are not already open, in name order,
 * until the global cap is reached. A host's own count is capped too, so a
 * corrupted value cannot flood the tab strip.
 */
export function restorePlan(
  parked: ParkedTabs,
  openHosts: Set<string>,
  limit = MAX_RESTORED_TABS
): { hostName: string; count: number }[] {
  const plan: { hostName: string; count: number }[] = [];
  let left = limit;
  for (const hostName of Object.keys(parked).sort()) {
    if (left <= 0) break;
    if (openHosts.has(hostName)) continue;
    const count = Math.min(Math.max(0, Math.trunc(parked[hostName] ?? 0)), MAX_TABS_PER_HOST, left);
    if (count <= 0) continue;
    plan.push({ hostName, count });
    left -= count;
  }
  return plan;
}

/** Coerce an untrusted persisted value into a tab map. */
export function parseParked(raw: unknown): ParkedTabs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const parked: ParkedTabs = {};
  for (const [host, count] of Object.entries(raw as Record<string, unknown>)) {
    const name = host.trim();
    if (!name || typeof count !== 'number' || !Number.isFinite(count)) continue;
    const value = Math.min(Math.max(0, Math.trunc(count)), MAX_TABS_PER_HOST);
    if (value > 0) parked[name] = value;
  }
  return parked;
}

function mirroredTabs(): ParkedTabs {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return parseParked(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

function mirrorLocal(parked: ParkedTabs): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(parked));
  } catch {
    // localStorage unavailable (hardened webview): the store copy is canonical.
  }
}

async function persistStore(parked: ParkedTabs): Promise<void> {
  try {
    const store = await loadSettingsStore();
    await store.set(STORE_KEY, parked);
    await store.save();
  } catch {
    // Not under Tauri (tests, vite preview): the localStorage mirror suffices.
  }
}

/** Build an independent store over an initial map (exported for tests). */
export function createOpenTabs(initial: ParkedTabs) {
  const { subscribe, set } = writable<ParkedTabs>(initial);
  let current = initial;
  let interacted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function apply(next: ParkedTabs, user: boolean): void {
    current = next;
    set(next);
    mirrorLocal(next);
    if (!user) return;
    interacted = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void persistStore(current);
    }, WRITE_DELAY_MS);
  }

  return {
    subscribe,
    parked: (): ParkedTabs => current,
    /** Remember the current tab counts (no-op when nothing changed). */
    save(next: ParkedTabs): void {
      const normalized = parseParked(next);
      if (JSON.stringify(normalized) === JSON.stringify(current)) return;
      apply(normalized, true);
    },
    /** Reconcile with the canonical tauri-plugin-store value. */
    async hydrate(): Promise<void> {
      try {
        const store = await loadSettingsStore();
        const saved = await store.get<unknown>(STORE_KEY);
        if (interacted || saved === undefined) return;
        const parsed = parseParked(saved);
        if (Object.keys(parsed).length > 0) apply({ ...parsed, ...current }, false);
      } catch {
        // Store unreachable: keep the mirrored value.
      }
    }
  };
}

export type OpenTabs = ReturnType<typeof createOpenTabs>;

export const openTabs = createOpenTabs(mirroredTabs());
