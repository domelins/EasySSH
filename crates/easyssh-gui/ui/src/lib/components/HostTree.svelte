<script lang="ts">
  import type { HostDto } from '$lib/bindings';
  import { Icon, StatusDot } from '$lib/theme';
  import { sidebarCollapsed } from '$lib/stores/ui';
  import { dashboardView } from '$lib/stores/dashboardView';
  import { statuses } from '$lib/stores/statuses';
  import { sessionStatusDot } from '$lib/stores/sessions';
  import { spawnSession } from '$lib/stores/navigation';
  import { hostTagGroups, type HostCollection } from '$lib/screens/hostExplorer';
  import { validateHostGroupName } from '$lib/screens/hostGroups';

  let {
    hosts,
    groupNames,
    query,
    collection,
    selectedTag,
    selectedHostKey,
    hostKey,
    onCollection,
    onTag,
    onHost,
    onManageGroups,
    onRenameGroup,
    onDeleteGroup
  }: {
    hosts: HostDto[];
    groupNames: readonly string[];
    query: string;
    collection: HostCollection;
    selectedTag: string | null;
    selectedHostKey: string | null;
    hostKey: (host: HostDto) => string;
    onCollection: (collection: HostCollection) => void;
    onTag: (tag: string | null) => void;
    onHost: (key: string | null) => void;
    onManageGroups: () => void;
    /** Rename a group (and every host's tag that carries it). */
    onRenameGroup: (from: string, to: string) => Promise<void>;
    /** Delete a group, leaving its hosts in place. */
    onDeleteGroup: (group: string) => Promise<void>;
  } = $props();

  const groups = $derived(hostTagGroups(hosts, groupNames));
  const ungrouped = $derived(hosts.filter((host) => !host.tags.some((tag) => tag.trim())));
  const favoriteCount = $derived(hosts.filter((host) => $dashboardView.favorites.includes(hostKey(host))).length);
  const searching = $derived(query.trim().length > 0);

  // Inline group editing: one group can be renaming, one awaiting delete, at a time.
  let renaming = $state<string | null>(null);
  let renameValue = $state('');
  let confirming = $state<string | null>(null);
  let groupError = $state<string | null>(null);
  let busy = $state(false);
  let renameEl = $state<HTMLInputElement>();
  $effect(() => {
    if (renaming) renameEl?.focus();
  });

  function startRename(group: string): void {
    renaming = group;
    renameValue = group;
    confirming = null;
    groupError = null;
  }

  async function applyRename(): Promise<void> {
    if (!renaming) return;
    const name = renameValue.trim();
    const problem = validateHostGroupName(name, groups.map((group) => group.tag), renaming);
    if (problem) {
      groupError = problem;
      return;
    }
    if (name === renaming) {
      renaming = null;
      return;
    }
    busy = true;
    try {
      await onRenameGroup(renaming, name);
      renaming = null;
      groupError = null;
    } catch (error) {
      groupError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function applyDelete(group: string): Promise<void> {
    busy = true;
    try {
      await onDeleteGroup(group);
      confirming = null;
      groupError = null;
    } catch (error) {
      groupError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  const smallAction =
    'grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition hover:bg-surface-inset hover:text-fg ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';

  const row =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
</script>

<aside
  aria-label="主机浏览"
  class="flex min-h-0 flex-col overflow-hidden border-r border-default bg-surface {$sidebarCollapsed ? 'w-14' : 'w-60'}"
>
  {#if $sidebarCollapsed}
    <div class="flex flex-col items-center gap-2 py-3">
      <button
        type="button"
        class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        title="展开侧栏 (⌘B)"
        aria-label="展开侧栏"
        onclick={() => sidebarCollapsed.toggle()}
      ><Icon name="expand" size={16} /></button>
      <button type="button" class="grid h-8 w-8 place-items-center rounded-md text-accent hover:bg-surface-inset" title="全部主机" aria-label="全部主机" onclick={() => onCollection('all')}>
        <Icon name="layers" size={16} />
      </button>
      <button type="button" class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-inset hover:text-fg" title="管理主机分组" aria-label="管理主机分组" onclick={onManageGroups}>
        <Icon name="folder" size={16} />
      </button>
    </div>
  {:else}
    <div class="flex h-11 shrink-0 items-center gap-1 border-b border-default px-2">
      <button
        type="button"
        class="flex h-7 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-muted hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        title="收起侧栏 (⌘B)"
        aria-label="收起侧栏"
        onclick={() => sidebarCollapsed.toggle()}
      ><Icon name="collapse" size={13} /> 收起</button>
      <button
        type="button"
        class="ml-auto flex h-7 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-muted hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        title="管理主机分组"
        aria-label="管理主机分组"
        onclick={onManageGroups}
      ><Icon name="folder" size={12} /> 分组</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-2">
      <div class="space-y-0.5 px-2">
        <button
          type="button"
          class="{row} {collection === 'all' && !selectedTag && !selectedHostKey ? 'bg-surface-inset font-medium text-fg' : 'text-muted hover:bg-surface-hover'}"
          aria-current={collection === 'all' && !selectedTag && !selectedHostKey ? 'page' : undefined}
          onclick={() => onCollection('all')}
        >
          <Icon name="layers" size={13} />
          <span class="flex-1">全部主机</span>
          <span class="text-[0.625rem] tabular-nums text-faint">{hosts.length}</span>
        </button>
        <button
          type="button"
          class="{row} {collection === 'favorites' ? 'bg-surface-inset font-medium text-fg' : 'text-muted hover:bg-surface-hover'}"
          aria-current={collection === 'favorites' ? 'page' : undefined}
          onclick={() => onCollection('favorites')}
        >
          <Icon name="star" size={13} />
          <span class="flex-1">收藏</span>
          <span class="text-[0.625rem] tabular-nums text-faint">{favoriteCount}</span>
        </button>
      </div>

      <div class="mx-3 my-2 border-t border-default"></div>
      <!-- The tree always shows which group a host belongs to; the "Group by tag"
           switch only decides whether the table folds the same way. -->
      <div class="space-y-0.5 px-2">
          {#each groups as group (group.tag)}
            {@const open = searching || !$dashboardView.collapsed.includes(group.tag)}
            <section aria-label="{group.tag} 的主机">
              <div class="group flex items-center">
                <button
                  type="button"
                  class="grid h-7 w-6 shrink-0 place-items-center rounded text-faint hover:text-fg"
                  aria-label="{!searching && open ? '折叠' : '展开'} {group.tag}"
                  aria-expanded={open}
                  disabled={searching}
                  onclick={() => dashboardView.toggleCollapsed(group.tag)}
                >
                  <span class="transition-transform {open ? '' : '-rotate-90'}"><Icon name="chevron" size={12} /></span>
                </button>
                {#if renaming === group.tag}
                  <div class="flex min-w-0 flex-1 items-center gap-1 py-0.5">
                    <input
                      bind:this={renameEl}
                      bind:value={renameValue}
                      class="min-w-0 flex-1 rounded border border-default bg-surface-inset px-1.5 py-0.5 text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      aria-label="分组名称"
                      onkeydown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); void applyRename(); }
                        else if (event.key === 'Escape') { event.preventDefault(); renaming = null; groupError = null; }
                      }}
                    />
                    <button type="button" class={smallAction} aria-label="保存分组名称" disabled={busy} onclick={applyRename}><Icon name="check" size={12} /></button>
                    <button type="button" class={smallAction} aria-label="取消重命名" onclick={() => { renaming = null; groupError = null; }}><Icon name="close" size={12} /></button>
                  </div>
                {:else}
                  <button
                    type="button"
                    class="{row} flex-1 {selectedTag === group.tag ? 'bg-surface-inset text-accent' : 'text-muted hover:bg-surface-hover'}"
                    onclick={() => onTag(selectedTag === group.tag ? null : group.tag)}
                  >
                    <Icon name="folder" size={13} />
                    <span class="min-w-0 flex-1 truncate">{group.tag}</span>
                    <span class="text-[0.625rem] text-faint">{group.hosts.length}</span>
                  </button>
                  <button type="button" class="{smallAction} opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title="重命名分组" aria-label="重命名分组 {group.tag}" onclick={() => startRename(group.tag)}><Icon name="edit" size={11} /></button>
                  <button type="button" class="{smallAction} opacity-0 hover:text-status-crit group-hover:opacity-100 focus-visible:opacity-100" title="删除分组" aria-label="删除分组 {group.tag}" onclick={() => (confirming = group.tag)}><Icon name="trash" size={11} /></button>
                {/if}
              </div>
              {#if confirming === group.tag}
                <div class="ml-6 flex items-center gap-1 pb-1 pl-1 text-[0.625rem] text-muted">
                  <span class="min-w-0 flex-1 truncate">删除“{group.tag}”？主机保留。</span>
                  <button type="button" class="rounded border border-status-crit px-1 text-status-crit hover:bg-surface-inset" aria-label="确认删除分组 {group.tag}" disabled={busy} onclick={() => applyDelete(group.tag)}>删除</button>
                  <button type="button" class="rounded border border-default px-1 hover:text-fg" aria-label="取消删除分组 {group.tag}" onclick={() => { confirming = null; groupError = null; }}>取消</button>
                </div>
              {/if}
              {#if groupError && (renaming === group.tag || confirming === group.tag)}
                <p class="ml-7 pb-1 text-[0.625rem] text-status-crit">{groupError}</p>
              {/if}
              {#if open}
                <div class="ml-3 border-l border-default pl-1">
                  {#each group.hosts as host (hostKey(host))}
                    {@render hostRow(host, 1)}
                  {/each}
                </div>
              {/if}
            </section>
          {/each}
        {#each ungrouped as host (hostKey(host))}
          {@render hostRow(host, 1)}
        {/each}
      </div>
      {#if hosts.length === 0}
        <p class="px-4 py-8 text-center text-xs text-faint">没有匹配的主机</p>
      {/if}
    </div>
  {/if}
</aside>

{#snippet hostRow(host: HostDto, depth: number)}
  {@const selected = selectedHostKey === hostKey(host)}
  {@const status = $statuses.get(host.name)?.kind ?? 'unknown'}
  <button
    type="button"
    class="{row} group {selected ? 'bg-surface-inset text-accent' : 'text-muted hover:bg-surface-hover hover:text-fg'}"
    style:padding-left="{depth ? '0.75rem' : undefined}"
    title="单击筛选，双击打开终端：{host.name}"
    aria-pressed={selected}
    onclick={() => onHost(selected ? null : hostKey(host))}
    ondblclick={() => spawnSession('terminal', host.name)}
  >
    <StatusDot status={sessionStatusDot[status]} size={6} />
    <span class="min-w-0 flex-1 truncate">{host.name}</span>
    <span class="opacity-0 transition group-hover:opacity-100"><Icon name="terminal" size={11} /></span>
  </button>
{/snippet}
