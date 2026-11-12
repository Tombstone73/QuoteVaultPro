export function checkProductionLabelLayout(document: Document, expectedCount: number) {
  const labels = Array.from(document.querySelectorAll<HTMLElement>(".production-item-label .label-content"));
  if (labels.length !== expectedCount) throw new Error("Some label pages did not render. Preview the labels again.");
  const overflow = labels.findIndex(label =>
    !label.clientHeight || !label.clientWidth || label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1,
  );
  if (overflow >= 0) throw new Error("Label " + (overflow + 1) + " does not fit this media. Choose a larger label or hide optional fields.");
}
