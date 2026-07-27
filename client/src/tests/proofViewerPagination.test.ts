import { describe, expect, test } from "@jest/globals";

import { clampProofViewerPage, getProofViewerNavigation } from "../lib/proofViewerPagination";

describe("proof viewer pagination", () => {
  test("uses the loaded proof page count for a two-page proof", () => {
    expect(getProofViewerNavigation(1, 2)).toMatchObject({ currentPage: 1, canGoPrevious: false, canGoNext: true });
    expect(getProofViewerNavigation(2, 2)).toMatchObject({ currentPage: 2, canGoPrevious: true, canGoNext: false });
  });

  test("clamps stale page state when the selected proof changes", () => {
    expect(clampProofViewerPage(4, 1)).toBe(1);
    expect(getProofViewerNavigation(1, 1)).toMatchObject({ canGoPrevious: false, canGoNext: false });
  });
});
