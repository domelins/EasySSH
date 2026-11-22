import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { latencies, latencyLabel, noteLatency } from './latency';

describe('host latency', () => {
  it('labels a measurement or an em dash', () => {
    expect(latencyLabel(12)).toBe('12 ms');
    expect(latencyLabel(0)).toBe('0 ms');
    expect(latencyLabel(null)).toBe('—');
    expect(latencyLabel(undefined)).toBe('—');
  });

  it('keeps the newest measurement per host', () => {
    noteLatency({ hostName: 'web-1', tcpMs: 12, pingMs: 18 });
    expect(get(latencies).get('web-1')).toEqual({ tcpMs: 12, pingMs: 18 });

    // A later sample replaces the old one, including a probe that got no answer.
    noteLatency({ hostName: 'web-1', tcpMs: 20 });
    expect(get(latencies).get('web-1')).toEqual({ tcpMs: 20, pingMs: undefined });
  });
});
