import { describe, expect, it } from 'vitest';
import { formatBytes, formatRate } from './format';

describe('byte formatting', () => {
  it('scales to a readable unit and trims a trailing zero', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(100 * 1024)).toBe('100 KB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
  });

  it('renders a missing or nonsensical value as an em dash', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-5)).toBe('—');
  });

  it('appends the per-second suffix for rates', () => {
    expect(formatRate(524_288)).toBe('512 KB/s');
    expect(formatRate(null)).toBe('—');
  });
});
