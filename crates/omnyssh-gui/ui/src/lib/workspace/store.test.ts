// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { DEFAULT_LAYOUT, type WorkspaceLayout } from './layout';
import { WRITE_DELAY_MS, createWorkspaceLayouts } from './store';

const backend = { get: vi.fn(), set: vi.fn(), save: vi.fn() };
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn(async () => backend) }));
vi.mock('$lib/ipc/commands', () => ({ settingsStorePath: vi.fn(async () => 'settings.json') }));

const LOCAL_KEY = 'omnyssh-workspace-layouts';

const layout = (patch: Partial<WorkspaceLayout> = {}): WorkspaceLayout => ({
  ...DEFAULT_LAYOUT,
  ...patch
});

function fresh(initial: Map<string, WorkspaceLayout> = new Map()) {
  return createWorkspaceLayouts(initial);
}

describe('workspace layouts', () => {
  beforeEach(() => {
    localStorage.clear();
    backend.get.mockReset();
    backend.set.mockReset();
    backend.save.mockReset();
    vi.useRealTimers();
  });

  it('starts a host on the default three-pane layout', () => {
    const store = fresh();
    expect(store.layout('web')).toEqual(DEFAULT_LAYOUT);
  });

  it('saves a host layout and mirrors it for the next first paint', () => {
    const store = fresh();
    store.setLayout('web', layout({ leftWidth: 340, rightCollapsed: true }));
    expect(store.layout('web')).toMatchObject({ leftWidth: 340, rightCollapsed: true });
    const mirrored = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
    expect(mirrored.web).toMatchObject({ leftWidth: 340, rightCollapsed: true });
  });

  it('keeps hosts apart', () => {
    const store = fresh();
    store.setLayout('web', layout({ leftWidth: 240 }));
    store.setLayout('db', layout({ rightWidth: 400 }));
    expect(store.layout('web').leftWidth).toBe(240);
    expect(store.layout('web').rightWidth).toBe(DEFAULT_LAYOUT.rightWidth);
    expect(store.layout('db').rightWidth).toBe(400);
    expect(store.layout('db').leftWidth).toBe(DEFAULT_LAYOUT.leftWidth);
  });

  it('patches one field without dropping the rest', () => {
    const store = fresh(new Map([['web', layout({ leftWidth: 300, maximized: 'files' })]]));
    store.patchLayout('web', { maximized: null, activePanel: 'monitor' });
    expect(store.layout('web')).toMatchObject({
      leftWidth: 300,
      maximized: null,
      activePanel: 'monitor'
    });
  });

  it('forgets a host on request', () => {
    const store = fresh(new Map([['web', layout({ leftWidth: 300 })]]));
    store.forget('web');
    expect(store.layout('web')).toEqual(DEFAULT_LAYOUT);
    expect(localStorage.getItem(LOCAL_KEY)).not.toContain('web');
  });

  it('publishes every change to subscribers', () => {
    const store = fresh();
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe((map) => seen.push(map.has('web')));
    store.setLayout('web', layout({ leftCollapsed: true }));
    unsubscribe();
    expect(get(store).get('web')?.leftCollapsed).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it('debounces the canonical write to one per drag burst', async () => {
    vi.useFakeTimers();
    const store = fresh();
    store.setLayout('web', layout({ leftWidth: 260 }));
    store.setLayout('web', layout({ leftWidth: 300 }));
    store.setLayout('web', layout({ leftWidth: 320 }));
    expect(backend.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS + 10);
    expect(backend.set).toHaveBeenCalledTimes(1);
    expect(backend.set.mock.calls[0][0]).toBe('workspaceLayouts');
    expect(backend.set.mock.calls[0][1].web.leftWidth).toBe(320);
    expect(backend.save).toHaveBeenCalled();
  });
});
