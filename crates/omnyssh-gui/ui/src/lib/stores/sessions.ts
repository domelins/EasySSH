import { writable } from 'svelte/store';
import type { Status } from '$lib/theme';

// The open terminal tabs (tech-gui.md §2, §3.5). Spawners append a row here;
// Stage 3 makes the sessions real (live PTY). Ids come from one monotonic space
// so a closed tab's id is never reused in the frontend.
export type SessionKind = 'terminal';
// 'closed': the remote side ended a terminal that showed output; its tab stays readable.
// 'dormant': a tab restored from the last run — it holds a place, not a connection, until
// the user opens it (see `wake`).
export type SessionStatus = 'dormant' | 'connecting' | 'connected' | 'failed' | 'closed' | 'unknown';

/** Session state on the shared server-state palette — one source for every session dot
 *  (sidebar row + command palette) so the two never drift. */
export const sessionStatusDot: Record<SessionStatus, Status> = {
  dormant: 'off',
  connecting: 'unknown',
  connected: 'ok',
  failed: 'crit',
  closed: 'off',
  unknown: 'unknown'
};

export interface Session {
  id: number;
  kind: SessionKind;
  hostName: string;
  status: SessionStatus;
  /** The backend public session id, set once `terminal_open` resolves (tech-gui.md
   *  §3.4). Undefined while connecting; the id crossing IPC is always this public id. */
  termId?: number;
}

/** The visible session label: just the host name, compact and readable at any width. */
export function sessionLabel(s: Session): string {
  return s.hostName;
}

const kindLabel: Record<SessionKind, string> = { terminal: '终端' };

/** The accessible/tooltip label: host + type, so hover and screen readers still convey
 *  the connection type the icon shows visually. */
export function sessionTitle(s: Session): string {
  return `${s.hostName} · ${kindLabel[s.kind]}`;
}

function createSessions() {
  const { subscribe, update } = writable<Session[]>([]);
  let nextId = 1;
  return {
    subscribe,
    spawn(kind: SessionKind, hostName: string): Session {
      const session: Session = { id: nextId++, kind, hostName, status: 'connecting' };
      update((list) => [...list, session]);
      return session;
    },
    /** Restore a tab from the previous run without connecting it: it shows its place
     *  in the workspace until `wake` is called. */
    park(hostName: string): Session {
      const session: Session = { id: nextId++, kind: 'terminal', hostName, status: 'dormant' };
      update((list) => [...list, session]);
      return session;
    },
    /** Turn a parked tab into a live connection request. Idempotent, so a click and
     *  the workspace's own activation cannot both start a session. */
    wake(id: number): void {
      update((list) =>
        list.map((s) => (s.id === id && s.status === 'dormant' ? { ...s, status: 'connecting' } : s))
      );
    },
    /** Record the backend public id once `terminal_open` resolves (tech-gui.md §3.4). */
    setTermId(id: number, termId: number): void {
      update((list) => list.map((s) => (s.id === id ? { ...s, termId } : s)));
    },
    /** Update a session's connection state (drives its status dot). */
    setStatus(id: number, status: SessionStatus): void {
      update((list) => list.map((s) => (s.id === id ? { ...s, status } : s)));
    },
    close(id: number): void {
      update((list) => list.filter((s) => s.id !== id));
    }
  };
}

export const sessions = createSessions();
