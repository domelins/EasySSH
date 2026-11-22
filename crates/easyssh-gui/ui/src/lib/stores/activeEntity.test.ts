import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { activeEntity } from './activeEntity';

// The exactly-one-active invariant (tech-gui.md §2): Content shows one selector or
// one session, never both. Because activeEntity is a single tagged value, exclusivity
// is structural — these assert the transitions a user drives.
describe('activeEntity — exactly one active', () => {
  beforeEach(() => activeEntity.selectDashboard());

  it('defaults to the dashboard selector', () => {
    expect(get(activeEntity)).toEqual({ kind: 'dashboard' });
  });

  it('activating a session deactivates the selectors', () => {
    activeEntity.selectSnippets();
    activeEntity.activateSession(7);
    expect(get(activeEntity)).toEqual({ kind: 'session', id: 7 });
  });

  it('selecting a selector deactivates the active session', () => {
    activeEntity.activateSession(7);
    activeEntity.selectDashboard();
    expect(get(activeEntity)).toEqual({ kind: 'dashboard' });
  });

  it('the two selectors are mutually exclusive', () => {
    activeEntity.selectSnippets();
    expect(get(activeEntity)).toEqual({ kind: 'snippets' });
    activeEntity.selectDashboard();
    expect(get(activeEntity)).toEqual({ kind: 'dashboard' });
  });

  it('an empty host workspace is an active entity like any other', () => {
    activeEntity.activateSession(7);
    activeEntity.activateHost('web-1');
    expect(get(activeEntity)).toEqual({ kind: 'host', hostName: 'web-1' });
    activeEntity.activateSession(8);
    expect(get(activeEntity)).toEqual({ kind: 'session', id: 8 });
    activeEntity.activateHost('web-1');
    activeEntity.selectSettings();
    expect(get(activeEntity)).toEqual({ kind: 'settings' });
  });
});
