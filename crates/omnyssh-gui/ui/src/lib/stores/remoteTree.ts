// One listing per directory for the workspace file panel, so folders can expand in
// place instead of replacing a single pane (tech-gui.md §3.2). The router feeds every
// `sftp-dir-listed` here as well as into the session pane; the tree reads this cache.
import { writable } from 'svelte/store';
import type { FileEntryDto } from '$lib/bindings';

export interface TreeDir {
  entries: FileEntryDto[];
  loading: boolean;
  error?: string;
}

/** `${sessionId}:${path}` → that directory's listing. */
export const remoteTree = writable<Map<string, TreeDir>>(new Map());

export function treeKey(sessionId: number, path: string): string {
  return `${sessionId}:${path}`;
}

function mutate(fn: (dirs: Map<string, TreeDir>) => void): void {
  remoteTree.update((dirs) => {
    const next = new Map(dirs);
    fn(next);
    return next;
  });
}

export function treeBegin(sessionId: number, path: string): void {
  mutate((dirs) => dirs.set(treeKey(sessionId, path), { entries: [], loading: true }));
}

export function treeListed(sessionId: number, path: string, entries: FileEntryDto[]): void {
  mutate((dirs) => dirs.set(treeKey(sessionId, path), { entries, loading: false }));
}

export function treeFailed(sessionId: number, path: string, error: string): void {
  mutate((dirs) => dirs.set(treeKey(sessionId, path), { entries: [], loading: false, error }));
}

/** Forget every listing of one session (refresh, or the pane closing). */
export function treeClear(sessionId: number): void {
  mutate((dirs) => {
    for (const key of [...dirs.keys()]) {
      if (key.startsWith(`${sessionId}:`)) dirs.delete(key);
    }
  });
}
