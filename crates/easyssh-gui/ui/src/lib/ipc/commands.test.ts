import { beforeEach, describe, expect, it, vi } from 'vitest';

// The wrappers' contract is argument pass-through plus Result unwrapping, so the
// generated bindings are replaced with spies and only their outcomes vary.
const { exportHostsCmd, deleteHostsCmd } = vi.hoisted(() => ({
  exportHostsCmd: vi.fn(),
  deleteHostsCmd: vi.fn()
}));

vi.mock('$lib/bindings', () => ({
  commands: {
    exportHosts: exportHostsCmd,
    deleteHosts: deleteHostsCmd
  }
}));

import { exportHosts, deleteHosts } from './commands';

describe('exportHosts', () => {
  beforeEach(() => {
    exportHostsCmd.mockReset();
    exportHostsCmd.mockResolvedValue({ status: 'ok', data: 'C:/Downloads/easyssh-hosts.toml' });
  });

  it('defaults to the full snapshot and the downloads folder', async () => {
    const path = await exportHosts();
    expect(exportHostsCmd).toHaveBeenCalledWith(null, 'both');
    expect(path).toBe('C:/Downloads/easyssh-hosts.toml');
  });

  it('passes an explicit path and the config scope through', async () => {
    await exportHosts('D:/Backups/config.toml', 'config');
    expect(exportHostsCmd).toHaveBeenCalledWith('D:/Backups/config.toml', 'config');
  });

  it('passes the credentials scope through', async () => {
    await exportHosts(null, 'credentials');
    expect(exportHostsCmd).toHaveBeenCalledWith(null, 'credentials');
  });

  it('throws the command error message', async () => {
    exportHostsCmd.mockResolvedValue({ status: 'error', error: { message: 'scope 无效' } });
    await expect(exportHosts(null, 'both')).rejects.toThrow('scope 无效');
  });
});

describe('deleteHosts', () => {
  beforeEach(() => {
    deleteHostsCmd.mockReset();
  });

  it('sends every name and returns the actual removed count', async () => {
    deleteHostsCmd.mockResolvedValue({ status: 'ok', data: 1 });
    const removed = await deleteHosts(['web-1', 'imported']);
    expect(deleteHostsCmd).toHaveBeenCalledWith(['web-1', 'imported']);
    expect(removed).toBe(1);
  });

  it('throws the command error message', async () => {
    deleteHostsCmd.mockResolvedValue({ status: 'error', error: { message: '写入失败' } });
    await expect(deleteHosts(['web-1'])).rejects.toThrow('写入失败');
  });
});