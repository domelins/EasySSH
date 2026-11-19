// Pure host form + validation logic (tech-gui.md §4.1, Stage 4.1), kept free of
// Svelte components so it is unit-testable; `HostEditor.svelte` renders it. The
// validation mirrors the TUI's `HostForm::to_host` (crates/omnyssh/src/app/host.rs)
// so both frontends produce the same `hosts.toml` shape and error messages.

import type { HostDto, HostInputDto, LocalForwardDto, MonitorModeDto } from '$lib/bindings';

/** One port-forward row as typed: listen on `[address:]port` here, reach
 *  `remoteHost:remotePort` from the host. */
export interface ForwardRow {
  local: string;
  remoteHost: string;
  remotePort: string;
}

/** The editable form fields — all raw text (tags are comma-separated, port a string). */
export interface HostFormFields {
  name: string;
  hostname: string;
  user: string;
  port: string;
  identityFile: string;
  password: string;
  tags: string;
  notes: string;
  monitoring: MonitorModeDto;
  /** Probe port; blank means "the host's SSH port". Only read for `tcpPort`. */
  monitorPort: string;
  forwards: ForwardRow[];
  tunnelAutostart: boolean;
  forwardAgent: boolean;
}

export function emptyForm(): HostFormFields {
  // Port pre-seeded to the SSH default; user blank (placeholder shows `root`, the
  // default the validation applies when it is left empty).
  return {
    name: '',
    hostname: '',
    user: '',
    port: '22',
    identityFile: '',
    password: '',
    tags: '',
    notes: '',
    monitoring: 'ssh',
    monitorPort: '',
    forwards: [],
    tunnelAutostart: false,
    forwardAgent: false
  };
}

export function emptyForwardRow(): ForwardRow {
  return { local: '', remoteHost: 'localhost', remotePort: '' };
}

/** An IPv6 address needs brackets to survive the colon-separated notation. */
export const bracketed = (address: string): string => (address.includes(':') ? `[${address}]` : address);

function rowFromForward(f: LocalForwardDto): ForwardRow {
  return {
    local: f.bindAddress == null ? String(f.bindPort) : `${bracketed(f.bindAddress)}:${f.bindPort}`,
    remoteHost: f.remoteHost,
    remotePort: String(f.remotePort)
  };
}

/** Seed the edit form from a `HostDto`. `identityFile`/`password` are intentionally
 *  blank: the DTO omits both (§3.4), so on edit they stay empty and mean "keep the
 *  stored value" — `save_host` preserves them unless the user types a new one. */
export function formFromHost(h: HostDto): HostFormFields {
  return {
    name: h.name,
    hostname: h.hostname,
    user: h.user,
    port: String(h.port),
    identityFile: '',
    password: '',
    tags: h.tags.join(', '),
    notes: h.notes ?? '',
    monitoring: h.monitoring,
    monitorPort: h.monitorPort == null ? '' : String(h.monitorPort),
    forwards: h.localForwards.map(rowFromForward),
    tunnelAutostart: h.tunnelAutostart,
    forwardAgent: h.forwardAgent
  };
}

// Digits with an optional leading `+`, matching Rust's `u16::parse`; the range check
// covers 0 and overflow.
function parsePort(raw: string): number | undefined {
  const v = raw.trim();
  if (!/^\+?\d+$/.test(v) || Number(v) < 1 || Number(v) > 65535) return undefined;
  return Number(v);
}

/** Parse the local side, `port` or `address:port` (IPv6 in brackets). */
function parseListen(raw: string): { bindAddress?: string; bindPort: number } | string {
  const v = raw.trim();
  const bracket = /^\[([^\]]*)\]:(.*)$/.exec(v);
  const [address, portRaw] = bracket
    ? [bracket[1], bracket[2]]
    : v.includes(':')
      ? [v.slice(0, v.lastIndexOf(':')), v.slice(v.lastIndexOf(':') + 1)]
      : [undefined, v];
  if (address?.includes(':') && !bracket) return 'IPv6 地址需放在方括号内，例如 [::1]:8080';
  const bindPort = parsePort(portRaw);
  if (bindPort == null) return `本地端口必须是 1 到 65535 之间的数字，当前为 '${portRaw.trim()}'`;
  return { bindAddress: address, bindPort };
}

/** Rows to forwards; blank rows are dropped, anything else must be complete. */
function parseForwards(rows: ForwardRow[]): LocalForwardDto[] | string {
  const forwards: LocalForwardDto[] = [];
  const listening = new Map<string, number>();
  for (const [i, row] of rows.entries()) {
    if (!row.local.trim() && !row.remotePort.trim()) continue;
    const n = i + 1;
    const listen = parseListen(row.local);
    if (typeof listen === 'string') return `转发 ${n}：${listen}`;
    // A bracketed IPv6 target is stored bare; the brackets are notation only.
    const remoteHost = row.remoteHost.trim().replace(/^\[(.*)\]$/, '$1');
    if (!remoteHost || /[\s[\]]/.test(remoteHost)) {
      return `转发 ${n}：请填写从服务器访问的目标主机，例如 localhost`;
    }
    const remotePort = parsePort(row.remotePort);
    if (remotePort == null) {
      return `转发 ${n}：远程端口必须是 1 到 65535 之间的数字，当前为 '${row.remotePort.trim()}'`;
    }
    // Two rules on one local port would fail the whole tunnel at bind time.
    const key = `${listen.bindAddress ?? 'localhost'}|${listen.bindPort}`;
    const clash = listening.get(key);
    if (clash) return `转发 ${n} 与转发 ${clash} 使用了相同的本地端口`;
    listening.set(key, n);
    forwards.push({ ...listen, remoteHost, remotePort });
  }
  return forwards;
}

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The tags a form's comma-separated text stands for (a group is a tag). */
export function tagsOf(raw: string): string[] {
  return splitCsv(raw);
}

/** Fold a group chip toggle into the tag text, keeping every hand-typed tag. */
export function toggleTag(raw: string, tag: string): string {
  const tags = tagsOf(raw);
  const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
  return next.join(', ');
}

export type HostFormResult = { ok: true; input: HostInputDto } | { ok: false; error: string };

/** Validate + build a `HostInputDto`, or return an error message. Mirrors the TUI's
 *  `to_host`: name and hostname are required; user defaults to `root` and port to `22`
 *  when blank; port must be a 1–65535 integer; identity/password/notes are trimmed and
 *  dropped to `undefined` when empty (so the wire form stays sparse, §4.1). `proxyJump`
 *  is not surfaced by the form (parity with the TUI, which sets it `None`) — `save_host`
 *  preserves any existing value across an edit. */
export function formToInput(f: HostFormFields): HostFormResult {
  const name = f.name.trim();
  if (!name) return { ok: false, error: '名称不能为空' };
  const hostname = f.hostname.trim();
  if (!hostname) return { ok: false, error: '主机名 / IP 不能为空' };
  const user = f.user.trim() || 'root';

  const portRaw = f.port.trim();
  let port = 22;
  if (portRaw !== '') {
    // Digits with an optional leading `+`, matching Rust's `u16::parse` (which accepts
    // `+22` but no `-`/decimal/hex/exponent); the range guard covers 0 and overflow.
    if (!/^\+?\d+$/.test(portRaw) || Number(portRaw) < 1 || Number(portRaw) > 65535) {
      return { ok: false, error: `端口必须是 1 到 65535 之间的数字，当前为 '${portRaw}'` };
    }
    port = Number(portRaw);
  }

  // Only meaningful for a reachability host; an SSH host never carries a probe port.
  let monitorPort: number | undefined;
  const monitorPortRaw = f.monitorPort.trim();
  if (f.monitoring === 'tcpPort' && monitorPortRaw !== '') {
    if (!/^\+?\d+$/.test(monitorPortRaw) || Number(monitorPortRaw) < 1 || Number(monitorPortRaw) > 65535) {
      return {
        ok: false,
        error: `探测端口必须是 1 到 65535 之间的数字，当前为 '${monitorPortRaw}'`
      };
    }
    monitorPort = Number(monitorPortRaw);
  }

  const localForwards = parseForwards(f.forwards);
  if (typeof localForwards === 'string') return { ok: false, error: localForwards };

  const identityFile = f.identityFile.trim();
  const password = f.password.trim();
  const notes = f.notes.trim();
  const tags = splitCsv(f.tags);
  return {
    ok: true,
    input: {
      name,
      hostname,
      user,
      port,
      identityFile: identityFile || undefined,
      password: password || undefined,
      tags,
      notes: notes || undefined,
      monitoring: f.monitoring,
      monitorPort,
      localForwards,
      // The switch hides with the last row; a flag nobody can see must not linger.
      tunnelAutostart: f.tunnelAutostart && localForwards.length > 0,
      forwardAgent: f.forwardAgent
    }
  };
}
