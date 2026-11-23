import { writable } from 'svelte/store';
import { loadSettingsStore } from '$lib/stores/settingsStore';

// The terminal font preference (family + size), persisted like the other UI prefs:
// tauri-plugin-store canonical, localStorage mirror for the first frame. TerminalView
// subscribes and re-styles every open terminal live.
const FAMILY_LOCAL_KEY = 'easyssh-font-family';
const SIZE_LOCAL_KEY = 'easyssh-font-size';
const FAMILY_STORE_KEY = 'fontFamily';
const SIZE_STORE_KEY = 'fontSize';

/** The built-in monospace stack, with the Nerd Font fallback tail. */
export const DEFAULT_FAMILY = 'default';
export const DEFAULT_SIZE = 13;
export const MIN_SIZE = 8;
export const MAX_SIZE = 32;

/** The families the settings screen offers. `default` keeps the built-in stack. */
export const FAMILY_OPTIONS = [
  { value: DEFAULT_FAMILY, label: '系统默认' },
  { value: 'Consolas', label: 'Consolas' },
  { value: 'Cascadia Mono', label: 'Cascadia Mono' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'MesloLGS NF', label: 'MesloLGS NF' },
  { value: 'Courier New', label: 'Courier New' }
] as const;

export const SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24] as const;

export type TerminalFont = { family: string; size: number };

export function clampFamily(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : DEFAULT_FAMILY;
}

export function clampSize(value: unknown): number {
  // `Number(null)` and `Number('')` are 0, which would clamp to MIN_SIZE — a missing
  // mirror (getItem returns null) must fall back to the default instead.
  if (value == null || value === '') return DEFAULT_SIZE;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
}

function mirrored(): TerminalFont {
  try {
    return {
      family: clampFamily(localStorage.getItem(FAMILY_LOCAL_KEY)),
      size: clampSize(localStorage.getItem(SIZE_LOCAL_KEY))
    };
  } catch {
    return { family: DEFAULT_FAMILY, size: DEFAULT_SIZE };
  }
}

function mirrorLocal(font: TerminalFont): void {
  try {
    localStorage.setItem(FAMILY_LOCAL_KEY, font.family);
    localStorage.setItem(SIZE_LOCAL_KEY, String(font.size));
  } catch {
    // localStorage unavailable (hardened webview): the store copy is canonical.
  }
}

async function persistStore(font: TerminalFont): Promise<void> {
  try {
    const store = await loadSettingsStore();
    await store.set(FAMILY_STORE_KEY, font.family);
    await store.set(SIZE_STORE_KEY, font.size);
    await store.save();
  } catch {
    // Not under Tauri (tests, vite preview): the localStorage mirror suffices.
  }
}

function createTerminalFont() {
  const initial = mirrored();
  const { subscribe, set: setStore } = writable<TerminalFont>(initial);
  let current = initial;
  let interacted = false;

  function apply(next: TerminalFont, user: boolean): void {
    current = { family: clampFamily(next.family), size: clampSize(next.size) };
    setStore(current);
    mirrorLocal(current);
    if (user) {
      interacted = true;
      void persistStore(current);
    }
  }

  return {
    subscribe,
    setFamily: (family: string) => apply({ ...current, family }, true),
    setSize: (size: number) => apply({ ...current, size }, true),
    /** Reconcile with the canonical store once Tauri is reachable (layout onMount). */
    async hydrate(): Promise<void> {
      try {
        const store = await loadSettingsStore();
        const family = await store.get<string>(FAMILY_STORE_KEY);
        const size = await store.get<number>(SIZE_STORE_KEY);
        if (interacted) return;
        if (typeof family === 'string' || typeof size === 'number') {
          apply(
            {
              family: typeof family === 'string' ? family : current.family,
              size: typeof size === 'number' ? size : current.size
            },
            false
          );
        }
      } catch {
        // Store unreachable: keep the mirrored value.
      }
    }
  };
}

export const terminalFont = createTerminalFont();