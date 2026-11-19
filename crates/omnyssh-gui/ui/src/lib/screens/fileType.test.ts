import { describe, expect, it } from 'vitest';
import { extensionOf, fileTypeIcon, fileTypeLabel } from './fileType';

function file(name: string, isDir = false) {
  return { name, isDir };
}

describe('remote file types', () => {
  it('reads the extension, treating dotfiles as config rather than an extension', () => {
    expect(extensionOf('notes.txt')).toBe('txt');
    expect(extensionOf('archive.tar.GZ')).toBe('gz');
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('Makefile')).toBe('');
  });

  it('picks a specific glyph per family', () => {
    expect(fileTypeIcon(file('etc', true))).toBe('folder');
    expect(fileTypeIcon(file('photo.PNG'))).toBe('image');
    expect(fileTypeIcon(file('movie.mp4'))).toBe('video');
    expect(fileTypeIcon(file('song.flac'))).toBe('music');
    expect(fileTypeIcon(file('backup.tar.gz'))).toBe('archive');
    expect(fileTypeIcon(file('main.rs'))).toBe('code');
    expect(fileTypeIcon(file('deploy.sh'))).toBe('terminal');
    expect(fileTypeIcon(file('app.db'))).toBe('database');
    expect(fileTypeIcon(file('id_ed25519.pub'))).toBe('key');
    expect(fileTypeIcon(file('README.md'))).toBe('doc');
    expect(fileTypeIcon(file('config.yaml'))).toBe('settings');
    expect(fileTypeIcon(file('notes'))).toBe('file');
  });

  it('labels the type in words', () => {
    expect(fileTypeLabel(file('logs', true))).toBe('文件夹');
    expect(fileTypeLabel(file('shot.jpeg'))).toBe('图片');
    expect(fileTypeLabel(file('x.zip'))).toBe('压缩包');
    expect(fileTypeLabel(file('.env'))).toBe('配置');
    expect(fileTypeLabel(file('blob'))).toBe('文件');
  });
});
