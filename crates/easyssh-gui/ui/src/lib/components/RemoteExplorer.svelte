<script lang="ts">
  // The workspace's left pane: the host's remote file system (tech-gui.md §3.2). It opens
  // its own SFTP session the first time the pane is shown, then browses through
  // `sftp_list` with the `sftp-dir-listed` event feeding the session's remote pane. A
  // breadcrumb jumps back up; hidden entries are filtered until asked for; symlinks are
  // marked; loading and failure states stay inside the pane instead of taking the
  // workspace down. Only semantic tokens (§5.1).
  import { onDestroy } from 'svelte';
  import { Icon } from '$lib/theme';
  import { Button } from '$lib/theme';
  import type { FileEntryDto } from '$lib/bindings';
  import { sftp, formatBytes, formatDate, transferState } from '$lib/stores/sftp';
  import { remoteTree, treeBegin, treeFailed, treeClear } from '$lib/stores/remoteTree';
  import { maskText } from '$lib/stores/streamer';
  import { lastError } from '$lib/stores/notifications';
  import {
    sftpOpen,
    sftpList,
    sftpClose,
    sftpReadFile,
    sftpWriteFile,
    sftpMkdir,
    sftpRename,
    sftpDelete,
    sftpUpload,
    sftpDownload,
    sftpChmod,
    compressRemote,
    remoteArchive,
    localArchive
  } from '$lib/ipc/commands';
  import { openDetachedPanel } from '$lib/workspace/panel';
  import Modal from '$lib/components/Modal.svelte';
  import { fileTypeIcon, fileTypeLabel } from '$lib/screens/fileType';

  let {
    hostName,
    active,
    maximized = false,
    detached = false,
    onCollapse,
    onMaximize
  }: {
    hostName: string;
    active: boolean;
    /** The pane currently fills the workspace; the fold button restores it instead. */
    maximized?: boolean;
    /** This pane already is its own window: no "pop out" to offer. */
    detached?: boolean;
    onCollapse: () => void;
    onMaximize: () => void;
  } = $props();

  let backendId = $state<number | undefined>(undefined);
  let opened = false;
  let destroyed = false;
  let openError = $state<string | undefined>(undefined);
  let showHidden = $state(false);

  // The inline editor: its text, whether a save is in flight, and why the last save
  // failed (kept in the modal so the draft is never thrown away on a failure).
  let draft = $state('');
  let saving = $state(false);
  let saveError = $state<string | undefined>(undefined);

  const view = $derived(backendId != null ? $sftp.get(backendId) : undefined);
  const error = $derived(openError ?? view?.error);
  const transfer = $derived(view ? transferState(view) : undefined);
  const tree = $derived($remoteTree);

  // A tree, not a pane: every directory remembers its own listing, the root is what
  // the breadcrumb shows, and expanding a folder loads it in place.
  let root = $state('/');
  let expanded = $state<Set<string>>(new Set());

  /** The loaded listing of one directory, if it has arrived. */
  function dir(path: string) {
    const id = backendId;
    return id == null ? undefined : tree.get(`${id}:${path}`);
  }

  function visible(path: string): FileEntryDto[] {
    return (dir(path)?.entries ?? []).filter(
      (entry) => entry.name !== '..' && (showHidden || !entry.name.startsWith('.'))
    );
  }

  const rootEntries = $derived(visible(root));
  const rootDir = $derived(dir(root));

  // 'a/' -> ['a'] with the cumulative paths the breadcrumb links to.
  const crumbs = $derived.by(() => {
    const parts = root.split('/').filter(Boolean);
    const out: { name: string; path: string }[] = [];
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      out.push({ name: part, path: current });
    }
    return out;
  });

  function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /** Ask the core for one directory's listing; the reply lands in the tree cache. */
  function load(target: string): void {
    const id = backendId;
    if (id == null) return;
    treeBegin(id, target);
    void sftpList(id, target).catch((err) => {
      treeFailed(id, target, errMsg(err));
    });
  }

  /** Load a directory unless its listing is already here. */
  function ensure(target: string): void {
    if (!dir(target)) load(target);
  }

  function toggle(target: string): void {
    const next = new Set(expanded);
    if (next.has(target)) next.delete(target);
    else next.add(target);
    expanded = next;
    if (next.has(target)) ensure(target);
  }

  /** Move the tree's root (breadcrumb / collapse back). */
  function goRoot(target: string): void {
    root = target;
    expanded = new Set();
    ensure(target);
  }

  /** Drop every cached listing and reload the root plus what was open. */
  function refreshAll(): void {
    const id = backendId;
    if (id == null) return;
    const paths = [root, ...expanded];
    treeClear(id);
    for (const target of paths) load(target);
  }

  async function open(): Promise<void> {
    if (opened) return;
    opened = true;
    openError = undefined;
    try {
      const id = await sftpOpen(hostName);
      if (destroyed) {
        void sftpClose(id).catch(() => {});
        return;
      }
      backendId = id;
      sftp.open(id, hostName);
      ensure('/');
    } catch (err) {
      opened = false;
      openError = errMsg(err);
      lastError.set(errMsg(err));
    }
  }

  function retry(): void {
    openError = undefined;
    opened = false;
    void open();
  }

  // Open the first time the pane is actually on screen: a collapsed workspace must not
  // hold an idle SFTP connection open.
  $effect(() => {
    if (active) void open();
  });

  // A listing that landed clears the last session-level failure, so the stale error
  // banner does not outlive the connection it belonged to.
  $effect(() => {
    const id = backendId;
    if (id != null && view?.error && !view.remote.loading) sftp.clearError(id);
  });

  onDestroy(() => {
    destroyed = true;
    if (backendId != null) {
      void sftpClose(backendId).catch(() => {});
      treeClear(backendId);
      sftp.remove(backendId);
    }
  });

  function openEntry(entry: FileEntryDto): void {
    if (entry.isDir) {
      toggle(entry.path);
      return;
    }
    openEditor(entry.path);
  }

  const edit = $derived(view?.edit);

  /** Load a remote text file into the editor. */
  function openEditor(path: string): void {
    const id = backendId;
    if (id == null) return;
    saveError = undefined;
    sftp.beginEdit(id, path);
    void sftpReadFile(id, path).catch((err) =>
      sftp.fileContent(id, path, undefined, errMsg(err))
    );
  }

  function closeEditor(): void {
    const id = backendId;
    if (id == null) return;
    sftp.clearEdit(id);
    saving = false;
    saveError = undefined;
  }

  /** Save the draft over SFTP; the modal stays open until the write is confirmed. */
  async function saveEditor(): Promise<void> {
    const id = backendId;
    const current = edit;
    if (id == null || !current || current.loading || saving) return;
    saving = true;
    saveError = undefined;
    try {
      sftp.clearError(id);
      // The core answers a write with `sftp-op-done`; queue the op so the reply is
      // matched and the listing refreshes once the file changed.
      sftp.pushOp(id, { kind: 'write', name: current.path, refresh: 'remote' });
      await sftpWriteFile(id, current.path, draft);
    } catch (err) {
      saving = false;
      saveError = errMsg(err);
      sftp.opDone(id, false, errMsg(err));
    }
  }

  // Seed the textarea when the read lands (never while the user is typing: the draft
  // is local state and the store's content only changes on open).
  $effect(() => {
    const current = edit;
    if (current && !current.loading && current.content != null) draft = current.content;
  });

  // The write's reply: close on success, keep the draft and show the reason on failure.
  $effect(() => {
    const id = backendId;
    if (id == null || !view || !saving || view.pending.length > 0) return;
    const failure = view.error;
    saving = false;
    if (failure) {
      saveError = failure;
      return;
    }
    sftp.clearEdit(id);
    saveError = undefined;
  });

  // A successful mutation asked for a re-list; do it now that nothing is queued.
  $effect(() => {
    const id = backendId;
    if (id == null || !view || view.pending.length > 0 || !view.refresh) return;
    const target = view.refresh;
    sftp.clearRefresh(id);
    if (target === 'remote' || target === 'both') refreshAll();
  });

  // --- Context menu (right click) ------------------------------------------------
  let menu = $state<{ x: number; y: number; entry: FileEntryDto | null } | null>(null);

  function openMenu(event: MouseEvent, entry: FileEntryDto | null): void {
    event.preventDefault();
    event.stopPropagation();
    menu = { x: event.clientX, y: event.clientY, entry };
  }

  const parentOf = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/';
  const joinRemote = (dir: string, name: string): string =>
    dir === '/' ? `/${name}` : `${dir}/${name}`;
  const localJoin = (dir: string, name: string): string =>
    `${dir}${dir.includes('\\') && !dir.includes('/') ? '\\' : '/'}${name}`;
  const localName = (p: string): string => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;

  function currentDir(entry: FileEntryDto | null): string {
    if (!entry) return root;
    return entry.isDir ? entry.path : parentOf(entry.path);
  }

  async function pickOpen(options: Record<string, unknown>): Promise<string | string[] | null> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      return await open(options);
    } catch {
      return null;
    }
  }

  /** Run a mutating op: queue its reply, refresh the tree when it lands. */
  async function mutate(kind: 'upload' | 'download' | 'mkdir' | 'rename' | 'delete' | 'write', run: (id: number) => Promise<void>, name = ''): Promise<void> {
    const id = backendId;
    if (id == null) return;
    sftp.clearError(id);
    sftp.pushOp(id, { kind, name, refresh: 'remote' });
    try {
      await run(id);
    } catch (error) {
      sftp.opDone(id, false, errMsg(error));
      lastError.set(errMsg(error));
    }
  }

  // Folder transfers go pack → one transfer → unpack, shown as a single operation: the
  // pack/unpack phases live in `preparing`, never in the pending FIFO, and the pending op
  // is pushed synchronously right before its core enqueue so op-done stays correlated.
  async function downloadFolder(entry: FileEntryDto, picked: string): Promise<void> {
    const id = backendId;
    if (id == null) return;
    const name = entry.name;
    let remoteTmp: string | null = null;
    let localTmp: string | null = null;
    sftp.clearError(id);
    sftp.setPreparing(id, { kind: 'download', name });
    try {
      const packed = await remoteArchive(hostName, 'pack', { dir: parentOf(entry.path), name });
      if (!packed) throw new Error('打包失败：远端没有返回压缩包路径');
      remoteTmp = packed;
      const { tempDir } = await import('@tauri-apps/api/path');
      localTmp = localJoin(await tempDir(), localName(packed));
      sftp.setPreparing(id, undefined);
      const done = sftp.pushOp(id, { kind: 'download', name, refresh: 'remote' });
      void sftpDownload(id, localTmp, packed).catch((error) => sftp.opDone(id, false, errMsg(error)));
      const result = await done;
      if (!result.ok) {
        lastError.set(result.error ?? '下载失败');
        return;
      }
      sftp.setPreparing(id, { kind: 'download', name });
      await localArchive('unpack', localTmp, picked);
      localTmp = null;
    } catch (error) {
      lastError.set(errMsg(error));
    } finally {
      sftp.setPreparing(id, undefined);
      if (remoteTmp) void remoteArchive(hostName, 'remove', { archive: remoteTmp }).catch(() => {});
      if (localTmp) void localArchive('remove', localTmp).catch(() => {});
    }
  }

  async function uploadFolder(local: string, destDir: string): Promise<void> {
    const id = backendId;
    if (id == null) return;
    const name = localName(local);
    let localTmp: string | null = null;
    let remoteTmp: string | null = null;
    sftp.clearError(id);
    sftp.setPreparing(id, { kind: 'upload', name });
    try {
      const packed = await localArchive('pack', local);
      if (!packed) throw new Error('打包失败：本地没有返回压缩包路径');
      localTmp = packed;
      const temp = await remoteArchive(hostName, 'temp');
      if (!temp) throw new Error('打包失败：远端没有返回临时路径');
      remoteTmp = temp;
      sftp.setPreparing(id, undefined);
      const done = sftp.pushOp(id, { kind: 'upload', name, refresh: 'remote' });
      void sftpUpload(id, packed, temp).catch((error) => sftp.opDone(id, false, errMsg(error)));
      const result = await done;
      if (!result.ok) {
        lastError.set(result.error ?? '上传失败');
        return;
      }
      sftp.setPreparing(id, { kind: 'upload', name });
      await remoteArchive(hostName, 'unpack', { archive: temp, dest: destDir });
      remoteTmp = null;
      // The op's own refresh fired before the unpack landed; list again to show it.
      refreshAll();
    } catch (error) {
      lastError.set(errMsg(error));
    } finally {
      sftp.setPreparing(id, undefined);
      if (localTmp) void localArchive('remove', localTmp).catch(() => {});
      if (remoteTmp) void remoteArchive(hostName, 'remove', { archive: remoteTmp }).catch(() => {});
    }
  }

  // An in-app prompt/confirm: WebView2 may not surface `window.prompt`, and a modal is
  // also the only place that can show why an input was refused.
  type Ask = {
    title: string;
    message?: string;
    withInput: boolean;
    value: string;
    run: (value: string) => Promise<void>;
  };
  let ask = $state<Ask | null>(null);

  function askText(title: string, initial: string, run: (value: string) => Promise<void>): void {
    ask = { title, withInput: true, value: initial, run };
  }

  function askConfirm(title: string, message: string, run: () => Promise<void>): void {
    ask = { title, message, withInput: false, value: '', run: () => run() };
  }

  async function submitAsk(): Promise<void> {
    const current = ask;
    if (!current) return;
    ask = null;
    try {
      await current.run(current.value.trim());
    } catch (error) {
      lastError.set(errMsg(error));
    }
  }

  // A file downloaded for "open with": opened once the transfer's reply says it landed.
  let openAfter = $state<string | null>(null);

  $effect(() => {
    const id = backendId;
    if (id == null || !view || openAfter == null || view.pending.length > 0) return;
    const target = openAfter;
    openAfter = null;
    if (view.error) return;
    void import('@tauri-apps/plugin-opener')
      .then(({ openPath }) => openPath(target))
      .catch((error) => lastError.set(errMsg(error)));
  });

  async function contextAction(kind: string): Promise<void> {
    const id = backendId;
    const target = menu?.entry ?? null;
    menu = null;
    if (id == null) return;
    try {
      switch (kind) {
        case 'upload': {
          const picked = await pickOpen({ multiple: true, title: '上传文件' });
          const files = Array.isArray(picked) ? picked : picked ? [picked] : [];
          const dir = currentDir(target);
          for (const local of files) {
            await mutate('upload', (sid) => sftpUpload(sid, local, joinRemote(dir, localName(local))), localName(local));
          }
          return;
        }
        case 'uploadDir': {
          const picked = await pickOpen({ directory: true, multiple: false, title: '上传文件夹' });
          if (typeof picked !== 'string') return;
          await uploadFolder(picked, currentDir(target));
          return;
        }
        case 'download': {
          if (!target) return;
          const picked = await pickOpen({ directory: true, multiple: false, title: '下载到…' });
          if (typeof picked !== 'string') return;
          if (target.isDir) {
            await downloadFolder(target, picked);
            return;
          }
          await mutate('download', (sid) => sftpDownload(sid, localJoin(picked, target.name), target.path), target.name);
          return;
        }
        case 'openWith': {
          if (!target || target.isDir) return;
          const { tempDir } = await import('@tauri-apps/api/path');
          const dir = await tempDir();
          // Open only once the download's op-done lands: opening right away would race
          // the transfer and fail with "file not found".
          openAfter = localJoin(dir, target.name);
          await mutate('download', (sid) => sftpDownload(sid, openAfter!, target.path));
          return;
        }
        case 'rename': {
          if (!target) return;
          const entry = target;
          askText('重命名', entry.name, async (name) => {
            if (!name || name === entry.name || name.includes('/')) return;
            await mutate('rename', (sid) => sftpRename(sid, entry.path, joinRemote(parentOf(entry.path), name)));
          });
          return;
        }
        case 'delete': {
          if (!target) return;
          const entry = target;
          askConfirm('删除', `删除“${entry.name}”？文件夹会连同内容一起删除。`, async () => {
            await mutate('delete', (sid) => sftpDelete(sid, entry.path));
          });
          return;
        }
        case 'newFile': {
          askText('新建文件', '', async (name) => {
            if (!name || name.includes('/')) return;
            const path = joinRemote(currentDir(target), name);
            await mutate('write', (sid) => sftpWriteFile(sid, path, ''));
          });
          return;
        }
        case 'newDir': {
          askText('新建文件夹', '', async (name) => {
            if (!name || name.includes('/')) return;
            await mutate('mkdir', (sid) => sftpMkdir(sid, joinRemote(currentDir(target), name)));
          });
          return;
        }
        case 'chmod': {
          if (!target) return;
          const entry = target;
          askText('修改权限（八进制，例如 644）', '644', async (raw) => {
            const mode = Number.parseInt(raw, 8);
            if (!Number.isFinite(mode) || mode < 0 || mode > 0o7777) {
              lastError.set('权限需要是 0–7777 的八进制数字。');
              return;
            }
            await mutate('rename', (sid) => sftpChmod(sid, entry.path, mode));
          });
          return;
        }
        case 'open': {
          if (target && !target.isDir) openEditor(target.path);
          return;
        }
        case 'copyPath': {
          if (target) await copyText(target.path);
          return;
        }
        case 'copyName': {
          if (target) await copyText(target.name);
          return;
        }
        case 'compress': {
          if (!target) return;
          const archive = await compressRemote(hostName, parentOf(target.path), target.name);
          refreshAll();
          lastError.set(`已压缩为 ${archive}`);
          return;
        }
      }
    } catch (error) {
      lastError.set(errMsg(error));
    }
  }

  async function copyText(value: string): Promise<void> {
    menu = null;
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      lastError.set(errMsg(error));
    }
  }

  // One menu everywhere: right-clicking an entry adds the entry-only actions to the
  // same creation/upload list the blank area shows (newFile/newDir land inside a
  // folder, or beside a file — see currentDir).
  const menuItems = $derived.by(() => {
    if (!menu) return [];
    const entry = menu.entry;
    return [
      { kind: 'upload', label: entry ? '上传到此…' : '上传…' },
      { kind: 'uploadDir', label: entry ? '上传文件夹到此…' : '上传文件夹…' },
      { kind: 'newFile', label: '新建文件…' },
      { kind: 'newDir', label: '新建文件夹…' },
      ...(entry ? [{ kind: 'download', label: '下载…' }] : []),
      ...(entry && !entry.isDir
        ? [
            { kind: 'open', label: '打开' },
            { kind: 'openWith', label: '打开方式…' },
            { kind: 'compress', label: '压缩为 .tar.gz' }
          ]
        : []),
      ...(entry
        ? [
            { kind: 'rename', label: '重命名…' },
            { kind: 'copyPath', label: '复制路径' },
            { kind: 'copyName', label: '复制文件名' },
            { kind: 'chmod', label: '修改权限…' },
            { kind: 'delete', label: '删除' }
          ]
        : [])
    ];
  });

  const row =
    'flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-[0.8rem] transition ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const iconButton =
    'grid h-6 w-6 shrink-0 place-items-center rounded transition hover:bg-surface-inset ' +
    'hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const button = (on = false): string => `${iconButton} ${on ? 'text-accent' : 'text-faint'}`;
</script>

<section
  aria-label="远程文件"
  aria-busy={rootDir?.loading ?? false}
  class="flex h-full min-h-0 min-w-0 flex-col bg-surface"
>
  <header class="shrink-0 border-b border-default px-3">
    <div class="flex h-9 items-center justify-between gap-2">
      <h2 class="flex min-w-0 items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted">
        <Icon name="sftp" size={13} /> 远程文件
      </h2>
      <div class="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class={button(showHidden)}
          title={showHidden ? '隐藏以 . 开头的文件' : '显示隐藏文件'}
          aria-label={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}
          aria-pressed={showHidden}
          onclick={() => (showHidden = !showHidden)}
        >
          <Icon name="eye" size={13} />
        </button>
        <button
          type="button"
          class={button()}
          title="刷新目录"
          aria-label="刷新远程目录"
          disabled={backendId == null}
          onclick={refreshAll}
        >
          <Icon name="refresh" size={13} />
        </button>
        {#if !detached && !maximized}
          <button
            type="button"
            class={button()}
            title="在独立窗口打开文件面板"
            aria-label="在独立窗口打开文件面板"
            onclick={() => openDetachedPanel('files', hostName)}
          >
            <Icon name="popout" size={13} />
          </button>
        {/if}
        <button
          type="button"
          class={button()}
          title={maximized ? '还原面板' : '折叠文件面板'}
          aria-label={maximized ? '还原文件面板' : '折叠文件面板'}
          onclick={onCollapse}
        >
          <Icon name={maximized ? 'restore' : 'collapse'} size={13} />
        </button>
        {#if !maximized}
          <button
            type="button"
            class={button()}
            title="最大化文件面板"
            aria-label="最大化文件面板"
            onclick={onMaximize}
          >
            <Icon name="maximize" size={13} />
          </button>
        {/if}
      </div>
    </div>

    <!-- Breadcrumb: the tree's root; clicking a segment re-roots the tree there. -->
    <nav aria-label="远程路径" class="mt-1.5 flex min-w-0 items-center gap-0.5 text-[0.6875rem]">
      <button
        type="button"
        class="shrink-0 rounded px-1 py-0.5 font-mono text-faint transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        title="根目录"
        onclick={() => goRoot('/')}
      >
        /
      </button>
      {#each crumbs as crumb, i (crumb.path)}
        <span aria-hidden="true" class="shrink-0 text-faint">›</span>
        <button
          type="button"
          class="min-w-0 truncate rounded px-1 py-0.5 font-mono transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus
            {i === crumbs.length - 1 ? 'text-fg' : 'text-muted'}"
          title={crumb.path}
          aria-current={i === crumbs.length - 1 ? 'location' : undefined}
          onclick={() => goRoot(crumb.path)}
        >
          {crumb.name}
        </button>
      {/each}
    </nav>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
    {#if openError}
      <div class="px-2 py-6 text-center text-xs">
        <p class="text-status-crit">{$maskText(openError)}</p>
        <button
          type="button"
          class="mt-3 rounded border border-default px-2 py-1 text-muted transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          onclick={retry}
        >
          重试
        </button>
      </div>
    {:else if error}
      <div class="px-2 py-6 text-center text-xs">
        <p class="text-status-crit">{$maskText(error)}</p>
        <button
          type="button"
          class="mt-3 rounded border border-default px-2 py-1 text-muted transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          onclick={refreshAll}
        >
          重新加载
        </button>
      </div>
    {:else if backendId == null || (rootDir?.loading && !rootDir.entries.length)}
      <p class="px-2 py-6 text-center text-xs text-faint">正在连接远程文件…</p>
    {:else if rootDir?.error && !rootDir.entries.length}
      <p class="px-2 py-6 text-center text-xs text-status-crit">{$maskText(rootDir.error)}</p>
    {:else if (rootDir?.entries.length ?? 0) === 0}
      <p class="px-2 py-6 text-center text-xs text-faint">空目录</p>
    {:else}
      <ul class="space-y-0.5" oncontextmenu={(e) => openMenu(e, null)}>
        {@render nodes(root, 0)}
      </ul>
    {/if}
  </div>

  {#if transfer}
    <div class="shrink-0 border-t border-default px-3 py-1.5" role="status" aria-label="传输进度">
      <div class="flex items-center gap-2 text-[0.625rem] text-muted">
        <Icon name={transfer.kind === 'upload' ? 'upload' : 'download'} size={12} />
        <span class="min-w-0 flex-1 truncate" title={transfer.name}>
          {transfer.name || (transfer.kind === 'upload' ? '上传' : '下载')}
        </span>
        <span class="shrink-0 tabular-nums">
          {#if transfer.preparing}
            准备中…
          {:else}
            {formatBytes(transfer.done)} / {formatBytes(transfer.total)}
          {/if}
        </span>
      </div>
      <div class="mt-1 h-1 overflow-hidden rounded bg-surface-inset">
        <div
          class="h-full bg-accent transition-[width]"
          style:width="{transfer.total > 0
            ? Math.min(100, (transfer.done / transfer.total) * 100)
            : transfer.preparing
              ? 0
              : 100}%"
        ></div>
      </div>
    </div>
  {/if}

  <footer
    class="flex h-6 shrink-0 items-center justify-between gap-2 border-t border-default px-3 text-[0.625rem] text-faint"
  >
    <span class="min-w-0 truncate font-mono" title={root}>{root}</span>
    <span class="shrink-0">{rootEntries.length} 项</span>
  </footer>
</section>

{#snippet nodes(path: string, depth: number)}
  {#each visible(path) as entry (entry.path)}
    {@const isOpen = expanded.has(entry.path)}
    {@const sub = dir(entry.path)}
    <li>
      <div class="flex min-w-0 items-center gap-0.5" style:padding-left="{depth * 0.85}rem">
        {#if entry.isDir}
          <button
            type="button"
            class="grid h-5 w-4 shrink-0 place-items-center rounded text-faint transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            title={isOpen ? '收起' : '展开'}
            aria-label="{isOpen ? '收起' : '展开'} {entry.name}"
            aria-expanded={isOpen}
            onclick={() => toggle(entry.path)}
          >
            <span class="transition-transform {isOpen ? 'rotate-90' : ''}"><Icon name="chevron" size={10} /></span>
          </button>
        {:else}
          <span class="w-4 shrink-0" aria-hidden="true"></span>
        {/if}
        <button
          type="button"
          class="{row} text-muted hover:bg-surface-inset hover:text-fg"
          title={entry.isDir ? `${fileTypeLabel(entry)} · 展开 ${entry.path}` : `${fileTypeLabel(entry)} · 编辑 ${entry.path} · ${formatBytes(entry.size)} · ${formatDate(entry.modified)}`}
          onclick={() => openEntry(entry)}
          oncontextmenu={(e) => openMenu(e, entry)}
        >
          <Icon name={fileTypeIcon(entry)} size={14} />
          <span class="min-w-0 flex-1 truncate {entry.isDir ? 'font-medium text-fg' : ''}">
            {entry.name}
          </span>
          {#if entry.isSymlink}
            <span class="shrink-0 text-faint" title="符号链接">
              <Icon name="link" size={11} label="符号链接" />
            </span>
          {/if}
          {#if !entry.isDir}
            <span class="shrink-0 tabular-nums text-[0.6875rem] text-faint">
              {formatBytes(entry.size)}
            </span>
          {/if}
        </button>
      </div>
      {#if entry.isDir && isOpen}
        <div class="space-y-0.5">
          {#if sub?.loading && !sub.entries.length}
            <p class="py-0.5 text-[0.625rem] text-faint" style:padding-left="{(depth + 1) * 0.85 + 1.25}rem">正在读取…</p>
          {:else if sub?.error}
            <p class="py-0.5 text-[0.625rem] text-status-crit" style:padding-left="{(depth + 1) * 0.85 + 1.25}rem">{$maskText(sub.error)}</p>
          {:else}
            <ul class="space-y-0.5" oncontextmenu={(e) => openMenu(e, null)}>{@render nodes(entry.path, depth + 1)}</ul>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
{/snippet}

{#if edit}
  <Modal label="编辑远程文件" wide onClose={closeEditor}>
    <div class="flex min-h-0 flex-col gap-3 p-5">
      <div class="min-w-0">
        <h2 class="truncate text-sm font-semibold" title={edit.path}>编辑 {edit.path}</h2>
        <p class="mt-0.5 text-xs text-faint">保存会直接覆盖远程文件；只支持 UTF-8 文本，最大 1 MiB。</p>
      </div>
      {#if edit.loading}
        <p class="py-10 text-center text-xs text-faint">正在读取…</p>
      {:else if edit.error}
        <p class="rounded-lg bg-surface-inset p-3 text-xs text-status-crit">{$maskText(edit.error)}</p>
        <div class="flex justify-end">
          <Button variant="ghost" onclick={closeEditor}>关闭</Button>
        </div>
      {:else}
        <textarea
          bind:value={draft}
          aria-label="文件内容"
          spellcheck="false"
          class="h-[44vh] w-full resize-none rounded-lg bg-surface-inset p-3 font-mono text-xs leading-relaxed text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
        ></textarea>
        {#if saveError}
          <p class="text-xs text-status-crit">{$maskText(saveError)}</p>
        {/if}
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" disabled={saving} onclick={closeEditor}>取消</Button>
          <Button variant="primary" disabled={saving} onclick={saveEditor}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      {/if}
    </div>
  </Modal>
{/if}
{#if menu}
  <div
    class="fixed inset-0 z-40"
    role="presentation"
    onclick={() => (menu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      menu = null;
    }}
  ></div>
  <div
    class="fixed z-50 min-w-52 rounded-lg border border-default bg-surface-raised py-1 shadow-soft"
    style:left="{menu.x}px"
    style:top="{menu.y}px"
    role="menu"
    aria-label="文件操作"
  >
    {#each menuItems as item (item.kind)}
      <button
        type="button"
        class="flex w-full items-center px-3 py-1.5 text-left text-xs text-muted transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
        aria-label={item.label}
        onclick={() => contextAction(item.kind)}
      >{item.label}</button>
    {/each}
  </div>
{/if}
{#if ask}
  <Modal label={ask.title} onClose={() => (ask = null)}>
    <form
      class="space-y-3 p-5"
      onsubmit={(e) => {
        e.preventDefault();
        void submitAsk();
      }}
    >
      <h2 class="text-sm font-semibold">{ask.title}</h2>
      {#if ask.message}<p class="text-xs text-muted">{ask.message}</p>{/if}
      {#if ask.withInput}
        <input
          bind:value={ask.value}
          class="w-full rounded-lg bg-surface-inset px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-label={ask.title}
        />
      {/if}
      <div class="flex justify-end gap-2 pt-1">
        <button type="button" class="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-fg" onclick={() => (ask = null)}>取消</button>
        <button type="button" class="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg" onclick={() => void submitAsk()}>
          {ask.withInput ? '确定' : '删除'}
        </button>
      </div>
    </form>
  </Modal>
{/if}