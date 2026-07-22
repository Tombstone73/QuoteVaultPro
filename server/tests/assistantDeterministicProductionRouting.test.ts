import { describe, expect, test } from "@jest/globals";
import { resolveDeterministicReadPlan } from "../services/assistant/deterministicReadRouting";

const customerContext = {
  contextVersion: "v1" as const,
  route: "/customers/customer-1",
  pageTitle: "Customer",
  entityType: "customer" as const,
  entityId: "customer-1",
  selectedRecordIds: [],
  activeFilters: [],
  capturedAt: "2026-07-21T12:00:00.000Z",
  unsavedChanges: false,
};

describe("deterministic production reporting routing", () => {
  test("routes a Flatbed queue question as a read-only station reference without customer context", () => {
    const plan = resolveDeterministicReadPlan("How many jobs are in Flatbed, and when is the first one due?", customerContext);
    expect(plan).toMatchObject({
      intent: "production_reporting",
      toolCalls: [{ toolName: "production.get_queue_summary", arguments: { stationKey: "Flatbed", limit: 5 } }],
    });
  });

  test("routes all-station backlog and comparison questions without selecting an arbitrary station", () => {
    for (const question of ["Which station has the largest backlog?", "Compare Flatbed and Roll."]) {
      expect(resolveDeterministicReadPlan(question, customerContext)).toMatchObject({
        toolCalls: [{ toolName: "production.get_queue_summary", arguments: { limit: 10 } }],
      });
    }
  });

  test("routes overdue, fulfillment, and urgent questions with valid applied filters", () => {
    expect(resolveDeterministicReadPlan("Are any jobs overdue?", customerContext)).toMatchObject({ toolCalls: [{ toolName: "operations.get_attention_summary", arguments: { filter: "overdue" } }] });
    expect(resolveDeterministicReadPlan("What is ready for fulfillment?", customerContext)).toMatchObject({ toolCalls: [{ toolName: "operations.get_attention_summary", arguments: { filter: "ready_for_fulfillment" } }] });
    expect(resolveDeterministicReadPlan("Show me the five most urgent production jobs.", customerContext)).toMatchObject({ toolCalls: [{ toolName: "operations.get_attention_summary", arguments: { filter: "urgent", limit: 5 } }] });
  });
});
