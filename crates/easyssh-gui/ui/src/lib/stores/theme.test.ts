// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { theme, THEME_IDS, themeMode } from './theme';

// Tauri persistence (tauri-plugin-store) and the native window follow lazily and
// no-op off-runtime; the unit-testable contract is the document attribute and the
// localStorage mirror the no-FOUC boot reads (tech-gui.md §5.1).
describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
    theme.set('dark');
  });

  it('sets data-theme and mirrors to localStorage', () => {
    theme.set('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('easyssh-theme')).toBe('light');
    expect(get(theme)).toBe('light');
  });

  it('every theme id paints its attribute and mirror', () => {
    for (const id of THEME_IDS) {
      theme.set(id);
      expect(document.documentElement.getAttribute('data-theme')).toBe(id);
      expect(localStorage.getItem('easyssh-theme')).toBe(id);
      expect(get(theme)).toBe(id);
    }
  });

  it('toggle flips dark↔light and re-persists each time', () => {
    theme.toggle();
    expect(get(theme)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('easyssh-theme')).toBe('light');

    theme.toggle();
    expect(get(theme)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('easyssh-theme')).toBe('dark');
  });

  it('toggle flips by base mode, not by id', () => {
    theme.set('ocean'); // dark-based
    theme.toggle();
    expect(get(theme)).toBe('light');

    theme.set('sakura'); // light-based
    theme.toggle();
    expect(get(theme)).toBe('dark');
  });

  it('themeMode maps each id to its native-window base', () => {
    expect(THEME_IDS.map(themeMode)).toEqual([
      'light',
      'dark',
      'dark',
      'dark',
      'light',
      'dark',
      'dark'
    ]);
  });
});
