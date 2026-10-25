import { describe, expect, test } from "@jest/globals";
import { createApplicationOperationTools } from "../services/assistant/applicationOperationTools";
import type { AssistantOperatorSemanticTool } from "../services/assistant/operatorToolExecutor";
import { AssistantOperatorRuntime } from "../services/assistant/operatorRuntime";

const context = { scope: { organizationId: "org", userId: "user" }, conversationId: "conversation",
  actor: { userId: "user", email: null }, permissions: [], context: {}, correlationId: "correlation", goal: "Update this Product" } as never;

describe("shared application change operations", () => {
  test("discovers supported business arguments without preparing or executing a change", async () => {
    let calls = 0;
    const adapter: AssistantOperatorSemanticTool = { name: "products.apply_existing_operations", description: "Review a Product configuration change.",
      inputSchema: { type: "object", required: ["operations"], properties: { operations: { type: "array" } } },
      execute: async () => { calls += 1; return { status: "succeeded" }; } };
    const [discover, prepare] = createApplicationOperationTools([adapter]);
    const listing = await discover!.execute({ arguments: { query: "product" }, context });
    expect(listing.status).toBe("succeeded");
    expect(listing.result?.data).toMatchObject({ operations: [{ name: adapter.name, inputSchema: adapter.inputSchema, confirmation: "GO after review" }] });
    expect(calls).toBe(0);
    expect((await prepare!.execute({ arguments: { operation: "orders.create", arguments: {} }, context })).status).toBe("rejected");
    expect(calls).toBe(0);
    expect((await prepare!.execute({ arguments: { operation: adapter.name, arguments: { operations: [] } }, context })).status).toBe("succeeded");
    expect(calls).toBe(1);
  });

  test("only supplied permitted adapters can be discovered or called", async () => {
    const [discover, prepare] = createApplicationOperationTools([]);
    expect((await discover!.execute({ arguments: {}, context })).result?.data).toMatchObject({ operations: [] });
    expect((await discover!.execute({ arguments: { query: "products.delete" }, context: { ...context, permissions: ["product.delete"] } })).result?.data)
      .toMatchObject({ adapterGaps: [{ operation: "products.delete", classification: "application_operation_missing_assistant_adapter" }] });
    expect((await discover!.execute({ arguments: { query: "products.delete" }, context })).result?.data).toMatchObject({ adapterGaps: [] });
    expect((await prepare!.execute({ arguments: { operation: "products.apply_existing_operations", arguments: {} }, context })).status).toBe("rejected");
  });

  test("composes discovery, record lookup, calculation, and a reviewed change without a request-specific workflow", async () => {
    let prepared = 0;
    const adapters = createApplicationOperationTools([{ name: "products.apply_existing_operations", description: "Prepare an existing Product change.",
      inputSchema: { type: "object", properties: { operations: { type: "array" } } },
      execute: async () => { prepared += 1; return { status: "succeeded" as const,
        result: { status: "succeeded" as const, data: { response: "Prepared rates for review.", taskDomain: "products" } },
        presentation: { cards: [{ kind: "action_proposal" as const, title: "Review rates", summary: "4mm $0.75; 10mm $1.25", sourceLinks: [], plan: { action: "products.update_existing_product" } }] } }; } }]);
    const tools = {
      catalog: () => [{ name: "products.get_summary", description: "Read one Product." }, { name: "analysis.run", description: "Calculate from trusted reads." },
        ...adapters.map((adapter) => ({ name: adapter.name, description: adapter.description, inputSchema: adapter.inputSchema }))],
      execute: async ({ toolName, arguments: args, context: trusted }: any) => {
        const adapter = adapters.find((item) => item.name === toolName);
        if (adapter) return { toolName, ...(await adapter.execute({ arguments: args, context: trusted })) };
        if (toolName === "products.get_summary") return { toolName, status: "succeeded" as const, result: { status: "succeeded" as const, data: { id: "product_1", choices: ["4mm", "10mm"] } } };
        return { toolName, status: "succeeded" as const, result: { status: "succeeded" as const, data: { prices: [0.75, 1.25] } } };
      },
    };
    const decisions = [
      { kind: "call_tools", calls: [{ toolName: "application.operations", arguments: { query: "Product" } }] },
      { kind: "call_tools", calls: [{ toolName: "products.get_summary", arguments: { productId: "product_1" } }] },
      { kind: "call_tools", calls: [{ toolName: "analysis.run", arguments: { purpose: "check rates" } }] },
      { kind: "call_tools", calls: [{ toolName: "application.prepare_change", arguments: { operation: "products.apply_existing_operations", arguments: { operations: [] } } }] },
      { kind: "complete", response: "The concrete Product pricing change is ready for GO." },
    ];
    const runtime = new AssistantOperatorRuntime({ decide: async () => decisions.shift() as never } as never, tools as never);
    const result = await runtime.run({ goal: "Review option prices", taskId: "task_1", trustedContext: context });
    expect(result.status).toBe("completed");
    expect(result.observations.map((item) => item.toolName)).toEqual(["application.operations", "products.get_summary", "analysis.run", "application.prepare_change"]);
    expect(result.observations.at(-1)?.presentation?.cards[0]).toMatchObject({ kind: "action_proposal", plan: { action: "products.update_existing_product" } });
    expect(prepared).toBe(1);
  });
});
