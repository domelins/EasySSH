import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { FileEntryDto } from '$lib/bindings';
import { remoteTree, treeBegin, treeListed, treeFailed, treeClear } from './remoteTree';

function entry(name: string): FileEntryDto {
  return {
    name,
    path: `/${name}`,
    size: 1,
    isDir: false,
    isSymlink: false,
    modified: 0
  };
}

describe('remote tree cache', () => {
  it('keeps one listing per session and path', () => {
    treeBegin(1, '/');
    expect(get(remoteTree).get('1:/')?.loading).toBe(true);

    treeListed(1, '/', [entry('a')]);
    treeListed(2, '/', [entry('b')]);
    expect(get(remoteTree).get('1:/')?.entries.map((e) => e.name)).toEqual(['a']);
    expect(get(remoteTree).get('2:/')?.entries.map((e) => e.name)).toEqual(['b']);

    treeClear(1);
    expect(get(remoteTree).has('1:/')).toBe(false);
    // Clearing one session leaves the other alone.
    expect(get(remoteTree).has('2:/')).toBe(true);
    treeClear(2);
  });

  it('records a failed listing without dropping the directory', () => {
    treeBegin(3, '/var');
    treeFailed(3, '/var', 'permission denied');
    expect(get(remoteTree).get('3:/var')).toMatchObject({
      loading: false,
      error: 'permission denied'
    });
    treeClear(3);
  });
});
