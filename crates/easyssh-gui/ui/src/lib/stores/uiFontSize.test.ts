// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clampUiSize, DEFAULT_UI_SIZE } from './uiFontSize';

const backend = { get: vi.fn(), set: vi.fn(), save: vi.fn() };
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn(async () => backend) }));
vi.mock('$lib/ipc/commands', () => ({
  settingsStorePath: vi.fn(async () => 'settings.json')
}));

async function freshUiFontSize() {
  vi.resetModules();
  return (await import('./uiFontSize')).uiFontSize;
}

describe('clampUiSize', () => {
  it('rounds and bounds the size', () => {
    expect(clampUiSize(16)).toBe(16);
    expect(clampUiSize('14')).toBe(14);
    expect(clampUiSize(15.6)).toBe(16);
    expect(clampUiSize(2)).toBe(12);
    expect(clampUiSize(99)).toBe(20);
    expect(clampUiSize('nope')).toBe(DEFAULT_UI_SIZE);
    expect(clampUiSize(null)).toBe(DEFAULT_UI_SIZE);
    expect(clampUiSize('')).toBe(DEFAULT_UI_SIZE);
  });
});

describe('ui font size store', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.fontSize = '';
    backend.get.mockReset();
    backend.set.mockReset().mockResolvedValue(undefined);
    backend.save.mockReset().mockResolvedValue(undefined);
  });

  it('a user change scales the root, mirrors, and writes the canonical store', async () => {
    const size = await freshUiFontSize();
    size.set(18);
    expect(document.documentElement.style.fontSize).toBe('18px');
    expect(localStorage.getItem('omnyssh-ui-font-size')).toBe('18');
    await vi.waitFor(() => {
      expect(backend.set).toHaveBeenCalledWith('uiFontSize', 18);
      expect(backend.save).toHaveBeenCalled();
    });
  });

  it('seeds from the mirror before hydrate and applies it to the root', async () => {
    localStorage.setItem('omnyssh-ui-font-size', '14');
    const size = await freshUiFontSize();
    let value = 0;
    size.subscribe((v) => (value = v))();
    expect(value).toBe(14);
    expect(document.documentElement.style.fontSize).toBe('14px');
  });

  it('hydrate applies the stored value and does not clobber a fresh choice', async () => {
    backend.get.mockResolvedValue(20);
    const size = await freshUiFontSize();
    await size.hydrate();
    let value = 0;
    size.subscribe((v) => (value = v))();
    expect(value).toBe(20);
    expect(document.documentElement.style.fontSize).toBe('20px');

    // A second fresh store: the user acts before the async hydrate resolves.
    const size2 = await freshUiFontSize();
    size2.set(12);
    await size2.hydrate();
    size2.subscribe((v) => (value = v))();
    expect(value).toBe(12);
  });

  it('hydrate ignores a non-numeric stored value', async () => {
    backend.get.mockResolvedValue('big');
    const size = await freshUiFontSize();
    await size.hydrate();
    let value = 0;
    size.subscribe((v) => (value = v))();
    expect(value).toBe(DEFAULT_UI_SIZE);
  });
});