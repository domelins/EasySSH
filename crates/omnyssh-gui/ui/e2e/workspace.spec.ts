import { expect, test, type Page } from '@playwright/test';

// Connection workspace e2e (tech-gui.md §2, §3.1): one host, three panes — remote files,
// terminal tabs, live monitor — with a draggable/collapsible splitter whose widths
// survive a reload. Tauri is absent off-runtime, so the boundary is stubbed like the
// other specs (§6.4).

const HOSTS = [
  {
    name: 'web-1',
    hostname: 'web-1.example.com',
    user: 'deploy',
    port: 22,
    tags: ['prod'],
    source: 'manual',
    hasKey: true,
    hasPassword: true,
    monitoring: 'ssh',
    localForwards: [],
    tunnelAutostart: false,
    forwardAgent: false
  },
  {
    name: 'db-1',
    hostname: 'db-1.example.com',
    user: 'root',
    port: 22,
    tags: [],
    source: 'manual',
    hasKey: false,
    monitoring: 'tcpPort',
    localForwards: [],
    tunnelAutostart: false,
    forwardAgent: false
  }
];

const FILES: Record<string, Array<{ name: string; size: number; isDir: boolean; isSymlink?: boolean }>> = {
  '/': [
    { name: 'etc', size: 0, isDir: true },
    { name: 'home', size: 0, isDir: true },
    { name: 'link-to-logs', size: 0, isDir: true, isSymlink: true },
    { name: 'notes.txt', size: 120, isDir: false },
    { name: '.hidden', size: 4, isDir: false }
  ],
  '/etc': [{ name: 'hosts', size: 220, isDir: false }]
};

async function boot(page: Page, options: { parked?: Record<string, number>; path?: string } = {}): Promise<void> {
  await page.addInitScript(
    ({ hosts, files, parked }) => {
      // A "next start" can be simulated by seeding the persisted tab counts.
      if (parked) localStorage.setItem('omnyssh-open-tabs', JSON.stringify(parked));
      let cbid = 0;
      let nextSession = 0;
      const win = window as unknown as Record<string, unknown>;
      const listeners: Record<string, number[]> = {};
      const chIndex: Record<number, number> = {};

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((e: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }

      // Lets a test simulate the remote shell exiting for a backend session id.
      win.__fireTerminalExited = (sessionId: number, hadOutput: boolean) =>
        fire('terminal-exited', { sessionId, hadOutput });

      function sendToChannel(chId: number, text: string): void {
        const cb = win[`__cb${chId}`] as ((m: unknown) => void) | undefined;
        const index = chIndex[chId] ?? 0;
        chIndex[chId] = index + 1;
        cb?.({ message: new TextEncoder().encode(text).buffer, index });
      }

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve(hosts);
            case 'reload_hosts':
              return Promise.resolve(null);
            case 'terminal_open': {
              const chId = (args.onOutput as { id: number }).id;
              const sid = ++nextSession;
              win.__lastTerminal = sid;
              win.__terminalOpens = ((win.__terminalOpens as number | undefined) ?? 0) + 1;
              setTimeout(() => sendToChannel(chId, 'omnyssh-ready> '), 0);
              return Promise.resolve(sid);
            }
            case 'terminal_write':
              return Promise.resolve(null);
            case 'terminal_resize':
              return Promise.resolve(null);
            case 'terminal_close':
              return Promise.resolve(null);
            case 'sftp_open': {
              const sid = ++nextSession;
              setTimeout(() => fire('sftp-connected', { sessionId: sid, hostName: args.hostName }), 0);
              return Promise.resolve(sid);
            }
            case 'sftp_list': {
              const { sessionId, path } = args as { sessionId: number; path: string };
              setTimeout(() => {
                const entries = (files[path] ?? []).map((entry) => ({
                  name: entry.name,
                  path: path === '/' ? `/${entry.name}` : `${path}/${entry.name}`,
                  size: entry.size,
                  isDir: entry.isDir,
                  isSymlink: entry.isSymlink ?? false,
                  modified: 1_700_000_000
                }));
                fire('sftp-dir-listed', { sessionId, path, entries });
              }, 0);
              return Promise.resolve(null);
            }
            case 'sftp_close':
              return Promise.resolve(null);
            case 'host_password':
              return Promise.resolve(`secret-for-${String(args.name)}`);
            case 'sftp_read_file': {
              const { sessionId, path } = args as { sessionId: number; path: string };
              setTimeout(() => fire('file-content', { sessionId, path, content: 'server_name web-1;\n' }), 0);
              return Promise.resolve(null);
            }
            case 'sftp_mkdir': {
              const { sessionId, path } = args as { sessionId: number; path: string };
              (win.__mkdirs as string[] | undefined)?.push(path);
              win.__mkdirs = [...((win.__mkdirs as string[] | undefined) ?? []), path];
              setTimeout(() => fire('sftp-op-done', { sessionId, ok: true }), 0);
              return Promise.resolve(null);
            }
            case 'sftp_write_file': {
              const { sessionId, path, content } = args as { sessionId: number; path: string; content: string };
              win.__written = { path, content };
              setTimeout(() => fire('sftp-op-done', { sessionId, ok: true }), 0);
              return Promise.resolve(null);
            }
            case 'refresh_metrics': {
              setTimeout(
                () => fire('host-latency', { hostName: 'web-1', tcpMs: 12, pingMs: 18 }),
                0
              );
              setTimeout(
                () =>
                  fire('metrics-updated', {
                    hostName: 'web-1',
                    metrics: {
                      cpuPercent: 32,
                      ramPercent: 48,
                      diskPercent: 61,
                      uptime: '12 days',
                      loadAvg: '0.42 0.51 0.47',
                      osInfo: 'Linux 6.8 web-1',
                      topProcesses: [
                        { name: 'sshd', cpuPercent: 1, memPercent: 2 },
                        { name: 'node', cpuPercent: 17, memPercent: 9 }
                      ],
                      processes: [
                        { pid: 101, command: 'sshd', cpuPercent: 1, memPercent: 2 },
                        { pid: 202, command: 'node', cpuPercent: 17, memPercent: 9 },
                        { pid: 303, command: 'postgres', cpuPercent: 4, memPercent: 12 }
                      ],
                      memory: {
                        totalBytes: 8_000_000_000,
                        usedBytes: 3_000_000_000,
                        cachedBytes: 2_000_000_000,
                        freeBytes: 3_000_000_000
                      },
                      network: {
                        rxBytesTotal: 1_048_576_000,
                        txBytesTotal: 52_428_800,
                        rxBytesPerSec: 1_572_864,
                        txBytesPerSec: 524_288
                      },
                      disks: [
                        {
                          mount: '/',
                          device: '/dev/sda1',
                          totalBytes: 100_000_000_000,
                          usedBytes: 61_000_000_000,
                          percent: 61,
                          readBytesPerSec: 1_048_576,
                          writeBytesPerSec: 524_288
                        },
                        {
                          mount: '/srv',
                          device: '/dev/sdb1',
                          totalBytes: 50_000_000_000,
                          usedBytes: 5_000_000_000,
                          percent: 10
                        }
                      ],
                      cpuHistory: [12, 18, 25, 32],
                      ageSeconds: 2
                    }
                  }),
                0
              );
              return Promise.resolve(null);
            }
            case 'plugin:dialog|open': {
              win.__dialogCalls = [...((win.__dialogCalls as unknown[] | undefined) ?? []), args];
              return Promise.resolve(win.__dialogPick ?? null);
            }
            case 'plugin:path|temp_dir':
              return Promise.resolve('C:\\Temp');
            case 'plugin:path|resolve_directory':
              // Newer @tauri-apps/api routes tempDir() here (BaseDirectory.Temp = 12).
              return Promise.resolve(args.directory === 12 ? 'C:\\Temp' : null);
            case 'remote_archive': {
              const { action, dir, name, archive, dest } = args as Record<string, string>;
              win.__archiveCalls = [
                ...((win.__archiveCalls as unknown[] | undefined) ?? []),
                { side: 'remote', action, dir, name, archive, dest }
              ];
              // A beat of latency so the pane's preparing/progress states are observable.
              const answer = action === 'pack' || action === 'temp' ? '/tmp/omnyssh-TEST1234' : null;
              return new Promise((resolve) => setTimeout(() => resolve(answer), 150));
            }
            case 'local_archive': {
              const { action, path, dest } = args as Record<string, string>;
              win.__archiveCalls = [
                ...((win.__archiveCalls as unknown[] | undefined) ?? []),
                { side: 'local', action, path, dest }
              ];
              const answer = action === 'pack' ? 'C:\\Temp\\omnyssh-TEST9999.tar.gz' : null;
              return new Promise((resolve) => setTimeout(() => resolve(answer), 150));
            }
            case 'sftp_upload':
            case 'sftp_download': {
              const { sessionId, local, remote } = args as { sessionId: number; local: string; remote: string };
              win.__transfers = [
                ...((win.__transfers as unknown[] | undefined) ?? []),
                { cmd, sessionId, local, remote }
              ];
              setTimeout(() => fire('transfer-progress', { sessionId, transferId: 1, done: 4, total: 8 }), 100);
              setTimeout(
                () =>
                  fire('sftp-op-done', {
                    sessionId,
                    ok: win.__transferOk ?? true,
                    error: win.__transferOk === false ? 'disk full' : undefined
                  }),
                250
              );
              return Promise.resolve(null);
            }
            case 'compress_remote':
              return Promise.resolve(`${String(args.dir)}/${String(args.name)}.tar.gz`);
            case 'plugin:event|listen': {
              const { event, handler } = args as { event: string; handler: number };
              (listeners[event] ||= []).push(handler);
              return Promise.resolve(cbid);
            }
            default:
              return Promise.resolve(null);
          }
        },
        transformCallback: (cb: unknown) => {
          const id = ++cbid;
          win[`__cb${id}`] = cb;
          return id;
        },
        unregisterCallback: (id: number) => {
          delete win[`__cb${id}`];
        }
      };
    },
    { hosts: HOSTS, files: FILES, parked: options.parked ?? null }
  );

  await page.goto(options.path ?? '/');
  if (options.path) return;
  await expect(page.getByText('2 台主机')).toBeVisible();
}

/** Opens web-1's terminal from the dashboard and waits for the workspace to settle. */
async function openWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: '连接 web-1' }).click();
  await expect(page.getByRole('tab', { name: /终端 1/ })).toBeVisible();
  await expect(page.getByRole('region', { name: '远程文件' })).toBeVisible();
}

test('opens one host workspace with files, terminal tabs and the live monitor', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);

  // Three panes of the same host, in one row.
  const files = page.getByRole('region', { name: '远程文件' });
  const monitor = page.getByRole('region', { name: '主机监控' });
  await expect(files).toBeVisible();
  await expect(monitor).toBeVisible();
  await expect(page.getByRole('tablist', { name: '终端标签' })).toBeVisible();
  await expect(page.locator('.xterm-rows').first()).toContainText('omnyssh-ready>');

  // The listing lands in the files pane: hidden entries are filtered, symlinks marked.
  await expect(files.getByText('etc')).toBeVisible();
  await expect(files.getByText('notes.txt')).toBeVisible();
  await expect(files.getByText('link-to-logs')).toBeVisible();
  await expect(files.getByText('.hidden')).toHaveCount(0);
  await expect(files.getByLabel('符号链接')).toHaveCount(1);

  // ...and the monitor shows the sample the poller delivered.
  await expect(monitor.getByText('32%')).toBeVisible();
  await expect(monitor.getByText('Linux 6.8 web-1')).toBeVisible();
  await expect(monitor.getByText('sshd')).toBeVisible();

  // The richer cards: memory split, network rates and the per-mount disk table.
  await expect(monitor.getByText('缓存')).toBeVisible();
  await expect(monitor.getByText('下行')).toBeVisible();
  await expect(monitor.getByText('/srv')).toBeVisible();
  await expect(monitor.getByText('读 1 MB/s · 写 512 KB/s')).toBeVisible();

  // Runtime state, latency and the broader system card.
  await expect(monitor.getByText('运行状态')).toBeVisible();
  await expect(monitor.getByText('12 ms')).toBeVisible();
  await expect(monitor.getByText('18 ms')).toBeVisible();
  await expect(monitor.getByText('最近采样')).toBeVisible();
  await expect(monitor.getByText('个挂载')).toBeVisible();

  // The full process table, with PIDs and a CPU sort.
  await expect(monitor.getByText('101')).toBeVisible();
  await expect(monitor.getByRole('button', { name: 'CPU' })).toBeVisible();
  await expect(monitor.getByRole('button', { name: 'PID' })).toBeVisible();
  // A detached monitor window can be requested from the header.
  await expect(monitor.getByRole('button', { name: '在独立窗口打开监控' })).toBeVisible();

  // A second terminal becomes a second tab of the same workspace.
  await page.getByRole('button', { name: '新建终端' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
});

test('navigates the remote tree and reveals hidden files', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);
  const files = page.getByRole('region', { name: '远程文件' });

  await files.getByRole('button', { name: '显示隐藏文件' }).click();
  await expect(files.getByText('.hidden')).toBeVisible();

  await files.getByText('etc').click();
  await expect(files.getByText('hosts')).toBeVisible();
  // A tree, not a pane: the root stays in place while the folder expands...
  await expect(files.getByText('notes.txt')).toBeVisible();
  await expect(files.getByRole('button', { name: '收起 etc' })).toBeVisible();
  // ...and folds away again.
  await files.getByRole('button', { name: '收起 etc' }).click();
  await expect(files.getByText('hosts')).toHaveCount(0);
});

test('collapses each side pane and restores it', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);

  await page.getByRole('button', { name: '隐藏文件面板' }).click();
  await expect(page.getByRole('region', { name: '远程文件' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '主机监控' })).toBeVisible();

  await page.getByRole('button', { name: '显示文件面板' }).click();
  await expect(page.getByRole('region', { name: '远程文件' })).toBeVisible();

  await page.getByRole('button', { name: '折叠监控面板' }).click();
  await expect(page.getByRole('region', { name: '主机监控' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '远程文件' })).toBeVisible();
});

test('drags the splitter and keeps the width across a reload', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);
  const files = page.getByRole('region', { name: '远程文件' });
  const before = (await files.boundingBox())?.width ?? 0;

  const gutter = page.getByRole('separator', { name: '调整远程文件面板宽度' });
  const box = await gutter.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();

  const after = (await files.boundingBox())?.width ?? 0;
  expect(after).toBeGreaterThan(before + 40);

  const saved = await page.evaluate(() => localStorage.getItem('omnyssh-workspace-layouts'));
  expect(saved).toContain('web-1');

  await page.reload();
  await expect(page.getByText('2 台主机')).toBeVisible();
  await page.getByRole('button', { name: '连接 web-1' }).click();
  await expect(page.getByRole('region', { name: '远程文件' })).toBeVisible();
  const restored = (await files.boundingBox())?.width ?? 0;
  expect(Math.abs(restored - after)).toBeLessThanOrEqual(2);
});

test('maximizes the terminal over both side panes', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);

  await page.getByRole('button', { name: '最大化终端' }).click();
  await expect(page.getByRole('region', { name: '远程文件' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '主机监控' })).toHaveCount(0);
  await expect(page.getByRole('tab')).toBeVisible();

  await page.getByRole('button', { name: '还原终端' }).click();
  await expect(page.getByRole('region', { name: '远程文件' })).toBeVisible();
});

test('a TCP-only host states that it has no metrics instead of inventing them', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '连接 db-1' }).click();
  await expect(page.getByRole('region', { name: '主机监控' })).toContainText('仅端口探测');
});


test('reconnects a terminal whose remote shell has exited', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);

  await page.evaluate(() => {
    const w = window as unknown as { __fireTerminalExited: (id: number, had: boolean) => void; __lastTerminal: number };
    w.__fireTerminalExited(w.__lastTerminal, true);
  });

  // The dead tab stays readable and offers a fresh connection instead.
  const reconnect = page.getByRole('button', { name: '重连 web-1' });
  await expect(reconnect).toBeVisible();
  await reconnect.click();

  // One tab again: the new session replaced the one whose shell was gone.
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(reconnect).toHaveCount(0);
  await expect(page.locator('.xterm-rows').first()).toContainText('omnyssh-ready>');
});
test('restores parked tabs on the next start and connects only the one opened', async ({ page }) => {
  await boot(page, { parked: { 'web-1': 2 } });

  // Both tabs are back at once under ONE top-bar host entry, and neither has dialled.
  const tabs = page.getByRole('button', { name: 'web-1 · 终端' });
  await expect(tabs).toHaveCount(1);
  const opens = () =>
    page.evaluate(() => (window as unknown as { __terminalOpens?: number }).__terminalOpens ?? 0);
  expect(await opens()).toBe(0);

  // Opening one wakes exactly that tab; its sibling stays parked.
  await tabs.first().click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.xterm-rows').first()).toContainText('omnyssh-ready>');
  expect(await opens()).toBe(1);
});

type ArchiveCall = { side: string; action: string; dir?: string; name?: string; archive?: string; dest?: string; path?: string };
type TransferCall = { cmd: string; sessionId: number; local: string; remote: string };
const archiveCalls = (page: Page): Promise<ArchiveCall[]> =>
  page.evaluate(() => (window as unknown as { __archiveCalls?: ArchiveCall[] }).__archiveCalls ?? []);
const transferCalls = (page: Page): Promise<TransferCall[]> =>
  page.evaluate(() => (window as unknown as { __transfers?: TransferCall[] }).__transfers ?? []);
const pick = (page: Page, value: string): Promise<void> =>
  page.evaluate((v) => {
    (window as unknown as { __dialogPick: string }).__dialogPick = v;
  }, value);

test('a folder download packs, transfers one archive and unpacks, seamlessly', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);
  await pick(page, 'D:\\Downloads');
  await page.getByRole('button', { name: 'etc', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: '下载…' }).click();

  // One strip named after the folder, through pack and unpack alike.
  const strip = page.getByRole('status', { name: '传输进度' });
  await expect(strip).toContainText('etc');
  await expect(strip).toContainText('准备中…');
  await expect(strip).toHaveCount(0);

  expect((await archiveCalls(page)).map((c) => `${c.side}:${c.action}`)).toEqual([
    'remote:pack',
    'local:unpack',
    'remote:remove'
  ]);
  const calls = await archiveCalls(page);
  expect(calls[0]).toMatchObject({ dir: '/', name: 'etc' });
  expect(calls[1].dest).toBe('D:\\Downloads');
  const transfers = await transferCalls(page);
  expect(transfers).toHaveLength(1);
  expect(transfers[0].cmd).toBe('sftp_download');
  expect(transfers[0].remote).toBe('/tmp/omnyssh-TEST1234');
  expect(transfers[0].local).toContain('omnyssh-TEST1234');
});

test('a folder upload packs locally and unpacks on the host', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);
  await pick(page, 'D:\\Photos');
  await page.getByRole('button', { name: 'home', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: '上传文件夹到此…' }).click();

  const strip = page.getByRole('status', { name: '传输进度' });
  await expect(strip).toContainText('Photos');
  await expect(strip).toHaveCount(0);

  expect((await archiveCalls(page)).map((c) => `${c.side}:${c.action}`)).toEqual([
    'local:pack',
    'remote:temp',
    'remote:unpack',
    'local:remove'
  ]);
  const calls = await archiveCalls(page);
  expect(calls[0].path).toBe('D:\\Photos');
  expect(calls[2]).toMatchObject({ archive: '/tmp/omnyssh-TEST1234', dest: '/home' });
  const transfers = await transferCalls(page);
  expect(transfers).toHaveLength(1);
  expect(transfers[0].cmd).toBe('sftp_upload');
  expect(transfers[0].local).toBe('C:\\Temp\\omnyssh-TEST9999.tar.gz');
  expect(transfers[0].remote).toBe('/tmp/omnyssh-TEST1234');
});

test('a failed folder transfer says why and still cleans both archives', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);
  await pick(page, 'D:\\Downloads');
  await page.evaluate(() => {
    (window as unknown as { __transferOk: boolean }).__transferOk = false;
  });
  await page.getByRole('button', { name: 'etc', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: '下载…' }).click();

  await expect(page.getByRole('status', { name: '传输进度' })).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('disk full');
  expect((await archiveCalls(page)).map((c) => `${c.side}:${c.action}`)).toEqual([
    'remote:pack',
    'remote:remove',
    'local:remove'
  ]);
});

test('a single file download still goes direct, without archives', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);
  await pick(page, 'D:\\Downloads');
  await page.getByRole('button', { name: 'notes.txt' }).click({ button: 'right' });
  await page.getByRole('button', { name: '下载…' }).click();

  // No preparing phase here: wait for the dispatch itself before reading the calls.
  await expect.poll(async () => (await transferCalls(page)).length).toBe(1);
  await expect(page.getByRole('status', { name: '传输进度' })).toHaveCount(0);
  const transfers = await transferCalls(page);
  expect(transfers).toHaveLength(1);
  expect(transfers[0].remote).toBe('/notes.txt');
  expect(transfers[0].local).toContain('notes.txt');
  expect(await archiveCalls(page)).toEqual([]);
});
test('a detached panel window renders that panel alone', async ({ page }) => {
  await boot(page, { path: '/?panel=monitor&host=web-1' });

  const monitor = page.getByRole('region', { name: '主机监控' });
  await expect(monitor).toBeVisible();
  await expect(monitor.getByText('32%')).toBeVisible();
  // No workspace chrome, and no "pop out" button inside a window that already is one.
  await expect(page.getByRole('navigation', { name: '工作区' })).toHaveCount(0);
  await expect(monitor.getByRole('button', { name: '在独立窗口打开监控' })).toHaveCount(0);
});

test('opens a remote file in the editor and saves the change', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);

  await page.getByRole('button', { name: 'notes.txt' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑远程文件' });
  await expect(dialog).toBeVisible();
  const area = dialog.getByLabel('文件内容');
  await expect(area).toHaveValue('server_name web-1;\n');

  await area.fill('server_name web-2;\n');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const written = await page.evaluate(
    () => (window as unknown as { __written?: { path: string; content: string } }).__written
  );
  expect(written).toEqual({ path: '/notes.txt', content: 'server_name web-2;\n' });
});

test('monitor shows the host address with copy actions', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await openWorkspace(page);
  const monitor = page.getByRole('region', { name: '主机监控' });

  await expect(monitor.getByText('web-1.example.com:22').first()).toBeVisible();
  await monitor.getByRole('button', { name: '复制 web-1 的 IP' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('web-1.example.com:22');

  await monitor.getByRole('button', { name: '复制 web-1 的登录密码' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('secret-for-web-1');
});

test('creates a folder and a file from the file panel context menu', async ({ page }) => {
  await boot(page);
  await openWorkspace(page);
  const files = page.getByRole('region', { name: '远程文件' });

  // Right-click the listing's empty space: the directory actions.
  await files.locator('ul').first().click({ button: 'right' });
  await page.getByRole('button', { name: '新建文件夹…' }).click();
  const folderDialog = page.getByRole('dialog', { name: '新建文件夹' });
  await folderDialog.getByLabel('新建文件夹').fill('newdir');
  await folderDialog.getByRole('button', { name: '确定' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mkdirs?: string[] }).__mkdirs))
    .toContain('/newdir');

  await files.locator('ul').first().click({ button: 'right' });
  await page.getByRole('button', { name: '新建文件…' }).click();
  const fileDialog = page.getByRole('dialog', { name: '新建文件' });
  await fileDialog.getByLabel('新建文件').fill('notes2.txt');
  await fileDialog.getByRole('button', { name: '确定' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __written?: { path: string } }).__written?.path
      )
    )
    .toBe('/notes2.txt');
});
