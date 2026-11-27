import { describe, expect, it, vi } from 'vitest';
import { horizontalWheel } from './wheelScroll';

function wheelEvent(
  el: { scrollWidth: number; clientWidth: number; scrollLeft: number },
  init: { deltaX?: number; deltaY?: number; deltaMode?: number }
) {
  const preventDefault = vi.fn();
  const event = {
    currentTarget: el,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
    preventDefault
  } as unknown as WheelEvent;
  return { event, preventDefault };
}

describe('horizontalWheel', () => {
  it('translates vertical wheel delta into horizontal scrolling when overflowing', () => {
    const el = { scrollWidth: 800, clientWidth: 300, scrollLeft: 20 };
    const { event, preventDefault } = wheelEvent(el, { deltaY: 60 });
    horizontalWheel(event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(el.scrollLeft).toBe(80);
  });

  it('preserves horizontal trackpad swipes when deltaX dominates', () => {
    const el = { scrollWidth: 800, clientWidth: 300, scrollLeft: 100 };
    const { event, preventDefault } = wheelEvent(el, { deltaX: -40, deltaY: 5 });
    horizontalWheel(event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(el.scrollLeft).toBe(60);
  });

  it('scales line-mode wheel deltas', () => {
    const el = { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 };
    const { event, preventDefault } = wheelEvent(el, { deltaY: 3, deltaMode: 1 });
    horizontalWheel(event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(el.scrollLeft).toBe(48);
  });

  it('does nothing when content fits without overflowing', () => {
    const el = { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 };
    const { event, preventDefault } = wheelEvent(el, { deltaY: 60 });
    horizontalWheel(event);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(el.scrollLeft).toBe(0);
  });
});
