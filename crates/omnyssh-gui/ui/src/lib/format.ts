// Byte formatting shared by the monitor pane and the dashboard row (tech-gui.md §4.1).
// Kept in one place so a rate in the host list reads exactly like the same rate in the
// panel it came from.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** A byte count at a readable scale; an em dash when there is no value. */
export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  // Drop a trailing zero: "1 MB", not "1.0 MB"; "512 KB", not "512.0 KB".
  const digits = unit === 0 || scaled >= 100 ? 0 : 1;
  return `${Number(scaled.toFixed(digits))} ${UNITS[unit]}`;
}

/** A per-second throughput, e.g. "1.5 MB/s". */
export function formatRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  return `${formatBytes(value)}/s`;
}
