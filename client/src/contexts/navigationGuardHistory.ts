export function readHistoryIndex(): number | null {
  if (typeof window === "undefined") return null;
  const idx = window.history.state?.idx;
  return typeof idx === "number" ? idx : null;
}

export function getBlockedPopReversalDelta(input: {
  currentHistoryIndex: number | null;
  lastStableHistoryIndex: number | null;
}): 1 | -1 | null {
  const { currentHistoryIndex, lastStableHistoryIndex } = input;
  if (currentHistoryIndex === null || lastStableHistoryIndex === null) return null;
  if (currentHistoryIndex === lastStableHistoryIndex) return null;
  return lastStableHistoryIndex > currentHistoryIndex ? 1 : -1;
}
