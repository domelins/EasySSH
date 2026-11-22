// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { clampInterval, driveMetricsRefresh, refreshInterval, REFRESH_OPTIONS } from './settings';

const backend = { get: vi.fn(), set: vi.fn(), save: vi.fn() };
vi.mock('$lib/stores/settingsStore', () => ({ loadSettingsStore: vi.fn(async () => backend) }));

async function fresh() {
  vi.resetModules();
  return (await import('./settings')).refreshInterval;
}

describe('clampInterval', () => {
  it('offers the faster intervals while retaining every old option', () => {
    expect(REFRESH_OPTIONS).toEqual([2, 5, 10, 30, 60, 120, 300]);
  });

  it('accepts positive numbers and rounds them without limiting saved values to the options', () => {
    expect(clampInterval(1)).toBe(1);
    expect(clampInterval(2)).toBe(2);
    expect(clampInterval(5)).toBe(5);
    expect(clampInterval(30)).toBe(30);
    expect(clampInterval('60')).toBe(60);
    expect(clampInterval(12.7)).toBe(13);
    expect(clampInterval(301)).toBe(301);
  });

  it('falls back to five seconds for junk and values below the one-second boundary', () => {
    for (const value of ['abc', '', null, undefined, 0, 0.99, -5, Number.NaN, Infinity]) {
      expect(clampInterval(value)).toBe(5);
    }
  });
});

describe('refresh interval persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    backend.get.mockReset();
    backend.set.mockReset().mockResolvedValue(undefined);
    backend.save.mockReset().mockResolvedValue(undefined);
  });

  it('defaults a new user to five seconds, including after empty hydrate', async () => {
    const store = await fresh();
    expect(get(store)).toBe(5);
    await store.hydrate();
    expect(get(store)).toBe(5);
  });

  it('keeps an old localStorage value before hydrate', async () => {
    localStorage.setItem('omnyssh-refresh-interval', '30');
    const store = await fresh();
    expect(get(store)).toBe(30);
    await store.hydrate();
    expect(get(store)).toBe(30);
  });

  it('hydrates the saved old interval and mirrors it without rewriting the canonical store', async () => {
    backend.get.mockResolvedValue(120);
    const store = await fresh();
    await store.hydrate();
    expect(backend.get).toHaveBeenCalledWith('refreshInterval');
    expect(get(store)).toBe(120);
    expect(localStorage.getItem('omnyssh-refresh-interval')).toBe('120');
    expect(backend.set).not.toHaveBeenCalled();
  });

  it('persists two seconds and does not let hydrate overwrite a fresh user choice', async () => {
    backend.get.mockResolvedValue(30);
    const store = await fresh();
    store.set(2);
    await store.hydrate();
    expect(get(store)).toBe(2);
    expect(localStorage.getItem('omnyssh-refresh-interval')).toBe('2');
    await vi.waitFor(() => {
      expect(backend.set).toHaveBeenCalledWith('refreshInterval', 2);
      expect(backend.save).toHaveBeenCalled();
    });
  });
});

describe('driveMetricsRefresh', () => {
  beforeEach(() => refreshInterval.set(5));

  it('arms on the current interval, re-arms when it changes, and disposes cleanly', () => {
    const refresh = vi.fn();
    let nextId = 1;
    const cleared: number[] = [];
    const armed: Array<{ ms: number; id: number }> = [];
    const fakeSet = ((_fn: () => void, ms?: number) => {
      const id = nextId++;
      armed.push({ ms: ms ?? 0, id });
      return id;
    }) as unknown as typeof setInterval;
    const fakeClear = ((id?: number) => {
      if (id !== undefined) cleared.push(id);
    }) as unknown as typeof clearInterval;

    const stop = driveMetricsRefresh(refresh, fakeSet, fakeClear);
    expect(armed).toEqual([{ ms: 5_000, id: 1 }]);

    refreshInterval.set(2);
    expect(cleared).toEqual([1]);
    expect(armed.at(-1)).toEqual({ ms: 2_000, id: 2 });

    refreshInterval.set(30);
    expect(cleared).toEqual([1, 2]);
    expect(armed.at(-1)).toEqual({ ms: 30_000, id: 3 });

    stop();
    expect(cleared).toEqual([1, 2, 3]);
    refreshInterval.set(10);
    expect(armed).toHaveLength(3);
  });

  it('invokes the provided refresh callback as the timer body', () => {
    const refresh = vi.fn();
    let body: (() => void) | undefined;
    const fakeSet = ((fn: () => void) => {
      body = fn;
      return 1;
    }) as unknown as typeof setInterval;
    const fakeClear = (() => {}) as unknown as typeof clearInterval;

    const stop = driveMetricsRefresh(refresh, fakeSet, fakeClear);
    body?.();
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });
});
