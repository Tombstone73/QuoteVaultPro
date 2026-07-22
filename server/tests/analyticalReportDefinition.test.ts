import { describe, expect, test } from "@jest/globals";
import { createCustomerAnalyticsReportDefinition } from "../services/assistant/analyticalReportDefinition";
import { customerSafeReportDefinition } from "@shared/aiReportingContracts";

const snapshotAt = "2026-07-22T12:00:00.000Z";

describe("customer analytics report definition", () => {
  test("preserves contact-to-company provenance and labels order value as operational", () => {
    const definition = createCustomerAnalyticsReportDefinition({
      companyName: "Graphic Solutions", resolutionType: "contact", contactName: "Rick Clark",
      explanation: "Found Rick Clark at Graphic Solutions; analytics use the company account.",
      dateRange: { start: "2026-07-01", end: "2026-07-31" }, financialSource: "order_value",
      timezone: "America/New_York", dataSnapshotAt: snapshotAt, sourceRecordCount: 1,
      sections: [{ kind: "executive_summary", text: "One uninvoiced order is represented as operational value." }],
    });

    expect(definition).toMatchObject({
      financialSource: "order_value",
      filters: { company: "Graphic Solutions", contactResolution: expect.stringContaining("Rick Clark"), dateRange: { start: "2026-07-01" } },
      sources: [{ label: "Qualifying order financial snapshots" }],
    });
    expect(definition.sections.at(-1)).toMatchObject({ kind: "methodology", text: expect.stringContaining("not recognized revenue") });
  });

  test("keeps the financial-source classification after customer-safe transformation", () => {
    const definition = createCustomerAnalyticsReportDefinition({
      companyName: "Graphic Solutions", resolutionType: "company", explanation: "Resolved company account Graphic Solutions.",
      dateRange: { start: "2026-07-01", end: "2026-07-31" }, financialSource: "combined_pipeline_view",
      timezone: "America/New_York", dataSnapshotAt: snapshotAt, sourceRecordCount: 2,
      sections: [{ kind: "executive_summary", text: "Revenue and pipeline are separate." }],
    });
    const safe = customerSafeReportDefinition(definition);

    expect(safe).toMatchObject({ audience: "customer_safe", financialSource: "combined_pipeline_view", sources: [] });
    expect(safe.sections.some((section) => section.kind === "methodology")).toBe(false);
  });
});
