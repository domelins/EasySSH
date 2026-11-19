import type { HostDto } from '$lib/bindings';
import type { ServerCard } from './serverCard';

export type HostCollection = 'all' | 'favorites' | 'recent';

export interface HostFilter {
  query: string;
  collection: HostCollection;
  tag: string | null;
  hostKey: string | null;
  tunnelOnly: boolean;
  favorites: readonly string[];
  recentHosts: readonly string[];
}

export interface HostTagGroup {
  tag: string;
  hosts: HostDto[];
}

export function filterHostCards(
  cards: ServerCard[],
  filter: HostFilter,
  keyOf: (host: HostDto) => string
): ServerCard[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return cards.filter(({ host, tunnel }) => {
    if (filter.tunnelOnly && !tunnel) return false;
    if (filter.collection === 'favorites' && !filter.favorites.includes(keyOf(host))) return false;
    if (filter.collection === 'recent' && !filter.recentHosts.includes(host.name)) return false;
    if (filter.tag !== null && !host.tags.includes(filter.tag)) return false;
    if (filter.hostKey !== null && keyOf(host) !== filter.hostKey) return false;
    if (!query) return true;
    return [host.name, host.hostname, host.user, host.notes ?? '', ...host.tags].some((value) =>
      value.toLocaleLowerCase().includes(query)
    );
  });
}

export function hostTagGroups(hosts: readonly HostDto[], groupNames: readonly string[] = []): HostTagGroup[] {
  const groups = new Map<string, HostDto[]>();
  for (const raw of groupNames) {
    const tag = raw.trim();
    if (tag && !groups.has(tag)) groups.set(tag, []);
  }
  for (const host of hosts) {
    for (const raw of host.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      const entries = groups.get(tag) ?? [];
      if (!entries.includes(host)) entries.push(host);
      groups.set(tag, entries);
    }
  }
  return [...groups]
    .map(([tag, groupedHosts]) => ({ tag, hosts: groupedHosts }))
    .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
}

export function hostStatusLabel(card: ServerCard): string {
  if (card.reachability === 'reachable') return '可达';
  if (card.reachability === 'unreachable') return '不可达';
  if (card.reachability === 'checking') return '检查中';
  if (card.offline) return '离线';
  return card.overall === 'unknown' ? '连接中' : '在线';
}

export function systemLabel(card: ServerCard): string {
  if (card.host.monitoring !== 'ssh') return 'TCP';
  const os = card.osInfo?.toLocaleLowerCase() ?? '';
  if (os.includes('debian')) return 'DEB';
  if (os.includes('ubuntu')) return 'UBU';
  if (os.includes('windows')) return 'WIN';
  if (os.includes('centos') || os.includes('rhel') || os.includes('fedora')) return 'RHEL';
  if (os.includes('arch')) return 'ARCH';
  return os.includes('linux') ? 'LINUX' : 'SSH';
}
