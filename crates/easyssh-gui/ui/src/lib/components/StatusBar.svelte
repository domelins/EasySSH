<script lang="ts">
  // Bottom region (tech-gui.md §2): context + host summary, and where background
  // errors surface (§3.5). The summary counts total / online / alert / offline
  // (§4.1); colour lives only in the status dots, per the brandbook.
  import { lastError } from '$lib/stores/notifications';
  import { hostSummary } from '$lib/stores/hostSummary';
  import { maskText, streamerMode } from '$lib/stores/streamer';
  import { streamerChordLabel } from '$lib/stores/ui';
  import { Icon, StatusDot } from '$lib/theme';

  const streamerLabel = '直播模式已开启';
</script>

<footer
  class="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-default bg-surface px-4 text-[0.6875rem] text-muted"
>
  {#if $lastError}
    {@const text = $maskText($lastError)}
    <!-- A long error (a hint to act on) is cut to one line; hover shows all of it. -->
    <span class="min-w-0 truncate text-status-crit" title={text}>{text}</span>
  {:else}
    <span class="min-w-0 truncate">就绪</span>
  {/if}
  <div class="flex shrink-0 items-center gap-3">
    {#if $streamerMode}
      <!-- Always in view, so nobody records believing addresses are hidden when they
           are not, or forgets the mode is on. No box or padding: the bar keeps its height. -->
      <span
        class="flex text-fg"
        role="img"
        title="{streamerLabel} ({streamerChordLabel})"
        aria-label={streamerLabel}
      >
        <Icon name="eye" size={14} />
      </span>
    {/if}
    <span>{$hostSummary.total} 台主机</span>
    <span class="flex items-center gap-1.5">
      <StatusDot status="ok" label="在线" />{$hostSummary.online} 在线
    </span>
    <span class="flex items-center gap-1.5">
      <StatusDot status="warn" label="告警" />{$hostSummary.alert} 告警
    </span>
    <span class="flex items-center gap-1.5">
      <StatusDot status="off" label="离线" />{$hostSummary.offline} 离线
    </span>
  </div>
</footer>
