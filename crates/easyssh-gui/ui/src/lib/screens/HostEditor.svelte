<script lang="ts">
  // Add/edit host form (tech-gui.md §4.1). Always writes a manual entry: editing an
  // SSH-config import adopts it, leaving ~/.ssh/config untouched. Validation mirrors the TUI via
  // `formToInput`; on submit the parent persists + reloads, and a rejected save
  // surfaces inline without closing. Semantic tokens only.
  import { onMount, tick } from 'svelte';
  import type { HostInputDto } from '$lib/bindings';
  import { Button, Icon } from '$lib/theme';
  import Modal from '$lib/components/Modal.svelte';
  import Select from '$lib/components/Select.svelte';
  import { isWindows } from '$lib/platform';
  import { maskAddress, maskHostname, maskText, streamerMode } from '$lib/stores/streamer';
  import { bracketed, emptyForwardRow, formToInput, tagsOf, toggleTag, type HostFormFields } from './hostForm';

  let {
    mode,
    initial,
    previousName,
    imported = false,
    groups = [],
    onSubmit,
    onCancel
  }: {
    mode: 'add' | 'edit';
    initial: HostFormFields;
    previousName?: string;
    /** Editing an `~/.ssh/config` import, so the save is an adoption — say so. */
    imported?: boolean;
    /** Known group names, offered as one-click chips (a group is a tag, §4.1). */
    groups?: string[];
    onSubmit: (input: HostInputDto, previousName: string | undefined) => Promise<void>;
    onCancel: () => void;
  } = $props();

  // Seeded once from `initial`; the editor is remounted per open, so the prop never
  // changes under a live instance.
  // svelte-ignore state_referenced_locally
  let fields = $state<HostFormFields>({ ...initial });
  let error = $state<string | null>(null);
  let saving = $state(false);
  let nameEl = $state<HTMLInputElement>();
  let hostnameEl = $state<HTMLInputElement>();
  let userEl = $state<HTMLInputElement>();
  let localEls = $state<HTMLInputElement[]>([]);

  // In streamer mode an address present when the form opened shows its disguise,
  // read-only, until Reveal; a reveal lasts while this form is open (it is remounted per
  // open) and streamer mode stays on. What the user adds or types is theirs and stays
  // editable, so a field never turns read-only under their cursor, even when the mode is
  // switched on mid-edit. A field the disguise leaves as is (a bare port, localhost) is
  // not held, so editing it never takes a Reveal.
  let revealed = $state(false);
  const hide = $derived($streamerMode && !revealed);
  $effect(() => {
    if (!$streamerMode) revealed = false;
  });
  // svelte-ignore state_referenced_locally
  let heldHostname = $state(maskHostname(initial.hostname) !== initial.hostname);
  // Parallel to `fields.forwards`.
  // svelte-ignore state_referenced_locally
  let heldRows = $state(
    initial.forwards.map((r) => ({
      local: maskListen(r.local) !== r.local,
      remote: maskAddress(r.remoteHost) !== r.remoteHost
    }))
  );
  const hostnameMasked = $derived(hide && heldHostname);
  const firstHeldRow = $derived(heldRows.findIndex((r) => r.local || r.remote));

  async function reveal(target: () => HTMLInputElement | undefined): Promise<void> {
    revealed = true;
    await tick();
    target()?.focus();
  }

  /** The tag list a form's text field stands for. */
  function hasGroup(group: string): boolean {
    return tagsOf(fields.tags).includes(group);
  }

  /** Fold a chip toggle back into the tag text, keeping any hand-typed tag. */
  function toggleGroup(group: string): void {
    fields = { ...fields, tags: toggleTag(fields.tags, group) };
  }

  /** Known groups plus anything already typed, so every tag is a chip too. */
  const groupChoices = $derived(
    [...new Set([...groups, ...tagsOf(fields.tags)])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  );

  /** `[address:]port` with the address disguised, as the card shows a forward. */
  function maskListen(raw: string): string {
    const i = raw.lastIndexOf(':');
    if (i < 0) return raw;
    return `${bracketed(maskAddress(raw.slice(0, i).replace(/^\[(.*)\]$/, '$1')))}${raw.slice(i)}`;
  }

  onMount(() => nameEl?.focus());

  async function save(): Promise<void> {
    const result = formToInput(fields);
    if (!result.ok) {
      error = result.error;
      return;
    }
    error = null;
    saving = true;
    try {
      await onSubmit(result.input, previousName);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  // On edit the DTO omits identity/password (§3.4), so the fields start blank and mean
  // "keep the stored value"; on add they mean "none".
  const secretHint = $derived(mode === 'edit' ? '留空则保留当前值' : undefined);

  const label = 'block space-y-1 text-xs font-medium text-muted';
  const forwardGrid = 'grid grid-cols-[8.5rem,1fr,4.5rem,1.75rem] items-center gap-2';
  const smallBtn =
    'inline-flex items-center gap-1 rounded-full border border-default px-2 py-0.5 text-xs text-muted transition ' +
    'hover:border-strong hover:bg-accent hover:text-accent-fg ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const field =
    'w-full rounded-lg bg-surface-inset px-3 py-2 text-sm text-fg outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-focus placeholder:text-faint';
  const maskedField = 'cursor-default text-muted';
</script>

<Modal label={mode === 'add' ? '添加主机' : '编辑主机'} onClose={onCancel}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
    class="flex min-h-0 flex-col"
  >
    <header class="border-b border-default px-5 py-3.5">
      <h2 class="text-sm font-semibold">{mode === 'add' ? '添加主机' : '编辑主机'}</h2>
    </header>

    <div class="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
      {#if imported}
        <p class="rounded-lg bg-surface-inset px-3 py-2 text-xs text-muted">
          从 <span class="font-mono">~/.ssh/config</span> 导入。保存后会在
          <span class="font-mono">hosts.toml</span> 中保留你自己的副本，EasySSH 之后将使用它 ——
          你的 SSH 配置文件不会被写入，此后对该文件的修改也不会再反映到这台主机上。
        </p>
      {/if}
      <label class={label}>
        <span>名称</span>
        <input
          bind:this={nameEl}
          bind:value={fields.name}
          class={field}
          placeholder="web-prod-1"
        />
      </label>

      <div class="flex items-end gap-2">
        <label class="{label} min-w-0 flex-1">
          <span>主机名 / IP</span>
          <input
            bind:this={hostnameEl}
            bind:value={
              () => (hostnameMasked ? maskHostname(fields.hostname) : fields.hostname),
              (v) => {
                fields.hostname = v;
                heldHostname = false;
              }
            }
            readonly={hostnameMasked}
            class="{field} font-mono {hostnameMasked ? maskedField : ''}"
            placeholder="10.0.0.1"
          />
        </label>
        {#if hostnameMasked}
          <button type="button" class="{smallBtn} mb-1.5 shrink-0" onclick={() => reveal(() => hostnameEl)}>
            显示
          </button>
        {/if}
      </div>

      <div class="grid grid-cols-[1fr,7rem] gap-3">
        <label class={label}>
          <span>用户名</span>
          <input bind:this={userEl} bind:value={fields.user} class={field} placeholder="root" />
        </label>
        <label class={label}>
          <span>端口</span>
          <input bind:value={fields.port} inputmode="numeric" class={field} placeholder="22" />
        </label>
      </div>

      <label class={label}>
        <span>密钥文件</span>
        <input
          bind:value={fields.identityFile}
          class="{field} font-mono"
          placeholder={secretHint ?? '~/.ssh/id_ed25519'}
        />
      </label>

      <label class={label}>
        <span>密码</span>
        <input
          type="password"
          bind:value={fields.password}
          class={field}
          placeholder={secretHint ?? '登录密码，不是密钥口令'}
          autocomplete="off"
        />
      </label>

      <div class="space-y-1">
        <div class={label}>
          <span>分组</span>
          <div class="rounded-lg border border-default bg-surface-inset/40 p-2" role="group" aria-label="选择分组">
            {#if groupChoices.length}
              <div class="flex flex-wrap gap-1.5">
                {#each groupChoices as group (group)}
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={hasGroup(group)}
                    aria-label="分组 {group}"
                    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {hasGroup(group)
                      ? 'border-accent bg-accent text-accent-fg'
                      : 'border-default text-muted hover:border-strong hover:text-fg'}"
                    onclick={() => toggleGroup(group)}
                  >
                    {#if hasGroup(group)}<Icon name="check" size={10} />{/if}
                    {group}
                  </button>
                {/each}
              </div>
            {:else}
              <p class="text-xs text-faint">还没有分组；在下面的“标签 / 新分组”里输入名称即可新建。</p>
            {/if}
          </div>
        </div>
        <label class={label}>
          <span>标签 / 新分组</span>
          <input
            bind:value={fields.tags}
            class={field}
            placeholder="prod, web"
            aria-describedby="host-tags-hint"
          />
        </label>
        <p id="host-tags-hint" class="text-xs text-faint">用逗号分隔；每个标签都是一个分组，一台主机可属于多个分组。</p>
      </div>

      <label class={label}>
        <span>备注</span>
        <textarea bind:value={fields.notes} rows="2" class="{field} resize-y" placeholder="可选"></textarea>
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class={label}>
          <span>监控</span>
          <Select bind:value={fields.monitoring} class={field}>
            <option value="ssh">SSH 指标</option>
            <option value="tcpPort">TCP 端口检测</option>
          </Select>
        </label>
        {#if fields.monitoring === 'tcpPort'}
          <label class={label}>
            <span>探测端口</span>
            <input
              bind:value={fields.monitorPort}
              inputmode="numeric"
              class={field}
              placeholder={fields.port || '22'}
            />
          </label>
        {/if}
      </div>
      {#if fields.monitoring === 'tcpPort'}
        <p class="text-xs text-faint">仅检测端口 —— 不登录，卡片上也不显示指标。</p>
      {/if}

      <div class="flex items-center justify-between gap-4 border-t border-default pt-3.5">
        <div class="min-w-0">
          <p class="text-sm text-fg">SSH 代理转发</p>
          <p class="text-xs text-faint">
            {#if isWindows}
              Windows 上暂不可用。
            {:else}
              这里的终端可以使用你本地代理中的密钥，如同 <span class="font-mono">ssh -A</span>
              —— 便于 sudo 或跳转登录。终端打开期间，这台服务器上任何拥有 root 权限的人都能使用这些密钥。
            {/if}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={fields.forwardAgent}
          aria-label="SSH 代理转发"
          disabled={isWindows}
          onclick={() => (fields.forwardAgent = !fields.forwardAgent)}
          class="relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 {fields.forwardAgent
            ? 'bg-accent'
            : 'bg-surface-inset'}"
        >
          <span
            class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {fields.forwardAgent
              ? 'left-[1.375rem]'
              : 'left-0.5'}"
          ></span>
        </button>
      </div>

      <!-- Port forwarding (`ssh -L`): each row listens on a local port and carries it to
           a host:port the server reaches. One tunnel per host carries every row. -->
      <div class="space-y-2 border-t border-default pt-3.5">
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs font-medium text-muted">端口转发</span>
          <div class="flex gap-2">
            {#if hide && firstHeldRow >= 0}
              <button type="button" class={smallBtn} onclick={() => reveal(() => localEls[firstHeldRow])}>
                显示
              </button>
            {/if}
            <button
              type="button"
              class={smallBtn}
              onclick={() => {
                fields.forwards.push(emptyForwardRow());
                heldRows.push({ local: false, remote: false });
              }}
            >
              <Icon name="plus" size={12} />
              添加转发
            </button>
          </div>
        </div>
        {#if fields.forwards.length}
          <div class="{forwardGrid} text-[0.6875rem] text-faint">
            <span>本地端口</span>
            <span>远程主机</span>
            <span>端口</span>
            <span></span>
          </div>
          {#each fields.forwards as row, i (i)}
            {@const localMasked = hide && heldRows[i].local}
            {@const remoteMasked = hide && heldRows[i].remote}
            <div class={forwardGrid}>
              <input
                bind:this={localEls[i]}
                bind:value={
                  () => (localMasked ? maskListen(row.local) : row.local),
                  (v) => {
                    row.local = v;
                    heldRows[i].local = false;
                  }
                }
                readonly={localMasked}
                class="{field} font-mono {localMasked ? maskedField : ''}"
                placeholder="9443"
                aria-label="转发 {i + 1} 的本地端口"
              />
              <input
                bind:value={
                  () => (remoteMasked ? maskAddress(row.remoteHost) : row.remoteHost),
                  (v) => {
                    row.remoteHost = v;
                    heldRows[i].remote = false;
                  }
                }
                readonly={remoteMasked}
                class="{field} font-mono {remoteMasked ? maskedField : ''}"
                placeholder="localhost"
                aria-label="转发 {i + 1} 的远程主机"
              />
              <input
                bind:value={row.remotePort}
                inputmode="numeric"
                class="{field} font-mono"
                placeholder="9443"
                aria-label="转发 {i + 1} 的远程端口"
              />
              <button
                type="button"
                class="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                title="移除转发 {i + 1}"
                aria-label="移除转发 {i + 1}"
                onclick={() => {
                  fields.forwards.splice(i, 1);
                  heldRows.splice(i, 1);
                }}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          {/each}
          <p class="text-xs text-faint">
            本地端口仅在本机监听 —— 写成 <span class="font-mono">0.0.0.0:8080</span>
            即可在局域网中共享。远程主机由服务器解析，因此
            <span class="font-mono">localhost</span> 指的是服务器自身。
          </p>
          <div class="flex items-center justify-between gap-4 pt-1">
            <span class="text-sm text-fg">EasySSH 打开时自动启动隧道</span>
            <button
              type="button"
              role="switch"
              aria-checked={fields.tunnelAutostart}
              aria-label="EasySSH 打开时自动启动隧道"
              onclick={() => (fields.tunnelAutostart = !fields.tunnelAutostart)}
              class="relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {fields.tunnelAutostart
                ? 'bg-accent'
                : 'bg-surface-inset'}"
            >
              <span
                class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {fields.tunnelAutostart
                  ? 'left-[1.375rem]'
                  : 'left-0.5'}"
              ></span>
            </button>
          </div>
        {:else}
          <p class="text-xs text-faint">
            通过本机的一个端口访问这台服务器上的服务 —— 数据库、Web 界面等 ——
            就像 <span class="font-mono">ssh -L</span> 一样。
          </p>
        {/if}
      </div>

      {#if error}
        <p class="text-xs text-status-crit">{$maskText(error)}</p>
      {/if}
    </div>

    <footer class="flex justify-end gap-2 border-t border-default px-5 py-3">
      <Button variant="ghost" onclick={onCancel}>取消</Button>
      <Button variant="primary" type="submit" disabled={saving}>
        {mode === 'add' ? '添加主机' : '保存'}
      </Button>
    </footer>
  </form>
</Modal>
