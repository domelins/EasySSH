<script lang="ts">
  // Server-state indicator. Colour comes from a semantic token, so the dot follows
  // the theme and never hardcodes a hue (tech-gui.md §5.1).
  import { statusToken, type Status } from './status';

  let {
    status,
    size = 8,
    label
  }: { status: Status; size?: number; label?: string } = $props();

  const statusLabel: Record<Status, string> = {
    ok: '在线',
    warn: '告警',
    crit: '严重',
    off: '离线',
    unknown: '未知'
  };
</script>

<span
  class="inline-block shrink-0 rounded-full"
  role="img"
  aria-label={label ?? statusLabel[status]}
  style="width: {size}px; height: {size}px; background-color: {statusToken(status)};"
></span>
