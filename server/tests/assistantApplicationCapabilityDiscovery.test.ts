import { describe, expect, test } from "@jest/globals";
import { createAssistantOperatorToolExecutor } from "../services/assistant/operatorToolExecutor";

describe("application capability discovery", () => {
  test("lists only registered, permission-filtered tools with bounded schemas and never invokes them", async () => {
    let called = false;
    const executor = createAssistantOperatorToolExecutor(() => undefined, [{
      name: "disposable.read", description: "Read a disposable Product", inputSchema: { type: "object", properties: { productId: { type: "string" } } },
      execute: async () => { called = true; return { status: "succeeded" }; },
    }]);
    const context = { scope: { organizationId: "org_test", userId: "user_test" }, actor: { userId: "user_test", email: null },
      permissions: [], context: {}, correlationId: "test", conversationId: "conversation", goal: "list capabilities" } as any;
    expect(executor.catalog(context).map((tool) => tool.name)).toContain("application.capabilities");
    const result = await executor.execute({ toolName: "application.capabilities", arguments: { query: "disposable", limit: 1 }, context });
    expect(result.status).toBe("succeeded");
    expect(result.result?.data).toMatchObject({ capabilities: [{ name: "disposable.read", inputSchema: { type: "object" } }], total: 1, nextOffset: null });
    expect(called).toBe(false);
  });
});
