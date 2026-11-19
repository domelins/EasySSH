import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { MetricsDto } from '$lib/bindings';
import { mergeMetrics, metricsSeenAt, noteMetricsArrived } from './metrics';

function sample(partial: Partial<MetricsDto>): MetricsDto {
  return {
    topProcesses: [],
    processes: [],
    disks: [],
    cpuHistory: [],
    ageSeconds: 0,
    ...partial
  };
}

describe('metrics merge', () => {
  it('keeps the previous numbers a discovery update leaves empty', () => {
    const full = sample({
      cpuPercent: 42,
      ramPercent: 55,
      diskPercent: 20,
      memory: { totalBytes: 100, usedBytes: 40, cachedBytes: 10, freeBytes: 50 },
      network: { rxBytesTotal: 1, txBytesTotal: 2, rxBytesPerSec: 3, txBytesPerSec: 4 },
      disks: [{ mount: '/', device: 'sda1', totalBytes: 1, usedBytes: 1, percent: 10 }],
      processes: [{ pid: 1, command: 'init', cpuPercent: 0.1, memPercent: 0.1 }],
      cpuHistory: [40, 42],
      osInfo: 'Linux'
    });
    const discovery = sample({ osInfo: 'Linux 6.8', ageSeconds: 3 });

    const merged = mergeMetrics(full, discovery);
    expect(merged.cpuPercent).toBe(42);
    expect(merged.memory).toEqual(full.memory);
    expect(merged.network).toEqual(full.network);
    expect(merged.disks).toHaveLength(1);
    expect(merged.processes).toHaveLength(1);
    expect(merged.cpuHistory).toEqual([40, 42]);
    expect(merged.osInfo).toBe('Linux 6.8');
  });

  it('replaces the CPU trend when the poller sends a fresh one', () => {
    const merged = mergeMetrics(
      sample({ cpuPercent: 90, cpuHistory: [90] }),
      sample({ cpuPercent: 10, cpuHistory: [10] })
    );
    expect(merged.cpuPercent).toBe(10);
    expect(merged.cpuHistory).toEqual([10]);
  });
});

describe('sample age', () => {
  it('records when a host last reported', () => {
    noteMetricsArrived('web-1', 1_700_000_000_000);
    expect(get(metricsSeenAt).get('web-1')).toBe(1_700_000_000_000);
  });
});
