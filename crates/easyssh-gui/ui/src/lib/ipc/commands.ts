// Thin typed wrappers over the generated command bindings (tech-gui.md §3.5).
// Components call these, never `invoke` directly.

import type { Channel } from '@tauri-apps/api/core';
import { commands } from '$lib/bindings';
import type {
  HostDto,
  HostInputDto,
  ImportSummary,
  SnippetDto,
  TerminalBytes,
  TraySupportDto,
  UpdateConfigDto,
  UpdateInfoDto
} from '$lib/bindings';

export async function listHosts(): Promise<HostDto[]> {
  const res = await commands.listHosts();
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Reload hosts from disk and (re)start the pollers; broadcasts `hosts-loaded`. */
export async function reloadHosts(): Promise<void> {
  const res = await commands.reloadHosts();
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Add or edit a manual host in `hosts.toml`. Call `reloadHosts` after to refresh. */
export async function saveHost(input: HostInputDto): Promise<void> {
  const res = await commands.saveHost(input);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Delete a manual host by name. A missing / SSH-config name is a no-op success. */
export async function deleteHost(name: string): Promise<void> {
  const res = await commands.deleteHost(name);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** The stored login password of a host, for the list's copy action (null when none). */
export async function hostPassword(name: string): Promise<string | null> {
  const res = await commands.hostPassword(name);
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Export every host (SSH-config imports included) to `path` (or the downloads folder
 *  when null); returns the path. The TOML file carries plaintext passwords. */
export async function exportHosts(path: string | null = null): Promise<string> {
  const res = await commands.exportHosts(path);
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Export every host as OpenSSH config text (no passwords); returns the path written. */
export async function exportSshConfig(path: string | null = null): Promise<string> {
  const res = await commands.exportSshConfig(path);
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Import hosts from a file's text; reports added / skipped / failed. */
export async function importHosts(content: string): Promise<ImportSummary> {
  const res = await commands.importHosts(content);
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Read the saved snippets from the shared `snippets.toml`. */
export async function listSnippets(): Promise<SnippetDto[]> {
  const res = await commands.listSnippets();
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Upsert one snippet by name and persist the whole list. */
export async function saveSnippet(snippet: SnippetDto): Promise<void> {
  const res = await commands.saveSnippet(snippet);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Delete the snippet named `name` and persist. */
export async function deleteSnippet(name: string): Promise<void> {
  const res = await commands.deleteSnippet(name);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Run a snippet on one or more hosts; results arrive as `snippet-result` events. */
export async function executeSnippet(
  snippetName: string,
  hostNames: string[],
  params: Record<string, string>
): Promise<void> {
  const res = await commands.executeSnippet(snippetName, hostNames, params);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Open a terminal for `hostName`, streaming raw output into `onOutput`; returns the
 *  public session id used by the write/resize/close wrappers (tech-gui.md §3.3/§4.2). */
export async function terminalOpen(
  hostName: string,
  cols: number,
  rows: number,
  onOutput: Channel<TerminalBytes>
): Promise<number> {
  const res = await commands.terminalOpen(hostName, cols, rows, onOutput);
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Send keystrokes (UTF-8 bytes) to a terminal. */
export async function terminalWrite(sessionId: number, data: number[]): Promise<void> {
  const res = await commands.terminalWrite(sessionId, data);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Reflow a terminal to `cols` x `rows`. */
export async function terminalResize(sessionId: number, cols: number, rows: number): Promise<void> {
  const res = await commands.terminalResize(sessionId, cols, rows);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Close a terminal and its connection. Idempotent for an already-closed id. */
export async function terminalClose(sessionId: number): Promise<void> {
  const res = await commands.terminalClose(sessionId);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Open an SFTP session for `hostName`; returns the public session id the sftp_*
 *  wrappers use, and the tab's `sftp-*` events carry (tech-gui.md §3.4/§4.2). */
export async function sftpOpen(hostName: string): Promise<number> {
  const res = await commands.sftpOpen(hostName);
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** List a remote directory; the result arrives as `sftp-dir-listed`. */
export async function sftpList(sessionId: number, path: string): Promise<void> {
  const res = await commands.sftpList(sessionId, path);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Upload a local file or folder to a remote path; progress arrives as `transfer-progress`. */
export async function sftpUpload(sessionId: number, local: string, remote: string): Promise<void> {
  const res = await commands.sftpUpload(sessionId, local, remote);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Download a remote file or folder to a local path; progress arrives as
 *  `transfer-progress`. */
export async function sftpDownload(
  sessionId: number,
  local: string,
  remote: string
): Promise<void> {
  const res = await commands.sftpDownload(sessionId, local, remote);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Create a remote directory; completion arrives as `sftp-op-done`. */
export async function sftpMkdir(sessionId: number, path: string): Promise<void> {
  const res = await commands.sftpMkdir(sessionId, path);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Rename / move a remote path; completion arrives as `sftp-op-done`. */
export async function sftpRename(sessionId: number, from: string, to: string): Promise<void> {
  const res = await commands.sftpRename(sessionId, from, to);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Delete a remote file (or empty directory); completion arrives as `sftp-op-done`. */
export async function sftpDelete(sessionId: number, path: string): Promise<void> {
  const res = await commands.sftpDelete(sessionId, path);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Read a remote text file for the editor; the text arrives as `file-content`. */
export async function sftpReadFile(sessionId: number, path: string): Promise<void> {
  const res = await commands.sftpReadFile(sessionId, path);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Replace a remote text file's contents; completion arrives as `sftp-op-done`. */
export async function sftpWriteFile(
  sessionId: number,
  path: string,
  content: string
): Promise<void> {
  const res = await commands.sftpWriteFile(sessionId, path, content);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Close an SFTP session and its connection. Idempotent for an already-closed id. */
export async function sftpClose(sessionId: number): Promise<void> {
  const res = await commands.sftpClose(sessionId);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Start auto SSH-key setup for a host; progress + the outcome arrive as `key-setup-*`
 *  events (tech-gui.md §4.2). Fire-and-forget — only an unknown host rejects here. */
export async function startKeySetup(hostName: string): Promise<void> {
  const res = await commands.startKeySetup(hostName);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Start (or restart) a host's tunnel; its progress arrives as `tunnel-status-changed`
 *  (tech-gui.md §4.2). Rejects an unknown host or one without port forwards. */
export async function tunnelStart(hostName: string): Promise<void> {
  const res = await commands.tunnelStart(hostName);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Stop a host's tunnel; a no-op when none runs. */
export async function tunnelStop(hostName: string): Promise<void> {
  const res = await commands.tunnelStop(hostName);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Paste into the focused terminal through the webview's own paste, for the Ctrl+Shift+V
 *  WebKitGTK misses under a non-Latin layout. */
export async function terminalPaste(): Promise<void> {
  const res = await commands.terminalPaste();
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Hide the webview engine's own right-click menu — browser chrome, not app UI. */
export async function disableDefaultContextMenu(): Promise<void> {
  const res = await commands.disableDefaultContextMenu();
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Minimize and close to the tray, or not; resolves to what this desktop allows. */
export async function setTrayBehavior(
  minimizeToTray: boolean,
  closeToTray: boolean
): Promise<TraySupportDto> {
  const res = await commands.setTrayBehavior(minimizeToTray, closeToTray);
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Absolute path of the shared UI settings store: AppData while writable, else the
 *  portable `omnyssh-data` beside the executable. */
export async function settingsStorePath(): Promise<string> {
  const res = await commands.settingsStorePath();
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Force an immediate metric poll of every host (tech-gui.md §4.2). */
export async function refreshMetrics(): Promise<void> {
  const res = await commands.refreshMetrics();
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Check GitHub for a newer release; `null` means up to date (tech-gui.md §4.2). */
export async function checkUpdate(): Promise<UpdateInfoDto | null> {
  const res = await commands.checkUpdate();
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Download and install the latest desktop bundle (tech-gui.md §4.3). Fully wired once
 *  Stage 5 configures the updater endpoints; until then it reports "not available yet". */
export async function installUpdate(): Promise<void> {
  const res = await commands.installUpdate();
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Read the update-checker preferences from the shared config (tech-gui.md §4.3). */
export async function loadUpdateConfig(): Promise<UpdateConfigDto> {
  const res = await commands.loadUpdateConfig();
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** Persist the update-checker preferences to the shared config (tech-gui.md §4.3). */
export async function saveUpdateConfig(config: UpdateConfigDto): Promise<void> {
  const res = await commands.saveUpdateConfig(config);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Decrypt an identity file with `passphrase` and cache it for this process. */
export async function unlockIdentity(keyPath: string, passphrase: string): Promise<void> {
  const res = await commands.unlockIdentity(keyPath, passphrase);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Answer a login's password prompt; `null` cancels the login. */
export async function answerPassword(requestId: number, password: string | null): Promise<void> {
  const res = await commands.answerPassword(requestId, password);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Change a remote entry's permission bits; completes as `sftp-op-done`. */
export async function sftpChmod(sessionId: number, path: string, mode: number): Promise<void> {
  const res = await commands.sftpChmod(sessionId, path, mode);
  if (res.status === 'error') throw new Error(res.error.message);
}

/** Compress dir/name into dir/name.tar.gz on the host; returns the archive path. */
export async function compressRemote(hostName: string, dir: string, name: string): Promise<string> {
  const res = await commands.compressRemote(hostName, dir, name);
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** The remote half of a seamless folder transfer: pack into a temp archive (returns its
 *  path), unpack one into `dest` (always removing it), allocate a temp path, or remove a
 *  leftover archive. */
export async function remoteArchive(
  hostName: string,
  action: 'pack' | 'unpack' | 'temp' | 'remove',
  opts: { dir?: string; name?: string; archive?: string; dest?: string } = {}
): Promise<string | null> {
  const res = await commands.remoteArchive(
    hostName,
    action,
    opts.dir ?? null,
    opts.name ?? null,
    opts.archive ?? null,
    opts.dest ?? null
  );
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}

/** The local half: pack a folder into a temp archive (returns its path), unpack one into
 *  `dest` (removing the archive), or remove a leftover archive. */
export async function localArchive(
  action: 'pack' | 'unpack' | 'remove',
  path: string,
  dest?: string
): Promise<string | null> {
  const res = await commands.localArchive(action, path, dest ?? null);
  if (res.status === 'error') throw new Error(res.error.message);
  return res.data;
}