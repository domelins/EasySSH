<script lang="ts">
  // Minimal settings (tech-gui.md §4.3): the light/dark theme mirrored from the sidebar
  // (§5.1), the metric auto-refresh interval and the tray (tauri-plugin-store UI prefs),
  // and the update preferences (`check_on_startup`) + a manual update check. Update prefs
  // persist to the shared config via `save_update_config`; the rest are frontend prefs.
  import { onMount } from 'svelte';
  import type { UpdateConfigDto } from '$lib/bindings';
  import { Surface, Icon } from '$lib/theme';
  import { theme, THEME_OPTIONS, type Theme } from '$lib/stores/theme';
  import { terminalFont, FAMILY_OPTIONS, SIZE_OPTIONS } from '$lib/stores/font';
  import { uiFontSize, UI_SIZE_OPTIONS } from '$lib/stores/uiFontSize';
  import Select from '$lib/components/Select.svelte';
  import { streamerMode } from '$lib/stores/streamer';
  import { refreshInterval, REFRESH_OPTIONS } from '$lib/stores/settings';
  import { traySupport, trayBehavior } from '$lib/stores/tray';
  import { confirmQuit } from '$lib/stores/quit';
  import { isMac } from '$lib/platform';
  import { offerUpdate } from '$lib/stores/update';
  import { lastError } from '$lib/stores/notifications';
  import { checkUpdate, loadUpdateConfig, saveUpdateConfig } from '$lib/ipc/commands';
  import { installedVersion } from '$lib/ipc/appInfo';

  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const formatInterval = (secs: number): string => (secs < 60 ? `${secs} 秒` : `${secs / 60} 分`);

  let updateConfig = $state<UpdateConfigDto | null>(null);
  let version = $state<string | null>(null);
  type CheckState =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'upToDate' }
    | { kind: 'available'; version: string }
    | { kind: 'error'; message: string };
  let check = $state<CheckState>({ kind: 'idle' });

  onMount(async () => {
    // Not awaited, so the update prefs never wait on it; a failed read leaves the row out.
    installedVersion().then((v) => (version = v), () => {});
    try {
      updateConfig = await loadUpdateConfig();
    } catch (e) {
      lastError.set(message(e));
    }
  });

  // Persist immediately; revert the optimistic flip if the write fails. Read-modify-write
  // fresh rather than from the mount-time cache: the update banner may have written a
  // `skipVersion` out-of-band, and `save_update_config` replaces the whole [update]
  // section — writing a stale copy would clobber that skip.
  async function toggleCheckOnStartup(): Promise<void> {
    if (!updateConfig) return;
    const previous = updateConfig;
    const desired = !previous.checkOnStartup;
    updateConfig = { ...previous, checkOnStartup: desired };
    try {
      const current = await loadUpdateConfig();
      const next = { ...current, checkOnStartup: desired };
      await saveUpdateConfig(next);
      updateConfig = next;
    } catch (e) {
      updateConfig = previous;
      lastError.set(message(e));
    }
  }

  async function checkNow(): Promise<void> {
    check = { kind: 'checking' };
    try {
      const info = await checkUpdate();
      if (info) {
        offerUpdate(info); // raise the banner too
        check = { kind: 'available', version: info.version };
      } else {
        check = { kind: 'upToDate' };
      }
    } catch (e) {
      check = { kind: 'error', message: message(e) };
    }
  }

  const seg =
    'rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const segState = (active: boolean): string =>
    active ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface-inset hover:text-fg';
  const fontField =
    'rounded-lg bg-surface-inset px-3 py-1.5 text-sm text-fg outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-focus';
</script>

<section class="mx-auto min-h-full max-w-2xl p-6">
  <h1 class="mb-5 text-lg font-semibold tracking-tight">设置</h1>

  <div class="space-y-4">
    <!-- Appearance -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">外观</h2>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm">主题</p>
          <p class="text-xs text-muted">与顶部栏的切换保持一致。</p>
        </div>
        <Select
          value={$theme}
          class="{fontField} w-44"
          aria-label="主题"
          onchange={(e) => theme.set(e.currentTarget.value as Theme)}
        >
          {#each THEME_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </Select>
      </div>
      <div class="mt-4 flex items-center justify-between gap-4">
        <div>
          <p class="text-sm">终端字体</p>
          <p class="text-xs text-muted">字体族与大小；应用于所有已打开的终端。</p>
        </div>
        <div class="flex items-center gap-2">
          <Select
            value={$terminalFont.family}
            class="{fontField} w-44"
            aria-label="终端字体族"
            onchange={(e) => terminalFont.setFamily(e.currentTarget.value)}
          >
            {#each FAMILY_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </Select>
          <Select
            value={String($terminalFont.size)}
            class="{fontField} w-24"
            aria-label="终端字体大小"
            onchange={(e) => terminalFont.setSize(Number(e.currentTarget.value))}
          >
            {#each SIZE_OPTIONS as size (size)}
              <option value={String(size)}>{size}px</option>
            {/each}
          </Select>
        </div>
      </div>
      <div class="mt-4 flex items-center justify-between gap-4">
        <div>
          <p class="text-sm">界面字体大小</p>
          <p class="text-xs text-muted">缩放整个界面；终端字体单独设置。</p>
        </div>
        <Select
          value={String($uiFontSize)}
          class="{fontField} w-24"
          aria-label="界面字体大小"
          onchange={(e) => uiFontSize.set(Number(e.currentTarget.value))}
        >
          {#each UI_SIZE_OPTIONS as size (size)}
            <option value={String(size)}>{size}px</option>
          {/each}
        </Select>
      </div>
    </Surface>

    <!-- Privacy -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">隐私</h2>
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm">直播模式</p>
          <p class="text-xs text-muted">
            用逼真的假地址遮盖主机地址，录制时真实 IP 不会出现在屏幕上。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={$streamerMode}
          aria-label="直播模式"
          onclick={() => streamerMode.toggle()}
          class="relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {$streamerMode
            ? 'bg-accent'
            : 'bg-surface-inset'}"
        >
          <span
            class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {$streamerMode
              ? 'left-[1.375rem]'
              : 'left-0.5'}"
          ></span>
        </button>
      </div>
    </Surface>

    <!-- Dashboard -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">仪表盘</h2>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm">自动刷新间隔</p>
          <p class="text-xs text-muted">仪表盘强制刷新指标的频率。</p>
        </div>
        <div class="flex flex-wrap justify-end gap-1 rounded-xl bg-surface-inset p-1">
          {#each REFRESH_OPTIONS as secs (secs)}
            <button
              type="button"
              class="{seg} tabular-nums {segState($refreshInterval === secs)}"
              aria-pressed={$refreshInterval === secs}
              onclick={() => refreshInterval.set(secs)}
            >
              {formatInterval(secs)}
            </button>
          {/each}
        </div>
      </div>
    </Surface>

    <!-- Window: the tray keeps sessions and tunnels up with no window on screen. macOS
         has no minimize event to act on, and keeps minimized windows in the Dock. -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">窗口</h2>
      <div class="space-y-4">
        {#if !isMac}
          {@render traySwitch(
            '最小化到托盘',
            $traySupport.available && !$traySupport.minimize
              ? 'Wayland 上不可用，它不会通知应用窗口已被最小化。'
              : '最小化会隐藏窗口；点击托盘图标可将其恢复。',
            $trayBehavior.minimizeToTray && $traySupport.minimize,
            $traySupport.minimize,
            () => trayBehavior.update({ minimizeToTray: !$trayBehavior.minimizeToTray })
          )}
        {/if}
        {@render traySwitch(
          isMac ? '关闭到菜单栏' : '关闭到托盘',
          '关闭窗口后 OmnySSH 继续运行——终端、传输和隧道保持连接。可通过图标退出。',
          $trayBehavior.closeToTray && $traySupport.available,
          $traySupport.available,
          () => trayBehavior.update({ closeToTray: !$trayBehavior.closeToTray })
        )}
        {#if !$traySupport.available}
          <p class="text-xs text-status-warn">
            当前桌面没有系统托盘，窗口将按常规方式关闭和最小化。
          </p>
        {:else if $trayBehavior.minimizeToTray || $trayBehavior.closeToTray}
          <!-- Some desktops keep tray icons out of sight (GNOME without the AppIndicator
               extension, an overflow menu); a second launch always finds the window. -->
          <p class="text-xs text-muted">
            找不到图标？再次打开 OmnySSH 即可恢复窗口。
          </p>
        {/if}
        {@render traySwitch(
          '退出前询问',
          '当仍有终端、传输、隧道或命令片段在运行时。',
          $confirmQuit,
          true,
          () => confirmQuit.toggle()
        )}
      </div>
    </Surface>

    <!-- Updates -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">更新</h2>
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm">启动时检查更新</p>
            <p class="text-xs text-muted">应用启动时查找新版本。</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={updateConfig?.checkOnStartup ?? false}
            aria-label="启动时检查更新"
            disabled={!updateConfig}
            onclick={toggleCheckOnStartup}
            class="relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {updateConfig?.checkOnStartup
              ? 'bg-accent'
              : 'bg-surface-inset'}"
          >
            <span
              class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {updateConfig?.checkOnStartup
                ? 'left-[1.375rem]'
                : 'left-0.5'}"
            ></span>
          </button>
        </div>

        <div class="flex items-center justify-between gap-4 border-t border-default pt-4">
          <div class="min-w-0">
            <p class="text-sm">手动检查</p>
            <p class="text-xs text-muted">
              {#if check.kind === 'checking'}正在检查…
              {:else if check.kind === 'upToDate'}已是最新版本。
              {:else if check.kind === 'available'}有新版本 {check.version} 可用。
              {:else if check.kind === 'error'}{check.message}
              {:else}在 GitHub 上查找新版本。
              {/if}
            </p>
          </div>
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-strong px-4 py-1.5 text-sm text-fg transition hover:bg-accent hover:text-accent-fg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            disabled={check.kind === 'checking'}
            onclick={checkNow}
          >
            <Icon name="refresh" size={14} />
            立即检查
          </button>
        </div>
      </div>
    </Surface>

    <!-- About: selectable, so the version can be pasted into a bug report -->
    {#if version}
      <Surface class="p-5">
        <h2 class="mb-3 text-sm font-semibold">关于</h2>
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm">版本</p>
          <p class="select-text text-sm tabular-nums text-muted">{version}</p>
        </div>
      </Surface>
    {/if}
  </div>
</section>

{#snippet traySwitch(
  label: string,
  hint: string,
  on: boolean,
  enabled: boolean,
  toggle: () => void
)}
  <div class="flex items-center justify-between gap-4">
    <div class="min-w-0">
      <p class="text-sm">{label}</p>
      <p class="text-xs text-muted">{hint}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={!enabled}
      onclick={toggle}
      class="relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {on
        ? 'bg-accent'
        : 'bg-surface-inset'}"
    >
      <span
        class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {on
          ? 'left-[1.375rem]'
          : 'left-0.5'}"
      ></span>
    </button>
  </div>
{/snippet}
