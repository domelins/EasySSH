import { expect, test, type Page } from '@playwright/test';

const BASE = {
  user: 'admin',
  port: 22,
  tags: [],
  source: 'manual',
  hasKey: true,
  monitoring: 'ssh',
  localForwards: [],
  tunnelAutostart: false,
  forwardAgent: false
};
const HOSTS = [
  {
    ...BASE,
    name: 'nas',
    hostname: '10.0.0.5',
    localForwards: [
      { bindPort: 9443, remoteHost: '127.0.0.1', remotePort: 9443 },
      { bindPort: 5432, remoteHost: 'db.internal', remotePort: 5432 }
    ]
  },
  { ...BASE, name: 'web-1', hostname: 'web-1.example.com' }
];

type Call = { cmd: string; args: Record<string, unknown> };

async function boot(page: Page, options: { rejectStart?: string } = {}): Promise<void> {
  await page.addInitScript(
    ({ hosts, rejectStart }) => {
      let cbid = 0;
      const listeners: Record<string, number[]> = {};
      const state = { hosts: hosts.map((host) => ({ ...host })) as Array<Record<string, unknown>> };
      const win = window as unknown as Record<string, unknown>;
      const calls: Call[] = [];
      win.__calls = calls;

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((event: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }
      win.__fire = fire;
      const tunnel = (hostName: string, ...statuses: unknown[]) =>
        statuses.forEach((status, index) => setTimeout(() => fire('tunnel-status-changed', { hostName, status }), 10 * (index + 1)));

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          calls.push({ cmd, args });
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve([...state.hosts]);
            case 'reload_hosts':
              setTimeout(() => fire('hosts-loaded', [...state.hosts]), 0);
              return Promise.resolve(null);
            case 'save_host': {
              const input = args.input as Record<string, unknown> & { name: string };
              const index = state.hosts.findIndex((host) => host.name === input.name);
              state.hosts[index] = {
                ...state.hosts[index],
                hostname: input.hostname,
                localForwards: input.localForwards,
                tunnelAutostart: input.tunnelAutostart,
                forwardAgent: input.forwardAgent
              };
              return Promise.resolve(null);
            }
            case 'tunnel_start':
              if (rejectStart) return Promise.reject({ message: rejectStart });
              tunnel(args.hostName as string, { kind: 'connecting' }, { kind: 'up' });
              return Promise.resolve(null);
            case 'tunnel_stop':
              tunnel(args.hostName as string, { kind: 'stopped' });
              return Promise.resolve(null);
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
        }
      };
    },
    { hosts: HOSTS, rejectStart: options.rejectStart }
  );
  await page.goto('/');
  await expect(page.getByText('nas', { exact: true }).first()).toBeVisible();
}

const calls = (page: Page): Promise<Call[]> => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls);

test('starts and stops a tunnel from the row actions', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'nas 的更多操作' }).click();
  await expect(page.getByText('localhost:9443')).toBeVisible();
  await expect(page.getByText('db.internal:5432')).toBeVisible();
  await expect(page.getByRole('button', { name: /到 web-1 的隧道/ })).toHaveCount(0);
  const toggle = page.getByRole('button', { name: '启动到 nas 的隧道' });
  await toggle.click();
  await expect(page.getByText('运行中', { exact: true })).toBeVisible();
  expect((await calls(page)).filter((call) => call.cmd === 'tunnel_start')).toEqual([
    { cmd: 'tunnel_start', args: { hostName: 'nas' } }
  ]);
  await page.evaluate(() =>
    (window as unknown as { __fire: (event: string, payload: unknown) => void }).__fire('tunnel-status-changed', {
      hostName: 'nas',
      status: { kind: 'retrying', message: 'connection lost' }
    })
  );
  await expect(page.getByText('重连中…')).toBeVisible();
  await expect(page.getByText('connection lost')).toBeVisible();
  await page.getByRole('button', { name: '停止到 nas 的隧道' }).click();
  await expect(page.getByText('未启动', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '启动到 nas 的隧道' })).toBeVisible();
});

test('a start the backend refuses surfaces its reason', async ({ page }) => {
  await boot(page, { rejectStart: "'nas' has no port forwards" });
  await page.getByRole('button', { name: 'nas 的更多操作' }).click();
  await page.getByRole('button', { name: '启动到 nas 的隧道' }).click();
  await expect(page.getByText("'nas' has no port forwards")).toBeVisible();
});

test('adds a forward in the editor and the row picks it up', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '编辑 web-1' }).click();
  const editor = page.getByRole('dialog', { name: '编辑主机' });
  await editor.getByRole('button', { name: '添加转发' }).click();
  await editor.getByLabel('转发 1 的本地端口').fill('8080');
  await editor.getByLabel('转发 1 的远程主机').fill('127.0.0.1');
  await editor.getByLabel('转发 1 的远程端口').fill('80');
  await editor.getByRole('switch', { name: 'EasySSH 打开时自动启动隧道' }).click();
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = (await calls(page)).find((call) => call.cmd === 'save_host')?.args.input as Record<string, unknown>;
  expect(saved.localForwards).toEqual([{ bindPort: 8080, remoteHost: '127.0.0.1', remotePort: 80 }]);
  expect(saved.tunnelAutostart).toBe(true);
  await page.getByRole('button', { name: 'web-1 的更多操作' }).click();
  await expect(page.getByText('localhost:8080')).toBeVisible();
  await expect(page.getByRole('button', { name: '启动到 web-1 的隧道' })).toBeVisible();
});

test('a half-filled forward keeps the editor open with the reason', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '编辑 web-1' }).click();
  const editor = page.getByRole('dialog', { name: '编辑主机' });
  await editor.getByRole('button', { name: '添加转发' }).click();
  await editor.getByLabel('转发 1 的本地端口').fill('8080');
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(editor.getByText('转发 1：远程端口必须是 1 到 65535 之间的数字')).toBeVisible();
  expect((await calls(page)).some((call) => call.cmd === 'save_host')).toBe(false);
});
