// The connection workspace's three-pane geometry (tech-gui.md §2, §3.1): remote files on
// the left, the terminal in the middle, live monitoring on the right. Everything here is
// pure so the drag/clamp/collapse rules are unit-tested without a DOM; the components
// only render what `computePanes` returns.

/** The three panels a host workspace can show. */
export type WorkspacePanel = 'files' | 'terminal' | 'monitor';

/** A side pane's collapse state, the stored widths and which pane is maximized. */
export interface WorkspaceLayout {
  /** Requested width of the remote-files pane, in CSS pixels. */
  leftWidth: number;
  /** Requested width of the monitor pane, in CSS pixels. */
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** A pane temporarily taking the whole workspace, hiding the other two. */
  maximized: WorkspacePanel | null;
  /** The pane that owns the workspace's focus/last interaction. */
  activePanel: WorkspacePanel;
}

/** A resized pane never goes below this, so a tree/table stays legible. */
export const MIN_PANE = 240;
/** ...nor above this, so the terminal keeps the majority of a wide window. */
export const MAX_PANE = 560;
/** The terminal never shrinks below this before the side panes give way. */
export const MIN_TERMINAL = 340;
/** The draggable gutter between two panes. */
export const SPLITTER = 5;

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  leftWidth: 280,
  rightWidth: 320,
  leftCollapsed: false,
  rightCollapsed: false,
  maximized: null,
  activePanel: 'terminal'
};

/** Keep a requested pane width inside the legible range. */
export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_PANE;
  return Math.round(Math.min(MAX_PANE, Math.max(MIN_PANE, width)));
}

/** What the view actually lays out for the current container width. A collapsed,
 *  hidden or maximized-away pane gets `0` (and its gutter `0`), so the terminal takes
 *  every pixel the panes do not claim. */
export interface PaneGeometry {
  left: number;
  right: number;
  center: number;
  leftVisible: boolean;
  rightVisible: boolean;
  maximized: WorkspacePanel | null;
}

/**
 * Resolve the requested layout against the space the workspace actually has.
 *
 * Panes keep their stored widths while both fit beside `MIN_TERMINAL`; beyond that the
 * right pane yields first (it is the one a user is likeliest to fold away on a narrow
 * window), then the left, and only when even `MIN_PANE` no longer fits is a pane
 * dropped from the row. Nothing here mutates the stored layout: a window that is
 * narrowed and widened again comes back to the widths the user chose.
 */
export function computePanes(layout: WorkspaceLayout, container: number): PaneGeometry {
  const max = layout.maximized;
  if (max === 'files') {
    return { left: Math.max(0, container), right: 0, center: 0, leftVisible: true, rightVisible: false, maximized: max };
  }
  if (max === 'monitor') {
    return { left: 0, right: Math.max(0, container), center: 0, leftVisible: false, rightVisible: true, maximized: max };
  }
  if (max === 'terminal') {
    return { left: 0, right: 0, center: Math.max(0, container), leftVisible: false, rightVisible: false, maximized: max };
  }

  const width = Math.max(0, container);
  let leftVisible = !layout.leftCollapsed;
  let rightVisible = !layout.rightCollapsed;
  let left = leftVisible ? clampWidth(layout.leftWidth) : 0;
  let right = rightVisible ? clampWidth(layout.rightWidth) : 0;

  const gutter = (): number => (leftVisible ? SPLITTER : 0) + (rightVisible ? SPLITTER : 0);
  const fits = (): boolean => left + right + gutter() + MIN_TERMINAL <= width;

  // Right pane gives way first, down to its own minimum; then the left one.
  if (!fits() && rightVisible) {
    right = Math.max(MIN_PANE, right - (left + right + gutter() + MIN_TERMINAL - width));
  }
  if (!fits() && leftVisible) {
    left = Math.max(MIN_PANE, left - (left + right + gutter() + MIN_TERMINAL - width));
  }
  // Still no room for the terminal: drop the right pane, then the left.
  if (!fits() && rightVisible) {
    rightVisible = false;
    right = 0;
  }
  if (!fits() && leftVisible) {
    leftVisible = false;
    left = 0;
  }

  const center = Math.max(0, width - left - right - gutter());
  return { left, right, center, leftVisible, rightVisible, maximized: null };
}

/**
 * A drag on the gutter beside `side`, as the new width for that pane.
 *
 * The pane is clamped to its own range and to what the terminal needs; asking for more
 * than that leaves the width where it is instead of crowding the terminal out.
 */
export function resizePane(
  layout: WorkspaceLayout,
  side: 'left' | 'right',
  nextWidth: number,
  container: number
): WorkspaceLayout {
  const width = Math.max(0, container);
  const otherVisible = side === 'left' ? !layout.rightCollapsed : !layout.leftCollapsed;
  const otherWidth = otherVisible
    ? side === 'left'
      ? clampWidth(layout.rightWidth)
      : clampWidth(layout.leftWidth)
    : 0;
  const gutters = SPLITTER * ((otherVisible ? 1 : 0) + 1);
  const room = Math.max(MIN_PANE, width - otherWidth - gutters - MIN_TERMINAL);
  const width2 = Math.max(MIN_PANE, Math.min(clampWidth(nextWidth), room, MAX_PANE));
  return side === 'left'
    ? { ...layout, leftWidth: width2, leftCollapsed: false }
    : { ...layout, rightWidth: width2, rightCollapsed: false };
}

/** Collapse or expand a side pane; a pane that was maximized stops being so. */
export function toggleCollapse(layout: WorkspaceLayout, side: 'left' | 'right'): WorkspaceLayout {
  if (side === 'left') {
    return { ...layout, leftCollapsed: !layout.leftCollapsed, maximized: null };
  }
  return { ...layout, rightCollapsed: !layout.rightCollapsed, maximized: null };
}

/** Maximize a pane, or restore the three-pane row when it already is. */
export function toggleMaximize(layout: WorkspaceLayout, panel: WorkspacePanel): WorkspaceLayout {
  return { ...layout, maximized: layout.maximized === panel ? null : panel };
}

/** Whether a pane is on screen under `geometry` (for focus and lazy loading). */
export function panelVisible(geometry: PaneGeometry, panel: WorkspacePanel): boolean {
  if (panel === 'files') return geometry.leftVisible;
  if (panel === 'monitor') return geometry.rightVisible;
  return geometry.center > 0;
}

const PANELS: readonly WorkspacePanel[] = ['files', 'terminal', 'monitor'];

function parseLayout(raw: unknown): WorkspaceLayout {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  return {
    leftWidth: typeof v.leftWidth === 'number' ? clampWidth(v.leftWidth) : DEFAULT_LAYOUT.leftWidth,
    rightWidth: typeof v.rightWidth === 'number' ? clampWidth(v.rightWidth) : DEFAULT_LAYOUT.rightWidth,
    leftCollapsed: bool(v.leftCollapsed, false),
    rightCollapsed: bool(v.rightCollapsed, false),
    maximized: PANELS.find((panel) => panel === v.maximized) ?? null,
    activePanel: PANELS.find((panel) => panel === v.activePanel) ?? 'terminal'
  };
}

/** Coerce an untrusted persisted map (`host → layout`) into valid layouts. */
export function parseLayouts(raw: unknown): Map<string, WorkspaceLayout> {
  const out = new Map<string, WorkspaceLayout>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [host, layout] of Object.entries(raw as Record<string, unknown>)) {
    const name = host.trim();
    if (name) out.set(name, parseLayout(layout));
  }
  return out;
}

/** The storable form of the layout map (plain objects, host name keys). */
export function serializeLayouts(map: Map<string, WorkspaceLayout>): Record<string, WorkspaceLayout> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** The layout for a host: its saved one, or the defaults. */
export function layoutFor(
  map: Map<string, WorkspaceLayout>,
  hostName: string
): WorkspaceLayout {
  return map.get(hostName) ?? DEFAULT_LAYOUT;
}
