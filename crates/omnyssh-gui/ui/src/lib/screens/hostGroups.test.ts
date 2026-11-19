import { describe, expect, it } from 'vitest';
import type { HostDto } from '$lib/bindings';
import {
  deleteHostGroup,
  hasHostGroup,
  hostGroupUpdates,
  normalizeHostGroups,
  renameHostGroup,
  setHostGroupMembership,
  validateHostGroupName
} from './hostGroups';

function host(name: string, tags: string[] = []): HostDto {
  return {
    name,
    hostname: `${name}.example.com`,
    user: 'root',
    port: 22,
    tags,
    source: 'manual',
    hasKey: true, hasPassword: false,
    monitoring: 'ssh',
    localForwards: [],
    tunnelAutostart: false,
    forwardAgent: false
  };
}

describe('host group drafts', () => {
  it('normalises names and validates new or renamed groups', () => {
    expect(normalizeHostGroups([' prod ', '', 'prod', 'db'])).toEqual(['prod', 'db']);
    expect(validateHostGroupName(' ', [])).toBe('请输入分组名称。');
    expect(validateHostGroupName('a,b', [])).toBe('分组名称不能包含逗号。');
    expect(validateHostGroupName('x'.repeat(41), [])).toBe('分组名称不能超过 40 个字符。');
    expect(validateHostGroupName('PROD', ['prod'])).toBe('该分组名称已存在。');
    expect(validateHostGroupName('PROD', ['prod'], 'prod')).toBeNull();
    expect(validateHostGroupName('生产', ['prod'])).toBeNull();
  });

  it('adds and removes membership without disturbing other groups', () => {
    const original = host('web', ['prod', ' prod ', 'ops']);
    const added = setHostGroupMembership(original, 'database', true);
    expect(added.tags).toEqual(['prod', 'ops', 'database']);
    expect(hasHostGroup(added, 'database')).toBe(true);
    expect(setHostGroupMembership(added, 'prod', false).tags).toEqual(['ops', 'database']);
    expect(original.tags).toEqual(['prod', ' prod ', 'ops']);
  });

  it('renames a group across hosts and deduplicates an existing target', () => {
    const renamed = renameHostGroup([host('web', ['prod', 'ops']), host('db', ['prod'])], 'prod', 'ops');
    expect(renamed[0].tags).toEqual(['ops']);
    expect(renamed[1].tags).toEqual(['ops']);
    expect(deleteHostGroup(renamed, 'ops').every((item) => item.tags.length === 0)).toBe(true);
  });

  it('builds updates only for changed hosts and leaves secrets backend-side', () => {
    const before = [host('web', ['prod']), host('db', [])];
    const after = [before[0], setHostGroupMembership(before[1], 'prod', true)];
    const updates = hostGroupUpdates(before, after);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ name: 'db', tags: ['prod'] });
    expect(updates[0].password).toBeUndefined();
    expect(updates[0].identityFile).toBeUndefined();
  });

  it('rejects a stale host list instead of updating the wrong host', () => {
    const before = [host('web')];
    expect(() => hostGroupUpdates(before, [])).toThrow('主机列表已变化');
    expect(() => hostGroupUpdates(before, [host('db')])).toThrow('主机列表已变化');
  });
});
