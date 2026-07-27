import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import { getProofPdfPageCountLabel } from "../lib/proofViewerPageCount";

describe("proof viewer page count", () => {
  test.each([
    [1, "1-page PDF"],
    [2, "2-page PDF"],
    [7, "7-page PDF"],
  ])("describes a %i-page document without claiming to track the visible page", (pageCount, expected) => {
    expect(getProofPdfPageCountLabel({ pageCount, isLoading: false, unavailable: false })).toBe(expected);
  });

  test("shows an honest loading state without fabricating a count", () => {
    expect(getProofPdfPageCountLabel({ pageCount: 0, isLoading: true, unavailable: false })).toBe("PDF page count loading…");
  });

  test("reports an unavailable count without preventing the PDF from being rendered", () => {
    expect(getProofPdfPageCountLabel({ pageCount: 0, isLoading: false, unavailable: true })).toBe("PDF page count unavailable");
  });

  test("keeps the native scrolling PDF viewer without custom page navigation", () => {
    const viewerSource = fs.readFileSync(path.resolve(process.cwd(), "client/src/pages/StaffProofingPage.tsx"), "utf8");

    expect(viewerSource).toContain("<iframe");
    expect(viewerSource).toContain('className="h-full w-full bg-white"');
    expect(viewerSource).toContain("{proofPdfPageCountLabel}");
    expect(viewerSource).not.toContain("proofViewerNavigation");
    expect(viewerSource).not.toContain("setViewerPage(");
    expect(viewerSource).not.toContain("page=${viewerPage}");
  });
});
