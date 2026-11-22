<script lang="ts">
  // The draggable gutter between two workspace panes (tech-gui.md §2). A pointer drag
  // reports the pane's new width; the arrows resize it from the keyboard and a
  // double-click folds the pane away, which is also what the header buttons do.
  let {
    side,
    width,
    min,
    max,
    label,
    onResize,
    onToggle
  }: {
    side: 'left' | 'right';
    /** The pane's current width, the base a drag starts from. */
    width: number;
    min: number;
    max: number;
    label: string;
    onResize: (nextWidth: number) => void;
    onToggle: () => void;
  } = $props();

  const STEP = 24;
  let dragging = $state(false);
  let startX = 0;
  let startWidth = 0;

  /** The width a pointer at `clientX` asks for: the pane grows toward the centre. */
  function widthAt(clientX: number): number {
    const delta = clientX - startX;
    return startWidth + (side === 'left' ? delta : -delta);
  }

  function down(event: PointerEvent): void {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    startWidth = width;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function move(event: PointerEvent): void {
    if (!dragging) return;
    onResize(widthAt(event.clientX));
  }

  function up(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }

  function keydown(event: KeyboardEvent): void {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === grow) {
      event.preventDefault();
      onResize(width + STEP);
    } else if (event.key === shrink) {
      event.preventDefault();
      onResize(width - STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onResize(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onResize(max);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  }
</script>

<!-- A 5 px hit area with a 1 px visual line: enough to grab without a visible seam.
     WAI-ARIA's resizable separator is the correct role here, and it must be focusable to
     be keyboard-resizable; that pair is exactly what the two ignored warnings flag. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={Math.round(width)}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  title="{label}（拖动调整宽度，双击折叠）"
  class="group relative w-[5px] shrink-0 cursor-col-resize touch-none select-none
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={onToggle}
  onkeydown={keydown}
>
  <span
    aria-hidden="true"
    class="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition
      {dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-accent group-focus-visible:bg-accent'}"
  ></span>
</div>
