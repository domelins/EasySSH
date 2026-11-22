// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const backend = { get: vi.fn(), set: vi.fn(), save: vi.fn() };
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn(async () => backend) }));

const LOCAL_KEY = 'omnyssh-dashboard-view';

async function fresh() {
  vi.resetModules();
  return (await import('./dashboardView')).dashboardView;
}

const DEFAULTS = {
  groupByTag: false,
  hostGroups: [],
  collapsed: [],
  sort: 'custom',
  sortDescending: false,
  order: [],
  favorites: [],
  recentHosts: [],
  showMetrics: true
};

describe('dashboard view prefs', () => {
  beforeEach(() => {
    localStorage.clear();
    backend.get.mockReset();
    backend.set.mockReset();
    backend.save.mockReset();
  });

  it('starts ungrouped, unfolded, in the custom order', async () => {
    expect(get(await fresh())).toEqual(DEFAULTS);
  });

  it('folds and unfolds sections', async () => {
    const view = await fresh();
    view.toggleCollapsed('prod');
    view.toggleCollapsed('');
    expect(get(view).collapsed).toEqual(['prod', '']);
    view.toggleCollapsed('prod');
    expect(get(view).collapsed).toEqual(['']);
  });

  it('stores a custom order and reverses a repeated column sort', async () => {
    const view = await fresh();
    view.setSort('name');
    expect(get(view)).toMatchObject({ sort: 'name', sortDescending: false });
    view.setSort('name');
    expect(get(view)).toMatchObject({ sort: 'name', sortDescending: true });
    view.setOrder(['db', 'web']);
    expect(get(view)).toMatchObject({ sort: 'custom', sortDescending: false, order: ['db', 'web'] });
  });

  it('persists favorites and metrics visibility', async () => {
    const view = await fresh();
    view.toggleFavorite('web-key');
    view.toggleFavorite('db-key');
    view.toggleFavorite('web-key');
    view.setShowMetrics(false);
    expect(get(view)).toMatchObject({ favorites: ['db-key'], showMetrics: false });
    expect(get(await fresh())).toMatchObject({ favorites: ['db-key'], showMetrics: false });
  });

  it('moves a recent host to the front, deduplicates it and caps the list', async () => {
    const view = await fresh();
    for (const name of ['a', 'b', 'a', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n']) {
      view.markRecent(name);
    }
    expect(get(view).recentHosts).toHaveLength(12);
    expect(get(view).recentHosts[0]).toBe('n');
    expect(get(view).recentHosts.filter((name) => name === 'a')).toHaveLength(1);
    expect(get(view).recentHosts).not.toContain('b');
  });

  it('mirrors changes to localStorage and initialises from it', async () => {
    const view = await fresh();
    view.toggleGroupByTag();
    view.setHostGroups([' 生产 ', 'empty', '生产']);
    view.toggleCollapsed('db');
    view.setOrder(['web', 'db']);
    view.setSort('status');
    view.toggleFavorite('web');
    view.markRecent('db');
    view.setShowMetrics(false);
    const saved = {
      ...DEFAULTS,
      groupByTag: true,
      hostGroups: ['生产', 'empty'],
      collapsed: ['db'],
      sort: 'status',
      order: ['web', 'db'],
      favorites: ['web'],
      recentHosts: ['db'],
      showMetrics: false
    };
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}')).toEqual(saved);
    expect(get(await fresh())).toEqual(saved);
  });

  it('survives a corrupt mirror', async () => {
    localStorage.setItem(LOCAL_KEY, '{not json');
    expect(get(await fresh())).toEqual(DEFAULTS);
  });

  it('writes the canonical tauri-plugin-store on a user change', async () => {
    const view = await fresh();
    view.toggleGroupByTag();
    await vi.waitFor(() => {
      expect(backend.set).toHaveBeenCalledWith('dashboardView', { ...DEFAULTS, groupByTag: true });
      expect(backend.save).toHaveBeenCalled();
    });
  });

  it('hydrate applies the stored value and refreshes the mirror', async () => {
    const saved = { ...DEFAULTS, groupByTag: true, collapsed: ['web'], sort: 'name', order: ['b', 'a'] };
    backend.get.mockResolvedValue(saved);
    const view = await fresh();
    await view.hydrate();
    expect(get(view)).toEqual(saved);
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}')).toEqual(saved);
  });

  it('hydrate does not clobber a fresh user change', async () => {
    backend.get.mockResolvedValue({ groupByTag: false, collapsed: ['web'], sort: 'name' });
    const view = await fresh();
    view.toggleGroupByTag();
    await view.hydrate();
    expect(get(view)).toEqual({ ...DEFAULTS, groupByTag: true });
  });

  it('hydrate falls back per field for invalid and legacy values', async () => {
    backend.get.mockResolvedValue({
      groupByTag: 'yes',
      hostGroups: [' db ', '', 1, 'db'],
      collapsed: ['db', 1, 'db', null],
      sort: 'cpu',
      sortDescending: 'yes',
      order: 'web',
      favorites: ['a', 2, 'a'],
      recentHosts: ['b', null],
      showMetrics: 'no'
    });
    const view = await fresh();
    await view.hydrate();
    expect(get(view)).toEqual({ ...DEFAULTS, hostGroups: ['db'], collapsed: ['db'], favorites: ['a'], recentHosts: ['b'] });
  });
});
