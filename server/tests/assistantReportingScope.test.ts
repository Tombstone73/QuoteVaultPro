import { describe, expect, test } from "@jest/globals";
import { resolveDeterministicReadPlan } from "../services/assistant/deterministicReadRouting";
import { resolveExplicitReportingScope } from "../services/assistant/reportingScope";

describe("assistant reporting scope", () => {
  test("classifies supported explicit reporting scopes", () => {
    expect(resolveExplicitReportingScope("Are any orders overdue?")).toBe("order");
    expect(resolveExplicitReportingScope("Are any production jobs overdue?")).toBe("production_job");
    expect(resolveExplicitReportingScope("How many incomplete line items are overdue?")).toBe("order_line");
    expect(resolveExplicitReportingScope("How many prints remain?")).toBe("print_quantity");
    expect(resolveExplicitReportingScope("Which invoices are overdue?")).toBe("invoice");
  });

  test("routes explicit order scope before the production attention shortcut", () => {
    expect(resolveDeterministicReadPlan("Are any orders overdue?", { contextVersion: "v1", route: "/production/flatbed", pageTitle: "Flatbed", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-07-21T12:00:00.000Z", unsavedChanges: false })).toMatchObject({
      selectedSkill: "deterministic_order_due_summary",
      toolCalls: [{ toolName: "orders.get_due_summary", arguments: { due: "overdue" } }],
    });
  });

  test("keeps explicit production-job scope on the existing production read path", () => {
    expect(resolveDeterministicReadPlan("Are any production jobs overdue?")).toMatchObject({
      selectedSkill: "deterministic_production_attention",
      toolCalls: [{ toolName: "operations.get_attention_summary", arguments: { filter: "overdue" } }],
    });
  });
});
