import { describe, expect, jest, test } from "@jest/globals";
import { AssistantOperatorRuntime, type AssistantOperatorDecisionProvider, type AssistantOperatorToolExecutor } from "../services/assistant/operatorRuntime";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";

const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/orders", pageTitle: "Orders", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-07T12:00:00.000Z", unsavedChanges: false });
const trustedContext = { scope: { organizationId: "org_1", userId: "user_1" }, actor: { userId: "user_1", email: "user@example.test" }, permissions: ["assistant.internal_staff"], context, correlationId: "correlation_1", goal: "test goal" };

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

  test("describes an unavailable read tool as a capability limitation rather than a safety block", async () => {
    const provider: AssistantOperatorDecisionProvider = {
      decide: async ({ observations }) => {
        if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "quotes.search", arguments: {} }] };
        throw new Error("provider cannot continue after rejected read");
      },
    };
    const tools: AssistantOperatorToolExecutor = {
      catalog: () => [{ name: "quotes.search", description: "Search quotes." }],
      execute: async ({ toolName }) => ({ toolName, status: "rejected", warning: "The requested business tool is not available." }),
    };
    const result = await new AssistantOperatorRuntime(provider, tools).run({ goal: "Show open quotes", taskId: "task_3", trustedContext });
    expect(result).toMatchObject({ status: "failed", response: "I couldn't complete that request because the needed business lookup is unavailable or invalid." });
  });

  test("composes quote detail, customer, and linked-order investigation from a trusted newest-quote reference", async () => {
    const calls: string[] = [];
    const provider: AssistantOperatorDecisionProvider = {
      decide: async ({ observations, task }) => {
        expect(task?.entityReferences).toEqual(expect.arrayContaining([expect.objectContaining({ type: "quote", id: "quote_new" })]));
        if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "quotes.get_detail", arguments: { quoteId: "quote_new" } }] };
        if (observations.length === 1) return { kind: "call_tools", calls: [{ toolName: "customers.get_summary", arguments: { customerId: "customer_new" } }, { toolName: "orders.get_summary", arguments: { orderId: "order_new" } }] };
        return { kind: "complete", response: "QT-910322 has one quoted item; its linked order has one queued production job." };
      },
    };
    const tools: AssistantOperatorToolExecutor = {
      catalog: () => [{ name: "quotes.get_detail", description: "Quote line items and authoritative related-order state." }, { name: "customers.get_summary", description: "Customer summary." }, { name: "orders.get_summary", description: "Order and production summary." }],
      execute: async ({ toolName }) => {
        calls.push(toolName);
        const data = toolName === "quotes.get_detail"
          ? { lineItems: [{ description: "Window graphic" }], relatedOrder: { state: "linked", order: { recordId: "order_new" } } }
          : toolName === "orders.get_summary"
            ? { operational: { production: { totalJobs: 1, queuedJobs: 1 } } }
            : { customer: { recordId: "customer_new" } };
        return { toolName, status: "succeeded", result: { status: "succeeded", data, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } } as any };
      },
    };
    const result = await new AssistantOperatorRuntime(provider, tools).run({
      goal: "Take the newest one and tell me what you can determine about the customer, the items being quoted, and whether there is any related order or production activity.", taskId: "task_quote", trustedContext: { ...trustedContext, task: { id: "task_quote", domain: "quotes", canonicalProductIntentProposalId: null, entityReferences: [{ type: "quote", id: "quote_new", label: "Quote QT-910322" }, { type: "customer", id: "customer_new", label: "Acme" }, { type: "order", id: "order_new", label: "Order ORD-910322" }] },
    });
    expect(result.status).toBe("completed");
    expect(calls).toEqual(["quotes.get_detail", "customers.get_summary", "orders.get_summary"]);
    expect(result.response).not.toMatch(/tool|api|way to view/i);
  });

  test("treats authoritative no-related-order as a completed quote investigation without an order or production lookup", async () => {
    const execute = jest.fn(async ({ toolName }: any) => ({ toolName, status: "succeeded", result: { status: "succeeded", data: { relatedOrder: { state: "none" }, lineItems: [{ description: "Decals" }] }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } } }));
    const provider: AssistantOperatorDecisionProvider = { decide: async ({ observations }) => observations.length ? { kind: "complete", response: "The quote has no related order, so there is no order production activity to inspect." } : { kind: "call_tools", calls: [{ toolName: "quotes.get_detail", arguments: { quoteId: "quote_no_order" } }] } };
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [{ name: "quotes.get_detail", description: "Quote details including relationship state." }], execute }).run({ goal: "Investigate this quote.", taskId: "task_none", trustedContext });
    expect(result.status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "quotes.get_detail" }));
  });

  test("accepts a direct presentation answer from retained quote observations without calling a tool", async () => {
    const execute = jest.fn(async () => { throw new Error("presentation needs no lookup"); });
    const provider: AssistantOperatorDecisionProvider = {
      decide: async ({ task, observations }) => {
        expect(observations).toEqual([]);
        expect(task?.trustedObservations).toEqual([expect.objectContaining({ toolName: "quotes.search", data: expect.objectContaining({ quotes: expect.arrayContaining([expect.objectContaining({ quoteNumber: "QT-910322" })]) }) })]);
        return { kind: "complete", response: "QT-910322 — Acme — $51.00 — Sent\nQT-910321 — Beta — $25.00 — Draft", workingSummary: "Reformatted the five known quotes." };
      },
    };
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [{ name: "quotes.search", description: "Search quotes." }], execute }).run({
      goal: "please separate these into individual lines per quote so I can read them", taskId: "task_format", trustedContext: { ...trustedContext, task: { id: "task_format", domain: "quotes", canonicalProductIntentProposalId: null, entityReferences: [], trustedObservations: [{ toolName: "quotes.search", data: { quotes: [{ quoteNumber: "QT-910322", customer: { name: "Acme" }, total: 51, status: "sent" }, { quoteNumber: "QT-910321", customer: { name: "Beta" }, total: 25, status: "draft" }] }, capturedAt: "2026-08-07T12:00:00.000Z" }], missingInformation: [] } },
    });
    expect(result).toMatchObject({ status: "completed", observations: [] });
    expect(result.response).toContain("\n");
    expect(execute).not.toHaveBeenCalled();
  });

  test("allows a cross-domain presentation answer from retained results without a forced lookup", async () => {
    const execute = jest.fn(async () => { throw new Error("presentation needs no lookup"); });
    const provider: AssistantOperatorDecisionProvider = { decide: async ({ task }) => {
      expect(task?.trustedObservations?.[0]?.toolName).toBe("orders.get_due_summary");
      return { kind: "complete", response: "ORD-20 — due Aug 8\nORD-19 — due Aug 10" };
    } };
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute }).run({ goal: "Put those in order by due date.", taskId: "task_orders", trustedContext: { ...trustedContext, task: { id: "task_orders", domain: "orders", canonicalProductIntentProposalId: null, entityReferences: [], trustedObservations: [{ toolName: "orders.get_due_summary", data: { orders: [{ number: "ORD-20" }, { number: "ORD-19" }] }, capturedAt: "2026-08-07T12:00:00.000Z" }], missingInformation: [] } } });
    expect(result.status).toBe("completed");
    expect(execute).not.toHaveBeenCalled();
  });

  test("stops an identical clarification loop instead of asking the same missing question again", async () => {
    const provider: AssistantOperatorDecisionProvider = { decide: async () => ({ kind: "ask_user", question: "Which quotes would you like separated?", missingInformation: ["quote selection"] }) };
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute: async () => { throw new Error("not called"); } }).run({ goal: "all 5", taskId: "task_loop", trustedContext: { ...trustedContext, task: { id: "task_loop", domain: "quotes", canonicalProductIntentProposalId: null, entityReferences: [], trustedObservations: [], missingInformation: ["quote selection"] } } });
    expect(result).toMatchObject({ status: "failed", missingInformation: [] });
    expect(result.response).toContain("won't repeat");
  });
});
