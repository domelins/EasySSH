import { get } from 'svelte/store';
import { activeEntity } from './activeEntity';
import { sessions, type Session, type SessionKind } from './sessions';
import { dashboardView } from './dashboardView';

// Composed navigation actions that keep the sessions list and the active entity in
// step (tech-gui.md §2). A spawn appends a session and makes it active (both spawn
// paths do this); closing the active session stays on its host — the next tab of that
// host, or the host's empty workspace — so the user is never bounced to the host list.
export function spawnSession(kind: SessionKind, hostName: string): Session {
  const session = sessions.spawn(kind, hostName);
  dashboardView.markRecent(hostName);
  activeEntity.activateSession(session.id);
  return session;
}

export function closeSession(id: number): void {
  const list = get(sessions);
  const closing = list.find((session) => session.id === id);
  const active = get(activeEntity);
  sessions.close(id);
  if (!closing) return;
  const wasActive =
    (active.kind === 'session' && active.id === id) ||
    (active.kind === 'host' && active.hostName === closing.hostName);
  if (!wasActive) return;
  const siblings = get(sessions).filter((session) => session.hostName === closing.hostName);
  if (siblings.length === 0) {
    activeEntity.activateHost(closing.hostName);
    return;
  }
  const at = list.findIndex((session) => session.id === id);
  const after = list.slice(at + 1).find((session) => session.hostName === closing.hostName);
  activeEntity.activateSession((after ?? siblings[siblings.length - 1]).id);
}

/** Close every terminal of a host (the top bar's per-host tab). With nothing left to
 *  show, fall back to the leftmost remaining host, then the Dashboard. */
export function closeHost(hostName: string): void {
  const list = get(sessions);
  const active = get(activeEntity);
  const belonged =
    (active.kind === 'host' && active.hostName === hostName) ||
    (active.kind === 'session' &&
      list.find((session) => session.id === active.id)?.hostName === hostName);
  for (const session of list) {
    if (session.hostName === hostName) sessions.close(session.id);
  }
  if (!belonged) return;
  const rest = get(sessions);
  if (rest.length > 0) activeEntity.activateSession(rest[0].id);
  else activeEntity.selectDashboard();
}
