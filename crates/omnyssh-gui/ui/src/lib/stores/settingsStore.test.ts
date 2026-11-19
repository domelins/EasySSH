import { beforeEach, describe, expect, it, vi } from 'vitest';

// The helper resolves the store location through the backend once, then hands the
// absolute path to tauri-plugin-store. Both layers are faked: Vitest has no Tauri.
const backend = { get: vi.fn(), set: vi.fn(), save: vi.fn() };
const load = vi.fn(async () => backend);
vi.mock('@tauri-apps/plugin-store', () => ({ load }));
const settingsStorePath = vi.fn();
vi.mock('$lib/ipc/commands', () => ({ settingsStorePath }));

async function freshLoader() {
  vi.resetModules();
  return (await import('./settingsStore')).loadSettingsStore;
}

describe('shared settings store loader', () => {
  beforeEach(() => {
    load.mockClear();
    settingsStorePath.mockReset();
  });

  it('loads the store at the path the backend resolved', async () => {
    settingsStorePath.mockResolvedValue('D:/portable/omnyssh-data/settings.json');
    const loadSettingsStore = await freshLoader();
    const store = await loadSettingsStore();
    expect(store).toBe(backend);
    expect(load).toHaveBeenCalledWith('D:/portable/omnyssh-data/settings.json');
  });

  it('resolves the path once for every caller', async () => {
    settingsStorePath.mockResolvedValue('D:/portable/omnyssh-data/settings.json');
    const loadSettingsStore = await freshLoader();
    await loadSettingsStore();
    await loadSettingsStore();
    expect(settingsStorePath).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('falls back to the relative path when the command is unreachable, and retries', async () => {
    settingsStorePath.mockRejectedValue(new Error('no Tauri'));
    const loadSettingsStore = await freshLoader();
    await loadSettingsStore();
    expect(load).toHaveBeenLastCalledWith('settings.json');
    // A failed resolution is not pinned: the next call asks again (an older backend
    // may be replaced by a newer one mid-session in dev).
    await loadSettingsStore();
    expect(settingsStorePath).toHaveBeenCalledTimes(2);
  });
});