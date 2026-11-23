import { writable } from 'svelte/store';
import { loadSettingsStore } from '$lib/stores/settingsStore';

// The interface font size — scales the whole UI through the root font-size (every
// rem-based dimension follows), distinct from the terminal font preference.
// Persisted like the other UI prefs: tauri-plugin-store canonical, localStorage
// mirror the app.html boot reads before first frame.
const LOCAL_KEY = 'easyssh-ui-font-size';
const STORE_KEY = 'uiFontSize';

export const DEFAULT_UI_SIZE = 16;
export const MIN_UI_SIZE = 12;
export const MAX_UI_SIZE = 20;

export const UI_SIZE_OPTIONS = [12, 13, 14, 15, 16, 17, 18, 20] as const;

export function clampUiSize(value: unknown): number {
  // `Number(null)` and `Number('')` are 0, which would clamp to MIN_UI_SIZE — a
  // missing mirror (getItem returns null) must fall back to the default instead.
  if (value == null || value === '') return DEFAULT_UI_SIZE;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_UI_SIZE;
  return Math.min(MAX_UI_SIZE, Math.max(MIN_UI_SIZE, Math.round(n)));
}

function applyRoot(size: number): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.fontSize = `${size}px`;
  }
}

function mirrored(): number {
  try {
    return clampUiSize(localStorage.getItem(LOCAL_KEY));
  } catch {
    return DEFAULT_UI_SIZE;
  }
}

function mirrorLocal(size: number): void {
  try {
    localStorage.setItem(LOCAL_KEY, String(size));
  } catch {
    // localStorage unavailable (hardened webview): the store copy is canonical.
  }
}

async function persistStore(size: number): Promise<void> {
  try {
    const store = await loadSettingsStore();
    await store.set(STORE_KEY, size);
    await store.save();
  } catch {
    // Not under Tauri (tests, vite preview): the localStorage mirror suffices.
  }
}

function createUiFontSize() {
  const initial = mirrored();
  applyRoot(initial);
  const { subscribe, set: setStore } = writable<number>(initial);
  let current = initial;
  let interacted = false;

  function apply(size: number, user: boolean): void {
    current = clampUiSize(size);
    applyRoot(current);
    setStore(current);
    mirrorLocal(current);
    if (user) {
      interacted = true;
      void persistStore(current);
    }
  }

  return {
    subscribe,
    set: (size: number) => apply(size, true),
    /** Reconcile with the canonical store once Tauri is reachable (layout onMount). */
    async hydrate(): Promise<void> {
      try {
        const store = await loadSettingsStore();
        const saved = await store.get<number>(STORE_KEY);
        if (interacted) return;
        if (typeof saved === 'number') apply(saved, false);
      } catch {
        // Store unreachable: keep the mirrored value.
      }
    }
  };
}

export const uiFontSize = createUiFontSize();