import { writable } from 'svelte/store';
import type { FileEntryDto, TransferProgressDto } from '$lib/bindings';

// Per-session SFTP state for the workspace file pane (tech-gui.md §3.2, §3.5), keyed by
// the backend public session id — the same id the `sftp-*` events carry, so the router
// routes each event to the right tab. Navigation/marking/transfer logic lives here as
// pure reducers so it is unit-testable; `RemoteExplorer.svelte` is a thin view + dispatcher.

export type PaneSide = 'local' | 'remote';
type SftpStatus = 'connecting' | 'connected' | 'failed';
type OpKind = 'upload' | 'download' | 'mkdir' | 'rename' | 'delete' | 'write';

/** One side's browsing state: current directory, its entries, and the marked set. */
export interface Pane {
  path: string;
  entries: FileEntryDto[];
  loading: boolean;
  /** Marked entry paths — the batch transfer/delete targets. */
  marked: Set<string>;
  error?: string;
}

/** The transfer currently reporting progress (one at a time — the core is sequential). */
interface Transfer {
  kind: 'upload' | 'download';
  name: string;
  done: number;
  total: number;
}

/** The remote file open in the editor: its text, or why it cannot be edited here. */
export interface EditState {
  path: string;
  loading: boolean;
  content?: string;
  error?: string;
}

/** The `sftp-op-done` error of a cancelled transfer, in the core's words. */
export const CANCELLED = 'Transfer cancelled';

// A mutating op awaiting its `sftp-op-done`. The core processes commands sequentially,
// so op-done events arrive in issue order — this FIFO correlates each op-done to the op
// that produced it (the contract carries no op id, §4.3). `refresh` is the pane whose
// listing the op invalidates.
interface PendingOp {
  kind: OpKind;
  name?: string;
  refresh: PaneSide;
}

export interface SftpSession {
  hostName: string;
  status: SftpStatus;
  local: Pane;
  remote: Pane;
  pending: PendingOp[];
  transfer?: Transfer;
  /** A folder transfer's pack/unpack phase: no core op is in flight yet (or anymore),
   *  but the pane must show the transfer as one seamless operation. */
  preparing?: { kind: 'upload' | 'download'; name: string };
  /** The file the editor has open, if any. */
  edit?: EditState;
  /** The last operation error, surfaced in the UI until the next successful action. */
  error?: string;
  /** Pane(s) to re-list once `pending` drains (a mutation changed the FS); the
   *  component performs the listing and clears this. */
  refresh?: PaneSide | 'both';
}

function emptyPane(): Pane {
  return { path: '', entries: [], loading: true, marked: new Set() };
}

/** A fresh session in the connecting state, both panes empty. */
export function newSession(hostName: string): SftpSession {
  return {
    hostName,
    status: 'connecting',
    local: emptyPane(),
    remote: emptyPane(),
    pending: []
  };
}

/** A directory listing landed for a pane: replace entries at `path`, clear marks. */
export function applyListing(pane: Pane, path: string, entries: FileEntryDto[]): Pane {
  return { ...pane, path, entries, loading: false, marked: new Set(), error: undefined };
}

/** Toggle an entry's marked state (the batch transfer/delete set). */
export function toggleMark(pane: Pane, path: string): Pane {
  const marked = new Set(pane.marked);
  if (marked.has(path)) marked.delete(path);
  else marked.add(path);
  return { ...pane, marked };
}

/** The marked entries in listing order — the stable sequence a batch transfer follows. */
/** The marked entries in listing order. A tree view passes `lookup` so a row nested
 *  under an expanded folder is found too — the pane listing only holds one directory. */
export function markedEntries(
  pane: Pane,
  lookup?: (path: string) => FileEntryDto | undefined
): FileEntryDto[] {
  if (!lookup) return pane.entries.filter((e) => pane.marked.has(e.path));
  return [...pane.marked]
    .map((path) => lookup(path))
    .filter((entry): entry is FileEntryDto => entry != null);
}

/** A name as a file system compares it: `caseless` for one that ignores case, as
 *  Windows and macOS do by default. macOS also takes an accented letter composed or not
 *  as the same; Windows does not, and gets a needless question at most. */
function nameKey(name: string, caseless: boolean): string {
  return caseless ? name.normalize('NFC').toLowerCase() : name;
}

/** How many of `names` the listing `entries` already holds: what a transfer into its
 *  directory would replace, or merge into for a folder. */
export function clashCount(names: string[], entries: FileEntryDto[], caseless: boolean): number {
  const there = new Set(
    entries.filter((e) => e.name !== '..').map((e) => nameKey(e.name, caseless))
  );
  return names.filter((name) => there.has(nameKey(name, caseless))).length;
}

/** A name in `names` that an earlier one would land on too: two files dropped from
 *  different folders, or `A.txt` and `a.txt` going where case is ignored. */
export function repeatedName(names: string[], caseless: boolean): string | undefined {
  const seen = new Set<string>();
  return names.find((name) => {
    const key = nameKey(name, caseless);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

/** Whether a name the server listed can be created locally as itself: one plain path
 *  component. Joined onto a local folder, anything else would land below it, unseen by
 *  the Replace check. On Windows `\\` separates too. */
export function isPlainName(name: string, windows: boolean): boolean {
  if (['', '.', '..'].includes(name) || name.includes('/')) return false;
  return !(windows && name.includes('\\'));
}

/** What dragging `entry` carries: every marked entry when `entry` is one of them, else
 *  `entry` alone. Folders travel with their whole contents; `..` is not transferable,
 *  so dragging it carries nothing. */
export function dragPayload(pane: Pane, entry: FileEntryDto): FileEntryDto[] {
  if (entry.name === '..') return [];
  if (pane.marked.has(entry.path)) return markedEntries(pane);
  return [entry];
}

/** The root in `roots` that `path` lies under, or '' for none (a network share).
 *  Drive letters compare case-insensitively, as Windows does. */
export function rootOf(path: string, roots: string[]): string {
  const lower = path.toLowerCase();
  return roots.find((root) => lower.startsWith(root.toLowerCase())) ?? '';
}

// A Windows path that is only a root: a drive, a share ('\\\\server\\share'), or a drive,
// share or volume in the long form that starts '\\\\?\\'.
const WINDOWS_ROOT = /^(?:[a-z]:|\\\\[?.]\\(?:unc\\[^\\]+\\[^\\]+|[^\\]+)|\\\\[^\\]+\\[^\\]+)\\?$/i;

/** The name a local path is uploaded under: its last component, or '' for a root
 *  ('/', 'C:\\', '\\\\server\\share'), which has no name to give it on the server. A path
 *  with no '/' is a Windows one, where '\\' separates; elsewhere '\\' is part of a name. */
export function baseName(path: string): string {
  const sep = path.includes('/') ? '/' : '\\';
  if (sep === '\\' && WINDOWS_ROOT.test(path)) return '';
  return path.split(sep).filter(Boolean).at(-1) ?? '';
}

/** The clickable breadcrumb of a path: its root first, the path itself last.
 *  POSIX (`/a/b`), drive (`C:\Users`) and UNC (`\\server\share\x`) forms. */
export function pathCrumbs(path: string): { name: string; path: string }[] {
  if (!path) return [];
  if (path.startsWith('\\\\')) {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    if (parts.length < 2) return [];
    const root = `\\\\${parts[0]}\\${parts[1]}`;
    const crumbs = [{ name: root, path: root }];
    let current = root;
    for (const part of parts.slice(2)) {
      current = `${current}\\${part}`;
      crumbs.push({ name: part, path: current });
    }
    return crumbs;
  }
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    const root = `${path.slice(0, 2)}\\`;
    const crumbs = [{ name: root, path: root }];
    let current = root.replace(/[\\/]$/, '');
    for (const part of path.slice(3).split(/[\\/]/).filter(Boolean)) {
      current += `\\${part}`;
      crumbs.push({ name: part, path: current });
    }
    return crumbs;
  }
  const crumbs = [{ name: '/', path: '/' }];
  let current = '';
  for (const part of path.split('/').filter(Boolean)) {
    current += `/${part}`;
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}

/** Human-readable byte size for a listing row or a transfer bar. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});
const dateFormatFull = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'medium'
});

/** A listing row's date from Unix seconds, or an em dash when the time is unknown.
 *  `full` gives the long form used in the hover title. */
export function formatDate(secs: number | null | undefined, full = false): string {
  if (secs == null || !Number.isFinite(secs)) return '—';
  const date = new Date(secs * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return (full ? dateFormatFull : dateFormat).format(date);
}

/** Widen the pending refresh target: two different sides collapse to `both`. */
export function mergeRefresh(
  current: PaneSide | 'both' | undefined,
  next: PaneSide
): PaneSide | 'both' {
  if (!current || current === next) return next;
  return 'both';
}

/** Fold a `transfer-progress` tick in. The transfer's kind/name come from the front
 *  pending op — which, because the core is sequential, is always the op now running —
 *  so the frontend never needs to know the backend-allocated transfer id in advance. */
export function applyProgress(session: SftpSession, p: TransferProgressDto): SftpSession {
  const front = session.pending[0];
  if (!front || (front.kind !== 'upload' && front.kind !== 'download')) return session;
  return {
    ...session,
    transfer: { kind: front.kind, name: front.name ?? '', done: p.done, total: p.total }
  };
}

/** What the transfer strip shows: the running transfer's last tick, else a folder
 *  transfer's pack/unpack phase, else — from dispatch until the first tick (the core may
 *  spend a while walking a folder) — that it is being prepared. */
export function transferState(
  session: SftpSession
): (Transfer & { preparing: boolean }) | undefined {
  if (session.transfer) return { ...session.transfer, preparing: false };
  if (session.preparing) return { ...session.preparing, done: 0, total: 0, preparing: true };
  const front = session.pending[0];
  if (front?.kind !== 'upload' && front?.kind !== 'download') return undefined;
  return { kind: front.kind, name: front.name ?? '', done: 0, total: 0, preparing: true };
}

/** Fold an `sftp-op-done` in: pop the front pending op (FIFO), record its refresh
 *  target, clear the transfer display if it was a transfer, and surface any error. */
export function applyOpDone(session: SftpSession, ok: boolean, error?: string): SftpSession {
  if (session.pending.length === 0) return session;
  const [front, ...rest] = session.pending;
  const wasTransfer = front.kind === 'upload' || front.kind === 'download';
  // A later op's success must NOT wipe an earlier op's failure in the same batch — that
  // silently masks e.g. a non-empty-folder delete beside a deleted sibling. Nor may the
  // user's own cancel. The error persists until the next batch clears it (`clearError`,
  // called on enqueue).
  const keep = ok || (error === CANCELLED && session.error != null);
  return {
    ...session,
    pending: rest,
    refresh: mergeRefresh(session.refresh, front.refresh),
    error: keep ? session.error : (error ?? '操作失败'),
    transfer: wasTransfer ? undefined : session.transfer
  };
}

/** The outcome of one pending op, handed to whoever pushed it once its op-done lands. */
export interface OpResult {
  ok: boolean;
  error?: string;
}

function createSftp() {
  const { subscribe, update } = writable<Map<number, SftpSession>>(new Map());
  // One resolver per pending op, in push order — the same FIFO the core's op-done
  // events follow. Closure-side so the reducers stay pure and the state serializable.
  const waiters = new Map<number, Array<(result: OpResult) => void>>();

  /** Apply `fn` to one session, no-op if the id is unknown (a closed tab). */
  function mut(id: number, fn: (s: SftpSession) => SftpSession): void {
    update((m) => {
      const session = m.get(id);
      if (!session) return m;
      const next = new Map(m);
      next.set(id, fn(session));
      return next;
    });
  }

  return {
    subscribe,
    /** Register a freshly opened session (called once `sftp_open` resolves). */
    open(id: number, hostName: string): void {
      update((m) => new Map(m).set(id, newSession(hostName)));
    },
    setStatus(id: number, status: SftpStatus): void {
      mut(id, (s) => ({ ...s, status }));
    },
    /** Mark a pane as loading before a listing request goes out. */
    beginLoading(id: number, side: PaneSide): void {
      mut(id, (s) => ({ ...s, [side]: { ...s[side], loading: true } }));
    },
    listing(id: number, side: PaneSide, path: string, entries: FileEntryDto[]): void {
      mut(id, (s) => ({ ...s, [side]: applyListing(s[side], path, entries) }));
    },
    paneError(id: number, side: PaneSide, error: string): void {
      mut(id, (s) => ({ ...s, [side]: { ...s[side], loading: false, error } }));
    },
    toggleMark(id: number, side: PaneSide, path: string): void {
      mut(id, (s) => ({ ...s, [side]: toggleMark(s[side], path) }));
    },
    /** Enqueue a mutating op. The returned promise settles when THIS op's op-done
     *  lands, so a folder flow can await its transfer before unpacking. Invariant: the
     *  push and the core enqueue must be synchronous neighbours — an await between them
     *  would let another op slip into the FIFO ahead of this one. */
    pushOp(id: number, op: PendingOp): Promise<OpResult> {
      let known = false;
      mut(id, (s) => {
        known = true;
        return { ...s, pending: [...s.pending, op] };
      });
      if (!known) return Promise.resolve({ ok: false, error: 'SFTP 会话已关闭' });
      return new Promise((resolve) => {
        const queue = waiters.get(id) ?? [];
        queue.push(resolve);
        waiters.set(id, queue);
      });
    },
    /** A folder transfer's pack/unpack phase (see `preparing`). */
    setPreparing(id: number, preparing?: { kind: 'upload' | 'download'; name: string }): void {
      mut(id, (s) => ({ ...s, preparing }));
    },
    progress(id: number, p: TransferProgressDto): void {
      mut(id, (s) => applyProgress(s, p));
    },
    opDone(id: number, ok: boolean, error?: string): void {
      mut(id, (s) => applyOpDone(s, ok, error));
      waiters.get(id)?.shift()?.({ ok, error });
    },
    /** Open the editor on `path`; the text arrives with `fileContent`. */
    beginEdit(id: number, path: string): void {
      mut(id, (s) => ({ ...s, edit: { path, loading: true } }));
    },
    /** The editor's read finished: the text, or the reason it cannot be edited. */
    fileContent(id: number, path: string, content?: string, error?: string): void {
      mut(id, (s) =>
        s.edit?.path === path ? { ...s, edit: { path, loading: false, content, error } } : s
      );
    },
    clearEdit(id: number): void {
      mut(id, (s) => (s.edit ? { ...s, edit: undefined } : s));
    },
    clearRefresh(id: number): void {
      mut(id, (s) => ({ ...s, refresh: undefined }));
    },
    /** Drop the surfaced op error — called when a new batch is enqueued, so a fresh
     *  action starts clean while a finished batch's error still lingered until now. */
    clearError(id: number): void {
      mut(id, (s) => ({ ...s, error: undefined }));
    },
    /** A soft error (e.g. a failed listing reported as `sftp-disconnected`, §4.3). The
     *  core emits it only for a remote `ListDir`, so clear just the remote pane's loading
     *  (leaving it set strands it on "Loading…"); a legit in-flight local listing keeps
     *  its own spinner. */
    sessionError(id: number, error: string): void {
      mut(id, (s) => ({ ...s, error, remote: { ...s.remote, loading: false } }));
    },
    remove(id: number): void {
      // The core's cancel op-done races this teardown: drain unresolved waiters so a
      // folder flow awaiting its transfer cannot hang on a session that is gone.
      for (const resolve of waiters.get(id) ?? []) {
        resolve({ ok: false, error: 'SFTP 会话已关闭' });
      }
      waiters.delete(id);
      update((m) => {
        if (!m.has(id)) return m;
        const next = new Map(m);
        next.delete(id);
        return next;
      });
    }
  };
}

export const sftp = createSftp();
