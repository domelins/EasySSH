import { describe, expect, it } from 'vitest';
import type { HostDto } from '$lib/bindings';
import { deriveCard, orderKeys } from './serverCard';
import { filterHostCards, hostStatusLabel, hostTagGroups, systemLabel, type HostFilter } from './hostExplorer';

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

const hosts = [host('web', ['prod']), host('db', ['prod', 'database']), host('jump')];
const cards = hosts.map((item) => deriveCard(item, { kind: 'connected' }, undefined, undefined));
const keyOf = orderKeys(hosts);
const filter: HostFilter = {
  query: '',
  collection: 'all',
  tag: null,
  hostKey: null,
  tunnelOnly: false,
  favorites: [],
  recentHosts: []
};

describe('host explorer filters', () => {
  it('searches names, addresses, users, notes and tags', () => {
    expect(filterHostCards(cards, { ...filter, query: 'PROD' }, keyOf)).toHaveLength(2);
    expect(filterHostCards(cards, { ...filter, query: 'db.example' }, keyOf).map((c) => c.host.name)).toEqual(['db']);
    expect(filterHostCards(cards, { ...filter, query: 'root' }, keyOf)).toHaveLength(3);
  });

  it('combines collection, tag and single-host filters', () => {
    const favorites = [keyOf(hosts[0]), keyOf(hosts[2])];
    expect(filterHostCards(cards, { ...filter, collection: 'favorites', favorites }, keyOf).map((c) => c.host.name)).toEqual(['web', 'jump']);
    expect(filterHostCards(cards, { ...filter, tag: 'prod' }, keyOf).map((c) => c.host.name)).toEqual(['web', 'db']);
    expect(filterHostCards(cards, { ...filter, hostKey: keyOf(hosts[1]) }, keyOf).map((c) => c.host.name)).toEqual(['db']);
  });

  it('filters recent and forwarded hosts', () => {
    expect(filterHostCards(cards, { ...filter, collection: 'recent', recentHosts: ['db'] }, keyOf).map((c) => c.host.name)).toEqual(['db']);
    expect(filterHostCards(cards, { ...filter, tunnelOnly: true }, keyOf)).toHaveLength(0);
  });
});

describe('host tree and row labels', () => {
  it('lists a host under each of its tags once', () => {
    const groups = hostTagGroups([hosts[0], hosts[1], hosts[0]]);
    expect(groups.map((group) => group.tag)).toEqual(['database', 'prod']);
    expect(groups.find((group) => group.tag === 'prod')?.hosts).toHaveLength(2);
    expect(groups.find((group) => group.tag === 'database')?.hosts.map((h) => h.name)).toEqual(['db']);
  });

  it('keeps registered empty groups without duplicating tagged groups', () => {
    const groups = hostTagGroups(hosts, ['empty', 'prod', ' empty ']);
    expect(groups.map((group) => group.tag)).toEqual(['database', 'empty', 'prod']);
    expect(groups.find((group) => group.tag === 'empty')?.hosts).toEqual([]);
  });

  it('uses real connection and operating-system state', () => {
    expect(hostStatusLabel(cards[0])).toBe('在线');
    expect(systemLabel(cards[0])).toBe('SSH');
    const sampled = deriveCard(host('linux'), { kind: 'connected' }, { cpuPercent: 10, ramPercent: 20, diskPercent: 30, osInfo: 'Ubuntu 24.04', uptime: '1d', topProcesses: [], processes: [], disks: [], cpuHistory: [], ageSeconds: 0 }, undefined);
    expect(hostStatusLabel(sampled)).toBe('在线');
    expect(systemLabel(sampled)).toBe('UBU');
  });
});
