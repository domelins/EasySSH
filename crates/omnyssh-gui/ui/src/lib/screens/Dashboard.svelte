<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import type { HostDto, HostInputDto } from '$lib/bindings';
  import { Icon, Button, StatusDot, statusToken } from '$lib/theme';
  import HostTree from '$lib/components/HostTree.svelte';
  import {
    serverCards,
    sortCards,
    moveCard,
    orderKeys,
    forwardListen,
    forwardTarget,
    networkLabel,
    type ServerCard
  } from './serverCard';
  import { filterHostCards, hostStatusLabel, systemLabel, type HostCollection } from './hostExplorer';
  import { hostGroupUpdates, deleteHostGroup, renameHostGroup, validateHostGroupName } from './hostGroups';  import { dashboardView, type CardSort } from '$lib/stores/dashboardView';
  import { spawnSession } from '$lib/stores/navigation';
  import { workspaceLayouts } from '$lib/workspace/store';
  import { streamerMode, displayHostname } from '$lib/stores/streamer';
  import { hosts } from '$lib/stores/hosts';
  import { lastError } from '$lib/stores/notifications';
  import { latencies, latencyLabel } from '$lib/stores/latency';
  import {
    saveHost,
    deleteHost,
    hostPassword,
    reloadHosts,
    startKeySetup,
    refreshMetrics,
    tunnelStart,
    tunnelStop
  } from '$lib/ipc/commands';
  import { isGroupHotkey, isRefreshHotkey } from '$lib/stores/ui';
  import { beginKeySetup, dismissKeySetup } from '$lib/stores/keySetup';
  import { emptyForm, formFromHost, type HostFormFields } from './hostForm';
  import { clampToScroller, dropTarget, scrollParent, scrollStep, swallowClick } from './cardDrag';
  import HostEditor from './HostEditor.svelte';
  import HostGroupManager from './HostGroupManager.svelte';
  import KeySetupConfirm from './KeySetupConfirm.svelte';
  import Modal from '$lib/components/Modal.svelte';

  let { tunnelOnly = false }: { tunnelOnly?: boolean } = $props();

  type Dialog =
    | { kind: 'add'; initial?: HostFormFields }
    | { kind: 'edit'; host: HostDto }
    | { kind: 'groups'; hosts: HostDto[] }
    | { kind: 'delete'; host: HostDto }
    | { kind: 'keySetup'; host: HostDto; rerun: boolean };

  let dialog = $state<Dialog | null>(null);
  let query = $state('');
  let collection = $state<HostCollection>('all');
  let selectedTag = $state<string | null>(null);
  let selectedHostKey = $state<string | null>(null);
  let selectedKeys = $state<string[]>([]);
  let menuKey = $state<string | null>(null);
  let copiedKey = $state<string | null>(null);
  let searchInput = $state<HTMLInputElement>();

  const keyOf = $derived(orderKeys($hosts));
  const treeCards = $derived(
    filterHostCards(
      $serverCards,
      {
        query,
        collection: 'all',
        tag: null,
        hostKey: null,
        tunnelOnly,
        favorites: [],
        recentHosts: []
      },
      keyOf
    )
  );
  const treeHosts = $derived(treeCards.map((card) => card.host));
  // Groups offered in the host form: every named group the workspace knows, plus any
  // tag an imported host already carries, so a group is never missing from the picker.
  const knownGroups = $derived(
    [
      ...new Set([
        ...$dashboardView.hostGroups,
        ...$hosts.flatMap((host) => host.tags.map((tag) => tag.trim()))
      ])
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  );
  const filteredCards = $derived(
    filterHostCards(
      $serverCards,
      {
        query,
        collection,
        tag: selectedTag,
        hostKey: selectedHostKey,
        tunnelOnly,
        favorites: $dashboardView.favorites,
        recentHosts: $dashboardView.recentHosts
      },
      keyOf
    )
  );
  const visibleCards = $derived(onScreen(filteredCards));
  const selectedCards = $derived(visibleCards.filter((card) => selectedKeys.includes(keyOf(card.host))));
  const allSelected = $derived(visibleCards.length > 0 && selectedCards.length === visibleCards.length);
  const viewChanged = $derived($dashboardView.groupByTag || $dashboardView.sort !== 'custom');

  let frozen = $state.raw<HostDto[] | null>(null);

  function onScreen(cards: ServerCard[]): ServerCard[] {
    if (!frozen) {
      return sortCards(cards, $dashboardView.sort, $dashboardView.order, keyOf, $dashboardView.sortDescending);
    }
    const rank = new Map(frozen.map((host, index) => [host, index]));
    return [...cards].sort((a, b) => (rank.get(a.host) ?? rank.size) - (rank.get(b.host) ?? rank.size));
  }

  function selectCollection(next: HostCollection): void {
    collection = next;
    selectedTag = null;
    selectedHostKey = null;
    selectedKeys = [];
  }

  function selectTag(tag: string | null): void {
    collection = 'all';
    selectedTag = tag;
    selectedHostKey = null;
    selectedKeys = [];
  }

  function selectHost(key: string | null): void {
    collection = 'all';
    selectedTag = null;
    selectedHostKey = key;
    selectedKeys = [];
  }

  function toggleSelection(key: string): void {
    selectedKeys = selectedKeys.includes(key) ? selectedKeys.filter((item) => item !== key) : [...selectedKeys, key];
  }

  function toggleAll(): void {
    const shown = visibleCards.map((card) => keyOf(card.host));
    selectedKeys = allSelected
      ? selectedKeys.filter((key) => !shown.includes(key))
      : [...new Set([...selectedKeys, ...shown])];
  }

  function connectSelected(): void {
    for (const card of selectedCards) spawnSession('terminal', card.host.name);
    selectedKeys = [];
  }

  const SORTS: { id: CardSort; label: string }[] = [
    { id: 'custom', label: 'Custom' },
    { id: 'name', label: 'Name' },
    { id: 'status', label: 'Status' },
    { id: 'address', label: 'Address' }
  ];

  let viewOpen = $state(false);
  let viewButton = $state<HTMLButtonElement>();
  let viewPanel = $state<HTMLElement>();

  async function onSortKey(event: KeyboardEvent): Promise<void> {
    const step = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as Record<string, number>)[event.key];
    if (!step) return;
    event.preventDefault();
    const group = event.currentTarget as HTMLElement;
    const at = SORTS.findIndex((option) => option.id === $dashboardView.sort);
    dashboardView.setSort(SORTS[(at + step + SORTS.length) % SORTS.length].id);
    await tick();
    group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }

  async function openView(): Promise<void> {
    viewOpen = true;
    await tick();
    viewPanel?.querySelector<HTMLElement>('button')?.focus();
  }

  function closeView(refocus: boolean): void {
    viewOpen = false;
    if (refocus) viewButton?.focus();
  }

  function onPointerDown(event: PointerEvent): void {
    const target = event.target as Node;
    if (viewOpen && !viewPanel?.contains(target) && !viewButton?.contains(target)) closeView(true);
    if (menuKey && !(target as Element).closest?.('[data-row-menu]')) menuKey = null;
  }

  type Drag = {
    run: ServerCard[];
    from: number;
    pointerId: number;
    handle: HTMLElement;
    rows: HTMLElement;
    scroller: HTMLElement;
    x0: number;
    y0: number;
    scroll0: number;
    x: number;
    y: number;
    started: boolean;
    to: number | null;
  };

  let drag: Drag | null = null;
  let frame = 0;
  let lifted = $state<{ index: number; dx: number; dy: number } | null>(null);
  let marker = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let announcement = $state('');

  function gripDown(event: PointerEvent, run: ServerCard[], from: number): void {
    const handle = event.currentTarget as HTMLElement;
    const rows = handle.closest<HTMLElement>('[data-cards]');
    if (event.button !== 0 || drag || !rows) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const scroller = scrollParent(rows);
    drag = {
      run,
      from,
      pointerId: event.pointerId,
      handle,
      rows,
      scroller,
      x0: event.clientX,
      y0: event.clientY,
      scroll0: scroller.scrollTop,
      x: event.clientX,
      y: event.clientY,
      started: false,
      to: null
    };
  }

  function gripMove(event: PointerEvent): void {
    if (event.pointerId !== drag?.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.started) {
      if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 4) return;
      drag.started = true;
      frozen = onScreen($serverCards).map((card) => card.host);
      frame = requestAnimationFrame(edgeScroll);
    }
    track();
  }

  function gripUp(event: PointerEvent): void {
    if (event.pointerId !== drag?.pointerId) return;
    if (drag.started) {
      drag.x = event.clientX;
      drag.y = event.clientY;
      track();
      swallowClick();
      const { run, from, to } = drag;
      if (to !== null && to !== from) commitMove(run, from, to);
    }
    endDrag();
  }

  function endDrag(): void {
    if (!drag) return;
    cancelAnimationFrame(frame);
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    drag = null;
    frozen = null;
    lifted = null;
    marker = null;
  }

  function track(): void {
    if (!drag) return;
    const current = drag;
    lifted = {
      index: current.from,
      dx: current.x - current.x0,
      dy: current.y - current.y0 + current.scroller.scrollTop - current.scroll0
    };
    const drop = dropTarget(current.rows, current.from, current.x, clampToScroller(current.scroller, current.y));
    current.to = drop?.to ?? null;
    marker = drop && drop.to !== current.from ? drop.marker : null;
  }

  function edgeScroll(): void {
    if (!drag) return;
    if (!drag.handle.isConnected) return endDrag();
    const step = scrollStep(drag.scroller, drag.rows, drag.y);
    if (step) {
      drag.scroller.scrollTop += step;
      track();
    }
    frame = requestAnimationFrame(edgeScroll);
  }

  function commitMove(run: ServerCard[], from: number, to: number): void {
    dashboardView.setOrder(moveCard(onScreen($serverCards), run, from, to, keyOf));
    announcement = `${run[from].host.name} moved to position ${to + 1} of ${run.length}`;
  }

  async function gripKey(event: KeyboardEvent, run: ServerCard[], from: number): Promise<void> {
    const last = run.length - 1;
    const keys: Record<string, number> = {
      ArrowUp: from - 1,
      ArrowLeft: from - 1,
      ArrowDown: from + 1,
      ArrowRight: from + 1,
      Home: 0,
      End: last
    };
    const to = keys[event.key];
    if (to === undefined || drag) return;
    event.preventDefault();
    if (to < 0 || to > last || to === from) return;
    const rows = (event.currentTarget as HTMLElement).closest('[data-cards]');
    commitMove(run, from, to);
    await tick();
    rows?.querySelectorAll<HTMLElement>('[data-grip]')[to]?.focus();
  }

  onDestroy(endDrag);

  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  let refreshing = $state(false);

  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      await refreshMetrics();
    } catch (error) {
      lastError.set(message(error));
    }
    setTimeout(() => (refreshing = false), 500);
  }

  async function reload(): Promise<void> {
    try {
      await reloadHosts();
    } catch (error) {
      lastError.set(message(error));
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (drag) {
      if (event.key === 'Escape') {
        event.preventDefault();
        endDrag();
      }
      return;
    }
    if (event.key === 'Escape' && (viewOpen || menuKey)) {
      closeView(viewOpen);
      menuKey = null;
    } else if (isRefreshHotkey(event)) {
      event.preventDefault();
      void refresh();
    } else if (isGroupHotkey(event)) {
      event.preventDefault();
      dashboardView.toggleGroupByTag();
    }
  }

  async function submit(input: HostInputDto, previousName: string | undefined): Promise<void> {
    if (!previousName && get(hosts).some((host) => host.name === input.name)) {
      throw new Error(`A host named "${input.name}" already exists`);
    }
    await saveHost(input);
    await reloadHosts();
    dialog = null;
  }

  async function submitGroups(groupNames: string[], editedHosts: HostDto[]): Promise<void> {    const baseline = dialog?.kind === 'groups' ? dialog.hosts : null;
    if (!baseline) return;
    try {
      for (const input of hostGroupUpdates(baseline, editedHosts)) await saveHost(input);
      dashboardView.setHostGroups(groupNames);
      dashboardView.setGroupByTag(true);
      await reloadHosts();
      if (selectedTag && !groupNames.includes(selectedTag)) selectedTag = null;
      dialog = null;
    } catch (error) {
      await reload();
      throw error;
    }
  }

  /** Rename a group from the tree: rewrite each member's tag and persist it. */
  async function renameGroup(from: string, to: string): Promise<void> {
    const name = to.trim();
    const problem = validateHostGroupName(name, knownGroups, from);
    if (problem) throw new Error(problem);
    const after = renameHostGroup($hosts, from, name);
    for (const input of hostGroupUpdates($hosts, after)) await saveHost(input);
    dashboardView.setHostGroups([...$dashboardView.hostGroups.filter((group) => group !== from), name]);
    if (selectedTag === from) selectedTag = name;
    await reloadHosts();
  }

  /** Delete a group from the tree; its hosts stay, just without that tag. */
  async function removeGroup(group: string): Promise<void> {
    const after = deleteHostGroup($hosts, group);
    for (const input of hostGroupUpdates($hosts, after)) await saveHost(input);
    dashboardView.setHostGroups($dashboardView.hostGroups.filter((item) => item !== group));
    if (selectedTag === group) selectedTag = null;
    await reloadHosts();
  }

  /** A copy of a host for the Add form: a fresh unique name, and no stored secret. */
  function duplicateForm(host: HostDto): HostFormFields {
    const names = new Set($hosts.map((h) => h.name));
    let name = `${host.name}-copy`;
    for (let n = 2; names.has(name); n += 1) name = `${host.name}-copy${n}`;
    return { ...formFromHost(host), name, password: '' };
  }

  async function setupKey(host: HostDto): Promise<void> {
    beginKeySetup(host.name);
    try {
      await startKeySetup(host.name);
    } catch (error) {
      dismissKeySetup();
      lastError.set(message(error));
    }
  }

  function confirmKeySetup(host: HostDto): void {
    dialog = null;
    void setupKey(host);
  }

  async function toggleTunnel(name: string, running: boolean): Promise<void> {
    try {
      await (running ? tunnelStop(name) : tunnelStart(name));
    } catch (error) {
      lastError.set(message(error));
    }
  }

  async function confirmDelete(name: string): Promise<void> {
    try {
      await deleteHost(name);
      await reloadHosts();
    } catch (error) {
      lastError.set(message(error));
    }
    dialog = null;
  }

  async function copyAddress(card: ServerCard): Promise<void> {
    const key = keyOf(card.host);
    try {
      await navigator.clipboard.writeText(`${card.host.hostname}:${card.host.port}`);
      copiedKey = key;
      setTimeout(() => {
        if (copiedKey === key) copiedKey = null;
      }, 1200);
    } catch (error) {
      lastError.set(message(error));
    }
  }

  /** The row's copy-password action: the secret stays backend-side until asked for. */
  async function copyPassword(card: ServerCard): Promise<void> {
    const key = `${keyOf(card.host)}:password`;
    try {
      const secret = await hostPassword(card.host.name);
      if (!secret) {
        lastError.set(`“${card.host.name}”没有保存密码，只能在连接时输入。`);
        return;
      }
      await navigator.clipboard.writeText(secret);
      copiedKey = key;
      setTimeout(() => {
        if (copiedKey === key) copiedKey = null;
      }, 1200);
    } catch (error) {
      lastError.set(message(error));
    }
  }

  function address(host: HostDto): string {
    return `${host.user}@${displayHostname(host.hostname, $streamerMode)}:${host.port}`;
  }

  function ariaSort(sort: CardSort): 'ascending' | 'descending' | 'none' {
    if ($dashboardView.sort !== sort) return 'none';
    return $dashboardView.sortDescending ? 'descending' : 'ascending';
  }

  const iconButton =
    'grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const actionButton =
    'inline-flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-[0.6875rem] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerDown} />

<section class="flex h-full min-h-0 bg-surface" aria-label={tunnelOnly ? 'Tunnel workspace' : 'SSH workspace'}>
  <HostTree
    hosts={treeHosts}
    groupNames={$dashboardView.hostGroups}
    {query}
    {collection}
    {selectedTag}
    {selectedHostKey}
    hostKey={keyOf}
    onCollection={selectCollection}
    onTag={selectTag}
    onHost={selectHost}
    onManageGroups={() => (dialog = { kind: 'groups', hosts: $hosts })}
    onRenameGroup={renameGroup}
    onDeleteGroup={removeGroup}
  />

  <div class="flex min-w-0 flex-1 flex-col">
    <div class="flex h-11 shrink-0 flex-wrap items-center gap-2 border-b border-default px-3">
      <div class="flex items-center gap-1 rounded-md bg-surface-inset p-0.5">
        <button
          type="button"
          class="rounded px-2.5 py-1 text-[0.6875rem] {collection === 'all' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}"
          aria-pressed={collection === 'all'}
          onclick={() => selectCollection('all')}
        >{tunnelOnly ? '全部隧道' : '全部主机'}</button>
        <button
          type="button"
          class="rounded px-2.5 py-1 text-[0.6875rem] {collection === 'recent' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}"
          aria-label="Recent connections"
          aria-pressed={collection === 'recent'}
          onclick={() => selectCollection('recent')}
        >最近连接</button>
      </div>

      <div class="flex h-8 min-w-44 flex-1 items-center rounded-md border border-default bg-surface px-2 focus-within:border-accent sm:max-w-80">
        <button
          type="button"
          class="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-faint hover:text-accent"
          title="Search hosts"
          aria-label="Search hosts"
          onclick={() => searchInput?.focus()}
        ><Icon name="search" size={13} /></button>
        <input
          bind:this={searchInput}
          bind:value={query}
          type="text"
          class="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-faint"
          placeholder="名称 / root@地址 / 标签"
          aria-label="Search hosts"
          onkeydown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              query = '';
              selectedHostKey = null;
              searchInput?.blur();
            }
          }}
        />
        {#if query}
          <button type="button" class="grid h-6 w-6 place-items-center rounded text-faint hover:text-fg" title="Clear search" aria-label="Clear search" onclick={() => (query = '')}>
            <Icon name="close" size={12} />
          </button>
        {/if}
      </div>

      {#if selectedTag || selectedHostKey}
        <button
          type="button"
          class="flex items-center gap-1 rounded-md bg-surface-inset px-2 py-1 text-[0.6875rem] text-accent hover:text-fg"
          title="Clear host filter"
          onclick={() => selectCollection('all')}
        >
          {selectedTag ?? visibleCards[0]?.host.name}<Icon name="close" size={11} />
        </button>
      {/if}

      <div class="ml-auto flex items-center gap-1">
        {#if visibleCards.length < $serverCards.length}
          <span class="mr-1 whitespace-nowrap text-[0.6875rem] tabular-nums text-faint">{visibleCards.length} / {$serverCards.length} 台</span>
        {/if}
        <button type="button" class={iconButton} title="Refresh metrics (R)" aria-label="Refresh metrics" disabled={refreshing} onclick={refresh}>
          <span class:inline-flex={true} class:animate-spin={refreshing}><Icon name="refresh" size={14} /></span>
        </button>
        <button type="button" class="{actionButton} bg-accent text-accent-fg hover:opacity-90" title="新建 SSH 主机" aria-label="Add host" onclick={() => (dialog = { kind: 'add' })}>
          <Icon name="plus" size={13} /><span class="hidden lg:inline">新建主机</span>
        </button>
        <div class="relative">
          <button
            bind:this={viewButton}
            type="button"
            class="{iconButton} relative"
            title="View options"
            aria-label="View options"
            aria-haspopup="dialog"
            aria-expanded={viewOpen}
            onclick={() => (viewOpen ? closeView(true) : openView())}
          >
            <Icon name="settings" size={14} />
            {#if viewChanged}<span class="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent"></span>{/if}
          </button>
          {#if viewOpen}
            <div
              bind:this={viewPanel}
              role="dialog"
              aria-label="View options"
              tabindex="-1"
              class="absolute right-0 top-full z-40 mt-1 w-72 space-y-4 rounded-xl border border-default bg-surface-raised p-4 shadow-soft"
              onfocusout={(event) => {
                const next = event.relatedTarget as Node | null;
                if (next && !viewPanel?.contains(next) && next !== viewButton) closeView(false);
              }}
            >
              <div class="flex items-center justify-between gap-4">
                <div><p class="text-xs font-medium">按标签分组</p><p class="mt-0.5 text-[0.6875rem] text-muted">在左侧主机树中显示分组</p></div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={$dashboardView.groupByTag}
                  aria-label="Group by tag"
                  class="relative h-5 w-9 shrink-0 rounded-full {$dashboardView.groupByTag ? 'bg-accent' : 'bg-surface-inset'}"
                  onclick={() => dashboardView.toggleGroupByTag()}
                ><span class="absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-[left] {$dashboardView.groupByTag ? 'left-[1.125rem]' : 'left-0.5'}"></span></button>
              </div>
              <div class="border-t border-default pt-3">
                <p id="dashboard-sort-label" class="mb-2 text-xs font-medium">Sort</p>
                <div role="radiogroup" aria-labelledby="dashboard-sort-label" tabindex="-1" class="grid grid-cols-2 gap-1 rounded-lg bg-surface-inset p-1" onkeydown={onSortKey}>
                  {#each SORTS as option (option.id)}
                    {@const on = $dashboardView.sort === option.id}
                    <button type="button" role="radio" aria-checked={on} tabindex={on ? 0 : -1} class="rounded px-2 py-1.5 text-[0.6875rem] {on ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'}" onclick={() => dashboardView.setSort(option.id)}>{option.label}</button>
                  {/each}
                </div>
                <p class="mt-2 text-[0.6875rem] text-muted">拖动手柄，或用手柄上的方向键调整自定义顺序。</p>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if selectedCards.length}
      <div class="flex h-10 shrink-0 items-center gap-3 border-b border-default bg-surface-inset px-4 text-xs">
        <span>已选择 <strong>{selectedCards.length}</strong> 台主机</span>
        <button type="button" class="{actionButton} bg-accent text-accent-fg" onclick={connectSelected}><Icon name="terminal" size={12} /> 批量连接</button>
        <button type="button" class="text-muted hover:text-fg" onclick={() => (selectedKeys = [])}>取消选择</button>
      </div>
    {/if}

    <div class="min-h-0 flex-1 overflow-auto">
      {#if visibleCards.length}
        <table class="w-full min-w-[60rem] border-separate border-spacing-0 text-left text-xs">
          <thead class="sticky top-0 z-10 bg-surface text-[0.6875rem] text-muted">
            <tr class="h-9 border-b border-default">
              <th class="w-10 border-b border-default px-3 font-normal">
                <input type="checkbox" class="accent-[var(--accent)]" aria-label="Select all hosts" checked={allSelected} indeterminate={selectedCards.length > 0 && !allSelected} onchange={toggleAll} />
              </th>
              <th class="w-8 border-b border-default font-normal"><span class="sr-only">Reorder</span></th>
              <th class="w-10 border-b border-default font-normal"><span class="sr-only">Favorite</span></th>
              <th class="w-20 border-b border-default px-2 font-medium">系统</th>
              <th class="w-24 border-b border-default px-2 font-medium" aria-sort={ariaSort('status')}>
                <button type="button" class="flex items-center gap-1 hover:text-fg" onclick={() => dashboardView.setSort('status')}>状态 <Icon name="chevron" size={11} /></button>
              </th>
              <th class="w-24 border-b border-default px-2 font-medium">延迟</th>
              <th class="w-44 border-b border-default px-2 font-medium" aria-sort={ariaSort('name')}>
                <button type="button" class="flex items-center gap-1 hover:text-fg" onclick={() => dashboardView.setSort('name')}>名称 <Icon name="chevron" size={11} /></button>
              </th>
              <th class="w-64 border-b border-default px-2 font-medium" aria-sort={ariaSort('address')}>
                <button type="button" class="flex items-center gap-1 hover:text-fg" onclick={() => dashboardView.setSort('address')}>地址 <Icon name="chevron" size={11} /></button>
              </th>
              <th class="min-w-56 border-b border-default px-3 font-medium">
                <div class="flex items-center gap-2">
                  <span>实时信息</span>
                  <button type="button" role="switch" aria-label="Show live metrics" aria-checked={$dashboardView.showMetrics} class="relative h-4 w-7 rounded-full {$dashboardView.showMetrics ? 'bg-accent' : 'bg-surface-inset'}" onclick={() => dashboardView.setShowMetrics(!$dashboardView.showMetrics)}>
                    <span class="absolute top-0.5 h-3 w-3 rounded-full bg-surface transition-[left] {$dashboardView.showMetrics ? 'left-3.5' : 'left-0.5'}"></span>
                  </button>
                </div>
              </th>
              <th class="sticky right-0 z-20 w-44 border-b border-default bg-surface px-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody data-cards>
            {#each visibleCards as card, index (card.host)}
              {@const key = keyOf(card.host)}
              {@const favorite = $dashboardView.favorites.includes(key)}
              {@const lift = lifted?.index === index ? lifted : null}
              <tr data-card class="group relative h-14 [&>td]:py-1.5 bg-surface transition-colors hover:bg-surface-hover {lift ? 'z-20 shadow-soft' : ''}" style:transform={lift ? `translate(${lift.dx}px, ${lift.dy}px)` : undefined}>
                <td class="border-b border-default px-3"><input type="checkbox" class="accent-[var(--accent)]" aria-label="Select {card.host.name}" checked={selectedKeys.includes(key)} onchange={() => toggleSelection(key)} /></td>
                <td class="border-b border-default px-1">
                  <button
                    type="button"
                    data-grip
                    class="grid h-7 w-7 cursor-grab touch-none place-items-center rounded text-faint opacity-0 transition hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
                    title="Drag to reorder"
                    aria-label="Move {card.host.name}"
                    aria-describedby="dashboard-reorder-help"
                    onpointerdown={(event) => gripDown(event, visibleCards, index)}
                    onpointermove={gripMove}
                    onpointerup={gripUp}
                    onpointercancel={endDrag}
                    onlostpointercapture={endDrag}
                    onkeydown={(event) => gripKey(event, visibleCards, index)}
                  ><Icon name="grip" size={13} /></button>
                </td>
                <td class="border-b border-default px-1">
                  <button type="button" class="grid h-7 w-7 place-items-center rounded {favorite ? 'text-status-warn' : 'text-faint hover:text-status-warn'}" title={favorite ? 'Remove from favorites' : 'Add to favorites'} aria-label="{favorite ? 'Unfavorite' : 'Favorite'} {card.host.name}" aria-pressed={favorite} onclick={() => dashboardView.toggleFavorite(key)}>
                    <span class="inline-block {favorite ? '[&>svg]:fill-current' : ''}"><Icon name="star" size={15} /></span>
                  </button>
                </td>
                <td class="border-b border-default px-2">
                  <span class="inline-flex min-w-10 items-center justify-center rounded border border-default px-1.5 py-1 font-mono text-[0.5625rem] font-semibold text-muted" title={card.osInfo ?? card.host.monitoring}>{systemLabel(card)}</span>
                </td>
                <td class="border-b border-default px-2">
                  <span class="flex items-center gap-1.5 whitespace-nowrap" title={card.failure}><StatusDot status={card.overall} size={7} /><span class="text-[0.6875rem]">{hostStatusLabel(card)}</span></span>
                </td>
                <td class="border-b border-default px-2">
                  <div class="flex flex-col gap-0.5 text-[0.625rem] leading-tight tabular-nums" title="从本机测量：TCP 连接与 ping">
                    <span class="flex items-center gap-1"><span class="w-7 shrink-0 text-faint">TCP</span><span class="text-muted">{latencyLabel($latencies.get(card.host.name)?.tcpMs)}</span></span>
                    <span class="flex items-center gap-1"><span class="w-7 shrink-0 text-faint">Ping</span><span class="text-muted">{latencyLabel($latencies.get(card.host.name)?.pingMs)}</span></span>
                  </div>
                </td>
                <td class="border-b border-default px-2">
                  <div class="min-w-0">
                    <button type="button" class="block max-w-full truncate rounded text-left font-medium text-fg hover:text-accent" title="打开 {card.host.name} 终端" ondblclick={() => spawnSession('terminal', card.host.name)} onclick={() => selectHost(selectedHostKey === key ? null : key)}>{card.host.name}</button>
                    <div class="mt-1 flex items-center gap-1">
                      {#if card.host.source === 'sshConfig'}<span class="rounded border border-default px-1 text-[0.5625rem] text-faint">ssh config</span>{/if}
                      {#if card.host.hasKey}<span title="Key authentication configured" class="text-faint"><Icon name="key" size={10} /></span>{/if}
                      {#if card.host.passwordAuthDisabled === true}<span role="img" title="Key login only" aria-label="Key login only" class="text-status-ok"><Icon name="shield" size={10} /></span>{/if}
                      {#if card.host.source === 'manual' && card.host.passwordAuthDisabled === false}
                        <button type="button" class="rounded border border-status-warn px-1 text-[0.5625rem] text-status-warn hover:bg-surface-inset" title="Turn off password login" onclick={() => (dialog = { kind: 'keySetup', host: card.host, rerun: true })}>Password on</button>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="border-b border-default px-2">
                  <div class="flex min-w-0 items-center gap-1">
                    <span class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted" title={address(card.host)}>{address(card.host)}</span>
                    <button type="button" class="grid h-6 w-6 shrink-0 place-items-center rounded text-faint hover:bg-surface-inset hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" title="复制 {address(card.host)}" aria-label="Copy IP for {card.host.name}" onclick={() => copyAddress(card)}>
                      <Icon name={copiedKey === key ? 'check' : 'copy'} size={12} />
                    </button>
                    {#if card.host.hasPassword}
                      <button type="button" class="grid h-6 w-6 shrink-0 place-items-center rounded text-faint hover:bg-surface-inset hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" title="复制 {card.host.name} 的登录密码" aria-label="Copy password for {card.host.name}" onclick={() => copyPassword(card)}>
                        <Icon name={copiedKey === `${key}:password` ? 'check' : 'key'} size={12} />
                      </button>
                    {/if}
                  </div>
                  {#if tunnelOnly && card.tunnel}
                    <span class="mt-1 block truncate font-mono text-[0.625rem] text-faint">{card.tunnel.forwards.length} 条转发 · {card.tunnel.label}</span>
                  {/if}
                </td>
                <td class="border-b border-default px-3">
                  {#if $dashboardView.showMetrics && !card.offline && card.metricRows.length}
                    <div class="grid grid-cols-3 gap-3">
                      {#each card.metricRows as row (row.label)}
                        <div class="min-w-0">
                          <div class="flex items-center justify-between gap-1 text-[0.5625rem] text-faint"><span>{row.label}</span><span class="tabular-nums text-muted">{row.percent == null ? '—' : `${Math.round(row.percent)}%`}</span></div>
                          <div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-inset">
                            {#if row.percent != null}<div class="h-full rounded-full" style="width: {Math.min(row.percent, 100)}%; background-color: {statusToken(row.status)};"></div>{/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                    {#if networkLabel(card)}
                      <p class="mt-1 truncate text-[0.5625rem] tabular-nums text-faint" title="实时网速">{networkLabel(card)}</p>
                    {/if}
                  {:else if card.reachability}
                    <span class="text-[0.6875rem] text-muted">{card.reachability}{card.host.monitorPort ? ` · ${card.host.monitorPort}` : ''}</span>
                  {:else}
                    <span class="text-faint">—</span>
                  {/if}
                </td>
                <td class="sticky right-0 {menuKey === key ? 'z-30' : 'z-10'} border-b border-default bg-surface px-3 after:pointer-events-none after:absolute after:inset-0 after:bg-surface-hover after:opacity-0 after:transition-opacity group-hover:after:opacity-100">
                  <div class="flex items-center gap-1 whitespace-nowrap">
                    <button type="button" class="{actionButton} mr-1 bg-accent px-3 text-accent-fg hover:opacity-90" title="sh on {card.host.name}" aria-label="Connect {card.host.name}" onclick={() => spawnSession('terminal', card.host.name)}>连接</button>
                    <button type="button" class={iconButton} title="打开 {card.host.name} 的终端与文件面板" aria-label="Files {card.host.name}" onclick={() => { spawnSession('terminal', card.host.name); workspaceLayouts.patchLayout(card.host.name, { leftCollapsed: false }); }}><Icon name="sftp" size={13} /></button>
                    <button type="button" class={iconButton} title="编辑 {card.host.name}" aria-label="Edit {card.host.name}" onclick={() => (dialog = { kind: 'edit', host: card.host })}><Icon name="edit" size={13} /></button>
                    {#if card.host.source === 'manual'}
                      <button type="button" class="{iconButton} hover:text-status-crit" title="删除 {card.host.name}" aria-label="Delete host {card.host.name}" onclick={() => { menuKey = null; dialog = { kind: 'delete', host: card.host }; }}><Icon name="trash" size={13} /></button>
                    {/if}
                    <div class="relative" data-row-menu>
                      <button type="button" class={iconButton} title="更多操作" aria-label="More actions for {card.host.name}" aria-expanded={menuKey === key} onclick={() => (menuKey = menuKey === key ? null : key)}><Icon name="more" size={14} /></button>
                      {#if menuKey === key}
                        <div class="absolute right-0 top-full z-30 mt-1 w-80 rounded-xl border border-default bg-surface-raised p-3 shadow-soft">
                          <div class="mb-2 border-b border-default pb-2">
                            <p class="font-medium">{card.host.name}</p>
                            {#if card.osInfo}<p class="mt-0.5 truncate text-[0.6875rem] text-muted">{card.osInfo}</p>{/if}
                            {#if card.uptime}<p class="mt-0.5 text-[0.6875rem] text-muted">运行时间 {card.uptime}</p>{/if}
                          </div>
                          {#if card.failure}<p class="mb-2 select-text break-words rounded bg-surface-inset p-2 text-[0.6875rem] text-status-crit">{$streamerMode ? 'Details hidden in streamer mode' : card.failure}</p>{/if}
                          {#if card.detectedServices.length}<p class="mb-2 text-[0.6875rem] text-muted">服务：{card.detectedServices.map((service) => service.name).join('、')}</p>{/if}
                          {#if card.tunnel}
                            <div class="mb-2 rounded-lg bg-surface-inset p-2">
                              <div class="flex items-center gap-2">
                                <StatusDot status={card.tunnel.dot} size={7} />
                                <span class="text-[0.6875rem] font-medium">{card.tunnel.label}</span>
                                <button type="button" class="{actionButton} ml-auto border border-default" aria-label="{card.tunnel.running ? 'Stop' : 'Start'} the tunnel to {card.host.name}" onclick={() => toggleTunnel(card.host.name, card.tunnel!.running)}>{card.tunnel.running ? '停止' : '启动'}</button>
                              </div>
                              <ul class="mt-2 space-y-1 font-mono text-[0.625rem] text-muted">
                                {#each card.tunnel.forwards as forward, forwardIndex (forwardIndex)}
                                  <li class="flex items-center gap-1"><span class="truncate">{forwardListen(forward, $streamerMode)}</span><span>→</span><span class="truncate">{forwardTarget(forward, $streamerMode)}</span></li>
                                {/each}
                              </ul>
                              {#if card.tunnel.message}<p class="mt-2 break-words text-[0.625rem] text-status-crit">{$streamerMode ? 'Details hidden in streamer mode' : card.tunnel.message}</p>{/if}
                            </div>
                          {/if}
                          <div class="flex flex-wrap gap-1">
                            <button type="button" class="{actionButton} border border-default text-muted hover:text-accent" aria-label="Duplicate {card.host.name}" onclick={() => { menuKey = null; dialog = { kind: 'add', initial: duplicateForm(card.host) }; }}><Icon name="copy" size={12} /> 复制主机</button>
                            {#if card.host.source === 'manual'}
                              {#if !card.host.hasKey || card.host.passwordAuthDisabled === false}
                                <button type="button" class="{actionButton} border border-default text-muted hover:text-accent" aria-label="Set up an SSH key for {card.host.name}" onclick={() => { menuKey = null; dialog = { kind: 'keySetup', host: card.host, rerun: card.host.hasKey }; }}><Icon name="key" size={12} /> 配置密钥</button>
                              {/if}
                              <p class="p-1 text-[0.625rem] text-faint">删除在行尾的垃圾桶按钮上。</p>
                            {:else}
                              <p class="p-1 text-[0.625rem] text-faint">SSH config 主机可通过编辑保存为本地副本。</p>
                            {/if}
                          </div>
                        </div>
                      {/if}
                    </div>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          {#if $serverCards.length === 0}
            <Icon name="terminal" size={28} />
            <p class="text-sm font-medium">No servers yet</p>
            <p class="text-xs text-muted">添加主机，或从 SSH 配置导入后开始连接。</p>
            <button type="button" class="{actionButton} mt-2 bg-accent px-4 text-accent-fg" aria-label="Add host" onclick={() => (dialog = { kind: 'add' })}><Icon name="plus" size={12} /> 添加主机</button>
          {:else if tunnelOnly}
            <Icon name="tunnel" size={28} />
            <p class="text-sm font-medium">没有匹配的端口转发</p>
            <p class="text-xs text-muted">编辑主机并添加本地端口转发后，会显示在这里。</p>
          {:else}
            <Icon name="search" size={28} />
            <p class="text-sm text-muted">没有匹配当前筛选条件的主机。</p>
            <button type="button" class="{actionButton} border border-default text-muted" onclick={() => { query = ''; selectCollection('all'); }}>清除筛选</button>
          {/if}
        </div>
      {/if}
    </div>

  </div>

  <p id="dashboard-reorder-help" class="sr-only">Drag, or press the arrow keys, Home or End, to move the row.</p>
  <p class="sr-only" aria-live="polite">{announcement}</p>
  {#if marker}
    <div class="pointer-events-none fixed z-30 rounded-full bg-accent" style:left="{marker.left}px" style:top="{marker.top}px" style:width="{marker.width}px" style:height="{marker.height}px"></div>
  {/if}
</section>

{#if dialog?.kind === 'add'}
  <HostEditor mode="add" initial={dialog.initial ?? emptyForm()} groups={knownGroups} onSubmit={submit} onCancel={() => (dialog = null)} />
{:else if dialog?.kind === 'edit'}
  {@const host = dialog.host}
  <HostEditor mode="edit" initial={formFromHost(host)} previousName={host.name} imported={host.source === 'sshConfig'} groups={knownGroups} onSubmit={submit} onCancel={() => (dialog = null)} />
{:else if dialog?.kind === 'groups'}
  <HostGroupManager hosts={dialog.hosts} groupNames={$dashboardView.hostGroups} onSave={submitGroups} onCancel={() => (dialog = null)} />
{:else if dialog?.kind === 'keySetup'}
  {@const host = dialog.host}
  <KeySetupConfirm {host} rerun={dialog.rerun} onConfirm={() => confirmKeySetup(host)} onCancel={() => (dialog = null)} />
{:else if dialog?.kind === 'delete'}
  {@const host = dialog.host}
  <Modal label="Delete host" onClose={() => (dialog = null)}>
    <div class="space-y-3 px-5 py-4">
      <h2 class="text-sm font-semibold">Delete host</h2>
      <p class="text-sm text-muted">Delete “{host.name}”? This removes it from <span class="font-mono">hosts.toml</span>. If your SSH config defines the same name, it comes back as an import.</p>
      <div class="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onclick={() => (dialog = null)}>Cancel</Button>
        <Button variant="primary" onclick={() => confirmDelete(host.name)}>Delete</Button>
      </div>
    </div>
  </Modal>
{/if}
