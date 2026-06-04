import { describe, expect, it } from "@jest/globals";

import { parseProductPlanningCsv } from "../services/productPlanningCsv";

describe("Product Planning CSV import mapping", () => {
  it("maps ChatGPT-style backlog columns into work item fields", () => {
    const preview = parseProductPlanningCsv([
      "Feature ID,Module,Submodule,Feature Name,Description,Business Value,Priority,Complexity,Phase,Status,Dependencies,Requested By,Notes,Tags",
      "EXT-1,Quotes,Editor,Inline approval hints,Show clearer approval state,Very High,Critical,Large,Go Live,In Progress,Approval settings,Dale,Keep compact,approval;quotes",
    ].join("\n"));

    expect(preview.counts).toMatchObject({ parsed: 1, valid: 1, invalid: 0 });
    expect(preview.validRows[0]).toMatchObject({
      title: "Inline approval hints",
      module: "Quotes",
      submodule: "Editor",
      businessValue: "very_high",
      priority: "critical",
      complexity: "large",
      phase: "go_live",
      planningStatus: "in_progress",
      sourceReference: "EXT-1",
      requestedBy: "Dale",
      tags: ["approval", "quotes"],
    });
    expect(preview.validRows[0].notes).toContain("Dependencies: Approval settings");
  });

  it("keeps unknown values as warnings instead of invalidating the row", () => {
    const preview = parseProductPlanningCsv("Title,Priority,Phase\nOdd row,Ultra,Someday");

    expect(preview.counts.valid).toBe(1);
    expect(preview.counts.warnings).toBe(2);
    expect(preview.validRows[0].priority).toBe("medium");
    expect(preview.validRows[0].phase).toBeNull();
  });

  it("marks rows without a title invalid", () => {
    const preview = parseProductPlanningCsv("Module,Priority\nOrders,High");

    expect(preview.counts.valid).toBe(0);
    expect(preview.counts.invalid).toBe(1);
    expect(preview.invalidRows[0].errors).toContain("Title is required.");
  });
});
