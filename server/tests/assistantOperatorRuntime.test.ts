import { describe, expect, test } from "@jest/globals";
import { AssistantOperatorRuntime, type AssistantOperatorDecisionProvider, type AssistantOperatorToolExecutor } from "../services/assistant/operatorRuntime";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";

const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/orders", pageTitle: "Orders", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-07T12:00:00.000Z", unsavedChanges: false });
const trustedContext = { scope: { organizationId: "org_1", userId: "user_1" }, actor: { userId: "user_1", email: "user@example.test" }, permissions: ["assistant.internal_staff"], context, correlationId: "correlation_1" };

describe("AssistantOperatorRuntime", () => {
  test("composes an alternate investigation after incomplete evidence", async () => {
    const provider: AssistantOperatorDecisionProvider = {
      decide: async ({ observations }) => observations.length === 0
        ? { kind: "call_tools", calls: [{ toolName: "pricing.snapshot", arguments: { product: "translucent vinyl" } }], workingSummary: "Looking for a current price." }
        : observations.length === 1
          ? { kind: "call_tools", calls: [{ toolName: "products.get_summary", arguments: { query: "regular translucent vinyl" } }], workingSummary: "The first price source was incomplete, so I am checking the catalog." }
          : { kind: "complete", response: "The current catalog price is $5.50 per square foot.", workingSummary: "Price confirmed from the catalog." },
    };
    const tools: AssistantOperatorToolExecutor = {
      catalog: () => [{ name: "search.global", description: "Search tenant records." }],
      execute: async ({ toolName }) => toolName === "pricing.snapshot"
        ? { toolName, status: "partial", result: { status: "partial", data: { price: null }, warning: "No active snapshot." } as any }
        : { toolName, status: "succeeded", result: { status: "succeeded", data: { priceCents: 550 }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } } as any },
    };
    const result = await new AssistantOperatorRuntime(provider, tools).run({ goal: "What do we charge for regular translucent vinyl?", taskId: "task_1", trustedContext });
    expect(result.status).toBe("completed");
    expect(result.observations.map((item) => item.toolName)).toEqual(["pricing.snapshot", "products.get_summary"]);
    expect(result.observations[0]?.status).toBe("partial");
    expect(result.response).toContain("$5.50");
  });

  test("asks only for genuinely missing business information", async () => {
    const provider: AssistantOperatorDecisionProvider = { decide: async () => ({ kind: "ask_user", question: "Which product category should this use?", missingInformation: ["product category"] }) };
    const tools: AssistantOperatorToolExecutor = { catalog: () => [], execute: async () => { throw new Error("not called"); } };
    const result = await new AssistantOperatorRuntime(provider, tools).run({ goal: "Create a product", taskId: "task_2", trustedContext });
    expect(result).toMatchObject({ status: "awaiting_input", missingInformation: ["product category"] });
  });
});
