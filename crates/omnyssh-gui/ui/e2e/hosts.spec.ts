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
      win.__hostCalls = calls;

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((event: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          calls.push(cmd);
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
                (args.path as string) ?? 'C:/Users/test/Downloads/omnyssh-hosts.toml'
              );
            case 'export_ssh_config':
              return Promise.resolve(
                (args.path as string) ?? 'C:/Users/test/Downloads/omnyssh-ssh-config.conf'
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
  await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
}

test('adds a host and it appears as a table row and in the tree', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add host' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Name', { exact: true }).fill('db-1');
  await editor.getByLabel('Hostname / IP').fill('db-1.example.com');
  await editor.getByLabel('User').fill('postgres');
  await editor.getByRole('button', { name: 'Add host' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hostRow(page, 'db-1')).toBeVisible();
  await expect(page.getByRole('complementary').getByText('db-1', { exact: true })).toBeVisible();
  await expect(page.getByText('postgres@db-1.example.com:22')).toBeVisible();
});

test('edits a manual host in place', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Edit web-1' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel(/^Name/)).toHaveAttribute('readonly', '');
  await editor.getByLabel('Hostname / IP').fill('web-1b.example.com');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('deploy@web-1b.example.com:22')).toBeVisible();
});

test.describe('on Linux', () => {
  test.use({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)' });

  test('agent forwarding is off until switched on, and stays on', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Edit web-1' }).click();
    let editor = page.getByRole('dialog', { name: 'Edit host' });
    const agent = editor.getByRole('switch', { name: 'Forward SSH agent' });
    await expect(agent).toHaveAttribute('aria-checked', 'false');
    await agent.click();
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit web-1' }).click();
    editor = page.getByRole('dialog', { name: 'Edit host' });
    await expect(editor.getByRole('switch', { name: 'Forward SSH agent' })).toHaveAttribute('aria-checked', 'true');
  });
});

test('agent forwarding says it is not on Windows yet', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Edit web-1' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });
  await expect(editor.getByRole('switch', { name: 'Forward SSH agent' })).toBeDisabled();
  await expect(editor.getByText('Not available on Windows yet.')).toBeVisible();
});

test('deletes a manual host after confirmation', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Delete host web-1' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete host' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(hostRow(page, 'web-1')).toHaveCount(0);
  await expect(page.getByRole('complementary').getByText('web-1', { exact: true })).toHaveCount(0);
});

test('an SSH-config host is adopted by editing it', async ({ page }) => {
  await boot(page);
  await expect(page.getByText('ssh config')).toBeVisible();
  // An import has no local file entry to delete: the row offers no trash button.
  await expect(page.getByRole('button', { name: 'Delete host imported' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit imported' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });
  await expect(editor.getByText(/never written/)).toBeVisible();
  await editor.getByLabel('Hostname / IP').fill('adopted.example.com');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('root@adopted.example.com:22')).toBeVisible();
  await expect(page.getByText('ssh config')).toHaveCount(0);
  // Adopted: the entry is now manual, so the row can delete it.
  await expect(page.getByRole('button', { name: 'Delete host imported' })).toHaveCount(1);
});

test('the tree always shows group membership; View options groups the table', async ({ page }) => {
  await boot(page);
  // The tree groups hosts by tag on its own, before any toggle.
  const prod = page.getByRole('region', { name: 'prod hosts' });
  const api = page.getByRole('region', { name: 'api hosts' });
  await expect(prod.getByText('web-1', { exact: true })).toBeVisible();
  await expect(api.getByText('api-1', { exact: true })).toBeVisible();

  const trigger = page.getByRole('button', { name: 'View options' });
  const dot = trigger.locator('span.bg-accent');
  await expect(dot).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'View options' });
  expect(await panel.evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(/^rgb\(/);
  const grouping = panel.getByRole('switch', { name: 'Group by tag' });
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
  await page.getByRole('button', { name: 'Refresh metrics' }).click();
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('g');
  await expect(dot).toHaveCount(0);
  // The table ungroups; the tree keeps showing which group a host belongs to.
  await expect(prod).toBeVisible();
  await expect(hostRow(page, 'api-1')).toHaveCount(1);
});

test('creates, renames and deletes groups while preserving hosts and empty groups', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Manage host groups' }).click();
  let manager = page.getByRole('dialog', { name: '主机分组' });
  await expect(manager).toBeVisible();

  await manager.getByRole('textbox', { name: '新分组名称' }).fill('empty');
  await manager.getByRole('button', { name: '创建分组' }).click();
  await manager.getByRole('textbox', { name: '新分组名称' }).fill('production');
  await manager.getByRole('button', { name: '创建分组' }).click();
  await manager.getByRole('checkbox', { name: 'web-1 属于 production' }).check();
  await manager.getByRole('button', { name: '保存分组' }).click();
  await expect(manager).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'empty hosts' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'production hosts' }).getByText('web-1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Manage host groups' }).click();
  await manager.getByRole('button', { name: '重命名分组 production' }).click();
  await manager.getByRole('textbox', { name: '分组名称', exact: true }).fill('核心');
  await manager.getByRole('button', { name: '保存名称' }).click();
  await manager.getByRole('button', { name: '保存分组' }).click();
  await expect(manager).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'production hosts' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '核心 hosts' }).getByText('web-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'prod hosts' }).getByText('web-1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Manage host groups' }).click();
  await manager.getByRole('button', { name: '删除分组 核心' }).click();
  await manager.getByRole('button', { name: '保存分组' }).click();
  await expect(manager).toHaveCount(0);
  await expect(page.getByRole('region', { name: '核心 hosts' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'prod hosts' }).getByText('web-1', { exact: true })).toBeVisible();
  await expect(hostRow(page, 'web-1')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'empty hosts' })).toBeVisible();
  await expect(page.getByRole('region', { name: '核心 hosts' })).toHaveCount(0);
});

test('folded tree sections stay folded across navigation and reload, but search unfolds them', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('g');
  const prod = page.getByRole('region', { name: 'prod hosts' });
  await page.getByRole('button', { name: 'Fold prod' }).click();
  await expect(page.getByRole('button', { name: 'Unfold prod' })).toHaveAttribute('aria-expanded', 'false');
  await expect(prod.getByText('web-1', { exact: true })).toBeHidden();
  await expect(hostRow(page, 'imported')).toBeVisible();
  await page.getByRole('button', { name: 'Snippets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Snippets' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'SSH', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unfold prod' })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unfold prod' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Search hosts' }).click();
  const search = page.getByRole('textbox', { name: 'Search hosts' });
  await search.fill('web');
  await expect(prod.getByText('web-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unfold prod' })).toBeDisabled();
  await search.press('Escape');
  await expect(prod.getByText('web-1', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Unfold prod' }).click();
  await expect(page.getByRole('button', { name: 'Fold prod' })).toHaveAttribute('aria-expanded', 'true');
  await expect(prod.getByText('web-1', { exact: true })).toBeVisible();
});

test('a host with a repeated tag renders once in that tree group', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await boot(page);
  await page.getByRole('button', { name: 'Edit web-1' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });
  await editor.getByLabel('标签 / 新分组').fill('prod, prod');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('g');
  const prod = page.getByRole('region', { name: 'prod hosts' });
  await expect(prod.getByText('web-1', { exact: true })).toHaveCount(1);
  await expect(prod.getByText('api-1', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('g is ignored under a modal and while typing', async ({ page }) => {
  await boot(page);
  // `g` toggles the table's grouping; its indicator is the View options dot.
  const dot = page.getByRole('button', { name: 'View options' }).locator('span.bg-accent');
  await expect(dot).toHaveCount(0);
  await page.getByRole('button', { name: 'Support OmnySSH' }).click();
  await expect(page.getByRole('dialog', { name: 'Support OmnySSH' })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByText('esc close').click();
  await page.keyboard.press('g');
  await expect(dot).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await page.getByRole('button', { name: 'Search hosts' }).click();
  await page.getByRole('textbox', { name: 'Search hosts' }).press('g');
  await expect(page.getByRole('textbox', { name: 'Search hosts' })).toHaveValue('g');
  await expect(dot).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search hosts' }).press('Escape');
  await page.keyboard.press('g');
  await expect(dot).toHaveCount(1);
});

async function cardOrder(page: Page): Promise<string[]> {
  const grips = page.getByRole('button', { name: /^Move / });
  return (await grips.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? ''))).map(
    (label) => label.slice('Move '.length)
  );
}

async function dragOnto(page: Page, host: string, onto: string): Promise<void> {
  await hostRow(page, host).hover();
  const grip = await page.getByRole('button', { name: `Move ${host}` }).boundingBox();
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
  await page.getByRole('button', { name: 'View options' }).click();
  const sort = page.getByRole('radiogroup', { name: 'Sort' });
  await expect(sort.getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true');
  await sort.getByRole('radio', { name: 'Custom' }).focus();
  await page.keyboard.press('ArrowRight');
  const byName = sort.getByRole('radio', { name: 'Name' });
  await expect(byName).toHaveAttribute('aria-checked', 'true');
  await expect(byName).toBeFocused();
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'imported', 'web-1']);
  await page.keyboard.press('ArrowRight');
  await expect(sort.getByRole('radio', { name: 'Status' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(sort.getByRole('radio', { name: 'Address' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(sort.getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true');
  await byName.click();
  await page.reload();
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'imported', 'web-1']);
});

test('dragging a row by its grip reorders the table and persists; cancellation saves nothing', async ({ page }) => {
  await boot(page);
  await dragOnto(page, 'api-1', 'web-1');
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'web-1', 'imported']);
  await expect(page.locator('[aria-live="polite"]', { hasText: 'api-1 moved to position 1 of 3' })).toHaveCount(1);
  await page.reload();
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'web-1', 'imported']);
  const grip = await page.getByRole('button', { name: 'Move imported' }).boundingBox();
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
  const options = page.getByRole('button', { name: 'View options' });
  await options.click();
  await page.getByRole('radio', { name: 'Name' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'imported', 'web-1']);
  const grip = await page.getByRole('button', { name: 'Move web-1' }).boundingBox();
  if (!grip) throw new Error('grip not on screen');
  await page.mouse.move(grip.x + 5, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x - 300, grip.y + 5, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await options.click();
  await expect(page.getByRole('radio', { name: 'Name' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await dragOnto(page, 'web-1', 'imported');
  await expect.poll(() => cardOrder(page)).toEqual(['api-1', 'web-1', 'imported']);
  await options.click();
  await expect(page.getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true');
});

test('the grip moves a row with the keyboard without changing it when the tree regroups', async ({ page }) => {
  await boot(page);
  const grip = page.getByRole('button', { name: 'Move web-1' });
  await grip.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => cardOrder(page)).toEqual(['imported', 'web-1', 'api-1']);
  await expect(grip).toBeFocused();
  await expect(page.locator('[aria-live="polite"]')).toHaveText('web-1 moved to position 2 of 3');
  await page.keyboard.press('End');
  await expect.poll(() => cardOrder(page)).toEqual(['imported', 'api-1', 'web-1']);
  await page.keyboard.press('Home');
  await expect.poll(() => cardOrder(page)).toEqual(['web-1', 'imported', 'api-1']);
  await expect(grip).toBeFocused();
  await page.keyboard.press('g');
  await expect.poll(() => cardOrder(page)).toEqual(['web-1', 'imported', 'api-1']);
  await expect(page.getByRole('button', { name: 'Move web-1' })).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(() => cardOrder(page)).toEqual(['imported', 'api-1', 'web-1']);
  await expect(page.locator('[aria-live="polite"]')).toHaveText('web-1 moved to position 3 of 3');
});

test('holding a drag past the bottom edge scrolls and drops at the end', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 260 });
  await boot(page);
  await hostRow(page, 'web-1').hover();
  const grip = await page.getByRole('button', { name: 'Move web-1' }).boundingBox();
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
  const grip = await page.getByRole('button', { name: 'Move x' }).boundingBox();
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
  const grip = await card('dup-b.example.com').getByRole('button', { name: 'Move dup' }).boundingBox();
  const target = await card('dup-a.example.com').boundingBox();
  if (!grip || !target) throw new Error('row not on screen');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(addresses).toEqual(['dup-b', 'dup-a', 'x', 'y', 'dup-c']);
  await page.keyboard.press('g');
  await card('dup-c.example.com').getByRole('button', { name: 'Move dup' }).focus();
  await page.keyboard.press('Home');
  await expect.poll(addresses).toEqual(['dup-c', 'dup-b', 'dup-a', 'x', 'y']);
  await page.reload();
  await expect.poll(addresses).toEqual(['dup-c', 'dup-b', 'dup-a', 'x', 'y']);
});

test('rejects a new host whose name already exists', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add host' });
  await editor.getByLabel('Name', { exact: true }).fill('web-1');
  await editor.getByLabel('Hostname / IP').fill('dupe.example.com');
  await editor.getByRole('button', { name: 'Add host' }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByText('A host named "web-1" already exists')).toBeVisible();
});

test('favorites filter the table and persist across reload', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Favorite web-1' }).click();
  await page.getByRole('button', { name: /^收藏/ }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await expect(hostRow(page, 'api-1')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /^收藏/ }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await page.getByRole('button', { name: 'Unfavorite web-1' }).click();
  await expect(hostRow(page, 'web-1')).toHaveCount(0);
});

test('recent connections are recorded by real session launches', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Connect web-1' }).click();
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'SSH', exact: true }).click();
  await page.getByRole('button', { name: 'Recent connections' }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await expect(hostRow(page, 'api-1')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Recent connections' }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
});

test('multi-select opens terminals for the selected hosts', async ({ page }) => {
  await boot(page);
  await page.getByRole('checkbox', { name: 'Select web-1' }).check();
  await page.getByRole('checkbox', { name: 'Select api-1' }).check();
  await page.getByRole('button', { name: '批量连接', exact: true }).click();
  await expect(page.getByRole('button', { name: 'web-1 · terminal', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'api-1 · terminal', exact: true })).toBeVisible();
});

test('tree selection filters one host and the address copy uses the real endpoint', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await page.getByRole('complementary').getByText('web-1', { exact: true }).click();
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await expect(hostRow(page, 'api-1')).toHaveCount(0);
  await hostRow(page, 'web-1').hover();
  await page.getByRole('button', { name: 'Copy IP for web-1' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('web-1.example.com:22');
});

test('picks an existing group while adding a host', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add host' });
  await editor.getByLabel('Name', { exact: true }).fill('grouped');
  await editor.getByLabel('Hostname / IP').fill('grouped.example.com');
  await editor.getByLabel('User').fill('root');

  // The chip is there because web-1/api-1 already carry that group.
  const chip = editor.getByRole('checkbox', { name: '分组 api' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-checked', 'true');
  await editor.getByRole('button', { name: 'Add host' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The membership survived the save: the edit form shows the chip checked.
  await page.getByRole('button', { name: 'Edit grouped' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit host' });
  await expect(edit.getByRole('checkbox', { name: '分组 api' })).toHaveAttribute('aria-checked', 'true');
});

test('copies the stored password from the row', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await page.getByRole('button', { name: 'Copy password for web-1' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('secret-for-web-1');
});

test('shows the live network rate on the host row', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Refresh metrics' }).click();
  await expect(hostRow(page, 'web-1').getByText('↓ 1.5 MB/s · ↑ 512 KB/s')).toBeVisible();
});

test('renames and deletes a group from the host tree', async ({ page }) => {
  await boot(page);
  // Groups live in the tree's grouped view; turn it on first.
  await page.getByRole('button', { name: 'View options' }).click();
  await page
    .getByRole('dialog', { name: 'View options' })
    .getByRole('switch', { name: 'Group by tag' })
    .click();
  await page.keyboard.press('Escape');
  const prod = page.getByRole('region', { name: 'prod hosts' });
  await expect(prod).toBeVisible();
  await prod.hover();
  await page.getByRole('button', { name: '重命名分组 prod' }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('production');
  await page.getByRole('button', { name: '保存分组名称' }).click();
  await expect(page.getByRole('region', { name: 'production hosts' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'prod hosts' })).toHaveCount(0);
  // The hosts kept the renamed tag and both remain listed.
  await expect(hostRow(page, 'web-1')).toBeVisible();
  await expect(hostRow(page, 'api-1')).toBeVisible();

  await page.getByRole('region', { name: 'api hosts' }).hover();
  await page.getByRole('button', { name: '删除分组 api' }).click();
  await page.getByRole('button', { name: '确认删除分组 api' }).click();
  await expect(page.getByRole('region', { name: 'api hosts' })).toHaveCount(0);
  // Deleting a group keeps its hosts, just without that tag.
  await expect(hostRow(page, 'api-1')).toBeVisible();
});

test('duplicates a host from the row menu into the add form', async ({ page }) => {
  await boot(page);
  await openMore(page, 'web-1');
  await page.getByRole('button', { name: 'Duplicate web-1' }).click();

  const editor = page.getByRole('dialog', { name: 'Add host' });
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('web-1-copy');
  await expect(editor.getByLabel('Hostname / IP')).toHaveValue('web-1.example.com');
  // The copy inherits the group membership, not just the address.
  await expect(editor.getByRole('checkbox', { name: '分组 prod' })).toHaveAttribute('aria-checked', 'true');

  await editor.getByRole('button', { name: 'Add host' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hostRow(page, 'web-1-copy')).toBeVisible();
});


for (const width of [880, 1100]) {
  for (const theme of ['dark', 'light']) {
    test(`top bar keeps transfer and navigation visible at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.addInitScript((value) => localStorage.setItem('omnyssh-theme', value), theme);
      const manyHosts = Array.from({ length: 12 }, (_, i) => ({
        ...HOSTS[0],
        name: `qa-long-host-${i + 1}`,
        hostname: `qa-${i + 1}.example.test`,
        tags: []
      }));
      await boot(page, manyHosts);
      await page.getByRole('checkbox', { name: 'Select all hosts', exact: true }).check();
      await page.getByRole('button', { name: '批量连接', exact: true }).click();
      const header = page.getByRole('banner');
      const tabs = page.getByRole('navigation', { name: 'Open sessions' });
      const workspace = page.getByRole('navigation', { name: 'Workspace', exact: true });
      const transfer = header.getByRole('button', { name: '导入 / 导出主机', exact: true });
      await expect(tabs.getByRole('button', { name: / · terminal$/ })).toHaveCount(12);
      await expect(header.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
      await expect(header.getByText('OmnySSH', { exact: true })).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(transfer).toHaveText('导入 / 导出');
      await expect(transfer.locator('svg')).toBeVisible();
      for (const button of await header.getByRole('button').all()) {
        if (await button.evaluate((el) => !!el.closest('[aria-label="Open sessions"]'))) continue;
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
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await workspace.getByRole('button', { name: '隧道', exact: true }).click();
      await expect(workspace.getByRole('button', { name: '隧道', exact: true })).toHaveAttribute('aria-current', 'page');
      await workspace.getByRole('button', { name: 'Snippets', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Snippets', exact: true })).toBeVisible();
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
  await expect(dialog.getByText('D:/Backups/omnyssh-hosts.toml')).toBeVisible();

  // Import reads the picked file, adds the host and reports the counts.
  await dialog.getByLabel('选择主机文件').setInputFiles({
    name: 'omnyssh-hosts.toml',
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
  await expect(dialog.getByText('D:/Backups/omnyssh-ssh-config.conf')).toBeVisible();

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
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
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
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: 'Edit web-1' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit host' }).getByLabel('Hostname / IP')).toHaveValue('web-1.example.com');
});

test('re-reads the local SSH config from the import and export dialog', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '导入 / 导出主机', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入 / 导出主机' });
  const sync = dialog.getByRole('button', { name: 'Import SSH config' });
  await sync.click();
  await expect(sync).toHaveText('已同步');
  await expect(hostRow(page, 'web-1')).toBeVisible();
});

test('shows the TCP and ping latency the prober reports', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Refresh metrics' }).click();
  const row = hostRow(page, 'web-1');
  await expect(row.getByText('12 ms')).toBeVisible();
  await expect(row.getByText('18 ms')).toBeVisible();
  // A host with no measurement shows an em dash for each probe.
  const latencyCell = hostRow(page, 'api-1').locator('div[title="从本机测量：TCP 连接与 ping"]');
  await expect(latencyCell.getByText('—')).toHaveCount(2);
});