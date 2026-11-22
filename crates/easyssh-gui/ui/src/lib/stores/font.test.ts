// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clampFamily, clampSize, DEFAULT_FAMILY, DEFAULT_SIZE } from './font';

const backend = { get: vi.fn(), set: vi.fn(), save: vi.fn() };
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn(async () => backend) }));
vi.mock('$lib/ipc/commands', () => ({
  settingsStorePath: vi.fn(async () => 'settings.json')
}));

async function freshFont() {
  vi.resetModules();
  return (await import('./font')).terminalFont;
}

describe('clamp helpers', () => {
  it('keeps a named family and falls back for empty values', () => {
    expect(clampFamily('Consolas')).toBe('Consolas');
    expect(clampFamily('')).toBe(DEFAULT_FAMILY);
    expect(clampFamily(null)).toBe(DEFAULT_FAMILY);
  });

  it('rounds and bounds the size', () => {
    expect(clampSize(15)).toBe(15);
    expect(clampSize('16')).toBe(16);
    expect(clampSize(14.6)).toBe(15);
    expect(clampSize(2)).toBe(8);
    expect(clampSize(99)).toBe(32);
    expect(clampSize('nope')).toBe(DEFAULT_SIZE);
    expect(clampSize(null)).toBe(DEFAULT_SIZE);
    expect(clampSize('')).toBe(DEFAULT_SIZE);
  });
});

describe('terminal font store', () => {
  beforeEach(() => {
    localStorage.clear();
    backend.get.mockReset();
    backend.set.mockReset().mockResolvedValue(undefined);
    backend.save.mockReset().mockResolvedValue(undefined);
  });

  it('mirrors a user change and writes the canonical store', async () => {
    const font = await freshFont();
    font.setFamily('Consolas');
    font.setSize(16);
    expect(localStorage.getItem('omnyssh-font-family')).toBe('Consolas');
    expect(localStorage.getItem('omnyssh-font-size')).toBe('16');
    await vi.waitFor(() => {
      expect(backend.set).toHaveBeenCalledWith('fontFamily', 'Consolas');
      expect(backend.set).toHaveBeenCalledWith('fontSize', 16);
      expect(backend.save).toHaveBeenCalled();
    });
  });

  it('seeds from the mirror before hydrate', async () => {
    localStorage.setItem('omnyssh-font-family', 'Fira Code');
    localStorage.setItem('omnyssh-font-size', '18');
    const font = await freshFont();
    let value = { family: '', size: 0 };
    font.subscribe((f) => (value = f))();
    expect(value).toEqual({ family: 'Fira Code', size: 18 });
  });

  it('hydrate applies stored values and does not clobber a fresh choice', async () => {
    backend.get.mockImplementation(async (key: string) =>
      key === 'fontFamily' ? 'JetBrains Mono' : key === 'fontSize' ? 20 : undefined
    );
    const font = await freshFont();
    await font.hydrate();
    let value = { family: '', size: 0 };
    font.subscribe((f) => (value = f))();
    expect(value).toEqual({ family: 'JetBrains Mono', size: 20 });

    // A second fresh store: the user acts before the async hydrate resolves.
    const font2 = await freshFont();
    font2.setSize(12);
    await font2.hydrate();
    font2.subscribe((f) => (value = f))();
    expect(value.size).toBe(12);
  });
});