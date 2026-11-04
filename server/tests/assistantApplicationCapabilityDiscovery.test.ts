import { describe, expect, jest, test } from "@jest/globals";
import { createAssistantOperatorToolExecutor } from "../services/assistant/operatorToolExecutor";
import { OrganizationAssistantCapabilityResolver } from "../services/assistant/assistantCapabilities";
import { aiProviderResolver } from "../services/ai/aiProviderResolver";

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


test("customer, product and pricing discovery reuses permission-filtered canonical reads", async () => {
  const executor = createAssistantOperatorToolExecutor();
  const context = { scope: { organizationId: "org_test", userId: "staff_test" }, actor: { userId: "staff_test", email: null },
    permissions: ["assistant.internal_staff", "catalog.read", "finance.read"], context: {}, correlationId: "fixture", conversationId: "fixture", goal: "discover" } as any;
  expect(executor.catalog(context).map(tool => tool.name)).toEqual(expect.arrayContaining(["customers.get_summary", "products.get_summary", "products.get_pricing"]));
  const restricted = executor.catalog({ ...context, permissions: ["assistant.internal_staff"] }).map(tool => tool.name);
  expect(restricted).not.toContain("products.get_pricing");
  expect(restricted).not.toContain("products.get_summary");
});

test("public URL capability is available without a search key, but the organization/provider switches remain authoritative", async () => {
  const key = process.env.PUBLIC_WEB_SEARCH_API_KEY;
  delete process.env.PUBLIC_WEB_SEARCH_API_KEY;
  const resolve = jest.spyOn(aiProviderResolver, "resolveProvider").mockResolvedValue({ enabled: true, mode: "printershero_managed", provider: "openai_compatible", model: "fixture-model", endpoint: "https://provider.example.invalid/chat", apiKey: "fixture-not-secret", feature: "assistant", source: "printershero_managed_env", settings: null });
  const resolver = new OrganizationAssistantCapabilityResolver({ getSettings: async () => ({ isEnabled: true, assistantEnabled: true }) } as never);
  try {
    expect(await resolver.getCapabilities("org_fixture")).toMatchObject({ enabled: true, toolsEnabled: true, externalResearchEnabled: true });
    resolve.mockResolvedValueOnce({ enabled: false } as never);
    expect(await resolver.getCapabilities("org_fixture")).toMatchObject({ toolsEnabled: false, externalResearchEnabled: false });
    const disabled = new OrganizationAssistantCapabilityResolver({ getSettings: async () => ({ isEnabled: false, assistantEnabled: true }) } as never);
    expect(await disabled.getCapabilities("org_fixture")).toMatchObject({ enabled: false, externalResearchEnabled: false });
  } finally {
    resolve.mockRestore();
    if (key === undefined) delete process.env.PUBLIC_WEB_SEARCH_API_KEY; else process.env.PUBLIC_WEB_SEARCH_API_KEY = key;
  }
});
