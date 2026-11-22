<script lang="ts">
  // The workspace's right pane: the live monitor for its host (tech-gui.md §3.3). It
  // renders what the core polls — CPU with its recent trend, the memory split, network
  // throughput and totals, per-mount disk usage with I/O rates, system identity, uptime,
  // load and the top processes — and states plainly when a host is watched over TCP only
  // or has not answered yet, rather than inventing numbers. A host that exposes less
  // (macOS/FreeBSD have no `/proc`) falls back to the percentage meters it did have.
  import { Icon, StatusDot, type Status } from '$lib/theme';
  import { metrics, metricsSeenAt } from '$lib/stores/metrics';
  import { statuses } from '$lib/stores/statuses';
  import { hosts } from '$lib/stores/hosts';
  import { refreshMetrics, hostPassword } from '$lib/ipc/commands';
  import { lastError } from '$lib/stores/notifications';
  import { latencies, latencyLabel } from '$lib/stores/latency';
  import { displayHostname, streamerMode } from '$lib/stores/streamer';
  import { openDetachedPanel } from '$lib/workspace/panel';
  import { processRows } from '$lib/workspace/processes';
  import { formatBytes as bytes, formatRate as rate } from '$lib/format';
  import ProcessList from './ProcessList.svelte';
  import type { ConnectionStatusDto } from '$lib/bindings';

  let {
    hostName,
    active,
    maximized = false,
    detached = false,
    onCollapse,
    onMaximize
  }: {
    hostName: string;
    active: boolean;
    /** The pane currently fills the workspace; its buttons restore the row instead. */
    maximized?: boolean;
    /** This pane already is its own window: no "pop out" to offer. */
    detached?: boolean;
    onCollapse: () => void;
    onMaximize: () => void;
  } = $props();

  const sample = $derived($metrics.get(hostName));
  const status = $derived($statuses.get(hostName));
  const host = $derived($hosts.find((h) => h.name === hostName));
  const latency = $derived($latencies.get(hostName));
  const tcpOnly = $derived(host?.monitoring === 'tcpPort');

  /** The endpoint as the header shows it: masked in streamer mode like every address. */
  const address = $derived(
    host ? `${displayHostname(host.hostname, $streamerMode)}:${host.port}` : ''
  );
  let copied = $state<'ip' | 'password' | null>(null);

  function flash(which: 'ip' | 'password'): void {
    copied = which;
    setTimeout(() => {
      if (copied === which) copied = null;
    }, 1200);
  }

  function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** Copy the endpoint the way `ssh` would take it. */
  async function copyIp(): Promise<void> {
    if (!host) return;
    try {
      await navigator.clipboard.writeText(`${host.hostname}:${host.port}`);
      flash('ip');
    } catch (error) {
      lastError.set(message(error));
    }
  }

  /** Copy the stored login password; the secret never rode in with the host list. */
  async function copyPassword(): Promise<void> {
    if (!host) return;
    try {
      const secret = await hostPassword(host.name);
      if (!secret) {
        lastError.set(`“${host.name}”没有保存密码，只能在连接时输入。`);
        return;
      }
      await navigator.clipboard.writeText(secret);
      flash('password');
    } catch (error) {
      lastError.set(message(error));
    }
  }

  /** The connection state in words for the runtime card. */
  function stateLabel(s: ConnectionStatusDto | undefined): string {
    switch (s?.kind) {
      case 'connected':
        return '已连接';
      case 'connecting':
        return '连接中';
      case 'failed':
        return '连接失败';
      default:
        return '未连接';
    }
  }

  /** The shared server-state palette for the connection dot. */
  function dotStatus(s: ConnectionStatusDto | undefined): Status {
    switch (s?.kind) {
      case 'connected':
        return 'ok';
      case 'connecting':
        return 'unknown';
      case 'failed':
        return 'crit';
      default:
        return 'off';
    }
  }

  let refresher: ReturnType<typeof setInterval> | undefined;
  let refreshing = $state(false);

  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      await refreshMetrics();
    } catch (err) {
      lastError.set(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => (refreshing = false), 400);
    }
  }

  // Sample while the pane is on screen: the core's pollers run on their own interval,
  // but a workspace that just opened should not wait a full cycle for its first numbers.
  $effect(() => {
    if (!active) return;
    void refresh();
    refresher = setInterval(() => void refresh(), 15_000);
    return () => {
      if (refresher) clearInterval(refresher);
      refresher = undefined;
    };
  });

  function pct(value: number | null | undefined): number {
    if (value == null || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  /** Percent bars turn warning/critical at the core's `threshold_level` boundaries
   *  (Ok < 60 ≤ Warn ≤ 85 < Crit) — the same ones the dashboard's alert count uses. */
  function tone(value: number | null | undefined): string {
    const v = pct(value);
    if (v > 85) return 'bg-status-crit';
    if (v >= 60) return 'bg-status-warn';
    return 'bg-status-ok';
  }

  /** The same thresholds as a text/currentColor token (SVG strokes inherit it). */
  function toneText(value: number | null | undefined): string {
    const v = pct(value);
    if (v > 85) return 'text-status-crit';
    if (v >= 60) return 'text-status-warn';
    return 'text-status-ok';
  }


  const seenAt = $derived($metricsSeenAt.get(hostName));
  let now = $state(Date.now());
  // The sample's own age is frozen when the event is emitted; ticking here keeps the
  // label honest while a host is silent.
  $effect(() => {
    if (!active) return;
    const tick = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(tick);
  });

  /** Time since the last sample reached the UI. */
  function age(): string {
    if (seenAt == null) return '—';
    const s = Math.max(0, (now - seenAt) / 1000);
    if (s < 60) return `${Math.round(s)} 秒前`;
    if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
    return `${Math.round(s / 3600)} 小时前`;
  }

  /** The CPU trend as SVG points, oldest sample first, 0–100 % over 0–28 px. */
  const cpuPoints = $derived.by(() => {
    const history = sample?.cpuHistory ?? [];
    if (history.length === 0) return '';
    const count = Math.max(history.length - 1, 1);
    return history
      .map((value, index) => `${(index / count) * 100},${28 - (pct(value) / 100) * 26 - 1}`)
      .join(' ');
  });

  /** The memory breakdown in a form the donut and the legend can share. */
  const memory = $derived.by(() => {
    const m = sample?.memory;
    if (!m || m.totalBytes <= 0) return undefined;
    const used = pct((m.usedBytes / m.totalBytes) * 100);
    return {
      used,
      total: m.totalBytes,
      usedBytes: m.usedBytes,
      cachedBytes: m.cachedBytes,
      freeBytes: m.freeBytes
    };
  });

  const card = 'rounded-lg border border-default bg-surface-raised p-3';
  const label = 'text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-faint';
  const valueText = 'text-sm font-medium tabular-nums text-fg';
</script>

<section
  aria-label="主机监控"
  class="flex h-full min-h-0 min-w-0 flex-col bg-surface"
>
  <header class="shrink-0 border-b border-default px-3">
    <div class="flex h-9 items-center justify-between gap-2">
      <h2 class="flex min-w-0 items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted">
        <Icon name="dashboard" size={13} /> 监控
      </h2>
      <div class="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-faint transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          title="刷新指标"
          aria-label="刷新指标"
          onclick={refresh}
        >
          <span class:animate-spin={refreshing}><Icon name="refresh" size={13} /></span>
        </button>
        {#if !detached && !maximized}
          <button
            type="button"
            class="grid h-6 w-6 place-items-center rounded text-faint transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            title="在独立窗口打开监控"
            aria-label="在独立窗口打开监控"
            onclick={() => openDetachedPanel('monitor', hostName)}
          >
            <Icon name="popout" size={13} />
          </button>
        {/if}
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-faint transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          title={maximized ? '还原监控面板' : '最大化监控面板'}
          aria-label={maximized ? '还原监控面板' : '最大化监控面板'}
          onclick={onMaximize}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={13} />
        </button>
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-faint transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          title={maximized ? '还原监控面板' : '折叠监控面板'}
          aria-label={maximized ? '还原监控面板' : '折叠监控面板'}
          onclick={onCollapse}
        >
          <Icon name={maximized ? 'restore' : 'expand'} size={13} />
        </button>
      </div>
    </div>
    <div class="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-faint">
      <StatusDot status={dotStatus(status)} size={6} />
      <span class="min-w-0 truncate">{hostName}</span>
      <span class="ml-auto shrink-0 tabular-nums">{age()}</span>
    </div>
    {#if host}
      <div class="mt-0.5 flex min-w-0 items-center gap-1 text-[0.6875rem] text-muted">
        <span class="min-w-0 flex-1 truncate font-mono" title={address}>{address}</span>
        <button
          type="button"
          class="grid h-5 w-5 shrink-0 place-items-center rounded text-faint transition hover:bg-surface-inset hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          title="复制 IP"
          aria-label="复制 {hostName} 的 IP"
          onclick={copyIp}
        >
          <Icon name={copied === 'ip' ? 'check' : 'copy'} size={11} />
        </button>
        {#if host.hasPassword}
          <button
            type="button"
            class="grid h-5 w-5 shrink-0 place-items-center rounded text-faint transition hover:bg-surface-inset hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            title="复制登录密码"
            aria-label="复制 {hostName} 的登录密码"
            onclick={copyPassword}
          >
            <Icon name={copied === 'password' ? 'check' : 'key'} size={11} />
          </button>
        {/if}
      </div>
    {/if}
  </header>

  <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
    <!-- Runtime state: what the panel is watching and how fresh the numbers are. -->
    <div class={card}>
      <p class={label}>运行状态</p>
      <dl class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[0.6875rem]">
        <dt class="text-faint">连接</dt>
        <dd class="min-w-0 truncate text-right text-muted">{stateLabel(status)}</dd>
        <dt class="text-faint">监控方式</dt>
        <dd class="min-w-0 truncate text-right text-muted">
          {tcpOnly ? 'TCP 端口' : 'SSH'}{host?.monitorPort ? ` · ${host.monitorPort}` : ''}
        </dd>
        {#if host}
          <dt class="text-faint">地址</dt>
          <dd class="min-w-0 truncate text-right font-mono text-muted">{address}</dd>
        {/if}
        <dt class="text-faint">延迟（TCP）</dt>
        <dd class="min-w-0 truncate text-right tabular-nums text-muted">{latencyLabel(latency?.tcpMs)}</dd>
        <dt class="text-faint">延迟（Ping）</dt>
        <dd class="min-w-0 truncate text-right tabular-nums text-muted">{latencyLabel(latency?.pingMs)}</dd>
        {#if sample}
          <dt class="text-faint">最近采样</dt>
          <dd class="min-w-0 truncate text-right tabular-nums text-muted">{age()}</dd>
          {#if !tcpOnly}
            <dt class="text-faint">进程</dt>
            <dd class="min-w-0 truncate text-right tabular-nums text-muted">{sample.processes.length} 个</dd>
          {/if}
        {/if}
        {#if host?.forwardAgent}
          <dt class="text-faint">代理转发</dt>
          <dd class="min-w-0 truncate text-right text-muted">{host.hasKey ? '已启用' : '已启用（无本地代理）'}</dd>
        {/if}
      </dl>
    </div>

    {#if tcpOnly}
      <div class={card}>
        <p class={label}>仅端口探测</p>
        <p class="mt-1.5 text-xs leading-relaxed text-muted">
          该主机按 TCP 端口探测，不建立登录会话，因此没有 CPU、内存与进程数据。
        </p>
      </div>
    {:else if !sample}
      <div class="{card} text-center">
        <p class="text-xs text-muted">还没有指标样本</p>
        <p class="mt-1 text-[0.6875rem] leading-relaxed text-faint">
          主机连接后，采样会随轮询自动到达。
        </p>
        <button
          type="button"
          class="mt-2 rounded border border-default px-2 py-1 text-[0.6875rem] text-muted transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          onclick={refresh}
        >
          立即采样
        </button>
      </div>
    {:else}
      <!-- CPU: the current sample plus the poller's recent trend. -->
      <div class={card}>
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5">
            <Icon name="cpu" size={12} />
            <span class={label}>CPU</span>
          </span>
          <span class={valueText}>{sample.cpuPercent == null ? '—' : `${pct(sample.cpuPercent).toFixed(0)}%`}</span>
        </div>
        <div class="mt-1.5 h-8 w-full">
          {#if cpuPoints}
            <svg
              viewBox="0 0 100 28"
              preserveAspectRatio="none"
              class="h-full w-full {toneText(sample.cpuPercent)}"
              role="img"
              aria-label="CPU 趋势"
            >
              <polyline
                points={cpuPoints}
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
              />
            </svg>
          {:else}
            <p class="pt-1 text-[0.6875rem] text-faint">趋势随采样累积</p>
          {/if}
        </div>
        <div
          class="mt-1 h-1 overflow-hidden rounded-full bg-surface-inset"
          role="meter"
          aria-valuenow={pct(sample.cpuPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="CPU"
        >
          <div class="h-full rounded-full transition-[width] {tone(sample.cpuPercent)}" style="width: {pct(sample.cpuPercent)}%"></div>
        </div>
        <p class="mt-1.5 flex items-center justify-between text-[0.6875rem] text-faint">
          <span>负载</span>
          <span class="font-mono text-muted">{sample.loadAvg ?? '—'}</span>
        </p>
      </div>

      <!-- Memory: the used/cached/free split the kernel reports. -->
      {#if memory}
        <div class={card}>
          <p class={label}>内存</p>
          <div class="mt-1.5 flex items-center gap-3">
            <div class="relative h-14 w-14 shrink-0">
              <svg viewBox="0 0 36 36" class="h-14 w-14 -rotate-90" role="img" aria-label="内存占用 {memory.used.toFixed(0)}%">
                <circle cx="18" cy="18" r="15.9155" fill="none" stroke-width="4" class="text-surface-inset" stroke="currentColor" />
                <circle
                  cx="18" cy="18" r="15.9155" fill="none" stroke-width="4"
                  class={toneText(memory.used)}
                  stroke="currentColor"
                  stroke-dasharray="{memory.used} {100 - memory.used}"
                  stroke-linecap="round"
                />
              </svg>
              <span class="absolute inset-0 grid place-items-center text-[0.6875rem] font-semibold tabular-nums text-fg">
                {memory.used.toFixed(0)}%
              </span>
            </div>
            <dl class="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[0.6875rem]">
              <dt class="text-faint">已用</dt>
              <dd class="min-w-0 truncate text-right tabular-nums text-muted">{bytes(memory.usedBytes)}</dd>
              <dt class="text-faint">缓存</dt>
              <dd class="min-w-0 truncate text-right tabular-nums text-muted">{bytes(memory.cachedBytes)}</dd>
              <dt class="text-faint">空闲</dt>
              <dd class="min-w-0 truncate text-right tabular-nums text-muted">{bytes(memory.freeBytes)}</dd>
              <dt class="text-faint">总量</dt>
              <dd class="min-w-0 truncate text-right tabular-nums text-fg">{bytes(memory.total)}</dd>
            </dl>
          </div>
        </div>
      {:else}
        <div class={card}>
          <div class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-1.5">
              <Icon name="memory" size={12} />
              <span class={label}>内存</span>
            </span>
            <span class={valueText}>{sample.ramPercent == null ? '—' : `${pct(sample.ramPercent).toFixed(0)}%`}</span>
          </div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-inset" role="meter" aria-valuenow={pct(sample.ramPercent)} aria-valuemin={0} aria-valuemax={100} aria-label="内存">
            <div class="h-full rounded-full transition-[width] {tone(sample.ramPercent)}" style="width: {pct(sample.ramPercent)}%"></div>
          </div>
        </div>
      {/if}

      <!-- Network throughput and totals. -->
      {#if sample.network}
        <div class={card}>
          <p class={label}>网络</p>
          <div class="mt-1.5 grid grid-cols-2 gap-2">
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[0.625rem] text-faint"><span aria-hidden="true">↓</span> 下行</p>
              <p class="truncate font-mono text-xs text-fg">{rate(sample.network.rxBytesPerSec)}</p>
              <p class="truncate text-[0.625rem] tabular-nums text-faint">累计 {bytes(sample.network.rxBytesTotal)}</p>
            </div>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[0.625rem] text-faint"><span aria-hidden="true">↑</span> 上行</p>
              <p class="truncate font-mono text-xs text-fg">{rate(sample.network.txBytesPerSec)}</p>
              <p class="truncate text-[0.625rem] tabular-nums text-faint">累计 {bytes(sample.network.txBytesTotal)}</p>
            </div>
          </div>
        </div>
      {/if}

      <!-- Disks: one row per real mount, with I/O when the device was matched. -->
      {#if sample.disks.length}
        <div class={card}>
          <p class={label}>磁盘</p>
          <ul class="mt-1.5 space-y-2">
            {#each sample.disks.slice(0, 6) as disk (disk.mount)}
              <li>
                <div class="flex items-baseline justify-between gap-2">
                  <span class="min-w-0 truncate font-mono text-[0.6875rem] text-fg" title="{disk.device} → {disk.mount}">{disk.mount}</span>
                  <span class="shrink-0 text-[0.6875rem] tabular-nums text-muted">{bytes(disk.usedBytes)} / {bytes(disk.totalBytes)}</span>
                </div>
                <div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-inset" role="meter" aria-valuenow={pct(disk.percent)} aria-valuemin={0} aria-valuemax={100} aria-label="磁盘 {disk.mount}">
                  <div class="h-full rounded-full transition-[width] {tone(disk.percent)}" style="width: {pct(disk.percent)}%"></div>
                </div>
                <div class="mt-0.5 flex justify-between text-[0.625rem] tabular-nums text-faint">
                  <span>{disk.percent.toFixed(0)}%</span>
                  {#if disk.readBytesPerSec != null || disk.writeBytesPerSec != null}
                    <span class="truncate">读 {rate(disk.readBytesPerSec)} · 写 {rate(disk.writeBytesPerSec)}</span>
                  {:else}
                    <span>无 I/O 计数</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {:else}
        <div class={card}>
          <div class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-1.5">
              <Icon name="disk" size={12} />
              <span class={label}>磁盘</span>
            </span>
            <span class={valueText}>{sample.diskPercent == null ? '—' : `${pct(sample.diskPercent).toFixed(0)}%`}</span>
          </div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-inset" role="meter" aria-valuenow={pct(sample.diskPercent)} aria-valuemin={0} aria-valuemax={100} aria-label="磁盘">
            <div class="h-full rounded-full transition-[width] {tone(sample.diskPercent)}" style="width: {pct(sample.diskPercent)}%"></div>
          </div>
        </div>
      {/if}

      <!-- System identity + uptime -->
      <div class={card}>
        <p class={label}>系统</p>
        <p class="mt-1 break-words text-xs leading-relaxed text-fg">{sample.osInfo ?? '—'}</p>
        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[0.6875rem]">
          <dt class="flex items-center gap-1 text-faint"><Icon name="terminal" size={11} /> 主机</dt>
          <dd class="min-w-0 truncate text-right text-muted">{hostName}</dd>
          <dt class="flex items-center gap-1 text-faint"><Icon name="link" size={11} /> 地址</dt>
          <dd class="min-w-0 truncate text-right font-mono text-muted">{address || '—'}</dd>
          <dt class="flex items-center gap-1 text-faint"><Icon name="clock" size={11} /> 运行时间</dt>
          <dd class="min-w-0 truncate text-right tabular-nums text-muted">{sample.uptime ?? '—'}</dd>
          <dt class="flex items-center gap-1 text-faint"><Icon name="cpu" size={11} /> 负载</dt>
          <dd class="min-w-0 truncate text-right tabular-nums text-muted">{sample.loadAvg ?? '—'}</dd>
          {#if sample.memory?.availableBytes != null}
            <dt class="flex items-center gap-1 text-faint"><Icon name="memory" size={11} /> 可用内存</dt>
            <dd class="min-w-0 truncate text-right tabular-nums text-muted">{bytes(sample.memory.availableBytes)}</dd>
          {/if}
          <dt class="flex items-center gap-1 text-faint"><Icon name="disk" size={11} /> 磁盘</dt>
          <dd class="min-w-0 truncate text-right tabular-nums text-muted">{sample.disks.length} 个挂载</dd>
        </dl>
      </div>

      <!-- Processes: the full table, sortable by CPU/memory/PID. -->
      <div class={card}>
        <div class="flex items-center justify-between">
          <p class={label}>进程</p>
          <span class="text-[0.625rem] text-faint">{processRows(sample.processes, sample.topProcesses).length} 个</span>
        </div>
        {#if processRows(sample.processes, sample.topProcesses).length === 0}
          <p class="mt-1.5 text-xs text-faint">没有进程样本</p>
        {:else}
          <div class="mt-1.5 max-h-64 overflow-y-auto">
            <ProcessList rows={processRows(sample.processes, sample.topProcesses)} />
          </div>
        {/if}
      </div>
    {/if}
  </div>
</section>
