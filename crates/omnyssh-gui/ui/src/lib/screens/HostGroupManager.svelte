<script lang="ts">
  import { onMount } from 'svelte';
  import type { HostDto } from '$lib/bindings';
  import Modal from '$lib/components/Modal.svelte';
  import { Button, Icon } from '$lib/theme';
  import { displayHostname, maskText, streamerMode } from '$lib/stores/streamer';
  import {
    deleteHostGroup,
    hasHostGroup,
    normalizeHostGroups,
    renameHostGroup,
    setHostGroupMembership,
    validateHostGroupName
  } from './hostGroups';

  let {
    hosts,
    groupNames,
    onSave,
    onCancel
  }: {
    hosts: HostDto[];
    groupNames: readonly string[];
    onSave: (groupNames: string[], hosts: HostDto[]) => Promise<void>;
    onCancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let draftHosts = $state<HostDto[]>(hosts.map((host) => ({ ...host, tags: [...host.tags] })));
  // svelte-ignore state_referenced_locally
  let groups = $state<string[]>(normalizeHostGroups([...groupNames, ...hosts.flatMap((host) => host.tags)]));
  // svelte-ignore state_referenced_locally
  let selectedGroup = $state<string | null>(groups[0] ?? null);
  let newGroup = $state('');
  let renameOriginal = $state<string | null>(null);
  let renameValue = $state('');
  let error = $state<string | null>(null);
  let saving = $state(false);
  let newGroupEl = $state<HTMLInputElement>();

  const sortedGroups = $derived([...groups].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
  const importedCount = $derived(draftHosts.filter((host) => host.source === 'sshConfig').length);

  onMount(() => newGroupEl?.focus());

  function memberCount(group: string): number {
    return draftHosts.filter((host) => hasHostGroup(host, group)).length;
  }

  function selectGroup(group: string): void {
    selectedGroup = group;
    renameOriginal = null;
    error = null;
  }

  function createGroup(): void {
    const name = newGroup.trim();
    const problem = validateHostGroupName(name, groups);
    if (problem) {
      error = problem;
      return;
    }
    groups = [...groups, name];
    selectedGroup = name;
    newGroup = '';
    renameOriginal = null;
    error = null;
  }

  function startRename(group: string): void {
    selectedGroup = group;
    renameOriginal = group;
    renameValue = group;
    error = null;
  }

  function applyRename(): void {
    if (!renameOriginal) return;
    const name = renameValue.trim();
    const problem = validateHostGroupName(name, groups, renameOriginal);
    if (problem) {
      error = problem;
      return;
    }
    draftHosts = renameHostGroup(draftHosts, renameOriginal, name);
    groups = groups.map((group) => (group === renameOriginal ? name : group));
    selectedGroup = name;
    renameOriginal = null;
    error = null;
  }

  function removeGroup(group: string): void {
    draftHosts = deleteHostGroup(draftHosts, group);
    groups = groups.filter((item) => item !== group);
    if (selectedGroup === group) selectedGroup = sortedGroups.find((item) => item !== group) ?? null;
    if (renameOriginal === group) renameOriginal = null;
    error = null;
  }

  function toggleHost(index: number, member: boolean): void {
    if (!selectedGroup) return;
    draftHosts = draftHosts.map((host, hostIndex) =>
      hostIndex === index ? setHostGroupMembership(host, selectedGroup!, member) : host
    );
    error = null;
  }

  async function save(): Promise<void> {
    saving = true;
    error = null;
    try {
      await onSave(normalizeHostGroups(groups), draftHosts);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal label="主机分组" backdropCloses={!saving} onClose={() => !saving && onCancel()}>
  <div class="flex min-h-0 flex-col">
    <header class="border-b border-default px-5 py-3.5">
      <h2 class="text-sm font-semibold">主机分组</h2>
      <p class="mt-1 text-xs text-muted">创建分组并勾选成员；一台主机可以属于多个分组。</p>
    </header>

    <div class="grid h-[22rem] min-h-0 grid-cols-[10rem,1fr]">
      <section class="flex min-h-0 flex-col border-r border-default" aria-label="分组列表">
        <form
          class="flex shrink-0 gap-1 border-b border-default p-2"
          onsubmit={(event) => {
            event.preventDefault();
            createGroup();
          }}
        >
          <input
            bind:this={newGroupEl}
            bind:value={newGroup}
            class="min-w-0 flex-1 rounded-md bg-surface-inset px-2 py-1.5 text-xs text-fg outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-focus"
            placeholder="新分组名称"
            aria-label="新分组名称"
            maxlength="40"
            disabled={saving}
          />
          <button
            type="submit"
            class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            title="创建分组"
            aria-label="创建分组"
            disabled={saving}
          ><Icon name="plus" size={13} /></button>
        </form>
        <div class="min-h-0 flex-1 overflow-y-auto p-1.5">
          {#each sortedGroups as group (group)}
            <div class="group mb-0.5 flex items-center rounded-md {selectedGroup === group ? 'bg-surface-inset text-accent' : 'text-muted hover:bg-surface-hover'}">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left text-xs"
                aria-label="选择分组 {group}"
                aria-pressed={selectedGroup === group}
                onclick={() => selectGroup(group)}
              >
                <Icon name="folder" size={12} />
                <span class="min-w-0 flex-1 truncate" title={group}>{group}</span>
                <span class="text-[0.625rem] text-faint">{memberCount(group)}</span>
              </button>
              <div class="mr-1 flex shrink-0">
                <button type="button" class="grid h-6 w-5 place-items-center rounded text-faint hover:text-fg" title="重命名分组 {group}" aria-label="重命名分组 {group}" disabled={saving} onclick={() => startRename(group)}>
                  <Icon name="edit" size={11} />
                </button>
                <button type="button" class="grid h-6 w-5 place-items-center rounded text-faint hover:text-status-crit" title="删除分组 {group}" aria-label="删除分组 {group}" disabled={saving} onclick={() => removeGroup(group)}>
                  <Icon name="trash" size={11} />
                </button>
              </div>
            </div>
          {:else}
            <p class="px-2 py-6 text-center text-[0.6875rem] text-faint">先创建一个分组</p>
          {/each}
        </div>
      </section>

      <section class="flex min-h-0 flex-col" aria-label="分组成员">
        <div class="shrink-0 border-b border-default px-3 py-2">
          {#if selectedGroup && renameOriginal === selectedGroup}
            <form
              class="flex items-center gap-1"
              onsubmit={(event) => {
                event.preventDefault();
                applyRename();
              }}
            >
              <input bind:value={renameValue} class="min-w-0 flex-1 rounded-md bg-surface-inset px-2 py-1.5 text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label="分组名称" maxlength="40" disabled={saving} />
              <button type="submit" class="rounded-md px-2 py-1.5 text-[0.6875rem] text-accent hover:bg-surface-inset" disabled={saving}>保存名称</button>
              <button type="button" class="rounded-md px-1.5 py-1.5 text-[0.6875rem] text-muted hover:bg-surface-inset" onclick={() => (renameOriginal = null)}>取消</button>
            </form>
          {:else if selectedGroup}
            <div class="flex items-center gap-2">
              <h3 class="min-w-0 flex-1 truncate text-xs font-medium">{selectedGroup}</h3>
              <span class="text-[0.625rem] text-faint">{memberCount(selectedGroup)} 台主机</span>
            </div>
            <p class="mt-1 text-[0.625rem] text-faint">勾选加入，取消勾选移出。</p>
          {:else}
            <p class="py-2 text-center text-xs text-faint">选择或创建一个分组</p>
          {/if}
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          {#if selectedGroup}
            {#each draftHosts as host, index (`${host.name}:${host.hostname}:${index}`)}
              <label class="mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-surface-hover">
                <input
                  type="checkbox"
                  class="shrink-0 accent-[var(--accent)]"
                  checked={hasHostGroup(host, selectedGroup)}
                  aria-label="{host.name} 属于 {selectedGroup}"
                  disabled={saving}
                  onchange={(event) => toggleHost(index, event.currentTarget.checked)}
                />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5">
                    <span class="truncate text-xs font-medium text-fg">{host.name}</span>
                    {#if host.source === 'sshConfig'}<span class="rounded border border-default px-1 text-[0.5625rem] text-faint">ssh config</span>{/if}
                  </span>
                  <span class="mt-0.5 block truncate font-mono text-[0.625rem] text-faint">{host.user}@{displayHostname(host.hostname, $streamerMode)}:{host.port}</span>
                </span>
              </label>
            {/each}
            {#if draftHosts.length === 0}<p class="py-8 text-center text-xs text-faint">还没有主机</p>{/if}
          {/if}
        </div>
      </section>
    </div>

    <div class="shrink-0 border-t border-default px-5 py-3">
      {#if importedCount > 0}
        <p class="mb-2 text-[0.625rem] leading-relaxed text-faint">SSH config 主机保存分组后会变成本地副本，原 SSH 配置文件不会被修改。</p>
      {/if}
      {#if error}<p class="mb-2 text-xs text-status-crit" role="alert">{$maskText(error)}</p>{/if}
      <div class="flex items-center justify-between gap-3">
        <p class="text-[0.625rem] text-faint">删除分组不会删除主机。保存后显示分组树。</p>
        <div class="flex shrink-0 gap-2">
          <Button variant="ghost" disabled={saving} onclick={onCancel}>取消</Button>
          <Button variant="primary" disabled={saving} onclick={save}>{saving ? '保存中…' : '保存分组'}</Button>
        </div>
      </div>
    </div>
  </div>
</Modal>
