import { writable } from 'svelte/store';
import type { MetricsDto } from '$lib/bindings';

/** Latest metrics sample per host, keyed by host name (tech-gui.md §3.5). */
export const metrics = writable<Map<string, MetricsDto>>(new Map());

/**
 * When each host's last sample reached the UI. The DTO's `ageSeconds` is frozen at
 * send time, so on its own it reads "0 秒前" forever once a host stops answering;
 * the panel counts from here instead and the age keeps growing.
 */
export const metricsSeenAt = writable<Map<string, number>>(new Map());

/** Note that a sample for `hostName` arrived just now. */
export function noteMetricsArrived(hostName: string, at: number = Date.now()): void {
  metricsSeenAt.update((seen) => new Map(seen).set(hostName, at));
}

/**
 * Merge a metrics update into the previous sample. The core emits two shapes of
 * `MetricsUpdate` per host: the poller's full snapshot and discovery's
 * os-info-only partial (cpu/ram/disk left `None`). A plain replace would wipe
 * cpu/ram/disk on every connect — flapping the alert count — so each field
 * prefers the new value and falls back to the previous, mirroring the TUI's
 * `new.or(existing)` merge.
 */
export function mergeMetrics(prev: MetricsDto | undefined, next: MetricsDto): MetricsDto {
  if (!prev) return next;
  return {
    cpuPercent: next.cpuPercent ?? prev.cpuPercent,
    ramPercent: next.ramPercent ?? prev.ramPercent,
    diskPercent: next.diskPercent ?? prev.diskPercent,
    uptime: next.uptime ?? prev.uptime,
    loadAvg: next.loadAvg ?? prev.loadAvg,
    osInfo: next.osInfo ?? prev.osInfo,
    // An empty list means "not in this update" (the core's `None`) — keep prior.
    topProcesses: next.topProcesses.length ? next.topProcesses : prev.topProcesses,
    processes: next.processes.length ? next.processes : prev.processes,
    // Same rule for the richer sample: discovery's OS-only update must not wipe
    // the memory split, the network counters or the mount table.
    memory: next.memory ?? prev.memory,
    network: next.network ?? prev.network,
    disks: next.disks.length ? next.disks : prev.disks,
    cpuHistory: next.cpuHistory.length ? next.cpuHistory : prev.cpuHistory,
    ageSeconds: next.ageSeconds
  };
}
