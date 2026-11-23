import { expect, test, type Page } from '@playwright/test';

const HOSTS = [
  { name: 'web-1', hostname: 'web-1.example.com', user: 'deploy', port: 22, tags: ['prod'], source: 'manual', hasKey: true, hasPassword: true, monitoring: 'ssh', localForwards: [], tunnelAutostart: false, forwardAgent: false },
  { name: 'imported', hostname: 'imported.example.com', user: 'root', port: 22, tags: [], source: 'sshConfig', hasKey: false, hasPassword: false, monitoring: 'ssh', localForwards: [], tunnelAutostart: false, forwardAgent: false },
  { name: 'api-1', hostname: 'api-1.example.com', user: 'deploy', port: 22, tags: ['prod', 'api'], source: 'manual', hasKey: true, hasPassword: false, monitoring: 'ssh', localForwards: [], tunnelAutostart: false, forwardAgent: false }
];

async function boot(
  page: Page,
  seed: Array<Record<string, unknown>> = HOSTS,
  cancelSave = false
): Promise<void> {
  await page.addInitScript(
    ({ hosts, cancelSave }) => {
      let cbid = 0;
      const listeners: Record<string, number[]> = {};
      const state: { hosts: Array<Record<string, unknown>> } = { hosts: hosts.map((host) => ({ ...host })) };
      const win = window as unknown as Record<string, unknown>;
      const calls: string[] = [];
      const callLog: Array<{ cmd: string; args: Record<string, unknown> }> = [];
      win.__hostCalls = calls;
      win.__hostCallLog = callLog;

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((event: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          calls.push(cmd);
          callLog.push({ cmd, args });
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve([...state.hosts]);
            case 'reload_hosts':
              setTimeout(() => fire('hosts-loaded', [...state.hosts]), 0);
              return Promise.resolve(null);
            case 'save_host': {
              const input = args.input as Record<string, unknown> & { name: string; identityFile?: string };
              const existing = state.hosts.find(
                (host) => (host as { name: string }).name === input.name
              ) as { hasPassword?: boolean } | undefined;
              const view = {
                name: input.name,
                hostname: input.hostname,
                user: input.user,
                port: input.port,
                tags: (input.tags as string[]) ?? [],
                notes: input.notes,
                source: 'manual',
                hasKey: !!input.identityFile,
                // Editing without typing a password keeps the stored one.
                hasPassword: !!input.password || !!existing?.hasPassword,
                monitoring: input.monitoring ?? 'ssh',
                localForwards: input.localForwards,
                tunnelAutostart: input.tunnelAutostart,
                forwardAgent: input.forwardAgent
              };
              const index = state.hosts.findIndex((host) => (host as { name: string }).name === view.name);
              if (index >= 0) state.hosts[index] = { ...state.hosts[index], ...view };
              else state.hosts.push(view);
              return Promise.resolve(null);
            }
            case 'host_password':
              return Promise.resolve(`secret-for-${String(args.name)}`);
            case 'export_hosts':
              return Promise.resolve(
                (args.path as string) ?? 'C:/Users/test/Downloads/easyssh-hosts.toml'
              );
            case 'export_ssh_config':
              return Promise.resolve(
                (args.path as string) ?? 'C:/Users/test/Downloads/easyssh-ssh-config.conf'
              );
            case 'plugin:dialog|save': {
              const options = (args.options ?? args) as { defaultPath?: string };
              return Promise.resolve(cancelSave ? null : `D:/Backups/${String(options.defaultPath)}`);
            }
            case 'import_hosts': {
              const text = String(args.content);
              const name =
                /name\s*=\s*"([^"]+)"/.exec(text)?.[1] ??
                /^Host\s+(\S+)/m.exec(text)?.[1];
              if (!name) return Promise.reject({ message: '无法识别主机文件（TOML 或 SSH config）' });
              if (state.hosts.some((host) => host.name === name)) {
                return Promise.resolve({ added: 0, skipped: 1, failed: 0, errors: [] });
              }
              state.hosts.push({
                name,
                hostname: 'imported.example.com',
                user: 'root',
                port: 22,
                tags: [],
                source: 'manual',
                hasKey: false,
                hasPassword: false,
                monitoring: 'ssh',
                localForwards: [],
                tunnelAutostart: false,
                forwardAgent: false
              });
              return Promise.resolve({ added: 1, skipped: 0, failed: 0, errors: [] });
            }
            case 'host_latency_probe':
              return Promise.resolve(null);
            case 'refresh_metrics':
              setTimeout(() => fire('host-latency', { hostName: 'web-1', tcpMs: 12, pingMs: 18 }), 0);
              setTimeout(
                () =>
                  fire('metrics-updated', {
                    hostName: 'web-1',
                    metrics: {
                      cpuPercent: 32,
                      ramPercent: 41,
                      diskPercent: 55,
                      topProcesses: [],
                      processes: [],
                      disks: [],
                      cpuHistory: [12, 32],
                      network: {
                        rxBytesTotal: 1_048_576_000,
                        txBytesTotal: 52_428_800,
                        rxBytesPerSec: 1_572_864,
                        txBytesPerSec: 524_288
                      },
                      ageSeconds: 1
                    }
                  }),
                0
              );
              return Promise.resolve(null);
            case 'delete_host':
              state.hosts = state.hosts.filter((host) => (host as { name: string }).name !== args.name);
              return Promise.resolve(null);
            case 'delete_hosts': {
              // Like the backend, only hosts.toml entries (manual hosts) can go.
              const names = args.names as string[];
              const removable = state.hosts.filter(
                (host) => host.source === 'manual' && names.includes(host.name as string)
              );
              state.hosts = state.hosts.filter((host) => !removable.includes(host));
              return Promise.resolve(removable.length);
            }
            case 'list_snippets':
              return Promise.resolve([]);
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
    { hosts: seed, cancelSave }
  );
  await page.goto('/');
  await expect(hostRow(page, String(seed[0].name)).first()).toBeVisible();
}

function hostRow(page: Page, name: string) {
  return page.locator('[data-card]').filter({ has: page.getByRole('button', { name, exact: true }) });
}

async function openMore(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `${name} 的更多操作`, exact: true }).click();
}

test('adds a host and it appears as a table row and in the tree', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '添加主机', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '添加主机' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('名称', { exact: true }).fill('db-1');
  await editor.getByLabel('主机名 / IP').fill('db-1.example.com');
  await editor.getByLabel('用户名').fill('postgres');
  await editor.getByRole('button', { name: '添加主机' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hostRow(page, 'db-1')).toBeVisible();
  await expect(page.getByRole('complementary').getByText('db-1', { exact: true })).toBeVisible();
  await expect(page.getByText('postgres@db-1.example.com:22')).toBeVisible();
});

test('edits a manual host in place', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '编辑 web-1' }).click();
  const editor = page.getByRole('dialog', { name: '编辑主机' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel(/^名称/)).toHaveAttribute('readonly', '');
  await editor.getByLabel('主机名 / IP').fill('web-1b.example.com');
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('deploy@web-1b.example.com:22')).toBeVisible();
});

test.describe('on Linux', () => {
  test.use({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)' });

  test('agent forwarding is off until switched on, and stays on', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: '编辑 web-1' }).click();
    let editor = page.getByRole('dialog', { name: '编辑主机' });
    const agent = editor.getByRole('switch', { name: 'SSH 代理转发' });
    await expect(agent).toHaveAttribute('aria-checked', 'false');
    await agent.click();
    await editor.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '编辑 web-1' }).click();
    editor = page.getByRole('dialog', { name: '编辑主机' });
    await expect(editor.getByRole('switch', { name: 'SSH 代理转发' })).toHaveAttribute('aria-checked', 'true');
  });
});

test('agent forwarding says it is not on Windows yet', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '编辑 web-1' }).click();
  const editor = page.getByRole('dialog', { name: '编辑主机' });
  await expect(editor.getByRole('switch', { name: 'SSH 代理转发' })).toBeDisabled();
  await expect(editor.getByText('Windows 上暂不可用。')).toBeVisible();
});

test('deletes a manual host after confirmation', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '删除主机 web-1' }).click();
  const confirm = page.getByRole('dialog', { name: '删除主机' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '删除', exact: true }).click();
  await expect(hostRow(page, 'web-1')).toHaveCount(0);
  await expect(page.getByRole('complementary').getByText('web-1', { exact: true })).toHaveCount(0);
});

test('an SSH-config host is adopted by editing it', async ({ page }) => {
  await boot(page);
  await expect(page.getByText('ssh config')).toBeVisible();
  // An import has no local file entry to delete: the row offers no trash button.
  await expect(page.getByRole('button', { name: '删除主机 imported' })).toHaveCount(0);
  await page.getByRole('button', { name: '编辑 imported' }).click();
  const editor = page.getByRole('dialog', { name: '编辑主机' });
  await expect(editor.getByText(/不会被写入/)).toBeVisible();
  await editor.getByLabel('主机名 / IP').fill('adopted.example.com');
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('root@adopted.example.com:22')).toBeVisible();
  await expect(page.getByText('ssh config')).toHaveCount(0);
  // Adopted: the entry is now manual, so the row can delete it.
  await expect(page.getByRole('button', { name: '删除主机 imported' })).toHaveCount(1);
});

test('the tree always shows group membership; View options groups the table', async ({ page }) => {
  await boot(page);
  // The tree groups hosts by tag on its own, before any toggle.
  const prod = page.getByRole('region', { name: 'prod 的主机' });
  const api = page.getByRole('region', { name: 'api 的主机' });
  await expect(prod.getByText('web-1', { exact: true })).toBeVisible();
  await expect(api.getByText('api-1', { exact: true })).toBeVisible();

  const trigger = page.getByRole('button', { name: '视图选项' });
  const dot = trigger.locator('span.bg-accent');
  await expect(dot).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: '视图选项' });
  expect(await panel.evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(/^rgb\(/);
  const grouping = panel.getByRole('switch', { name: '按标签分组' });
  await expect(grouping).toBeFocused();
  await page.keyboard.press('Space');
  await expect(grouping).toHaveAttribute('aria-checked', 'true');
  await expect(dot).toHaveCount(1);
  await expect(prod.getByText('api-1', { exact: true })).toBeVisible();
  await expect(api.getByText('api-1', { exact: true })).toBeVisible();
  await expect(hostRow(page, 'api-1')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: '刷新监控指标' }).click();
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('g');
  await expect(dot).toHaveCount(0);
  // The table ungroups; the tree keeps showing which group a host belongs to.
  await expect(prod).toBeVisible();
  await expect(hostRow(page, 'api-1')).toHaveCount(1);
});

test('creates, renames and deletes groups while preserving hosts and empty groups', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '管理主机分组' }).click();
  let manager = page.getByRole('dialog', { name: '主机分组' });
  await expect(manager).toBeVisible();

  await manager.getByRole('textbox', { name: '新分组名称' }).fill('empty');
  await manager.getByRole('button', { name: '创建分组' }).click();
  await manager.getByRole('textbox', { name: '新分组名称' }).fill('production');
  await manager.getByRole('button', { name: '创建分组' }).click();
  await manager.getByRole('checkbox', { name: 'web-1 属于 production' }).check();
  await manager.getByRole('button', { name: '保存分组' }).click();
  await expect(manager).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'empty 的主机' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'production 的主机' }).getByText('web-1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '管理主机分组' }).click();
  await manager.getByRole('button', { name: '重命名分组 production' }).click();
  await manager.getByRole('textbox', { name: '分组名称', exact: true }).fill('核心');
  await manager.getByRole('button', { name: '保存名称' }).click();
  await manager.getByRole('button', { name: '保存分组' }).click();
  await expect(manager).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'production 的主机' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '核心 的主机' }).getByText('web-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'prod 的主机' }).getByText('web-1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '管理主机分组' }).click();
  await manager.getByRole('button', { name: '删除分组 核心' }).click();
  await manager.getByRole('button', { name: '保存分组' }).click();
  await expect(manager).toHaveCount(0);
  await expect(page.getByRole('region', { name: '核心 的主机' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'prod 的主机' }).getByText('web-1', { exact: true })).toBeVisible();
  await expect(hostRow(page, 'web-1')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'empty 的主机' })).toBeVisible();
  await expect(page.getByRole('region', { name: '核心 的主机' })).toHaveCount(0);
});

test('folded tree sections stay folded across navigation and reload, but search unfolds them', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('g');
  const prod = page.getByRole('region', { name: 'prod 的主机' });
  await page.getByRole('button', { name: '折叠 prod' }).click();
  await expect(page.getByRole('button', { name: '展开 prod' })).toHaveAttribute('aria-expanded', 'false');
  await expect(prod.getByText('web-1', { exact: true })).toBeHidden();
  await expect(hostRow(page, 'imported')).toBeVisible();
  await page.getByRole('button', { name: '命令片段', exact: true }).click();
  await expect(page.getByRole('heading', { name: '命令片段' })).toBeVisible();
  await page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name: 'SSH', exact: true }).click();
  await expect(page.getByRole('button', { name: '展开 prod' })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByRole('button', { name: '展开 prod' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '搜索主机' }).click();
  const search = page.getByRole('textbox', { name: '搜索主机' });
  await search.fill('web');
  await expect(prod.getByText('web-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '展开 prod' })).toBeDisabled();
  await search.press('Escape');
  await expect(prod.getByText('web-1', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: '展开 prod' }).click();
  await expect(page.getByRole('button', { name: '折叠 prod' })).toHaveAttribute('aria-expanded', 'true');
  await expect(prod.getByText('web-1', { exact: true })).toBeVisible();
});

test('a host with a repeated tag renders once in that tree group', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await boot(page);
  await page.getByRole('button', { name: '编辑 web-1' }).click();
  const editor = page.getByRole('dialog', { name: '编辑主机' });
  await editor.getByLabel('标签 / 新分组').fill('prod, prod');
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('g');
  const prod = page.getByRole('region', { name: 'prod 的主机' });
  await expect(prod.getByText('web-1', { exact: true })).toHaveCount(1);
  await expect(prod.getByText('api-1', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('g is ignored under a modal and while typing', async ({ page }) => {
  await boot(page);
  // `g` toggles the table's grouping; its indicator is the View options dot.
  const dot = page.getByRole('button', { name: '视图选项' }).locator('span.bg-accent');
  await expect(dot).toHaveCount(0);
  await page.getByRole('button', { name: '支持 EasySSH' }).click();
  await expect(page.getByRole('dialog', { name: '支持 EasySSH' })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: '命令面板' });
  await palette.getByText('esc 关闭').click();
  await page.keyboard.press('g');
  await expect(dot).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await page.getByRole('button', { name: '搜索主机' }).click();
  await page.getByRole('textbox', { name: '搜索主机' }).press('g');
  await expect(page.getByRole('textbox', { name: '搜索主机' })).toHaveValue('g');
  await expect(dot).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索主机' }).press('Escape');
  await page.keyboard.press('g');
  await expect(dot).toHaveCount(1);
});

async function cardOrder(page: Page): Promise<string[]> {
  const grips = page.getByRole('button', { name: /^移动 / });
  return (await grips.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? ''))).map(
    (label) => label.slice('移动 '.length)
  );
}

async function dragOnto(page: Page, host: string, onto: string): Promise<void> {
  await hostRow(page, host).hover();
  const grip = await page.getByRole('button', { name: `移动 ${host}` }).boundingBox();
  const target = await hostRow(page, onto).boundingBox();
  if (!grip || !target) throw new Error('row not on screen');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + 2, { steps: 12 });
  await page.mouse.up();
}

test('View options sorts columns with arrow keys and persists the choice', async ({ page }) => {
  await boot(page);
  await expect.poll(() => cardOrder(page)).toEqual(['web-1', 'imported', 'api-1']);
  await page.getByRole('button', { name: '视图选项' }).click();
  const sort = page.getByRole('radiogroup', { name: '排序' });
  await expect(sort.getByRole('radio', { name: '自定义' })).toHaveAttribute('aria-checked', 'true');
  await sort.getByRole('radio', { name: '自定义' }).focus();
  await page.keyboard.press('ArrowRight');
  const byName = sort.getByRole('radio', { name: '名称' });
  await expect(byName).toHaveAttribute('aria-checked', 'true');
  await expect(byName).toBeFocused();
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'imported', 'web-1']);
  await page.keyboard.press('ArrowRight');
  await expect(sort.getByRole('radio', { name: '状态' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(sort.getByRole('radio', { name: '地址' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(sort.getByRole('radio', { name: '自定义' })).toHaveAttribute('aria-checked', 'true');
  await byName.click();
  await page.reload();
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'imported', 'web-1']);
});

test('dragging a row by its grip reorders the table and persists; cancellation saves nothing', async ({ page }) => {
  await boot(page);
  await dragOnto(page, 'api-1', 'web-1');
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'web-1', 'imported']);
  await expect(page.locator('[aria-live="polite"]', { hasText: 'api-1 已移动到第 1 位，共 3 台主机' })).toHaveCount(1);
  await page.reload();
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'web-1', 'imported']);
  const grip = await page.getByRole('button', { name: '移动 imported' }).boundingBox();
  if (!grip) throw new Error('grip not on screen');
  await page.mouse.move(grip.x + 5, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x - 300, grip.y + 5, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.mouse.move(grip.x + 5, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x + 5, 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'web-1', 'imported']);
});

test('a drag while sorted by name starts from the name order', async ({ page }) => {
  await boot(page);
  const options = page.getByRole('button', { name: '视图选项' });
  await options.click();
  await page.getByRole('radio', { name: '名称' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'imported', 'web-1']);
  const grip = await page.getByRole('button', { name: '移动 web-1' }).boundingBox();
  if (!grip) throw new Error('grip not on screen');
  await page.mouse.move(grip.x + 5, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x - 300, grip.y + 5, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await options.click();
  await expect(page.getByRole('radio', { name: '名称' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await dragOnto(page, 'web-1', 'imported');
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'web-1', 'imported']);
  await options.click();
  await expect(page.getByRole('radio', { name: '自定义' })).toHaveAttribute('aria-checked', 'true');
});

test('the grip moves a row with the keyboard without changing it when the tree regroups', async ({ page }) => {
  await boot(page);
  const grip = page.getByRole('button', { name: '移动 web-1' });
  await grip.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => cardOrder(page)).toEqual(['imported', 'web-1', 'api-1']);
  await expect(grip).toBeFocused();
  await expect(page.locator('[aria-live="polite"]')).toHaveText('web-1 已移动到第 2 位，共 3 台主机');
  await page.keyboard.press('End');
  await expect.poll(() => cardOrder(page)).toEqual(['imported', 'api-1', 'web-1']);
  await page.keyboard.press('Home');
  await expect.poll(() => cardOrder(page)).toEqual(['web-1', 'imported', 'api-1']);
  await expect(grip).toBeFocused();
  await page.keyboard.press('g');
  await expect.poll(() => cardOrder(page)).toEqual(['web-1', 'imported', 'api-1']);
  await expect(page.getByRole('button', { name: '移动 web-1' })).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(() => cardOrder(page)).toEqual(['imported', 'api-1', 'web-1']);
  await expect(page.locator('[aria-live="polite"]')).toHaveText('web-1 已移动到第 3 位，共 3 台主机');
});

test('holding a drag past the bottom edge scrolls and drops at the end', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 260 });
  await boot(page);
  await hostRow(page, 'web-1').hover();
  const grip = await page.getByRole('button', { name: '移动 web-1' }).boundingBox();
  if (!grip) throw new Error('grip not on screen');
  await page.mouse.move(grip.x + 5, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x + 5, 259, { steps: 10 });
  const marker = page.locator('.pointer-events-none.fixed.bg-accent');
  await expect(marker).toBeVisible();
  const scrolled = () =>
    page.evaluate(() => {
      let parent = document.querySelector('[data-cards]')?.parentElement;
      while (parent && !/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
      return parent?.scrollTop ?? 0;
    });
  await expect.poll(async () => {
    const before = await scrolled();
    await page.waitForTimeout(150);
    return before > 0 && (await scrolled()) === before;
  }).toBe(true);
  await page.mouse.up();
  await expect.poll(() => cardOrder(page)).toEqual(['imported', 'api-1', 'web-1']);
});

test('same-named hosts keep their places while a drag starts', async ({ page }) => {
  const twin = HOSTS[1];
  await boot(page, [
    { ...twin, name: 'dup', hostname: 'dup-a.example.com' },
    { ...twin, name: 'x', hostname: 'x.example.com' },
    { ...twin, name: 'dup', hostname: 'dup-b.example.com' }
  ]);
  const addresses = () => page.getByText(/^root@.*:22$/).evaluateAll((elements) => elements.map((element) => element.textContent?.trim()));
  const before = ['root@dup-a.example.com:22', 'root@x.example.com:22', 'root@dup-b.example.com:22'];
  await expect.poll(addresses).toEqual(before);
  await hostRow(page, 'x').hover();
  const grip = await page.getByRole('button', { name: '移动 x' }).boundingBox();
  if (!grip) throw new Error('grip not on screen');
  await page.mouse.move(grip.x + 5, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x + 15, grip.y + 5, { steps: 3 });
  await expect(page.locator('[data-card].z-20')).toHaveCount(1);
  expect(await addresses()).toEqual(before);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(addresses).toEqual(before);
});

test('moving one of several same-named hosts moves just that row', async ({ page }) => {
  const twin = HOSTS[1];
  await boot(page, [
    { ...twin, name: 'dup', hostname: 'dup-a.example.com', tags: ['web'] },
    { ...twin, name: 'x', hostname: 'x.example.com', tags: ['web'] },
    { ...twin, name: 'dup', hostname: 'dup-b.example.com', tags: ['web'] },
    { ...twin, name: 'y', hostname: 'y.example.com' },
    { ...twin, name: 'dup', hostname: 'dup-c.example.com' }
  ]);
  const addresses = () => page.getByText(/^root@.*:22$/).evaluateAll((elements) => elements.map((element) => element.textContent?.trim().replace(/^root@|\.example\.com:22$/g, '')));
  const card = (hostname: string) => page.locator('[data-card]', { hasText: hostname });
  await card('dup-b.example.com').hover();
  const grip = await card('dup-b.example.com').getByRole('button', { name: '移动 dup' }).boundingBox();
  const target = await card('dup-a.example.com').boundingBox();
  if (!grip || !target) throw new Error('row not on screen');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(addresses).toEqual(['dup-b', 'dup-a', 'x', 'y', 'dup-c']);
  await page.keyboard.press('g');
  await card('dup-c.example.com').getByRole('button', { name: '移动 dup' }).focus();
  await page.keyboard.press('Home');
  await expect.poll(addresses).toEqual(['dup-c', 'dup-b', 'dup-a', 'x', 'y']);
  await page.reload();
  await expect.poll(addresses).toEqual(['dup-c', 'dup-b', 'dup-a', 'x', 'y']);
});

test('rejects a new host whose name already exists', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '添加主机', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '添加主机' });
  await editor.getByLabel('名称', { exact: true }).fill('web-1');
  await editor.getByLabel('主机名 / IP').fill('dupe.example.com');
  await editor.getByRole('button', { name: '添加主机' }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByText('已存在名为“web-1”的主机')).toBeVisible();
});

test('favorites filter the table and persist across reload', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '收藏 web-1' }).click();
  await page.getByRole('button', { name: /^收藏 \d+$/ }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await expect(hostRow(page, 'api-1')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /^收藏 \d+$/ }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await page.getByRole('button', { name: '取消收藏 web-1' }).click();
  await expect(hostRow(page, 'web-1')).toHaveCount(0);
});

test('recent connections are recorded by real session launches', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '连接 web-1' }).click();
  await page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name: 'SSH', exact: true }).click();
  await page.getByRole('button', { name: '最近连接' }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await expect(hostRow(page, 'api-1')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '最近连接' }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
});

test('multi-select opens terminals for the selected hosts', async ({ page }) => {
  await boot(page);
  await page.getByRole('checkbox', { name: '选择 web-1' }).check();
  await page.getByRole('checkbox', { name: '选择 api-1' }).check();
  await page.getByRole('button', { name: '批量连接', exact: true }).click();
  await expect(page.getByRole('button', { name: 'web-1 · 终端', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'api-1 · 终端', exact: true })).toBeVisible();
});

test('tree selection filters one host and the address copy uses the real endpoint', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await page.getByRole('complementary').getByText('web-1', { exact: true }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await expect(hostRow(page, 'api-1')).toHaveCount(0);
  await hostRow(page, 'web-1').hover();
  await page.getByRole('button', { name: '复制 web-1 的 IP' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('web-1.example.com:22');
});

test('picks an existing group while adding a host', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '添加主机', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '添加主机' });
  await editor.getByLabel('名称', { exact: true }).fill('grouped');
  await editor.getByLabel('主机名 / IP').fill('grouped.example.com');
  await editor.getByLabel('用户名').fill('root');

  // The chip is there because web-1/api-1 already carry that group.
  const chip = editor.getByRole('checkbox', { name: '分组 api' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-checked', 'true');
  await editor.getByRole('button', { name: '添加主机' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The membership survived the save: the edit form shows the chip checked.
  await page.getByRole('button', { name: '编辑 grouped' }).click();
  const edit = page.getByRole('dialog', { name: '编辑主机' });
  await expect(edit.getByRole('checkbox', { name: '分组 api' })).toHaveAttribute('aria-checked', 'true');
});

test('copies the stored password from the row', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await page.getByRole('button', { name: '复制 web-1 的密码' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('secret-for-web-1');
});

for (const theme of ['dark', 'light']) {
  test(`host table fits 1100px with the expanded sidebar and hover leaves actions painted in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.addInitScript((value) => {
      localStorage.setItem('easyssh-theme', value);
      localStorage.setItem('easyssh-sidebar-collapsed', 'false');
    }, theme);
    await boot(page, [...HOSTS, ...Array.from({ length: 24 }, (_, i) => ({
      ...HOSTS[0], name: `long-host-name-${i}`, hostname: `long-host-address-${i}.example.com`
    }))]);
    await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '刷新监控指标' }).click();
    const table = page.getByRole('table');
    const scroller = table.locator('..');
    // Also exercise the width lost to a vertical scrollbar, not just a three-row table.
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBe(0);
    const sidebar = await page.getByRole('complementary', { name: '主机浏览' }).boundingBox();
    expect(sidebar!.width).toBe(240);
    for (const header of await table.getByRole('columnheader').all()) {
      await expect(header).toBeInViewport({ ratio: 1 });
    }

    const row = hostRow(page, 'web-1');
    const metrics = row.locator('td').nth(8);
    const actions = row.locator('td').last();
    for (const text of ['CPU', 'RAM', 'Disk', '32%', '41%', '55%', '↓ 1.5 MB/s · ↑ 512 KB/s']) {
      await expect(metrics.getByText(text, { exact: true })).toBeInViewport({ ratio: 1 });
    }
    expect(await metrics.locator('p[title="实时网速"]').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await metrics.locator('.grid span').evaluateAll((spans) => spans.every((span) => {
      const box = span.getBoundingClientRect();
      const parent = span.parentElement!.getBoundingClientRect();
      return box.left >= parent.left - 1 && box.right <= parent.right + 1;
    }))).toBe(true);
    const metricBox = (await metrics.boundingBox())!;
    const actionBox = (await actions.boundingBox())!;
    expect(metricBox.x + metricBox.width).toBeLessThanOrEqual(actionBox.x + 1);
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(1100);

    await row.hover();
    const connect = row.getByRole('button', { name: '连接 web-1', exact: true });
    await expect(connect).toHaveText('连接');
    await expect(connect).toBeVisible();
    for (const button of await actions.getByRole('button').all()) {
      await expect(button).toBeInViewport({ ratio: 1 });
    }
    await expect(row.getByRole('button', { name: 'web-1 的文件面板' }).locator('svg')).toBeVisible();
    // Visibility/hit-testing alone misses an opaque, pointer-events:none pseudo-layer.
    expect(await actions.evaluate((el) => ['none', 'normal'].includes(getComputedStyle(el, '::after').content))).toBe(true);
    expect(await connect.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.visibility === 'visible' && Number(style.opacity) > 0 && style.color !== style.backgroundColor;
    })).toBe(true);
    await openMore(page, 'web-1');
    await expect(row.getByRole('button', { name: '复制 web-1', exact: true })).toBeVisible();
    expect(await actions.evaluate((el) => getComputedStyle(el).zIndex)).toBe('30');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 880, height: 720 });
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });
}

test('shows the live network rate on the host row', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '刷新监控指标' }).click();
  await expect(hostRow(page, 'web-1').getByText('↓ 1.5 MB/s · ↑ 512 KB/s')).toBeVisible();
});

test('renames and deletes a group from the host tree', async ({ page }) => {
  await boot(page);
  // Groups live in the tree's grouped view; turn it on first.
  await page.getByRole('button', { name: '视图选项' }).click();
  await page
    .getByRole('dialog', { name: '视图选项' })
    .getByRole('switch', { name: '按标签分组' })
    .click();
  await page.keyboard.press('Escape');
  const prod = page.getByRole('region', { name: 'prod 的主机' });
  await expect(prod).toBeVisible();
  await prod.hover();
  await page.getByRole('button', { name: '重命名分组 prod' }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('production');
  await page.getByRole('button', { name: '保存分组名称' }).click();
  await expect(page.getByRole('region', { name: 'production 的主机' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'prod 的主机' })).toHaveCount(0);
  // The hosts kept the renamed tag and both remain listed.
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await expect(hostRow(page, 'api-1')).toBeVisible();

  await page.getByRole('region', { name: 'api 的主机' }).hover();
  await page.getByRole('button', { name: '删除分组 api' }).click();
  await page.getByRole('button', { name: '确认删除分组 api' }).click();
  await expect(page.getByRole('region', { name: 'api 的主机' })).toHaveCount(0);
  // Deleting a group keeps its hosts, just without that tag.
  await expect(hostRow(page, 'api-1')).toBeVisible();
});

test('duplicates a host from the row menu into the add form', async ({ page }) => {
  await boot(page);
  await openMore(page, 'web-1');
  await page.getByRole('button', { name: '复制 web-1', exact: true }).click();

  const editor = page.getByRole('dialog', { name: '添加主机' });
  await expect(editor.getByLabel('名称', { exact: true })).toHaveValue('web-1-copy');
  await expect(editor.getByLabel('主机名 / IP')).toHaveValue('web-1.example.com');
  // The copy inherits the group membership, not just the address.
  await expect(editor.getByRole('checkbox', { name: '分组 prod' })).toHaveAttribute('aria-checked', 'true');

  await editor.getByRole('button', { name: '添加主机' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hostRow(page, 'web-1-copy')).toBeVisible();
});


for (const width of [880, 1100]) {
  for (const theme of ['dark', 'light']) {
    test(`top bar keeps transfer and navigation visible at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.addInitScript((value) => localStorage.setItem('easyssh-theme', value), theme);
      const manyHosts = Array.from({ length: 12 }, (_, i) => ({
        ...HOSTS[0],
        name: `qa-long-host-${i + 1}`,
        hostname: `qa-${i + 1}.example.test`,
        tags: []
      }));
      await boot(page, manyHosts);
      await page.getByRole('checkbox', { name: '全选主机', exact: true }).check();
      await page.getByRole('button', { name: '批量连接', exact: true }).click();
      const header = page.getByRole('banner');
      const tabs = page.getByRole('navigation', { name: '已打开会话' });
      const workspace = page.getByRole('navigation', { name: '工作区', exact: true });
      const transfer = header.getByRole('button', { name: '导入 / 导出主机', exact: true });
      await expect(tabs.getByRole('button', { name: / · 终端$/ })).toHaveCount(12);
      await expect(header.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
      // The merged Windows bar carries the brand itself (no native title row).
      await expect(header.getByText('EasySSH', { exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(transfer).toHaveText('导入 / 导出');
      await expect(transfer.locator('svg')).toBeVisible();
      for (const button of await header.getByRole('button').all()) {
        if (await button.evaluate((el) => !!el.closest('[aria-label="已打开会话"]'))) continue;
        await expect(button).toBeInViewport({ ratio: 1 });
      }
      const position = await transfer.boundingBox();
      expect(await tabs.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await tabs.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await expect.poll(() => tabs.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      expect(await transfer.boundingBox()).toEqual(position);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await transfer.click();
      const dialog = page.getByRole('dialog', { name: '导入 / 导出主机' });
      await expect(dialog.getByRole('button', { name: '完整备份', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'SSH config', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '关闭', description: '关闭', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await workspace.getByRole('button', { name: '隧道', exact: true }).click();
      await expect(workspace.getByRole('button', { name: '隧道', exact: true })).toHaveAttribute('aria-current', 'page');
      await workspace.getByRole('button', { name: '命令片段', exact: true }).click();
      await expect(page.getByRole('heading', { name: '命令片段', exact: true })).toBeVisible();
      await workspace.getByRole('button', { name: 'SSH', exact: true }).click();
      await expect(hostRow(page, manyHosts[0].name)).toBeVisible();
      await expect(workspace.getByRole('button', { name: 'SSH', exact: true })).toHaveAttribute('aria-current', 'page');
    });
  }
}

test('imports and exports the host list', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '导入 / 导出主机', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入 / 导出主机' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '完整备份', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('包含明文登录密码')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '导入', exact: true })).toBeDisabled();

  // Export asks where to save (the dialog's path) and reports it back.
  await dialog.getByRole('button', { name: '导出…' }).click();
  await expect(dialog.getByText('D:/Backups/easyssh-hosts.toml')).toBeVisible();

  // Import reads the picked file, adds the host and reports the counts.
  await dialog.getByLabel('选择主机文件').setInputFiles({
    name: 'easyssh-hosts.toml',
    mimeType: 'text/plain',
    buffer: Buffer.from('[[hosts]]\nname = "imported-1"\nhostname = "imported.example.com"\n')
  });
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await expect(dialog.getByText('新增 1 台')).toBeVisible();
  await expect(hostRow(page, 'imported-1')).toBeVisible();
});

test('exports SSH config format and imports ssh config text', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '导入 / 导出主机', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入 / 导出主机' });

  // The SSH config format warns that passwords are left out, and saves a .conf.
  const sshToggle = dialog.getByRole('button', { name: 'SSH config', exact: true });
  await sshToggle.click();
  await expect(sshToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('不含密码')).toBeVisible();
  await dialog.getByRole('button', { name: '导出…' }).click();
  await expect(dialog.getByText('D:/Backups/easyssh-ssh-config.conf')).toBeVisible();

  // Import accepts plain ssh config text and adds the Host block as a manual host.
  await dialog.getByLabel('选择主机文件').setInputFiles({
    name: 'config',
    mimeType: 'text/plain',
    buffer: Buffer.from('Host ssh-imported\n    HostName 10.0.0.8\n')
  });
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await expect(dialog.getByText('新增 1 台')).toBeVisible();
  await expect(hostRow(page, 'ssh-imported')).toBeVisible();
});

test('cancelling host transfer never imports or exports a file', async ({ page }) => {
  await boot(page, HOSTS, true);
  const transfer = page.getByRole('button', { name: '导入 / 导出主机', exact: true });
  await transfer.click();
  const dialog = page.getByRole('dialog', { name: '导入 / 导出主机' });
  await expect(dialog.getByText('未选择文件')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '导入', exact: true })).toBeDisabled();
  for (const format of ['完整备份', 'SSH config']) {
    await dialog.getByRole('button', { name: format, exact: true }).click();
    await dialog.getByRole('button', { name: '导出…', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '导出…', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: '复制导出路径' })).toHaveCount(0);
  }
  await dialog.getByLabel('选择主机文件').setInputFiles({
    name: 'cancelled.toml', mimeType: 'text/plain',
    buffer: Buffer.from('[[hosts]]\nname = "cancelled-qa"\n')
  });
  await dialog.getByLabel('选择主机文件').setInputFiles([]);
  await expect(dialog.getByText('未选择文件')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '导入', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await transfer.click();
  await expect(dialog.getByText('未选择文件')).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', description: '关闭', exact: true }).click();
  const calls = await page.evaluate(() => (window as unknown as { __hostCalls: string[] }).__hostCalls);
  expect(calls.filter((cmd) => cmd === 'plugin:dialog|save')).toHaveLength(2);
  expect(calls.filter((cmd) => ['import_hosts', 'export_hosts', 'export_ssh_config'].includes(cmd))).toEqual([]);
});

test('transfer shows invalid-file errors and duplicate counts without replacing hosts', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '导入 / 导出主机', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入 / 导出主机' });
  const file = dialog.getByLabel('选择主机文件');
  await file.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not a host file') });
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await expect(dialog.getByText('无法识别主机文件（TOML 或 SSH config）')).toBeVisible();
  await expect(page.locator('[data-card]')).toHaveCount(HOSTS.length);
  await file.setInputFiles({
    name: 'duplicate.conf', mimeType: 'text/plain',
    buffer: Buffer.from('Host web-1\n  HostName must-not-replace.example.test\n')
  });
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await expect(dialog.getByText('新增 0 台，跳过 1 台（已存在），失败 0 台。', { exact: true })).toBeVisible();
  await expect(dialog.getByText('无法识别主机文件（TOML 或 SSH config）')).toHaveCount(0);
  await expect(page.locator('[data-card]')).toHaveCount(HOSTS.length);
  await dialog.getByRole('button', { name: '关闭', description: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '编辑 web-1' }).click();
  await expect(page.getByRole('dialog', { name: '编辑主机' }).getByLabel('主机名 / IP')).toHaveValue('web-1.example.com');
});

test('re-reads the local SSH config from the import and export dialog', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '导入 / 导出主机', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入 / 导出主机' });
  const sync = dialog.getByRole('button', { name: '导入 SSH config' });
  await sync.click();
  await expect(sync).toHaveText('已同步');
  await expect(hostRow(page, 'web-1')).toBeVisible();
});

test('shows the TCP and ping latency the prober reports', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '刷新监控指标' }).click();
  const row = hostRow(page, 'web-1');
  await expect(row.getByText('12 ms')).toBeVisible();
  await expect(row.getByText('18 ms')).toBeVisible();
  // A host with no measurement shows an em dash for each probe.
  const latencyCell = hostRow(page, 'api-1').locator('div[title="从本机测量：TCP 连接与 ping"]');
  await expect(latencyCell.getByText('—')).toHaveCount(2);
});

async function callLog(page: Page): Promise<Array<{ cmd: string; args: Record<string, unknown> }>> {
  return page.evaluate(
    () => (window as unknown as { __hostCallLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__hostCallLog
  );
}

test('exports each TOML scope once with its own filename and IPC scope', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '导入 / 导出主机', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入 / 导出主机' });
  const scopes = dialog.getByRole('radiogroup', { name: '导出范围' });
  const both = scopes.getByRole('radio', { name: '完整快照（含密码）' });
  const config = scopes.getByRole('radio', { name: '仅连接配置（不含密码）' });
  const credentials = scopes.getByRole('radio', { name: '仅凭据（用户名 + 密码）' });
  await expect(both).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByText('含明文密码，请妥善保管', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: '导出…' }).click();
  await expect(dialog.getByText('D:/Backups/easyssh-hosts.toml')).toBeVisible();

  await config.click();
  await expect(config).toHaveAttribute('aria-checked', 'true');
  await expect(both).toHaveAttribute('aria-checked', 'false');
  await expect(dialog.getByText('含明文密码，请妥善保管', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('不含密码', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '导出…' }).click();
  await expect(dialog.getByText('D:/Backups/easyssh-hosts-config.toml')).toBeVisible();

  // Arrow keys move the selection and the focus together.
  await config.focus();
  await page.keyboard.press('ArrowDown');
  await expect(credentials).toHaveAttribute('aria-checked', 'true');
  await expect(credentials).toBeFocused();
  await dialog.getByRole('button', { name: '导出…' }).click();
  await expect(dialog.getByText('D:/Backups/easyssh-credentials.toml')).toBeVisible();

  const exports = (await callLog(page)).filter((call) => call.cmd === 'export_hosts');
  expect(exports.map((call) => call.args.scope)).toEqual(['both', 'config', 'credentials']);
  expect(exports.map((call) => call.args.path)).toEqual([
    'D:/Backups/easyssh-hosts.toml',
    'D:/Backups/easyssh-hosts-config.toml',
    'D:/Backups/easyssh-credentials.toml'
  ]);
});

test('batch deletes the selected hosts after a second confirmation', async ({ page }) => {
  await boot(page);
  await page.getByRole('checkbox', { name: '选择 web-1' }).check();
  await page.getByRole('checkbox', { name: '选择 api-1' }).check();
  await page.getByRole('button', { name: '删除所选（2）', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除所选主机' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText('web-1、api-1')).toBeVisible();
  await expect(confirm.getByText(/不可撤销/)).toBeVisible();
  await confirm.getByRole('button', { name: '删除（2）', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hostRow(page, 'web-1')).toHaveCount(0);
  await expect(hostRow(page, 'api-1')).toHaveCount(0);
  await expect(hostRow(page, 'imported')).toBeVisible();
  await expect(page.locator('[aria-live="polite"]', { hasText: '已删除 2 个主机' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^删除所选（/ })).toHaveCount(0);

  const log = await callLog(page);
  const batch = log.filter((call) => call.cmd === 'delete_hosts');
  expect(batch).toHaveLength(1);
  expect(batch[0].args.names).toEqual(['web-1', 'api-1']);
  // The list refresh follows the delete, not the other way round.
  const deleteAt = log.indexOf(batch[0]);
  expect(log.slice(deleteAt + 1).some((call) => call.cmd === 'reload_hosts')).toBe(true);
});

test('batch delete explains the hosts it could not remove', async ({ page }) => {
  await boot(page);
  await page.getByRole('checkbox', { name: '选择 web-1' }).check();
  await page.getByRole('checkbox', { name: '选择 imported' }).check();
  await page.getByRole('button', { name: '删除所选（2）', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除所选主机' });
  await expect(confirm.getByText(/SSH config 导入的主机/)).toBeVisible();
  await confirm.getByRole('button', { name: '删除（2）', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hostRow(page, 'web-1')).toHaveCount(0);
  // The SSH-config import has no local entry, so it stays and the bar says why.
  await expect(hostRow(page, 'imported')).toBeVisible();
  await expect(page.locator('[aria-live="polite"]', { hasText: '已删除 1 个主机' })).toHaveCount(1);
  await expect(page.getByText(/已删除 1 个，其余 1 个未删除/)).toBeVisible();
});

test('batch confirmation lists five names at most and cancelling deletes nothing', async ({ page }) => {
  await boot(page, Array.from({ length: 7 }, (_, i) => ({ ...HOSTS[0], name: `h${i + 1}`, tags: [] })));
  await page.getByRole('checkbox', { name: '全选主机', exact: true }).check();
  await page.getByRole('button', { name: '删除所选（7）', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除所选主机' });
  await expect(confirm.getByText('h1、h2、h3、h4、h5')).toBeVisible();
  await expect(confirm.getByText(/等 7 个/)).toBeVisible();
  await expect(confirm.getByText(/h6/)).toHaveCount(0);
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hostRow(page, 'h7')).toBeVisible();
  expect((await callLog(page)).filter((call) => call.cmd === 'delete_hosts')).toEqual([]);
});