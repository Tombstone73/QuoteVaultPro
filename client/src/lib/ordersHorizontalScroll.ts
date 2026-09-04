export function hasHorizontalOverflow(scrollWidth: number, clientWidth: number) {
  return scrollWidth > clientWidth + 1;
}

export function syncHorizontalScroll(source: { scrollLeft: number }, target: { scrollLeft: number }) {
  if (Math.abs(target.scrollLeft - source.scrollLeft) > 0.5) target.scrollLeft = source.scrollLeft;
}
