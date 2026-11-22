// Per-host latency from the backend's prober: a TCP connect and an ICMP echo, both
// measured from this machine (tech-gui.md §4.3). Unreachable or ICMP-blocked hosts show
// an em dash for the missing side.
import { writable } from 'svelte/store';
import type { HostLatency } from '$lib/bindings';

export type Latency = { tcpMs?: number; pingMs?: number };

/** Latest measurement per host, keyed by host name. */
export const latencies = writable<Map<string, Latency>>(new Map());

export function noteLatency(payload: HostLatency): void {
  const measure: Latency = {
    tcpMs: payload.tcpMs ?? undefined,
    pingMs: payload.pingMs ?? undefined
  };
  latencies.update((map) => new Map(map).set(payload.hostName, measure));
}

/** "12 ms", or an em dash when that probe got no answer. */
export function latencyLabel(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value)} ms`;
}
