import { describe, expect, test } from "@jest/globals";
import { assistantOrderDueSummaryInputSchema } from "@shared/assistantContracts";
import { resolveDeterministicReadPlan } from "../services/assistant/deterministicReadRouting";

describe("customer-scoped order due summary normalization", () => {
  test("normalizes the failed Graphic Solutions request before provider planning", () => {
    const plan = resolveDeterministicReadPlan("give me a report for graphic solutions for all jobs that are due last week or this week");

    expect(plan).toMatchObject({
      intent: "analytical_reporting",
      selectedSkill: "deterministic_customer_order_due_summary",
      toolCalls: [{
        toolName: "orders.get_due_summary",
        arguments: {
          due: "last_week_through_current_week",
          customer: { name: "graphic solutions" },
          limit: 10,
          includeOperationalSummary: true,
        },
      }],
    });
    expect(assistantOrderDueSummaryInputSchema.safeParse(plan?.toolCalls[0]?.arguments).success).toBe(true);
  });

  test("rejects malformed explicit date ranges without accepting invalid provider arguments", () => {
    expect(assistantOrderDueSummaryInputSchema.safeParse({
      due: "date_range",
      dateRange: { start: "2026-07-27", end: "2026-07-20" },
    }).success).toBe(false);
    expect(assistantOrderDueSummaryInputSchema.safeParse({
      due: "last_week_or_this_week",
      customerName: "Graphic Solutions",
    }).success).toBe(false);
  });
});
