// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '$lib/stores/sessions';
import {
  MAX_RESTORED_TABS,
  createOpenTabs,
  openTabs,
  parkedFromSessions,
  parseParked,
  restorePlan
} from './tabs';
import { WRITE_DELAY_MS } from './store';

const backend = { get: vi.fn(), set: vi.fn(), save: vi.fn() };
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn(async () => backend) }));
vi.mock('$lib/ipc/commands', () => ({ settingsStorePath: vi.fn(async () => 'settings.json') }));

const LOCAL_KEY = 'easyssh-open-tabs';

function terminal(hostName: string): Session {
  return { id: 1, kind: 'terminal', hostName, status: 'connected' };
}

describe('tab counts', () => {
  it('counts terminals per host', () => {
    const sessions: Session[] = [terminal('web'), terminal('web'), terminal('db')];
    expect(parkedFromSessions(sessions)).toEqual({ web: 2, db: 1 });
  });

  it('is empty with no terminals', () => {
    expect(parkedFromSessions([])).toEqual({});
  });
});

describe('restore plan', () => {
  it('restores every host in name order', () => {
    expect(restorePlan({ web: 2, db: 1 }, new Set())).toEqual([
      { hostName: 'db', count: 1 },
      { hostName: 'web', count: 2 }
    ]);
  });

  it('skips hosts that are already open', () => {
    expect(restorePlan({ web: 2, db: 1 }, new Set(['db']))).toEqual([
      { hostName: 'web', count: 2 }
    ]);
  });

  it('caps the total across hosts', () => {
    const plan = restorePlan({ a: 5, b: 5, c: 5 }, new Set(), 7);
    expect(plan.reduce((sum, entry) => sum + entry.count, 0)).toBeLessThanOrEqual(7);
    expect(plan[0]).toEqual({ hostName: 'a', count: 5 });
    expect(plan.at(-1)?.count).toBe(2);
  });

  it('uses the default cap', () => {
    const plan = restorePlan({ a: 99 }, new Set());
    expect(plan[0].count).toBeLessThanOrEqual(MAX_RESTORED_TABS);
  });

  it('drops zero and negative counts', () => {
    expect(restorePlan({ a: 0, b: -3, c: 1 }, new Set())).toEqual([{ hostName: 'c', count: 1 }]);
  });
});

describe('persisted tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    backend.get.mockReset();
    backend.set.mockReset();
    backend.save.mockReset();
    vi.useRealTimers();
  });

  it('parses only positive integer counts', () => {
    expect(parseParked({ web: 2, db: 0, bad: 'x', neg: -1, frac: 1.8, ' ': 4 })).toEqual({
      web: 2,
      frac: 1
    });
    expect(parseParked(null)).toEqual({});
    expect(parseParked([1, 2])).toEqual({});
  });

  it('saves a changed count and mirrors it for the next start', () => {
    const store = createOpenTabs({});
    store.save({ web: 2 });
    expect(store.parked()).toEqual({ web: 2 });
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}')).toEqual({ web: 2 });
  });

  it('ignores a save that does not change the counts', () => {
    const store = createOpenTabs({ web: 2 });
    const listener = vi.fn();
    store.subscribe(listener);
    listener.mockClear();
    store.save({ web: 2 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('debounces the canonical write', async () => {
    vi.useFakeTimers();
    const store = createOpenTabs({});
    store.save({ web: 1 });
    store.save({ web: 2 });
    expect(backend.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS + 10);
    expect(backend.set).toHaveBeenCalledTimes(1);
    expect(backend.set.mock.calls[0][1]).toEqual({ web: 2 });
  });

  it('exports one app-wide store', () => {
    expect(typeof openTabs.hydrate).toBe('function');
  });
});
