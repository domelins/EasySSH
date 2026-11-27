/** Convert mouse-wheel movement into horizontal scrolling for tab strips whose
 *  scrollbars are hidden. Horizontal trackpad swipes (`deltaX`) are preserved too. */
export function horizontalWheel(event: WheelEvent): void {
  const el = event.currentTarget as HTMLElement | null;
  if (!el || el.scrollWidth <= el.clientWidth) return;

  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1;
  const dx = event.deltaX * scale;
  const dy = event.deltaY * scale;
  const delta = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
  if (delta === 0) return;

  event.preventDefault();
  el.scrollLeft += delta;
}
