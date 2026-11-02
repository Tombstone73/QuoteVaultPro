import { describe, expect, it } from "@jest/globals";
import { PRINTING_SPECIFICATION_GUIDANCE, printingNotation, printingSidesFromEvidence } from "../printingSpecifications";

describe("shared printing evidence vocabulary", () => {
  it.each([["Prints4/4", "double"], ["Printing: 4/0", "single"], ["4/4", "double"], ["4/0 full color", "single"]])("interprets %s in printing context", (text, side) => {
    expect(printingSidesFromEvidence(text)).toEqual([side]);
  });
  it.each(["Due 4/4", "Due date: 4/4/2026", "Scale 4/4", "We received this on 4/4", "PO 44/44"]) ("does not interpret %s as printing", text => {
    expect(printingNotation(text)).toEqual([]);
  });
  it("preserves conflicting evidence for clarification", () => {
    expect(printingSidesFromEvidence("Single-sided; Prints 4/4")).toEqual(["single", "double"]);
    expect(PRINTING_SPECIFICATION_GUIDANCE).toContain("blank back");
  });
});
