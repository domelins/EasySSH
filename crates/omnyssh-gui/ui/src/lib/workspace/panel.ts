import { lastError } from '$lib/stores/notifications';

// Detached panel windows (tech-gui.md §2, §3.3). A panel can be lifted out of the
// workspace into its own WebviewWindow, which loads the same SPA with
// `?panel=…&host=…` and renders only that panel. The main window keeps the
// workspace; closing the detached window leaves it untouched.

export type DetachedPanel = 'files' | 'monitor';

export interface DetachedTarget {
  panel: DetachedPanel;
  host: string;
}

const PANELS: readonly DetachedPanel[] = ['files', 'monitor'];

/** Read the detached-panel parameters out of a URL (null in the main window). */
export function detachedTarget(url: URL): DetachedTarget | null {
  const panel = url.searchParams.get('panel');
  const host = url.searchParams.get('host');
  if (!host || !PANELS.includes(panel as DetachedPanel)) return null;
  return { panel: panel as DetachedPanel, host };
}

/** The URL a detached window loads. */
export function panelUrl(panel: DetachedPanel, host: string): string {
  return `/?panel=${panel}&host=${encodeURIComponent(host)}`;
}

/** A stable window label per panel and host, so reopening focuses instead of duplicating. */
export function panelLabel(panel: DetachedPanel, host: string): string {
  return `panel-${panel}-${host}`.replace(/[^a-zA-Z0-9:_-]/g, '-');
}

/**
 * Open (or focus) the detached window for one panel. Off Tauri — tests, a plain
 * browser — there is no window to create, and the caller's error surface says so
 * instead of failing silently.
 */
export async function openDetachedPanel(panel: DetachedPanel, host: string): Promise<void> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const label = panelLabel(panel, host);
    // Reopening focuses the window instead of stacking a duplicate. A core whose
    // lookup is unavailable must not stop the window from opening at all.
    let existing: InstanceType<typeof WebviewWindow> | null = null;
    try {
      existing = await WebviewWindow.getByLabel(label);
    } catch {
      existing = null;
    }
    if (existing) {
      await existing.setFocus();
      return;
    }
    const window = new WebviewWindow(label, {
      url: panelUrl(panel, host),
      title: `OmnySSH · ${host}`,
      width: panel === 'monitor' ? 420 : 520,
      height: 720,
      minWidth: 300,
      minHeight: 320,
      resizable: true
    });
    // The window reports a creation failure asynchronously, never by throwing.
    void window.once('tauri://error', (event) => {
      lastError.set(`面板窗口打开失败：${String(event.payload)}`);
    });
  } catch (err) {
    lastError.set(`面板窗口打开失败：${err instanceof Error ? err.message : String(err)}`);
  }
}
