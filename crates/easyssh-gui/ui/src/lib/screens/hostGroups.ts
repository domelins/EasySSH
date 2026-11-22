import type { HostDto, HostInputDto } from '$lib/bindings';
import { formFromHost, formToInput } from './hostForm';

export function normalizeHostGroups(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function hasHostGroup(host: HostDto, group: string): boolean {
  return host.tags.some((tag) => tag.trim() === group);
}

export function validateHostGroupName(
  raw: string,
  groups: readonly string[],
  current?: string
): string | null {
  const name = raw.trim();
  if (!name) return '请输入分组名称。';
  if (name.includes(',')) return '分组名称不能包含逗号。';
  if (name.length > 40) return '分组名称不能超过 40 个字符。';
  if (groups.some((group) => group !== current && group.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return '该分组名称已存在。';
  }
  return null;
}

export function setHostGroupMembership(host: HostDto, group: string, member: boolean): HostDto {
  const tags = normalizeHostGroups(host.tags);
  if (tags.includes(group) === member) return host;
  return {
    ...host,
    tags: member ? [...tags, group] : tags.filter((tag) => tag !== group)
  };
}

export function renameHostGroup(hosts: readonly HostDto[], previous: string, next: string): HostDto[] {
  return hosts.map((host) => {
    if (!hasHostGroup(host, previous)) return host;
    return {
      ...host,
      tags: normalizeHostGroups(host.tags.map((tag) => (tag.trim() === previous ? next.trim() : tag)))
    };
  });
}

export function deleteHostGroup(hosts: readonly HostDto[], group: string): HostDto[] {
  return hosts.map((host) => {
    if (!hasHostGroup(host, group)) return host;
    return { ...host, tags: normalizeHostGroups(host.tags).filter((tag) => tag !== group) };
  });
}

function sameHostIdentity(a: HostDto, b: HostDto): boolean {
  return a.name === b.name && a.hostname === b.hostname && a.user === b.user && a.port === b.port && a.source === b.source;
}

function groupUpdateInput(host: HostDto): HostInputDto {
  const result = formToInput({ ...formFromHost(host), tags: '' });
  if (!result.ok) throw new Error(result.error);
  return { ...result.input, tags: normalizeHostGroups(host.tags) };
}

export function hostGroupUpdates(before: readonly HostDto[], after: readonly HostDto[]): HostInputDto[] {
  if (before.length !== after.length) throw new Error('主机列表已变化，请重新打开分组管理。');
  return after.flatMap((host, index) => {
    const original = before[index];
    if (!sameHostIdentity(original, host)) throw new Error('主机列表已变化，请重新打开分组管理。');
    const oldTags = JSON.stringify(normalizeHostGroups(original.tags));
    const newTags = JSON.stringify(normalizeHostGroups(host.tags));
    return oldTags === newTags ? [] : [groupUpdateInput(host)];
  });
}
