<script lang="ts">
  // Host import/export (tech-gui.md §4.2), one place for both file kinds: the full
  // backup is a `hosts.toml`-shaped snapshot that carries passwords in plaintext exactly
  // like the config does, so the dialog says so; OpenSSH config text has no password
  // directive. Import tells the two apart on its own and never overwrites a known name.
  import { Button, Icon } from '$lib/theme';
  import Modal from '$lib/components/Modal.svelte';
  import type { ImportSummary } from '$lib/bindings';
  import { exportHosts, exportSshConfig, importHosts, reloadHosts, type ExportScope } from '$lib/ipc/commands';

  let { onClose }: { onClose: () => void } = $props();

  type ExportFormat = 'toml' | 'ssh';
  const FORMATS: { id: ExportFormat; title: string; hint: string }[] = [
    { id: 'toml', title: '完整备份', hint: '主机 + 账号密码，可原样导回' },
    { id: 'ssh', title: 'SSH config', hint: '通用 OpenSSH 格式，仅主机配置' }
  ];

  const SCOPES: { id: ExportScope; title: string; hint: string; file: string }[] = [
    { id: 'both', title: '完整快照（含密码）', hint: '配置 + 凭据', file: 'omnyssh-hosts.toml' },
    { id: 'config', title: '仅连接配置（不含密码）', hint: '地址、端口、用户名等连接配置', file: 'omnyssh-hosts-config.toml' },
    { id: 'credentials', title: '仅凭据（用户名 + 密码）', hint: '不含地址与连接配置', file: 'omnyssh-credentials.toml' }
  ];

  let file = $state<File | null>(null);
  let importing = $state(false);
  let exporting = $state(false);
  let syncing = $state(false);
  let synced = $state(false);
  let exported = $state<string | null>(null);
  let summary = $state<ImportSummary | null>(null);
  let errorText = $state<string | null>(null);
  let copied = $state(false);
  let exportFormat = $state<ExportFormat>('toml');
  let exportScope = $state<ExportScope>('both');
  const scopeFile = $derived(SCOPES.find((scope) => scope.id === exportScope)!.file);

  function onScopeKey(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1
      : 0;
    if (!step) return;
    event.preventDefault();
    const index = SCOPES.findIndex((scope) => scope.id === exportScope);
    const next = (index + step + SCOPES.length) % SCOPES.length;
    exportScope = SCOPES[next].id;
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function pick(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
    summary = null;
    errorText = null;
  }

  async function runImport(): Promise<void> {
    if (!file || importing) return;
    importing = true;
    errorText = null;
    summary = null;
    try {
      summary = await importHosts(await file.text());
      await reloadHosts();
    } catch (error) {
      errorText = message(error);
    } finally {
      importing = false;
    }
  }

  /** Re-reads `hosts.toml` and `~/.ssh/config` from this machine. */
  async function runSync(): Promise<void> {
    if (syncing) return;
    syncing = true;
    synced = false;
    errorText = null;
    try {
      await reloadHosts();
      synced = true;
    } catch (error) {
      errorText = message(error);
    } finally {
      syncing = false;
    }
  }

  /** The save dialog's path, `null` when the user cancels, `undefined` when there is no
   *  dialog here (the tests, or a platform without one) — the backend then uses its
   *  downloads-folder default. */
  async function chooseExportPath(): Promise<string | null | undefined> {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      return await save(
        exportFormat === 'toml'
          ? {
              title: '导出主机到…',
              defaultPath: scopeFile,
              filters: [{ name: 'EasySSH 主机', extensions: ['toml'] }]
            }
          : {
              title: '导出 SSH config 到…',
              defaultPath: 'omnyssh-ssh-config.conf',
              filters: [{ name: 'SSH config', extensions: ['conf', 'txt'] }]
            }
      );
    } catch {
      return undefined;
    }
  }

  async function runExport(): Promise<void> {
    if (exporting) return;
    exporting = true;
    errorText = null;
    exported = null;
    try {
      const chosen = await chooseExportPath();
      if (chosen === null) return; // the dialog was dismissed: nothing to write
      exported =
        exportFormat === 'toml'
          ? await exportHosts(chosen ?? null, exportScope)
          : await exportSshConfig(chosen ?? null);
    } catch (error) {
      errorText = message(error);
    } finally {
      exporting = false;
    }
  }

  async function copyPath(): Promise<void> {
    if (!exported) return;
    try {
      await navigator.clipboard.writeText(exported);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch (error) {
      errorText = message(error);
    }
  }

  const quietButton =
    'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-default px-3 text-xs text-muted transition hover:border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-within:ring-2 focus-within:ring-focus disabled:cursor-not-allowed disabled:opacity-60';
</script>

<Modal label="导入 / 导出主机" wide onClose={onClose}>
  <div class="flex items-start gap-3 border-b border-default px-5 py-4">
    <div class="min-w-0 flex-1">
      <h2 class="text-sm font-semibold">导入 / 导出主机</h2>
      <p class="mt-0.5 text-xs text-muted">主机配置与登录账号密码在这里一起迁移。</p>
    </div>
    <button
      type="button"
      class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      title="关闭"
      aria-label="关闭"
      onclick={onClose}
    >
      <Icon name="close" size={14} />
    </button>
  </div>

  <div class="grid gap-x-6 gap-y-5 overflow-y-auto p-5 md:grid-cols-2">
    <section class="flex min-w-0 flex-col gap-3" aria-labelledby="transfer-import">
      <h3 id="transfer-import" class="flex items-center gap-1.5 text-xs font-semibold">
        <Icon name="download" size={13} /> 导入
      </h3>
      <p class="text-xs text-muted">
        完整备份和 SSH config 文件都能导入，格式自动识别；已有的同名主机会跳过，不会覆盖。
      </p>
      <div class="flex items-center gap-2">
        <label class={quietButton}>
          <Icon name="file" size={12} />
          选择文件
          <input
            type="file"
            accept=".toml,.txt,.conf,text/plain"
            class="sr-only"
            aria-label="选择主机文件"
            onchange={pick}
          />
        </label>
        <span class="min-w-0 flex-1 truncate text-xs {file ? 'text-fg' : 'text-faint'}" title={file?.name}>
          {file?.name ?? '未选择文件'}
        </span>
        <Button variant="primary" size="sm" disabled={!file || importing} onclick={runImport}>
          {importing ? '导入中…' : '导入'}
        </Button>
      </div>
      {#if summary}
        <div class="rounded-lg bg-surface-inset px-3 py-2 text-xs text-muted">
          <p>新增 {summary.added} 台，跳过 {summary.skipped} 台（已存在），失败 {summary.failed} 台。</p>
          {#each summary.errors as line (line)}
            <p class="mt-1 text-status-crit">{line}</p>
          {/each}
        </div>
      {/if}

      <div class="mt-auto flex items-center gap-2 border-t border-default pt-3">
        <p class="min-w-0 flex-1 text-xs text-muted">
          重新读取本机的 <span class="font-mono">~/.ssh/config</span>
        </p>
        <button
          type="button"
          class={quietButton}
          aria-label="导入 SSH config"
          disabled={syncing}
          onclick={runSync}
        >
          {#if synced && !syncing}
            <Icon name="check" size={12} /> 已同步
          {:else}
            <span class="inline-flex" class:animate-spin={syncing}><Icon name="refresh" size={12} /></span>
            {syncing ? '同步中…' : '同步'}
          {/if}
        </button>
      </div>
    </section>

    <section
      class="flex min-w-0 flex-col gap-3 border-t border-default pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0"
      aria-labelledby="transfer-export"
    >
      <h3 id="transfer-export" class="flex items-center gap-1.5 text-xs font-semibold">
        <Icon name="upload" size={13} /> 导出
      </h3>
      <div class="grid gap-2" role="group" aria-label="导出格式">
        {#each FORMATS as format (format.id)}
          {@const on = exportFormat === format.id}
          <button
            type="button"
            aria-label={format.title}
            aria-describedby="transfer-format-{format.id}"
            aria-pressed={on}
            class="flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {on
              ? 'border-accent bg-surface-inset'
              : 'border-default hover:border-strong'}"
            onclick={() => (exportFormat = format.id)}
          >
            <span
              class="grid h-4 w-4 shrink-0 place-items-center rounded-full border {on
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-strong text-transparent'}"
            >
              <Icon name="check" size={10} />
            </span>
            <span class="min-w-0">
              <span class="block text-xs font-medium text-fg">{format.title}</span>
              <span id="transfer-format-{format.id}" class="block text-[0.6875rem] text-muted">{format.hint}</span>
            </span>
          </button>
        {/each}
      </div>
      {#if exportFormat === 'toml'}
        <div
          class="grid gap-1.5"
          role="radiogroup"
          aria-label="导出范围"
          tabindex="-1"
          onkeydown={onScopeKey}
        >
          {#each SCOPES as scope (scope.id)}
            {@const on = exportScope === scope.id}
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={scope.title}
              aria-describedby="transfer-scope-{scope.id}"
              tabindex={on ? 0 : -1}
              class="flex items-center gap-2.5 rounded-lg border px-3 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {on
                ? 'border-accent bg-surface-inset'
                : 'border-default hover:border-strong'}"
              onclick={() => (exportScope = scope.id)}
            >
              <span
                class="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border {on
                  ? 'border-accent'
                  : 'border-strong'}"
              >
                <span class="h-1.5 w-1.5 rounded-full {on ? 'bg-accent' : 'bg-transparent'}"></span>
              </span>
              <span class="min-w-0">
                <span class="block text-xs font-medium text-fg">{scope.title}</span>
                <span id="transfer-scope-{scope.id}" class="block text-[0.6875rem] text-muted">{scope.hint}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
      <p class="text-xs text-muted">
        {#if exportFormat === 'ssh'}
          <span class="text-status-warn">不含密码</span>，标签、备注和监控设置也不会导出。
        {:else if exportScope === 'config'}
          <span class="text-status-warn">不含密码</span>，只导出连接配置。
        {:else if exportScope === 'credentials'}
          文件<span class="text-status-warn">包含明文登录密码</span>（用户名 + 密码），请妥善保管。
        {:else}
          文件<span class="text-status-warn">包含明文登录密码</span>，请妥善保管。
        {/if}
      </p>
      {#if exportFormat === 'toml' && exportScope === 'both'}
        <p class="text-xs font-medium text-status-warn" role="note">含明文密码，请妥善保管</p>
      {/if}
      <div class="mt-auto flex items-center gap-2 border-t border-default pt-3">
        {#if exported}
          <span class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted" title={exported}>{exported}</span>
          <button
            type="button"
            class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint transition hover:bg-surface-inset hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            title="复制路径"
            aria-label="复制导出路径"
            onclick={copyPath}
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} />
          </button>
        {:else}
          <span class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-faint">
            {exportFormat === 'toml' ? scopeFile : 'omnyssh-ssh-config.conf'}
          </span>
        {/if}
        <Button variant="primary" size="sm" disabled={exporting} onclick={runExport}>
          {exporting ? '导出中…' : '导出…'}
        </Button>
      </div>
    </section>
  </div>

  {#if errorText}
    <p class="mx-5 mb-5 rounded-lg bg-surface-inset px-3 py-2 text-xs text-status-crit">{errorText}</p>
  {/if}
</Modal>
