import { describe, expect, it } from 'vitest';
import { xtermTheme } from './terminalTheme';
import { THEME_IDS } from '$lib/stores/theme';

// The xterm theme is derived from the app.css tokens and pushed to every live
// terminal on toggle (tech-gui.md §5.1). Every theme must differ on the surfaces
// a toggle re-paints, and each must define the full colour set xterm renders from —
// otherwise a toggle would leave a terminal half-themed.
const ANSI = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite'
] as const;

describe('xtermTheme', () => {
  it('light and dark differ on the load-bearing surfaces', () => {
    const light = xtermTheme('light');
    const dark = xtermTheme('dark');
    expect(dark.background).not.toBe(light.background);
    expect(dark.foreground).not.toBe(light.foreground);
    expect(dark.cursor).not.toBe(light.cursor);
  });

  it('every theme defines background, foreground, cursor and all 16 ANSI colours', () => {
    for (const id of THEME_IDS) {
      const theme = xtermTheme(id);
      expect(theme.background, `${id} background`).toBeTruthy();
      expect(theme.foreground, `${id} foreground`).toBeTruthy();
      expect(theme.cursor, `${id} cursor`).toBeTruthy();
      for (const name of ANSI) expect(theme[name], `${id} missing ${name}`).toBeTruthy();
    }
  });

  it('every theme has a distinct terminal background', () => {
    const backgrounds = THEME_IDS.map((id) => xtermTheme(id).background);
    expect(new Set(backgrounds).size).toBe(THEME_IDS.length);
  });
});
