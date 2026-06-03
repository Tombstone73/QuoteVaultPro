import { describe, expect, test } from "@jest/globals";
import { formatReportReferenceList } from "../lib/aiTriageBriefPdf";

describe("AI triage brief PDF helpers", () => {
  test("formats permanent report references from the saved snapshot", () => {
    const references = formatReportReferenceList([
      { id: "bug_1", referenceNumber: "B-0001", title: "Can't send quotes" },
      { id: "feature_1", referenceNumber: "F-0001", title: "OCR PDF Order Entry" },
    ]);

    expect(references).toContain("B-0001 Can't send quotes");
    expect(references).toContain("F-0001 OCR PDF Order Entry");
  });
});
