// Glyph + human label for a remote entry, so a directory tree reads at a glance
// (tech-gui.md §3.2). Extension-driven; an unknown type is a plain file icon.
import type { FileEntryDto } from '$lib/bindings';
import type { IconName } from '$lib/theme';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'tif', 'tiff', 'avif', 'heic', 'psd']);
const VIDEO = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'mpeg', 'mpg']);
const AUDIO = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'mid']);
const ARCHIVE = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'deb', 'rpm', 'apk', 'iso', 'jar']);
const CODE = new Set([
  'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'tsx', 'jsx', 'vue', 'svelte', 'py', 'rb', 'php', 'rs', 'go',
  'java', 'kt', 'kts', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'scala', 'lua', 'pl', 'r', 'dart',
  'ex', 'exs', 'erl', 'hs', 'clj', 'zig', 'nim'
]);
const SCRIPT = new Set(['sh', 'bash', 'zsh', 'fish', 'ksh', 'ps1', 'psm1', 'bat', 'cmd', 'awk', 'sed']);
const DOC = new Set(['md', 'markdown', 'txt', 'rst', 'log', 'pdf', 'doc', 'docx', 'odt', 'rtf', 'tex', 'csv', 'tsv']);
const CONFIG = new Set(['json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'xml', 'env', 'properties', 'service', 'desktop', 'lock']);
const DATABASE = new Set(['db', 'sqlite', 'sqlite3', 'sql', 'mdb', 'dump', 'bak']);
const KEY = new Set(['key', 'pem', 'pub', 'crt', 'cer', 'p12', 'pfx', 'asc', 'gpg', 'kdbx']);

type Named = Pick<FileEntryDto, 'name' | 'isDir'>;

/** The part after the last dot; dotfiles like `.bashrc` count as config, not `.bashrc`. */
export function extensionOf(name: string): string {
  const base = name.replace(/^\.+/, '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** A glyph for the entry: folder, or a type icon for known extensions. */
export function fileTypeIcon(entry: Named): IconName {
  return iconFor(entry.isDir, entry.name);
}

function iconFor(isDir: boolean, name: string): IconName {
  if (isDir) return 'folder';
  const ext = extensionOf(name);
  if (IMAGE.has(ext)) return 'image';
  if (VIDEO.has(ext)) return 'video';
  if (AUDIO.has(ext)) return 'music';
  if (ARCHIVE.has(ext)) return 'archive';
  if (CODE.has(ext)) return 'code';
  if (SCRIPT.has(ext)) return 'terminal';
  if (DATABASE.has(ext)) return 'database';
  if (KEY.has(ext)) return 'key';
  if (DOC.has(ext)) return 'doc';
  if (CONFIG.has(ext) || name.startsWith('.')) return 'settings';
  return 'file';
}

/** The type in words, for a tooltip. */
export function fileTypeLabel(entry: Named): string {
  if (entry.isDir) return '文件夹';
  const ext = extensionOf(entry.name);
  if (IMAGE.has(ext)) return '图片';
  if (VIDEO.has(ext)) return '视频';
  if (AUDIO.has(ext)) return '音频';
  if (ARCHIVE.has(ext)) return '压缩包';
  if (CODE.has(ext)) return '代码';
  if (SCRIPT.has(ext)) return '脚本';
  if (DATABASE.has(ext)) return '数据库';
  if (KEY.has(ext)) return '密钥';
  if (DOC.has(ext)) return '文档';
  if (CONFIG.has(ext) || entry.name.startsWith('.')) return '配置';
  return '文件';
}
