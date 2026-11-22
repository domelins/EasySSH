// Sorting for the monitor's process table (tech-gui.md §3.3). Pure so the
// ordering rules — and the fallback when a host only reports its top three —
// are unit-tested without a DOM.

import type { ProcessDto, ProcessEntryDto } from '$lib/bindings';

/** One row the table can show: either the core's full entry or the top-three fallback. */
export interface ProcessRow {
  /** 0 when the host only reported its top three, which carry no PID. */
  pid: number;
  command: string;
  cpuPercent: number;
  memPercent: number;
}

export type ProcessSort = 'cpu' | 'mem' | 'pid';

/**
 * The rows the table shows. A host that reports the full list gets it; one that
 * only has the top-three snapshot (an older core, or a platform whose `ps`
 * failed) still shows those rows, marked as PID-less.
 */
export function processRows(
  entries: ProcessEntryDto[] | undefined,
  top: ProcessDto[] | undefined
): ProcessRow[] {
  if (entries && entries.length > 0) {
    return entries.map((entry) => ({
      pid: entry.pid,
      command: entry.command,
      cpuPercent: entry.cpuPercent,
      memPercent: entry.memPercent
    }));
  }
  return (top ?? []).map((process) => ({
    pid: 0,
    command: process.name,
    cpuPercent: process.cpuPercent,
    memPercent: process.memPercent
  }));
}

/** Sort a copy: CPU or memory descending by default, PID ascending. */
export function sortProcesses(
  rows: ProcessRow[],
  key: ProcessSort,
  descending: boolean
): ProcessRow[] {
  const direction = descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const delta =
      key === 'pid'
        ? a.pid - b.pid
        : key === 'mem'
          ? a.memPercent - b.memPercent
          : a.cpuPercent - b.cpuPercent;
    // A stable tie-break on the command keeps equal rows from jumping between
    // samples, which would make the table look like it is flickering.
    return delta !== 0 ? delta * direction : a.command.localeCompare(b.command);
  });
}

/** The default direction for a column: the busiest first, the lowest PID first. */
export function defaultDescending(key: ProcessSort): boolean {
  return key !== 'pid';
}
