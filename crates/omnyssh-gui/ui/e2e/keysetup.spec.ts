import { expect, test, type Page } from '@playwright/test';

// Auto SSH-key setup (tech-gui.md §4.2). e2e runs against the static SPA with Tauri
// absent, so we stub `__TAURI_INTERNALS__` at the boundary (§6.4). `start_key_setup` is
// faked per outcome: it streams the `key-setup-progress` steps the real run would reach,
// persists what the backend persists (full success: key + password off; partial: key +
// password on; may-be-off failure: the key alone), then emits the terminal event, so the
// follow-up `reload_hosts` replays
// the host as the real backend would leave it.
const HOSTS = [
  { name: 'pw-host', hostname: 'pw.example.com', user: 'root', port: 22, tags: [], source: 'manual', hasKey: false, localForwards: [], tunnelAutostart: false, forwardAgent: false }
];

type Outcome = 'success' | 'partial' | 'unsafe' | 'rollback';

async function boot(page: Page, outcome: Outcome = 'success', options: { manual?: boolean } = {}): Promise<void> {
  await page.addInitScript(
    ({ hosts, outcome, manual }) => {
      let cbid = 0;
      const listeners: Record<string, number[]> = {};
      const state: { hosts: Array<Record<string, unknown>> } = { hosts: hosts.map((h) => ({ ...h })) };
      const win = window as unknown as Record<string, unknown>;
      win.__startCalls = 0;

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((e: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }
      win.__fire = fire;

      const LABELS = [
        'Generating Ed25519 key pair',
        'Copying public key to server',
        'Verifying key authentication',
        'Disabling password authentication',
        'Reloading SSH service',
        'Final verification'
      ];
      // The last step each outcome reaches: partial stops after the verify step (no
      // passwordless sudo), the unsafe failure in the disable step, and a rollback
      // after the final check.
      const LAST: Record<string, number> = { success: 6, partial: 3, unsafe: 4, rollback: 6 };

      function run(name: string): void {
        const last = LAST[outcome];
        for (let i = 1; i <= last; i++) {
          setTimeout(
            () => fire('key-setup-progress', { hostName: name, step: { index: i, total: 6, description: LABELS[i - 1] } }),
            40 * i
          );
        }
        setTimeout(() => {
          const h = state.hosts.find((x) => (x as { name: string }).name === name);
          const keyPath = `/home/me/.ssh/omnyssh_${name}_ed25519`;
          if (outcome === 'success' || outcome === 'partial') {
            // The real backend persists before emitting complete.
            if (h) {
              h.hasKey = true;
              h.passwordAuthDisabled = outcome === 'success';
            }
            fire('key-setup-complete', { hostName: name, keyPath, passwordOff: outcome === 'success' });
          } else if (outcome === 'unsafe') {
            if (h) h.hasKey = true;
            fire('key-setup-failed', {
              hostName: name,
              error: 'Failed to disable password authentication: timeout',
              passwordMayBeOff: true
            });
          } else {
            fire('key-setup-rollback', {
              hostName: name,
              result: 'Final verification failed after disabling password. Attempting rollback.'
            });
          }
        }, 40 * last + 200);
      }

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve([...state.hosts]);
            case 'reload_hosts':
              setTimeout(() => fire('hosts-loaded', [...state.hosts]), 0);
              return Promise.resolve(null);
            case 'start_key_setup':
              win.__startCalls = (win.__startCalls as number) + 1;
              // Manual mode parks the run in the initial connecting state; the test
              // fires each progress event itself, with the core's English descriptions.
              if (!manual) run(args.hostName as string);
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
    { hosts: HOSTS, outcome, manual: options.manual ?? false }
  );
  await page.goto('/');
  await expect(page.locator('[data-card]').getByText('pw-host', { exact: true })).toBeVisible();
}

const startCalls = (page: Page) => page.evaluate(() => (window as unknown as { __startCalls: number }).__startCalls);

const fire = (page: Page, event: string, payload: unknown) =>
  page.evaluate(
    ([e, p]) => (window as unknown as { __fire: (e: string, p: unknown) => void }).__fire(e as string, p),
    [event, payload]
  );

async function openKeySetup(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'pw-host 的更多操作', exact: true }).click();
  await page.getByRole('button', { name: '为 pw-host 配置 SSH 密钥' }).click();
}

/** Open the confirm dialog from the row and accept it. */
async function confirmSetup(page: Page): Promise<void> {
  await openKeySetup(page);
  await page.getByRole('dialog', { name: '设置密钥登录' }).getByRole('button', { name: '设置密钥登录' }).click();
}

test('asks before key setup, with Cancel focused, and Cancel starts nothing', async ({ page }) => {
  await boot(page);

  await openKeySetup(page);
  const confirm = page.getByRole('dialog', { name: '设置密钥登录' });
  await expect(confirm.getByText('为 pw-host 设置密钥登录？')).toBeVisible();
  // Desktop Chrome's user agent says Windows, so the path is the Windows one.
  await expect(confirm.getByText('%USERPROFILE%\\.ssh\\omnyssh_pw-host_ed25519')).toBeVisible();
  await expect(confirm.getByText('root@pw.example.com')).toBeVisible();
  await expect(confirm.getByText(/所有账户和设备/)).toBeVisible();
  await expect(confirm.getByRole('button', { name: '取消' })).toBeFocused();

  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await startCalls(page)).toBe(0);

  // Escape cancels too.
  await openKeySetup(page);
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await startCalls(page)).toBe(0);
});

test('a full success says password login is off and the card shows the shield', async ({ page }) => {
  await boot(page, 'success');
  await confirmSetup(page);

  const dialog = page.getByRole('dialog', { name: '密钥设置' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('密钥登录已设置，密码登录已关闭')).toBeVisible();
  await expect(dialog.getByText(/omnyssh_pw-host_ed25519/)).toBeVisible();
  await expect(dialog.getByText('OmnySSH 中保存的密码已删除。')).toBeVisible();
  expect(await startCalls(page)).toBe(1);

  await dialog.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The reload flipped hasKey/passwordAuthDisabled: the card shows the shield and no
  // longer offers key setup.
  await expect(page.getByRole('img', { name: '仅限密钥登录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '为 pw-host 配置 SSH 密钥' })).toHaveCount(0);
});

test('a partial run says password login is still on and offers to turn it off', async ({ page }) => {
  await boot(page, 'partial');
  await confirmSetup(page);

  const dialog = page.getByRole('dialog', { name: '密钥设置' });
  await expect(dialog.getByText(/密钥登录已可用。密码登录仍开启/)).toBeVisible();
  await expect(dialog.getByText('已保存的密码被保留。')).toBeVisible();
  await expect(dialog.getByText(/密码登录已关闭/)).toHaveCount(0);
  await dialog.getByRole('button', { name: '完成' }).click();

  const badge = page.getByRole('button', { name: '密码登录开' });
  await expect(badge).toBeVisible();
  await expect(page.getByRole('img', { name: '仅限密钥登录' })).toHaveCount(0);

  await badge.click();
  const rerun = page.getByRole('dialog', { name: '关闭密码登录' });
  await expect(rerun.getByText('关闭 pw-host 的密码登录？')).toBeVisible();
  await expect(rerun.getByText(/复用 OmnySSH 之前生成的登录密钥/)).toBeVisible();
  await expect(rerun.getByRole('button', { name: '取消' })).toBeFocused();
  await rerun.getByRole('button', { name: '关闭密码登录' }).click();
  await expect(page.getByRole('dialog', { name: '密钥设置' })).toBeVisible();
  expect(await startCalls(page)).toBe(2);
});

test('a failure that may leave password login off says so', async ({ page }) => {
  await boot(page, 'unsafe');
  await confirmSetup(page);

  const dialog = page.getByRole('dialog', { name: '密钥设置' });
  await expect(dialog.getByText('密钥设置失败——密码登录可能已关闭')).toBeVisible();
  await expect(dialog.getByText(/或在 SSH 服务下次重启后关闭/)).toBeVisible();
  await expect(dialog.getByText(/新密钥已为该主机保存/)).toBeVisible();
  await expect(dialog.getByText('sudo sshd -T | grep -i passwordauthentication')).toBeVisible();
  await expect(dialog.getByText(/请用最新的/)).toBeVisible();
  await expect(dialog.getByText('Failed to disable password authentication: timeout')).toBeVisible();
  await expect(dialog.getByText('密码登录未被更改。')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '打开终端' })).toBeVisible();
  await expect(dialog.getByText('关闭', { exact: true })).toBeVisible();

  // The reload picked up the saved key, so the card stops offering key setup.
  await expect(page.getByTitle('已配置密钥认证')).toBeVisible();
  await expect(page.getByRole('button', { name: '为 pw-host 配置 SSH 密钥' })).toHaveCount(0);
});

test('a rollback says password login was turned back on', async ({ page }) => {
  await boot(page, 'rollback');
  await confirmSetup(page);

  const dialog = page.getByRole('dialog', { name: '密钥设置' });
  await expect(dialog.getByText('密码登录已重新开启')).toBeVisible();
  await expect(dialog.getByText(/关闭密码登录之后的某个步骤失败/)).toBeVisible();
  await expect(dialog.getByText(/已从备份恢复服务器的\s+SSH 设置/)).toBeVisible();
  await expect(dialog.getByText(/停止工作/)).toHaveCount(0);
  await expect(
    dialog.getByText('原因：Final verification failed after disabling password. Attempting rollback.')
  ).toBeVisible();
});

// The core's step descriptions stay English on the wire (real boundary); the GUI maps
// the stable index 1..6 to Chinese. Manual mode parks the run so each step is fired and
// asserted one at a time — no timers, no auto-advance.
test('the panel starts at connecting, then each core step reads in Chinese with its index', async ({ page }) => {
  await boot(page, 'success', { manual: true });
  await confirmSetup(page);

  const dialog = page.getByRole('dialog', { name: '密钥设置' });
  await expect(dialog.getByText('正在连接…', { exact: true })).toBeVisible();
  await expect(dialog.getByText('0/6', { exact: true })).toBeVisible();
  expect(await startCalls(page)).toBe(1);

  const EN = [
    'Generating Ed25519 key pair',
    'Copying public key to server',
    'Verifying key authentication',
    'Disabling password authentication',
    'Reloading SSH service',
    'Final verification'
  ];
  const ZH = [
    '正在生成 Ed25519 密钥对',
    '正在复制公钥到服务器',
    '正在验证密钥认证',
    '正在关闭密码认证',
    '正在重新加载 SSH 服务',
    '正在进行最终验证'
  ];
  for (let i = 0; i < 6; i++) {
    await fire(page, 'key-setup-progress', {
      hostName: 'pw-host',
      step: { index: i + 1, total: 6, description: EN[i] }
    });
    await expect(dialog.getByText(ZH[i], { exact: true })).toBeVisible();
    await expect(dialog.getByText(`${i + 1}/6`, { exact: true })).toBeVisible();
    // The raw English step name is not what the user reads.
    await expect(dialog.getByText(EN[i])).toHaveCount(0);
    await expect(dialog.getByText('正在连接…')).toHaveCount(0);
  }
});
