// xterm renders outside the DOM/CSS-variable system, so its colours can't be CSS
// tokens — they're derived here from the brandbook's ink/paper language (§5.1) and
// pushed to every live terminal on theme toggle. Background/foreground/cursor mirror
// the `--surface`/`--text`/`--accent` tokens; the 16 ANSI colours are the terminal's
// content palette (what remote programs emit), reusing the app's server-state colours
// for red/green/yellow and cool blue/violet accents to stay on the monochrome brand
// tone. Both maps are tuned for AA-legible reading on their surface.
import type { ITheme } from '@xterm/xterm';
import type { Theme } from '$lib/stores/theme';

const dark: ITheme = {
  background: '#212121', // --surface (dark)
  foreground: '#e4e7ec', // paper, softened for sustained reading
  cursor: '#ffffff', // --accent (dark)
  cursorAccent: '#212121',
  selectionBackground: 'rgba(255, 255, 255, 0.18)',
  black: '#3a3f45',
  red: '#f07777', // --status-crit (dark)
  green: '#5fd08a', // --status-ok (dark)
  yellow: '#e8c15a', // --status-warn (dark)
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#c8ccd4',
  brightBlack: '#5b6066', // graphite
  brightRed: '#ff8f8f',
  brightGreen: '#7fe0a3',
  brightYellow: '#f0d178',
  brightBlue: '#9ab8ff',
  brightMagenta: '#d0b8ff',
  brightCyan: '#9ee0ff',
  brightWhite: '#ffffff'
};

const light: ITheme = {
  background: '#ffffff', // --surface (light)
  foreground: '#1f2937', // --text (light)
  cursor: '#22c55e', // --accent (light)
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(31, 41, 55, 0.15)',
  black: '#1f2937',
  red: '#ef4444', // --status-crit (light)
  green: '#22c55e', // --status-ok (light)
  yellow: '#f59e0b', // --status-warn (light)
  blue: '#2f6feb',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#9ca3af', // --text-faint (light)
  brightBlack: '#6b7280', // --text-muted (light)
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fbbf24',
  brightBlue: '#4785ff',
  brightMagenta: '#9a5cf0',
  brightCyan: '#2596a0',
  brightWhite: '#1f2937'
};

const ocean: ITheme = {
  background: '#101a2c', // --surface (ocean)
  foreground: '#e2e8f0', // --text (ocean)
  cursor: '#38bdf8', // --accent (ocean)
  cursorAccent: '#0b1220',
  selectionBackground: 'rgba(56, 189, 248, 0.25)',
  black: '#1e293b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#cbd5e1',
  brightBlack: '#475569',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc'
};

const nord: ITheme = {
  background: '#3b4252', // --surface (nord)
  foreground: '#eceff4', // --text (nord)
  cursor: '#88c0d0', // --accent (nord)
  cursorAccent: '#2e3440',
  selectionBackground: 'rgba(136, 192, 208, 0.25)',
  black: '#3b4252',
  red: '#bf616a',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  blue: '#81a1c1',
  magenta: '#b48ead',
  cyan: '#88c0d0',
  white: '#e5e9f0',
  brightBlack: '#4c566a',
  brightRed: '#d08770',
  brightGreen: '#a3be8c',
  brightYellow: '#ebcb8b',
  brightBlue: '#81a1c1',
  brightMagenta: '#b48ead',
  brightCyan: '#8fbcbb',
  brightWhite: '#eceff4'
};

const sakura: ITheme = {
  background: '#fffafc', // --surface-raised (sakura): a pink tint, distinct from light's white
  foreground: '#4c2a3d', // --text (sakura)
  cursor: '#db2777', // --accent (sakura)
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(219, 39, 119, 0.15)',
  black: '#4c2a3d',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#d97706',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0d9488',
  white: '#c4a3b3',
  brightBlack: '#8b6478',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#f59e0b',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#14b8a6',
  brightWhite: '#4c2a3d'
};

const mocha: ITheme = {
  background: '#2a2320', // --surface (mocha)
  foreground: '#ede0d4', // --text (mocha)
  cursor: '#d99e56', // --accent (mocha)
  cursorAccent: '#201a17',
  selectionBackground: 'rgba(217, 158, 86, 0.25)',
  black: '#3a312b',
  red: '#e76f51',
  green: '#a7c957',
  yellow: '#e9c46a',
  blue: '#83a598',
  magenta: '#d3869b',
  cyan: '#8ec07c',
  white: '#d5c4a1',
  brightBlack: '#665c54',
  brightRed: '#f08a6e',
  brightGreen: '#b8bb26',
  brightYellow: '#fabd2f',
  brightBlue: '#9dbbaa',
  brightMagenta: '#e0a3b3',
  brightCyan: '#a3d18c',
  brightWhite: '#fbf1c7'
};

const violet: ITheme = {
  background: '#201a2e', // --surface (violet)
  foreground: '#ede9fe', // --text (violet)
  cursor: '#a78bfa', // --accent (violet)
  cursorAccent: '#171321',
  selectionBackground: 'rgba(167, 139, 250, 0.25)',
  black: '#322a4d',
  red: '#fca5a5',
  green: '#86efac',
  yellow: '#fcd34d',
  blue: '#93c5fd',
  magenta: '#f0abfc',
  cyan: '#67e8f9',
  white: '#cfc6e8',
  brightBlack: '#5b5178',
  brightRed: '#fecaca',
  brightGreen: '#bbf7d0',
  brightYellow: '#fde68a',
  brightBlue: '#bfdbfe',
  brightMagenta: '#f5d0fe',
  brightCyan: '#a5f3fc',
  brightWhite: '#ffffff'
};

const THEMES: Record<Theme, ITheme> = { dark, light, ocean, nord, sakura, mocha, violet };

/** The xterm theme object for the app theme; applied to every open terminal on toggle. */
export function xtermTheme(theme: Theme): ITheme {
  return THEMES[theme];
}
