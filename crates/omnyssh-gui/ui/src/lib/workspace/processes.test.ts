import { describe, expect, it } from 'vitest';
import {
  defaultDescending,
  processRows,
  sortProcesses,
  type ProcessRow
} from './processes';

const rows: ProcessRow[] = [
  { pid: 30, command: 'nginx', cpuPercent: 5, memPercent: 20 },
  { pid: 10, command: 'postgres', cpuPercent: 40, memPercent: 5 },
  { pid: 20, command: 'node', cpuPercent: 20, memPercent: 10 }
];

describe('process rows', () => {
  it('prefers the full list and keeps its fields', () => {
    const out = processRows(
      [{ pid: 7, command: 'sshd', cpuPercent: 1, memPercent: 2 }],
      [{ name: 'ignored', cpuPercent: 99, memPercent: 99 }]
    );
    expect(out).toEqual([{ pid: 7, command: 'sshd', cpuPercent: 1, memPercent: 2 }]);
  });

  it('falls back to the top-three snapshot when the host reports no full list', () => {
    const out = processRows([], [{ name: 'node', cpuPercent: 12, memPercent: 3 }]);
    expect(out).toEqual([{ pid: 0, command: 'node', cpuPercent: 12, memPercent: 3 }]);
  });

  it('is empty for a host with neither sample', () => {
    expect(processRows(undefined, undefined)).toEqual([]);
    expect(processRows([], [])).toEqual([]);
  });
});

describe('process sorting', () => {
  it('sorts by CPU busiest first by default', () => {
    const out = sortProcesses(rows, 'cpu', defaultDescending('cpu'));
    expect(out.map((row) => row.command)).toEqual(['postgres', 'node', 'nginx']);
  });

  it('sorts by memory and by PID', () => {
    expect(sortProcesses(rows, 'mem', true).map((row) => row.command)).toEqual([
      'nginx',
      'node',
      'postgres'
    ]);
    expect(sortProcesses(rows, 'pid', false).map((row) => row.pid)).toEqual([10, 20, 30]);
    expect(defaultDescending('pid')).toBe(false);
  });

  it('does not mutate the input and breaks ties by command', () => {
    const tied: ProcessRow[] = [
      { pid: 2, command: 'b', cpuPercent: 1, memPercent: 1 },
      { pid: 1, command: 'a', cpuPercent: 1, memPercent: 1 }
    ];
    const out = sortProcesses(tied, 'cpu', true);
    expect(out.map((row) => row.command)).toEqual(['a', 'b']);
    expect(tied.map((row) => row.command)).toEqual(['b', 'a']);
  });
});
