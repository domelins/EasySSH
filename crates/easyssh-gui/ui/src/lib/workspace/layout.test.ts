import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  MAX_PANE,
  MIN_PANE,
  MIN_TERMINAL,
  SPLITTER,
  clampWidth,
  computePanes,
  layoutFor,
  panelVisible,
  parseLayouts,
  resizePane,
  serializeLayouts,
  toggleCollapse,
  toggleMaximize,
  type WorkspaceLayout
} from './layout';

const layout = (patch: Partial<WorkspaceLayout> = {}): WorkspaceLayout => ({
  ...DEFAULT_LAYOUT,
  ...patch
});

describe('pane widths', () => {
  it('keeps a pane inside the legible range', () => {
    expect(clampWidth(10)).toBe(MIN_PANE);
    expect(clampWidth(10_000)).toBe(MAX_PANE);
    expect(clampWidth(320.4)).toBe(320);
    expect(clampWidth(Number.NaN)).toBe(MIN_PANE);
  });
});

describe('computePanes', () => {
  it('lays the saved widths out beside the terminal', () => {
    const panes = computePanes(layout({ leftWidth: 280, rightWidth: 320 }), 1400);
    expect(panes).toMatchObject({ left: 280, right: 320, leftVisible: true, rightVisible: true });
    expect(panes.center).toBe(1400 - 280 - 320 - SPLITTER * 2);
  });

  it('gives a collapsed pane no width and no gutter', () => {
    const panes = computePanes(layout({ leftCollapsed: true }), 1400);
    expect(panes.left).toBe(0);
    expect(panes.leftVisible).toBe(false);
    expect(panes.center).toBe(1400 - 320 - SPLITTER);
  });

  it('shrinks the monitor pane first, then the file pane, before dropping either', () => {
    // 900 px: the stored 280 + 320 + gutters leaves the terminal under MIN_TERMINAL,
    // but both panes still fit at MIN_PANE.
    const narrow = computePanes(layout({ leftWidth: 280, rightWidth: 320 }), 900);
    expect(narrow.leftVisible).toBe(true);
    expect(narrow.rightVisible).toBe(true);
    expect(narrow.right).toBeLessThan(320);
    expect(narrow.left).toBeGreaterThanOrEqual(MIN_PANE);
    expect(narrow.center).toBeGreaterThanOrEqual(MIN_TERMINAL);
    expect(narrow.left + narrow.right + narrow.center + SPLITTER * 2).toBe(900);
  });

  it('drops the side panes rather than crushing the terminal', () => {
    const tiny = computePanes(layout(), 500);
    expect(tiny.leftVisible).toBe(false);
    expect(tiny.rightVisible).toBe(false);
    expect(tiny.center).toBe(500);
  });

  it('maximizes one pane over the whole workspace', () => {
    const files = computePanes(layout({ maximized: 'files' }), 1000);
    expect(files).toEqual({
      left: 1000,
      right: 0,
      center: 0,
      leftVisible: true,
      rightVisible: false,
      maximized: 'files'
    });
    const terminal = computePanes(layout({ maximized: 'terminal' }), 1000);
    expect(terminal.center).toBe(1000);
    expect(terminal.leftVisible || terminal.rightVisible).toBe(false);
    expect(panelVisible(terminal, 'terminal')).toBe(true);
    expect(panelVisible(terminal, 'monitor')).toBe(false);
  });
});

describe('resizePane', () => {
  it('applies a drag inside the allowed range', () => {
    const next = resizePane(layout(), 'left', 360, 1400);
    expect(next.leftWidth).toBe(360);
  });

  it('never widens a pane past what the terminal needs', () => {
    const next = resizePane(layout(), 'left', 900, 1000);
    expect(next.leftWidth).toBeLessThanOrEqual(1000 - 320 - SPLITTER * 2 - MIN_TERMINAL);
    expect(next.leftWidth).toBeGreaterThanOrEqual(MIN_PANE);
  });

  it('expands a collapsed pane when its gutter is dragged', () => {
    const next = resizePane(layout({ leftCollapsed: true }), 'right', 300, 1400);
    expect(next.rightCollapsed).toBe(false);
    expect(next.rightWidth).toBe(300);
  });
});

describe('collapse and maximize', () => {
  it('toggles each side independently', () => {
    const left = toggleCollapse(layout(), 'left');
    expect(left.leftCollapsed).toBe(true);
    expect(left.rightCollapsed).toBe(false);
    expect(toggleCollapse(left, 'left').leftCollapsed).toBe(false);
  });

  it('leaves a maximized pane when one is folded away', () => {
    const maximized = toggleMaximize(layout(), 'monitor');
    expect(maximized.maximized).toBe('monitor');
    expect(toggleCollapse(maximized, 'left').maximized).toBeNull();
  });

  it('restores the row when the same pane is maximized again', () => {
    expect(toggleMaximize(toggleMaximize(layout(), 'files'), 'files').maximized).toBeNull();
  });
});

describe('persisted layouts', () => {
  it('parses valid hosts and ignores anything else', () => {
    const map = parseLayouts({
      web: { leftWidth: 9999, rightWidth: 'wide', leftCollapsed: true, maximized: 'nope' },
      db: { leftWidth: 240, activePanel: 'files' },
      '  ': { leftWidth: 300 },
      broken: 42
    });
    expect([...map.keys()]).toEqual(['web', 'db', 'broken']);
    expect(map.get('web')).toMatchObject({
      leftWidth: MAX_PANE,
      rightWidth: DEFAULT_LAYOUT.rightWidth,
      leftCollapsed: true,
      maximized: null,
      activePanel: 'terminal'
    });
    expect(map.get('db')).toMatchObject({ leftWidth: 240, activePanel: 'files' });
    expect(map.get('broken')).toEqual(DEFAULT_LAYOUT);
  });

  it('refuses a non-object payload', () => {
    expect(parseLayouts(null).size).toBe(0);
    expect(parseLayouts([1, 2]).size).toBe(0);
    expect(parseLayouts('nope').size).toBe(0);
  });

  it('serializes host keys in a stable order', () => {
    const map = new Map([
      ['web', layout({ leftWidth: 240 })],
      ['db', layout()]
    ]);
    const json = serializeLayouts(map);
    expect(Object.keys(json)).toEqual(['db', 'web']);
    expect(parseLayouts(json).get('web')?.leftWidth).toBe(240);
  });

  it('falls back to the defaults for an unknown host', () => {
    expect(layoutFor(new Map(), 'web')).toEqual(DEFAULT_LAYOUT);
  });
});
