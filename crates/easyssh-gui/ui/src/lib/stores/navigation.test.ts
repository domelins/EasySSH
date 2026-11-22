import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// A fresh module graph per test isolates the sessions id counter and the active
// entity singleton (tech-gui.md §2). navigation, sessions and activeEntity share
// the graph, so re-importing all three keeps them consistent.
async function fresh() {
  vi.resetModules();
  const nav = await import('./navigation');
  const { sessions } = await import('./sessions');
  const { activeEntity } = await import('./activeEntity');
  const { dashboardView } = await import('./dashboardView');
  return { ...nav, sessions, activeEntity, dashboardView };
}

describe('navigation actions', () => {
  it('spawning a session appends it and makes it active', async () => {
    const { spawnSession, sessions, activeEntity, dashboardView } = await fresh();
    const s = spawnSession('terminal', 'web-1');
    expect(get(sessions)).toHaveLength(1);
    expect(get(activeEntity)).toEqual({ kind: 'session', id: s.id });
    expect(get(dashboardView).recentHosts).toEqual(['web-1']);
  });

  it('allocates unique, monotonic ids', async () => {
    const { spawnSession } = await fresh();
    const a = spawnSession('terminal', 'a');
    const b = spawnSession('terminal', 'b');
    expect(b.id).toBeGreaterThan(a.id);
  });

  it('closing the last terminal of a host stays on that host, empty', async () => {
    const { spawnSession, closeSession, sessions, activeEntity } = await fresh();
    const a = spawnSession('terminal', 'a');
    const b = spawnSession('terminal', 'b'); // b becomes the active session
    closeSession(b.id);
    expect(get(sessions).map((s) => s.id)).toEqual([a.id]);
    expect(get(activeEntity)).toEqual({ kind: 'host', hostName: 'b' });
  });

  it('closing a terminal activates the next tab of the same host', async () => {
    const { spawnSession, closeSession, activeEntity } = await fresh();
    const a = spawnSession('terminal', 'web');
    const b = spawnSession('terminal', 'web');
    const c = spawnSession('terminal', 'web');
    closeSession(b.id); // c sits after b in the strip
    expect(get(activeEntity)).toEqual({ kind: 'session', id: c.id });
    closeSession(c.id); // nothing after c: fall back to the last sibling
    expect(get(activeEntity)).toEqual({ kind: 'session', id: a.id });
  });

  it('closing an inactive session leaves the active entity untouched', async () => {
    const { spawnSession, closeSession, activeEntity } = await fresh();
    const a = spawnSession('terminal', 'a');
    const b = spawnSession('terminal', 'b'); // b active
    closeSession(a.id);
    expect(get(activeEntity)).toEqual({ kind: 'session', id: b.id });
  });

  it('closeHost closes every terminal of the host and lands on the leftmost rest', async () => {
    const { spawnSession, closeHost, sessions, activeEntity } = await fresh();
    const a = spawnSession('terminal', 'a');
    spawnSession('terminal', 'b');
    const b2 = spawnSession('terminal', 'b'); // active, host b
    closeHost('b');
    expect(get(sessions).map((s) => s.id)).toEqual([a.id]);
    expect(get(activeEntity)).toEqual({ kind: 'session', id: a.id });
    expect(b2.id).toBeGreaterThan(a.id);
  });

  it('closeHost of the last host falls back to the dashboard', async () => {
    const { spawnSession, closeHost, sessions, activeEntity } = await fresh();
    spawnSession('terminal', 'a');
    closeHost('a');
    expect(get(sessions)).toEqual([]);
    expect(get(activeEntity)).toEqual({ kind: 'dashboard' });
  });

  it('closeHost of a host that is not on screen leaves the entity alone', async () => {
    const { spawnSession, closeHost, activeEntity } = await fresh();
    spawnSession('terminal', 'a');
    const b = spawnSession('terminal', 'b'); // active
    closeHost('a');
    expect(get(activeEntity)).toEqual({ kind: 'session', id: b.id });
  });

  it('closeHost also dismisses an empty host workspace', async () => {
    const { spawnSession, closeSession, closeHost, activeEntity } = await fresh();
    const a = spawnSession('terminal', 'a');
    closeSession(a.id); // host entity for a
    closeHost('a');
    expect(get(activeEntity)).toEqual({ kind: 'dashboard' });
  });
});
