import { expect, test, type Page } from '@playwright/test';

// The Windows main window has no native frame (main.rs set_decorations(false)):
// TopBar carries the brand and the caption buttons. Tauri is stubbed at
// __TAURI_INTERNALS__ like quit.spec; the stub emulates the native close path by
// answering plugin:window|close with tauri://close-requested, so a test can prove
// the close button goes through the quit question instead of destroy().
const HOSTS = [
  { name: 'web-1', hostname: 'web-1.example.com', user: 'deploy', port: 22, tags: [], source: 'manual', hasKey: true, localForwards: [], tunnelAutostart: false, forwardAgent: false }
];

type Call = { cmd: string; args: Record<string, unknown> };

async function boot(
  page: Page,
  options: { tunnel?: boolean; maximized?: boolean; hosts?: typeof HOSTS } = {}
): Promise<void> {
  await page.addInitScript(
    ({ hosts, tunnel, maximized }) => {
      let cbid = 0;
      const listeners: Record<string, number[]> = {};
      const win = window as unknown as Record<string, unknown>;
      const calls: Call[] = [];
      win.__calls = calls;
      win.__maximized = maximized;

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((e: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }
      win.__fire = fire;

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { windowLabel: 'main', label: 'main' }
        },
        invoke: (cmd: string, args: Record<string, unknown>) => {
          calls.push({ cmd, args });
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve(hosts);
            case 'reload_hosts':
              if (tunnel) {
                setTimeout(() => fire('tunnel-status-changed', { hostName: 'web-1', status: { kind: 'up' } }), 0);
              }
              return Promise.resolve(null);
            case 'set_tray_behavior':
              return Promise.resolve({ available: true, minimize: true });
            case 'terminal_open': {
              const chId = (args.onOutput as { id: number }).id;
              setTimeout(() => {
                const cb = win[`__cb${chId}`] as ((m: unknown) => void) | undefined;
                cb?.({ message: new TextEncoder().encode('ready> ').buffer, index: 0 });
              }, 0);
              return Promise.resolve(1);
            }
            case 'plugin:window|is_visible':
              return Promise.resolve(true);
            case 'plugin:window|is_maximized':
              return Promise.resolve(win.__maximized);
            case 'plugin:window|toggle_maximize':
              win.__maximized = !win.__maximized;
              // The real resize event carries a physical size; onResized wraps it
              // in PhysicalSize, which throws on a null payload.
              setTimeout(() => fire('tauri://resize', { width: 1280, height: 800 }), 0);
              return Promise.resolve(null);
            case 'plugin:window|close':
              // The native window answers close() with a close-requested event;
              // the page then decides between the quit question and destroy().
              setTimeout(() => fire('tauri://close-requested', null), 0);
              return Promise.resolve(null);
            case 'plugin:event|listen': {
              const { event, handler } = args as { event: string; handler: number };
              (listeners[event] ||= []).push(handler);
              return Promise.resolve(handler);
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
    { hosts: options.hosts ?? HOSTS, tunnel: options.tunnel ?? false, maximized: options.maximized ?? false }
  );
  await page.goto('/');
  const first = (options.hosts ?? HOSTS)[0].name;
  await expect(page.locator('[data-card]').getByText(first, { exact: true })).toBeVisible();
}

const calls = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __calls: Call[] }).__calls).map((c) => c.cmd));

const caption = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test('one merged bar: brand, drag region and caption buttons, no second title row', async ({ page }) => {
  await boot(page);
  const header = page.locator('header[data-tauri-drag-region]');
  await expect(header).toHaveCount(1);
  await expect(header.getByText('EasySSH', { exact: true })).toBeVisible();
  for (const name of ['最小化', '最大化', '关闭']) {
    await expect(caption(page, name)).toBeVisible();
  }
  // Interactive controls must never start a window drag.
  for (const name of ['最小化', '最大化', '关闭', '设置', '导入 / 导出主机']) {
    expect(await caption(page, name).getAttribute('data-tauri-drag-region')).toBeNull();
  }
  // The brand strip itself is draggable.
  await expect(header.getByText('EasySSH', { exact: true })).toHaveAttribute('data-tauri-drag-region', '');
});

test('minimize and maximize call the window API, and the icon follows the state', async ({ page }) => {
  await boot(page);
  await caption(page, '最小化').click();
  await expect.poll(() => calls(page)).toContain('plugin:window|minimize');

  await caption(page, '最大化').click();
  await expect.poll(() => calls(page)).toContain('plugin:window|toggle_maximize');
  // The stub flips is_maximized and fires tauri://resize, like the real window.
  await expect(caption(page, '还原')).toBeVisible();
  await expect(caption(page, '最大化')).toHaveCount(0);

  await caption(page, '还原').click();
  await expect(caption(page, '最大化')).toBeVisible();
  const toggles = (await calls(page)).filter((c) => c === 'plugin:window|toggle_maximize');
  expect(toggles).toHaveLength(2);
});

test('a maximized window opens showing the restore control', async ({ page }) => {
  await boot(page, { maximized: true });
  await expect(caption(page, '还原')).toBeVisible();
  await expect(caption(page, '最大化')).toHaveCount(0);
});

test('the close button asks before quitting and never destroys on its own', async ({ page }) => {
  await boot(page, { tunnel: true });
  await caption(page, '关闭').click();
  const dialog = page.getByRole('dialog', { name: '退出 EasySSH？' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('1 条隧道将被关闭。')).toBeVisible();
  expect(await calls(page)).toContain('plugin:window|close');
  expect(await calls(page)).not.toContain('plugin:window|destroy');

  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await calls(page)).not.toContain('plugin:window|destroy');

  await caption(page, '关闭').click();
  await dialog.getByRole('button', { name: '退出' }).click();
  await expect.poll(() => calls(page)).toContain('plugin:window|destroy');
});

test('with nothing live the close button closes at once', async ({ page }) => {
  await boot(page);
  await caption(page, '关闭').click();
  await expect.poll(() => calls(page)).toContain('plugin:window|destroy');
  await expect(page.getByRole('dialog', { name: '退出 EasySSH？' })).toHaveCount(0);
});

test('off Tauri the caption buttons stay hidden and the shell still mounts', async ({ page }) => {
  // No __TAURI_INTERNALS__ stub: the isMaximized probe rejects, controls never show.
  await page.goto('/');
  await expect(page.locator('header')).toBeVisible();
  await expect(caption(page, '最小化')).toHaveCount(0);
  await expect(caption(page, '关闭')).toHaveCount(0);
});

// Narrow-window layout regression (same scenario as the hosts.spec top-bar tests):
// many long host tabs must not push the caption trio, transfer or workspace nav out of
// view or on top of each other — the tab strip scrolls instead.
for (const width of [880, 1100]) {
  test(`at ${width}px the caption trio, transfer and navigation stay in view while long tabs scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    const manyHosts = Array.from({ length: 12 }, (_, i) => ({
      ...HOSTS[0],
      name: `qa-long-host-${i + 1}`,
      hostname: `qa-${i + 1}.example.test`
    }));
    await boot(page, { hosts: manyHosts });
    await page.getByRole('checkbox', { name: '全选主机', exact: true }).check();
    await page.getByRole('button', { name: '批量连接', exact: true }).click();

    const header = page.locator('header[data-tauri-drag-region]');
    const tabs = page.getByRole('navigation', { name: '已打开会话' });
    const workspace = page.getByRole('navigation', { name: '工作区', exact: true });
    const transfer = header.getByRole('button', { name: '导入 / 导出主机', exact: true });
    await expect(tabs.getByRole('button', { name: / · 终端$/ })).toHaveCount(12);
    await expect(header.getByText('EasySSH', { exact: true })).toBeVisible();

    for (const name of ['最小化', '最大化', '关闭']) {
      await expect(caption(page, name)).toBeInViewport({ ratio: 1 });
    }
    await expect(transfer).toBeInViewport({ ratio: 1 });
    await expect(transfer).toHaveText('导入 / 导出');
    for (const name of ['SSH', '隧道', '命令片段']) {
      await expect(workspace.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    }

    // One row, so pairwise disjoint x-ranges mean nothing overlaps.
    const boxes = await Promise.all(
      [workspace, tabs, transfer, caption(page, '最小化'), caption(page, '最大化'), caption(page, '关闭')].map(
        (loc) => loc.boundingBox()
      )
    );
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);
      }
    }

    expect(await tabs.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await tabs.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await expect.poll(() => tabs.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test.describe('on macOS', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
  });

  test('the overlay title bar keeps its inset and gains no caption buttons', async ({ page }) => {
    await boot(page);
    await expect(caption(page, '最小化')).toHaveCount(0);
    await expect(caption(page, '关闭')).toHaveCount(0);
    await expect(page.locator('header').getByText('EasySSH', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-os'))).toBe('macos');
  });
});