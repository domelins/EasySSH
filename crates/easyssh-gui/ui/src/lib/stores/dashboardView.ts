import { writable } from 'svelte/store';
import { loadSettingsStore } from '$lib/stores/settingsStore';

// Dashboard organisation prefs: host-tree grouping, favorites, recents, table sorting and
// the custom host order. Like the sidebar collapse (./ui.ts) they survive restarts: persisted
// canonically via tauri-plugin-store, mirrored to localStorage for first paint and for a
// plain browser (Playwright, vite preview).
const LOCAL_KEY = 'omnyssh-dashboard-view';
const STORE_KEY = 'dashboardView';

/** How the dashboard orders cards: the user's own order, by name, or by status. */
export type CardSort = 'custom' | 'name' | 'status' | 'address';

interface DashboardView {
  groupByTag: boolean;
  hostGroups: string[];
  collapsed: string[];
  sort: CardSort;
  sortDescending: boolean;
  order: string[];
  favorites: string[];
  recentHosts: string[];
  showMetrics: boolean;
}

const SORTS: readonly CardSort[] = ['custom', 'name', 'status', 'address'];

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string'))] : [];

const groupNames = (v: unknown): string[] => [...new Set(strings(v).map((name) => name.trim()).filter(Boolean))];

/** Coerce an untrusted persisted value into a valid view, falling back per field. */
function parseView(raw: unknown): DashboardView {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    groupByTag: typeof v.groupByTag === 'boolean' ? v.groupByTag : false,
    hostGroups: groupNames(v.hostGroups),
    collapsed: strings(v.collapsed),
    sort: SORTS.find((s) => s === v.sort) ?? 'custom',
    sortDescending: typeof v.sortDescending === 'boolean' ? v.sortDescending : false,
    order: strings(v.order),
    favorites: strings(v.favorites),
    recentHosts: strings(v.recentHosts).slice(0, 12),
    showMetrics: typeof v.showMetrics === 'boolean' ? v.showMetrics : true
  };
}

function mirroredView(): DashboardView {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return parseView(raw ? JSON.parse(raw) : null);
  } catch {
    return parseView(null); // localStorage unavailable or corrupt: defaults.
  }
}

function mirrorLocal(view: DashboardView): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(view));
  } catch {
    // localStorage unavailable (hardened webview): the store copy is canonical.
  }
}

async function persistStore(view: DashboardView): Promise<void> {
  try {
    const store = await loadSettingsStore();
    await store.set(STORE_KEY, view);
    await store.save();
  } catch {
    // Not under Tauri (tests, vite preview): the localStorage mirror suffices.
  }
}

function createDashboardView() {
  const initial = mirroredView();
  const { subscribe, set: setStore } = writable<DashboardView>(initial);
  let current = initial;
  let interacted = false;

  // `user` marks a deliberate change: it writes the canonical store and blocks a late
  // hydrate from reverting it.
  function apply(view: DashboardView, user: boolean): void {
    current = view;
    setStore(view);
    mirrorLocal(view);
    if (user) {
      interacted = true;
      void persistStore(view);
    }
  }

  return {
    subscribe,
    toggleGroupByTag: () => apply({ ...current, groupByTag: !current.groupByTag }, true),
    setGroupByTag: (groupByTag: boolean) => apply({ ...current, groupByTag }, true),
    setHostGroups: (hostGroups: string[]) => apply({ ...current, hostGroups: groupNames(hostGroups) }, true),
    /** Fold or unfold a section. */
    toggleCollapsed: (key: string) =>
      apply(
        {
          ...current,
          collapsed: current.collapsed.includes(key)
            ? current.collapsed.filter((k) => k !== key)
            : [...current.collapsed, key]
        },
        true
      ),
    setSort: (sort: CardSort) =>
      apply(
        {
          ...current,
          sort,
          sortDescending: current.sort === sort && sort !== 'custom' ? !current.sortDescending : false
        },
        true
      ),
    setOrder: (order: string[]) => apply({ ...current, sort: 'custom', sortDescending: false, order }, true),
    toggleFavorite: (key: string) =>
      apply(
        {
          ...current,
          favorites: current.favorites.includes(key)
            ? current.favorites.filter((favorite) => favorite !== key)
            : [...current.favorites, key]
        },
        true
      ),
    markRecent: (name: string) =>
      apply(
        { ...current, recentHosts: [name, ...current.recentHosts.filter((host) => host !== name)].slice(0, 12) },
        true
      ),
    setShowMetrics: (showMetrics: boolean) => apply({ ...current, showMetrics }, true),
    /** Reconcile with the canonical tauri-plugin-store value (called from the layout's onMount). */
    async hydrate(): Promise<void> {
      try {
        const store = await loadSettingsStore();
        const saved = await store.get<unknown>(STORE_KEY);
        if (!interacted && saved !== undefined) apply(parseView(saved), false);
      } catch {
        // Store unreachable: keep the mirrored value.
      }
    }
  };
}

export const dashboardView = createDashboardView();
