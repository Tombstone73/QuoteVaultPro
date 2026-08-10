import { describe, expect, test } from "@jest/globals";
import { runOperatorAnalysis } from "../services/assistant/operatorAnalysisWorkspace";
import { AssistantOperatorRuntime, type AssistantOperatorDecisionProvider } from "../services/assistant/operatorRuntime";

const context: any = {
  scope: { organizationId: "org_1", userId: "user_1" },
  conversationId: "conversation_1",
  actor: { userId: "user_1", email: "user@example.test" },
  permissions: ["assistant.internal_staff"],
  context: { contextVersion: "v1", route: "/invoices", pageTitle: "Invoices", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-07T12:00:00.000Z", unsavedChanges: false },
  correlationId: "corr_1",
  goal: "Analyze invoices",
  analysisObservations: [{
    step: 1, toolName: "authorized.invoices", status: "succeeded",
    result: { status: "succeeded", data: { invoices: [
      { customer: "Acme", total: 8.88, paid: false }, { customer: "Acme", total: 8.88, paid: true },
      { customer: "Beta", total: 0, paid: false }, { customer: "Beta", total: 8.88, paid: false },
    ] }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } },
  }],
};

describe("operator analysis workspace", () => {
  test("groups authorized observations accurately, preserving tied maxima for the operator to interpret", () => {
    const result = runOperatorAnalysis({
      purpose: "Calculate customer totals from released invoice rows.",
      dataset: { source: "current_turn", toolName: "authorized.invoices", path: "invoices" },
      program: { operations: [{ op: "group", by: ["customer"], metrics: [{ as: "invoiceCount", op: "count" }, { as: "total", op: "sum", field: "total" }] }, { op: "sort", field: "total", direction: "descending" }] },
    }, context);
    expect(result.rows).toEqual([{ customer: "Acme", invoiceCount: 2, total: 17.76 }, { customer: "Beta", invoiceCount: 2, total: 8.88 }]);
  });

  test("supports AI-selected period comparison without a customer-decline report endpoint", () => {
    const comparisonContext: any = {
      ...context,
      analysisObservations: [{
        step: 1, toolName: "analytics.invoice_activity", status: "succeeded",
        result: { status: "succeeded", data: { invoices: [
          { customerName: "Acme", postedAt: "2026-07-03T12:00:00.000Z", totalCents: 20000 },
          { customerName: "Acme", postedAt: "2026-08-03T12:00:00.000Z", totalCents: 15000 },
          { customerName: "Beta", postedAt: "2026-07-03T12:00:00.000Z", totalCents: 10000 },
          { customerName: "Beta", postedAt: "2026-08-03T12:00:00.000Z", totalCents: 10000 },
        ] }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } },
      }],
    };
    const result = runOperatorAnalysis({
      purpose: "Compare AI-selected comparable first-week customer spend periods.",
      dataset: { source: "current_turn", toolName: "analytics.invoice_activity", path: "invoices" },
      program: { operations: [
        { op: "classify_range", as: "period", field: "postedAt", ranges: [
          { label: "historical", start: "2026-07-01T00:00:00.000Z", endExclusive: "2026-07-08T00:00:00.000Z" },
          { label: "current", start: "2026-08-01T00:00:00.000Z", endExclusive: "2026-08-08T00:00:00.000Z" },
        ] },
        { op: "group", by: ["customerName", "period"], metrics: [{ as: "spendCents", op: "sum", field: "totalCents" }] },
        { op: "pivot", by: ["customerName"], column: "period", values: [
          { columnValue: "current", field: "spendCents", as: "currentSpendCents" },
          { columnValue: "historical", field: "spendCents", as: "historicalSpendCents" },
        ] },
        { op: "calculate", fields: [{ as: "percentChange", calculation: "percent_change", fields: ["currentSpendCents", "historicalSpendCents"] }] },
        { op: "sort", field: "percentChange", direction: "ascending" },
      ] },
    }, comparisonContext);
    expect(result.rows).toEqual([
      { customerName: "Acme", currentSpendCents: 15000, historicalSpendCents: 20000, percentChange: -25 },
      { customerName: "Beta", currentSpendCents: 10000, historicalSpendCents: 10000, percentChange: 0 },
    ]);
  });

  test("accepts only task-bound released observations and rejects arbitrary code, paths, and missing dataset references", () => {
    expect(() => runOperatorAnalysis({
      purpose: "Run code", dataset: { source: "current_turn", toolName: "authorized.invoices", path: "invoices" },
      program: { operations: [{ op: "eval", code: "process.env.SECRET" }] },
    }, context)).toThrow();
    expect(() => runOperatorAnalysis({
      purpose: "Read outside data", dataset: { source: "trusted_task", toolName: "other_tenant.invoices", path: "invoices" },
      program: { operations: [{ op: "limit", count: 1 }] },
    }, context)).toThrow("not available");
    expect(() => runOperatorAnalysis({
      purpose: "Read an unsafe path", dataset: { source: "current_turn", toolName: "authorized.invoices", path: "__proto__.env" },
      program: { operations: [{ op: "limit", count: 1 }] },
    }, context)).toThrow();
  });

  test("returns analysis as an operator observation so the provider can continue or answer directly", async () => {
    const provider: AssistantOperatorDecisionProvider = { decide: async ({ observations }) => {
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "authorized.invoices", arguments: {} }] };
      if (observations.length === 1) return { kind: "call_tools", calls: [{ toolName: "analysis.run", arguments: {
        purpose: "Total authorized invoices", dataset: { source: "current_turn", toolName: "authorized.invoices", path: "invoices" },
        program: { operations: [{ op: "summarize", metrics: [{ as: "total", op: "sum", field: "total" }] }] },
      } }] };
      expect(observations[1]?.result?.data).toMatchObject({ summary: { total: 17.76 } });
      return { kind: "complete", response: "The authorized invoice total is $17.76." };
    } };
    const runtime = new AssistantOperatorRuntime(provider, {
      catalog: () => [{ name: "authorized.invoices", description: "Released invoice rows." }, { name: "analysis.run", description: "Declarative analysis." }],
      execute: async ({ toolName, arguments: args, context: executionContext }) => toolName === "authorized.invoices"
        ? { toolName, status: "succeeded", result: { status: "succeeded", data: { invoices: [{ total: 8.88 }, { total: 8.88 }] }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } } as any }
        : { toolName, status: "succeeded", result: { status: "succeeded", data: runOperatorAnalysis(args, executionContext), provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } } as any },
    });
    const result = await runtime.run({ goal: "Analyze invoices", taskId: "task_1", trustedContext: context });
    expect(result).toMatchObject({ status: "completed", response: "The authorized invoice total is $17.76." });
    expect(result.observations.map((item) => item.toolName)).toEqual(["authorized.invoices", "analysis.run"]);
  });
});
