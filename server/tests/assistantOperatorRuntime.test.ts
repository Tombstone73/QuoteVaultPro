import { describe, expect, jest, test } from "@jest/globals";
import { AssistantOperatorRuntime, ASSISTANT_OPERATOR_MAX_STEPS, parseAssistantOperatorDecisionText, resolveAiOperatorMaxSteps, type AssistantOperatorDecisionProvider, type AssistantOperatorToolExecutor } from "../services/assistant/operatorRuntime";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";

const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/orders", pageTitle: "Orders", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-07T12:00:00.000Z", unsavedChanges: false });
const trustedContext = { scope: { organizationId: "org_1", userId: "user_1" }, actor: { userId: "user_1", email: "user@example.test" }, permissions: ["assistant.internal_staff"], context, correlationId: "correlation_1", goal: "test goal" };

describe("AssistantOperatorRuntime", () => {
  test("uses a configurable bounded investigation budget with a sixteen-step default", () => {
    expect(resolveAiOperatorMaxSteps({} as NodeJS.ProcessEnv)).toBe(16);
    expect(resolveAiOperatorMaxSteps({ AI_OPERATOR_MAX_STEPS: "20" } as NodeJS.ProcessEnv)).toBe(20);
    expect(resolveAiOperatorMaxSteps({ AI_OPERATOR_MAX_STEPS: "999" } as NodeJS.ProcessEnv)).toBe(ASSISTANT_OPERATOR_MAX_STEPS);
    expect(resolveAiOperatorMaxSteps({ AI_OPERATOR_MAX_STEPS: "invalid" } as NodeJS.ProcessEnv)).toBe(16);
  });

  test("recognizes only complete schema-valid Operator control JSON", () => {
    expect(parseAssistantOperatorDecisionText('{"kind":"continue","workingSummary":"Searching catalog."}')).toEqual({ kind: "continue", workingSummary: "Searching catalog." });
    expect(parseAssistantOperatorDecisionText('{"kind":"call_tools","calls":[{"toolName":"search.global","arguments":{"query":"banner"}}]}')).toMatchObject({ kind: "call_tools" });
    expect(parseAssistantOperatorDecisionText('{"kind":"ask_user","question":"Which size?","missingInformation":["size"]}')).toMatchObject({ kind: "ask_user" });
    expect(parseAssistantOperatorDecisionText('{"kind":"complete","response":"Done."}')).toMatchObject({ kind: "complete" });
    expect(parseAssistantOperatorDecisionText('{"kind":"fail","response":"Unavailable."}')).toMatchObject({ kind: "fail" });
    expect(parseAssistantOperatorDecisionText('{"kind":"continue"')).toBeNull();
    expect(parseAssistantOperatorDecisionText('{"kind":"unknown","response":"No."}')).toBeNull();
    expect(parseAssistantOperatorDecisionText('{"requested":"json"}')).toBeNull();
    expect(parseAssistantOperatorDecisionText('"{\\"kind\\":\\"continue\\",\\"workingSummary\\":\\"Continuing to check whether the product exists and establish a trusted product reference before configuring the new product.\\"}"')).toEqual({ kind: "continue", workingSummary: "Continuing to check whether the product exists and establish a trusted product reference before configuring the new product." });
    expect(parseAssistantOperatorDecisionText('"{\\"kind\\":\\"complete\\",\\"response\\":\\"Done.\\"}"')).toMatchObject({ kind: "complete", response: "Done." });
    expect(parseAssistantOperatorDecisionText('"{\\"kind\\":\\"ask_user\\",\\"question\\":\\"Which size?\\",\\"missingInformation\\":[\\"size\\"]}"')).toMatchObject({ kind: "ask_user" });
    expect(parseAssistantOperatorDecisionText('"{\\"kind\\":\\"fail\\",\\"response\\":\\"Unavailable.\\"}"')).toMatchObject({ kind: "fail" });
    expect(parseAssistantOperatorDecisionText('"{\\"kind\\":\\"call_tools\\",\\"calls\\":[{\\"toolName\\":\\"search.global\\",\\"arguments\\":{}}]}"')).toMatchObject({ kind: "call_tools" });
    expect(parseAssistantOperatorDecisionText('"{not valid}"')).toBeNull();
    expect(parseAssistantOperatorDecisionText('{"example":"ordinary JSON remains visible"}')).toBeNull();
  });

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

  test("continues after provider-native web activity that has no final content yet", async () => {
    const provider: AssistantOperatorDecisionProvider = {
      decide: jest.fn(async ({ step }) => step === 1
        ? { kind: "continue", workingSummary: "Continuing public research." }
        : { kind: "complete", response: "I found current public product information with sources." }),
    };
    const execute = jest.fn(async () => { throw new Error("no PrintersHero tool should run"); });
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute }).run({ goal: "Research printable sidewalk vinyl.", taskId: "task_web", trustedContext });

    expect(result).toMatchObject({ status: "completed", response: "I found current public product information with sources." });
    expect(provider.decide).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  test("allows multiple provider-native web continuations before a final answer", async () => {
    const provider: AssistantOperatorDecisionProvider = {
      decide: jest.fn(async ({ step }) => step < 3
        ? { kind: "continue", workingSummary: "Continuing public research." }
        : { kind: "complete", response: "I completed the multi-source public research." }),
    };
    const execute = jest.fn(async () => { throw new Error("native web research is not a PrintersHero function"); });
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute }).run({ goal: "Research several current printable sidewalk vinyl options.", taskId: "task_multi_web", trustedContext });

    expect(result).toMatchObject({ status: "completed", response: "I completed the multi-source public research." });
    expect(provider.decide).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
  });

  test("completes a realistic investigation that exceeds the legacy eight-decision limit", async () => {
    const provider: AssistantOperatorDecisionProvider = { decide: jest.fn(async ({ step }) => step < 11
      ? step % 2 === 0
        ? { kind: "call_tools", calls: [{ toolName: step === 2 ? "search.global" : step === 4 ? "products.get_summary" : step === 6 ? "products.get_pricing" : step === 8 ? "analysis.run" : "web.open", arguments: {} }] }
        : { kind: "continue", workingSummary: "Continuing the authorized investigation." }
      : { kind: "complete", response: "I completed the internal and public comparison from the gathered evidence." }), };
    const execute = jest.fn(async ({ toolName }) => ({ toolName, status: "succeeded" as const, result: { status: "succeeded" as const, data: { verified: true }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-08T12:00:00.000Z" } } } as any }));
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute }).run({ goal: "Compare banner pricing with current public options.", taskId: "task_long", trustedContext });

    expect(result).toMatchObject({ status: "completed", response: expect.stringContaining("completed") });
    expect(provider.decide).toHaveBeenCalledTimes(11);
    expect(result.diagnostics).toMatchObject({ configuredMaxSteps: 16, stepsConsumed: 11, providerDecisionCount: 11, printersHeroToolDecisionCount: 5, continuationCount: 5, finalSynthesisUsed: false });
  });

  test("uses one evidence-only final synthesis instead of asking the user to retry at the safety limit", async () => {
    const provider: AssistantOperatorDecisionProvider = { decide: jest.fn(async ({ step, finalSynthesis, toolCatalog, observations }) => {
      if (finalSynthesis) {
        expect(step).toBe(3);
        expect(toolCatalog).toEqual([]);
        expect(observations).toHaveLength(2);
        return { kind: "complete", response: "I established the internal price, but the available research capacity did not produce enough comparable local offers for a reliable market conclusion." };
      }
      return { kind: "call_tools", calls: [{ toolName: "products.get_pricing", arguments: {} }], workingSummary: "Gathering authorized pricing." };
    }) };
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [{ name: "products.get_pricing", description: "Price" }], execute: async ({ toolName }) => ({ toolName, status: "succeeded", result: { status: "succeeded", data: { priceCents: 12500 }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-08T12:00:00.000Z" } } } as any }) }, 2).run({ goal: "Compare banner prices.", taskId: "task_synthesis", trustedContext });

    expect(result).toMatchObject({ status: "completed", diagnostics: { finalSynthesisUsed: true, configuredMaxSteps: 2, stepsConsumed: 2, providerDecisionCount: 3 } });
    expect(result.response).not.toContain("Please try again");
    expect(result.response).not.toContain('"kind"');
  });

  test("keeps a mixed catalog, pricing, and native-web investigation inside the Operator loop", async () => {
    const provider: AssistantOperatorDecisionProvider = {
      decide: jest.fn(async ({ step }) => {
        if (step === 1) return { kind: "continue", workingSummary: "Searching the catalog for a trusted banner reference." };
        if (step === 2) return { kind: "call_tools", calls: [{ toolName: "search.global", arguments: { query: "13 oz banner", limit: 5 } }], workingSummary: "Found candidate products and am confirming the pricing input." };
        if (step === 3) return { kind: "call_tools", calls: [{ toolName: "products.get_pricing", arguments: { productId: "banner_13oz", quantity: 1 } }], workingSummary: "Comparing authorized internal pricing with public evidence." };
        if (step === 4) return { kind: "continue", workingSummary: "Continuing public research." };
        return { kind: "complete", response: "Our authorized 13 oz banner price is competitive with the Indianapolis evidence I found." };
      }),
    };
    const execute = jest.fn(async ({ toolName }) => ({
      toolName,
      status: "succeeded" as const,
      result: { status: "succeeded" as const, data: toolName === "search.global" ? { matches: [{ id: "banner_13oz" }] } : { totalCents: 12500 }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-08T12:00:00.000Z" } } } as any,
    }));

    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute }).run({ goal: "Are our 13 oz banner prices competitive around Indianapolis?", taskId: "task_banner", trustedContext });

    expect(result).toMatchObject({ status: "completed", response: "Our authorized 13 oz banner price is competitive with the Indianapolis evidence I found." });
    expect(provider.decide).toHaveBeenCalledTimes(5);
    expect(execute.mock.calls.map(([input]) => input.toolName)).toEqual(["search.global", "products.get_pricing"]);
    expect(result.response).not.toContain('"kind":"continue"');
  });

  test("keeps successful observations available after a later tool failure", async () => {
    const provider: AssistantOperatorDecisionProvider = {
      decide: async ({ observations }) => observations.length === 0
        ? { kind: "call_tools", calls: [{ toolName: "products.get_summary", arguments: { query: "13 oz banner" } }] }
        : observations.length === 1
          ? { kind: "call_tools", calls: [{ toolName: "web.search", arguments: { query: "Indianapolis banner pricing" } }] }
          : { kind: "complete", response: "I found your internal banner pricing, but public market research was unavailable, so I cannot make a reliable comparison yet." },
    };
    const result = await new AssistantOperatorRuntime(provider, {
      catalog: () => [],
      execute: async ({ toolName }) => toolName === "products.get_summary"
        ? { toolName, status: "succeeded", result: { status: "succeeded", data: { products: ["Banner"] }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-07T12:00:00.000Z" } } } as any }
        : { toolName, status: "failed", warning: "Public research was unavailable." },
    }).run({ goal: "Compare our 13 oz banner prices with Indianapolis.", taskId: "task_mixed", trustedContext });

    expect(result.status).toBe("completed");
    expect(result.observations.map((item) => item.status)).toEqual(["succeeded", "failed"]);
    expect(result.response).toContain("internal banner pricing");
  });

  test("blocks repeated equivalent deterministic failures and leaves the provider free to use another capability", async () => {
    const execute = jest.fn(async ({ toolName }: any) => toolName === "search.global"
      ? { toolName, status: "failed" as const, warning: "The business lookup could not be completed.", failureCode: "adapter_failed", failureCategory: "adapter_failed", failingStep: "tool_execution" }
      : { toolName, status: "succeeded" as const, result: { status: "succeeded" as const, data: { priced: true }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-10T00:00:00.000Z" } } } as any });
    const provider: AssistantOperatorDecisionProvider = { decide: async ({ observations }) => {
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "search.global", arguments: { query: "Banner", entityType: "product" } }] };
      if (observations.length === 1) return { kind: "call_tools", calls: [{ toolName: "search.global", arguments: { entityType: "product", query: "Banner" } }] };
      if (observations.length === 2) return { kind: "call_tools", calls: [{ toolName: "products.get_pricing", arguments: {} }] };
      return { kind: "complete", response: "I used the available pricing capability after the search failure." };
    } };

    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute }).run({ goal: "Price this trusted product.", taskId: "task_no_repeat", trustedContext });

    expect(execute.mock.calls.map(([call]: any[]) => call.toolName)).toEqual(["search.global", "products.get_pricing"]);
    expect(result.observations).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "search.global", status: "rejected", warning: expect.stringContaining("already failed deterministically") })]));
    expect(result.status).toBe("completed");
  });

  test("normalizes lifecycle defaults and stops a repeated rejected existing-product proposal", async () => {
    const execute = jest.fn(async ({ toolName }: any) => ({ toolName, status: "rejected" as const, warning: "Resolve exactly one existing product before preparing an edit.", failureCategory: "entity_resolution", failureCode: "existing_product_target_unresolved", failingStep: "existing_product_resolution", operationType: "update_product_lifecycle" }));
    const provider: AssistantOperatorDecisionProvider = { decide: jest.fn(async ({ observations }) => observations.length === 0
      ? { kind: "call_tools", calls: [{ toolName: "products.apply_existing_operations", arguments: { operations: [{ op: "update_product_lifecycle", isActive: false }] } }] }
      : { kind: "call_tools", calls: [{ toolName: "products.apply_existing_operations", arguments: { operations: [{ isActive: false, confirmPublishWarnings: false, op: "update_product_lifecycle" }] } }] }) };

    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute }).run({ goal: "Deactivate the active Banner product.", taskId: "task_existing_rejection", trustedContext });

    expect(result).toMatchObject({ status: "failed", response: "Resolve exactly one existing product before preparing an edit." });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.observations).toEqual([
      expect.objectContaining({ status: "rejected", failureCode: "existing_product_target_unresolved" }),
      expect.objectContaining({ status: "rejected", warning: expect.stringContaining("not attempted again") }),
    ]);
  });

  test("permits a corrected existing-product proposal after the rejected operation changes", async () => {
    const execute = jest.fn(async ({ toolName, arguments: args }: any) => args.operations[0].isActive === false
      ? { toolName, status: "rejected" as const, warning: "No lifecycle change is available.", failureCategory: "business_validation", failureCode: "NO_PRODUCT_LIFECYCLE_CHANGES", operationType: "update_product_lifecycle" }
      : { toolName, status: "succeeded" as const, result: { status: "succeeded" as const, data: { response: "Prepared one protected lifecycle proposal." }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-10T00:00:00.000Z" } } } as any });
    const provider: AssistantOperatorDecisionProvider = { decide: jest.fn(async ({ observations }) => observations.length === 0
      ? { kind: "call_tools", calls: [{ toolName: "products.apply_existing_operations", arguments: { operations: [{ op: "update_product_lifecycle", isActive: false }] } }] }
      : observations.length === 1
        ? { kind: "call_tools", calls: [{ toolName: "products.apply_existing_operations", arguments: { operations: [{ op: "update_product_lifecycle", isActive: true }] } }] }
        : { kind: "complete", response: "I prepared one protected Product lifecycle plan. No change has been made; GO is required." }) };

    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute }).run({ goal: "Correct the requested lifecycle operation.", taskId: "task_existing_corrected", trustedContext });

    expect(result.status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.response).toContain("GO is required");
  });

  test("uses pricing directly for a trusted current product without rediscovery", async () => {
    const execute = jest.fn(async ({ toolName, arguments: args }: any) => {
      expect(toolName).toBe("products.get_pricing");
      expect(args).toEqual({});
      return { toolName, status: "succeeded" as const, result: { status: "succeeded" as const, data: { totals: [4000, 4400, 5200, 5000, 5500, 6500] }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-10T00:00:00.000Z" } } } as any };
    });
    const provider: AssistantOperatorDecisionProvider = { decide: async ({ observations, task }) => {
      expect(task?.entityReferences).toEqual([expect.objectContaining({ type: "product", id: "product_translucent" })]);
      return observations.length
        ? { kind: "complete", response: "3 Layer: $40, $44, $52. 5 Layer: $50, $55, $65." }
        : { kind: "call_tools", calls: [{ toolName: "products.get_pricing", arguments: {} }] };
    } };

    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute }).run({
      goal: "Show pricing for this product.", taskId: "task_trusted_pricing",
      trustedContext: { ...trustedContext, task: { id: "task_trusted_pricing", domain: "products", canonicalProductIntentProposalId: null, entityReferences: [{ type: "product", id: "product_translucent", label: "Translucent Vinyl" }] } },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.response).toContain("$65");
  });

  test("turns an unexpected tool exception into a recoverable observation", async () => {
    const provider: AssistantOperatorDecisionProvider = {
      decide: async ({ observations }) => observations.length
        ? { kind: "complete", response: "The lookup was unavailable, so I cannot verify that fact." }
        : { kind: "call_tools", calls: [{ toolName: "web.search", arguments: { query: "test" } }] },
    };
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute: async () => { throw new Error("network failure"); } }).run({ goal: "Research this.", taskId: "task_exception", trustedContext });

    expect(result).toMatchObject({ status: "completed", observations: [expect.objectContaining({ status: "failed", warning: "The requested capability was temporarily unavailable." })] });
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
    expect(result.response).not.toContain("start a new request");
  });

  test("keeps a recoverable active semantic product draft in context instead of forcing a restart", async () => {
    const provider: AssistantOperatorDecisionProvider = { decide: async () => ({ kind: "ask_user", question: "Which Layers option should be the default?", missingInformation: ["Layers default"] }) };
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [], execute: async () => { throw new Error("not called"); } }).run({
      goal: "yes", taskId: "task_product_recovery", trustedContext: {
        ...trustedContext,
        task: {
          id: "task_product_recovery", domain: "products", canonicalProductIntentProposalId: "proposal_1", entityReferences: [], trustedObservations: [], missingInformation: ["Layers default"],
          activeSemanticProductDraft: {
            name: "Translucent Vinyl", category: { state: "unresolved", label: "Product category" }, measurementMode: "dimensions_required",
            pricing: { model: "one_dimensional_matrix", basis: "per_square_foot", optionGroup: "Layers", rates: [{ option: "3 Layer", priceCents: 400 }] },
            optionGroups: [{ label: "Layers", required: true, selectionMode: "single", defaultValue: null, values: ["3 Layer", "5 Layer"], availableWhen: null }],
            outstandingDecisions: [{ path: "optionGroups.layers.default", question: "Which Layers option should be the default?", choices: ["3 Layer", "5 Layer"] }], readyForReview: false,
          },
        },
      },
    });
    expect(result).toMatchObject({ status: "awaiting_input", missingInformation: ["Layers default"] });
    expect(result.response).not.toContain("start a new request");
  });

  test("binds an unambiguous yes to durable semantic product clarification context", async () => {
    const provider: AssistantOperatorDecisionProvider = { decide: async ({ observations, safeWorkingSummary, task }) => {
      if (!observations.length) {
        expect(safeWorkingSummary).toBe("Waiting for confirmation to require proof approval on the active product draft.");
        expect(task?.activeSemanticProductDraft?.name).toBe("Translucent Vinyl");
        return { kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: { operations: [{ op: "set_proof_requirement", requiresProofApproval: true }] } }] };
      }
      return { kind: "complete", response: "I updated the product draft." };
    } };
    const execute = jest.fn(async ({ toolName, arguments: args }: any) => {
      expect(toolName).toBe("products.apply_operations");
      expect(args).toEqual({ operations: [{ op: "set_proof_requirement", requiresProofApproval: true }] });
      return { toolName, status: "succeeded" as const, result: { status: "succeeded" as const, data: { response: "Draft updated." } } as any };
    });
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [{ name: "products.apply_operations", description: "Apply an active product business operation." }], execute }).run({
      goal: "yes", taskId: "task_product_yes", initialWorkingSummary: "Waiting for confirmation to require proof approval on the active product draft.", trustedContext: {
        ...trustedContext,
        task: {
          id: "task_product_yes", domain: "products", canonicalProductIntentProposalId: "proposal_1", entityReferences: [], trustedObservations: [], missingInformation: ["proof approval"],
          activeSemanticProductDraft: {
            name: "Translucent Vinyl", category: { state: "unresolved", label: "Product category" }, measurementMode: "dimensions_required",
            pricing: { model: "one_dimensional_matrix", basis: "per_square_foot", optionGroup: "Layers", rates: [{ option: "3 Layer", priceCents: 400 }] },
            optionGroups: [], outstandingDecisions: [{ path: "workflow.requiresProofApproval", question: "Require proof approval?", choices: ["Yes", "No"] }], readyForReview: false,
          },
        },
      },
    });
    expect(result).toMatchObject({ status: "completed", response: "I updated the product draft." });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("requires a revised product plan after recoverable canonical validation instead of accepting a premature failure", async () => {
    const first = { operations: [{ op: "set_option_rate", optionGroup: "Finish", value: "Gloss", priceCents: 500, basis: "per_square_foot" }] };
    const revised = { operations: [{ op: "add_option_value", optionGroup: "Finish", value: "Gloss" }, { op: "set_option_rate", optionGroup: "Finish", value: "Gloss", priceCents: 500, basis: "per_square_foot" }] };
    const provider: AssistantOperatorDecisionProvider = { decide: jest.fn(async ({ observations }) => {
      if (!observations.length) return { kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: first }] };
      if (observations.length === 1) return { kind: "fail", response: "Canonical validation failed." };
      if (observations.some((observation) => observation.toolName === "products.apply_operations" && observation.status === "succeeded")) return { kind: "complete", response: "I added Gloss and its per-square-foot price to the active draft." };
      if (observations.some((observation) => observation.toolName === "operator.replan_required")) {
        expect(observations[0]?.result?.data).toMatchObject({ validation: { retryable: true, stage: "semantic_operation_validation", validation: { issuePaths: ["operations.0.value"] } } });
        return { kind: "call_tools", calls: [{ toolName: "products.apply_operations", arguments: revised }] };
      }
      return { kind: "fail", response: "Expected a product-plan revision request." };
    }) };
    const execute = jest.fn(async ({ toolName, arguments: args }: any) => {
      if (JSON.stringify(args) === JSON.stringify(first)) return {
        toolName,
        status: "rejected" as const,
        warning: "The requested option value is not available.",
        failureCategory: "recoverable_validation",
        failureCode: "product_operations_rejected",
        failingStep: "semantic_operation_validation",
        result: { status: "failed" as const, data: { draftContext: { optionGroups: [{ label: "Finish", values: ["Matte"] }] }, validation: { retryable: true, stage: "semantic_operation_validation", validation: { issuePaths: ["operations.0.value"], issueCodes: ["custom"], requestedOperations: ["set_option_rate"] } } } } as any,
      };
      return { toolName, status: "succeeded" as const, result: { status: "succeeded" as const, data: { response: "Draft updated." } } as any };
    });
    const result = await new AssistantOperatorRuntime(provider, { catalog: () => [{ name: "products.apply_operations", description: "Apply product changes." }], execute }).run({ goal: "Add Gloss at $5 per square foot.", taskId: "task_product_replan", trustedContext });

    expect(result).toMatchObject({ status: "completed", response: expect.stringContaining("Gloss") });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ arguments: revised }));
    expect(result.observations).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "operator.replan_required", failureCode: "product_plan_revision_required" })]));
  });
});
