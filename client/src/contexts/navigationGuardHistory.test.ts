import { describe, expect, it } from "@jest/globals";
import { getBlockedPopReversalDelta } from "./navigationGuardHistory";

describe("getBlockedPopReversalDelta", () => {
  it("returns +1 when a blocked back navigation should move forward again", () => {
    expect(getBlockedPopReversalDelta({ currentHistoryIndex: 3, lastStableHistoryIndex: 4 })).toBe(1);
  });

  it("returns -1 when a blocked forward navigation should move backward again", () => {
    expect(getBlockedPopReversalDelta({ currentHistoryIndex: 5, lastStableHistoryIndex: 4 })).toBe(-1);
  });

  it("falls back when either history index is unavailable", () => {
    expect(getBlockedPopReversalDelta({ currentHistoryIndex: null, lastStableHistoryIndex: 4 })).toBeNull();
    expect(getBlockedPopReversalDelta({ currentHistoryIndex: 4, lastStableHistoryIndex: null })).toBeNull();
  });

  it("does nothing when the history index already matches the stable entry", () => {
    expect(getBlockedPopReversalDelta({ currentHistoryIndex: 4, lastStableHistoryIndex: 4 })).toBeNull();
  });
});
