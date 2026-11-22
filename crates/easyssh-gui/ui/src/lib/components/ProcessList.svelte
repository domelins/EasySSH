<script lang="ts">
  // The monitor's process table (tech-gui.md §3.3): the full list the core polls,
  // scrollable, with sortable CPU/memory/PID columns. Sorting is applied here so a
  // sample update keeps the user's chosen order.
  import { defaultDescending, sortProcesses, type ProcessRow, type ProcessSort } from '$lib/workspace/processes';

  let { rows }: { rows: ProcessRow[] } = $props();

  let sortKey = $state<ProcessSort>('cpu');
  let descending = $state(true);

  function select(key: ProcessSort): void {
    if (key === sortKey) {
      descending = !descending;
      return;
    }
    sortKey = key;
    descending = defaultDescending(key);
  }

  const sorted = $derived(sortProcesses(rows, sortKey, descending));
  const ariaSort = (key: ProcessSort) =>
    key === sortKey ? (descending ? 'descending' : 'ascending') : 'none';

  const header = 'flex items-center gap-1 text-left font-medium hover:text-fg';
</script>

<table class="w-full table-fixed text-[0.6875rem]">
  <thead class="sticky top-0 bg-surface-raised text-[0.625rem] uppercase tracking-[0.1em] text-faint">
    <tr class="border-b border-default">
      <th class="w-12 pb-1 text-left font-medium" aria-sort={ariaSort('pid')}>
        <button type="button" class={header} onclick={() => select('pid')}>PID</button>
      </th>
      <th class="pb-1 text-left font-medium">命令</th>
      <th class="w-12 pb-1 text-right font-medium" aria-sort={ariaSort('cpu')}>
        <button type="button" class="{header} justify-end" onclick={() => select('cpu')}>CPU</button>
      </th>
      <th class="w-12 pb-1 text-right font-medium" aria-sort={ariaSort('mem')}>
        <button type="button" class="{header} justify-end" onclick={() => select('mem')}>内存</button>
      </th>
    </tr>
  </thead>
  <tbody>
    {#each sorted as process, i (process.pid + ':' + process.command + ':' + i)}
      <tr class="border-b border-default/60 last:border-0">
        <td class="py-0.5 pr-1 font-mono tabular-nums text-faint">{process.pid || '—'}</td>
        <td class="truncate py-0.5 pr-1 font-mono text-muted" title={process.command}>{process.command}</td>
        <td class="py-0.5 text-right tabular-nums text-faint">{process.cpuPercent.toFixed(0)}%</td>
        <td class="py-0.5 text-right tabular-nums text-faint">{process.memPercent.toFixed(0)}%</td>
      </tr>
    {/each}
  </tbody>
</table>
