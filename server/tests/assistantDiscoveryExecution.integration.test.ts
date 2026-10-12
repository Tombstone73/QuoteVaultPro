import { AssistantOrchestrationService } from "../services/assistant/orchestration";
import { deepSeekFunctionParameters } from "../services/ai/providers/configuredProvider";
import { getCanonicalCapabilityForCommand } from "../services/assistant/canonicalCapabilityRegistry";
import { capabilityInventory } from "../services/assistant/capabilityInventory";
import { AssistantOperatorRuntime } from "../services/assistant/operatorRuntime";

const freshness = "2026-10-12T00:00:00.000Z";
const context = {
  scope: { organizationId: "org_fixture", userId: "user_fixture" },
  actor: { userId: "user_fixture", email: null }, permissions: ["assistant.internal_staff", "catalog.read"],
  context: { page: "unknown" }, correlationId: "discovery_fixture",
} as any;
const entity = (entityType: string, recordId: string, label: string) => ({
  entityType, recordId, label, freshness,
  sourceLink: { label, href: `/${entityType}s/${recordId}`, entityType, entityId: recordId },
});
const envelope = (data: unknown, record: ReturnType<typeof entity>) => ({
  status: "succeeded" as const, data,
  provenance: { sourceLinks: [record.sourceLink], freshness: { capturedAt: freshness } },
});

describe("provider discovery to policy-enforced V1 execution", () => {
  const customer = entity("customer", "customer_fixture", "Acme Signs");
  const order = entity("order", "order_fixture", "1001");
  const product = entity("product", "product_fixture", "Banner");
  const search = jest.fn(async (args: any, trusted: any) => {
    expect(args).toEqual({ query: "Acme Signs", entityType: "customer", limit: 5 });
    expect(trusted.scope).toEqual(context.scope);
    return envelope({ matches: [customer] }, customer);
  });
  const summary = jest.fn(async (args: any, trusted: any) => {
    expect(args).toEqual({ customerId: customer.recordId });
    expect(trusted.scope).toEqual(context.scope);
    return envelope({ customer, paymentTerms: "Net 30" }, customer);
  });
  const orderRead = jest.fn(async (args: any, trusted: any) => {
    expect(args).toEqual({ orderNumber: "1001" });
    expect(trusted.scope).toEqual(context.scope);
    return envelope({ order, customer, lineItemSummary: "Two printed banners", productionState: "queued" }, order);
  });
  const productRead = jest.fn(async (args: any, trusted: any) => {
    expect(args).toEqual({ query: "Banner" });
    expect(trusted.scope).toEqual(context.scope);
    return envelope({ product, pricingEngineConfiguration: { engine: "pbv2", profileKey: null, allowRotation: true, mixedSheetLayout: false } }, product);
  });
  const audit = jest.fn();
  const service = new AssistantOrchestrationService({
    "search.global": { execute: search }, "customers.get_summary": { execute: summary },
    "orders.get_summary": { execute: orderRead }, "products.get_summary": { execute: productRead },
  }, audit);
  beforeEach(() => jest.clearAllMocks());

  it("passes trusted actor grants into discovery on every iterative runtime decision", async () => {
    const catalog = jest.fn((trusted: any) => service.catalog(trusted));
    const runtime = new AssistantOperatorRuntime({
      decide: async ({ toolCatalog, observations }) => {
        expect(toolCatalog.map(tool => tool.name)).not.toContain("products.get_pricing");
        return observations.length === 0
          ? { kind: "call_tools", calls: [{ toolName: "orders.get_summary", arguments: { orderNumber: "1001" } }] }
          : { kind: "complete", response: "Order 1001 contains two printed banners and is queued." };
      },
    }, {
      catalog,
      execute: ({ toolName, arguments: args, context: trusted }) => service.executeTool(toolName, args, trusted),
    });
    const result = await runtime.run({ goal: "Show Order 1001 details", taskId: "task_fixture", trustedContext: context });
    expect(result.status).toBe("completed");
    expect(result.observations).toEqual([expect.objectContaining({ toolName: "orders.get_summary", status: "succeeded" })]);
    expect(catalog).toHaveBeenCalledTimes(2);
    expect(catalog).toHaveBeenCalledWith(context);
  });

  it("discovers a customer by name then reads only the resolved tenant customer", async () => {
    const catalog = service.catalog(context);
    expect(deepSeekFunctionParameters(catalog.find(tool => tool.name === "customers.get_summary")!.inputSchema))
      .toMatchObject({ required: ["customerId"], properties: { customerId: { type: "string" } } });
    const found = await service.executeTool("search.global", { query: "Acme Signs", entityType: "customer", limit: 5 }, context);
    expect(found.status).toBe("succeeded");
    const id = (found.result!.data as any).matches[0].recordId;
    const result = await service.executeTool("customers.get_summary", { customerId: id, organizationId: "org_attacker" }, context);
    expect(result).toMatchObject({ status: "succeeded", result: { data: { paymentTerms: "Net 30" } } });
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it("advertises and executes business-number order details", async () => {
    expect(service.catalog(context).find(tool => tool.name === "orders.get_summary")!.inputSchema)
      .toMatchObject({ properties: { orderNumber: { type: "string" } } });
    expect(await service.executeTool("orders.get_summary", { orderNumber: "1001" }, context))
      .toMatchObject({ status: "succeeded", result: { data: { lineItemSummary: "Two printed banners" } } });
  });

  it("executes named product configuration without rediscovery or mutation", async () => {
    expect(await service.executeTool("products.get_summary", { query: "Banner" }, context))
      .toMatchObject({ status: "succeeded", result: { data: { pricingEngineConfiguration: { allowRotation: true, mixedSheetLayout: false } } } });
    expect(search).not.toHaveBeenCalled();
    expect(productRead).toHaveBeenCalledTimes(1);
  });

  it("hides unauthorized reads and denies forged execution before adapters run", async () => {
    const denied = { ...context, permissions: [] };
    expect(service.catalog(denied)).toEqual([]);
    expect(service.catalog(context).map(tool => tool.name)).not.toContain("products.get_pricing");
    expect(await service.executeTool("products.get_summary", { query: "Banner", permissions: ["catalog.read", "assistant.internal_staff"] }, denied))
      .toMatchObject({ status: "permission_denied", failureCode: "unauthorized" });
    expect(productRead).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "unauthorized" }));
  });

  it("keeps Material creation metadata in its authoritative domain and GO boundary", () => {
    expect(getCanonicalCapabilityForCommand("materials.create"))
      .toMatchObject({ domain: "materials", requiredGrant: "assistant.materials.create", allowedOrganizationRoles: ["owner", "admin"], confirmation: "go_required", idempotency: "server_generated_with_request_hash" });
    expect(getCanonicalCapabilityForCommand("materials.create")?.uiSurfaceReference).toContain("server/routes/orders.routes.ts");
    expect(capabilityInventory.find(item => item.commandName === "materials.create"))
      .toMatchObject({ domain: "materials", permissionRequirement: "assistant.materials.create" });
  });
});
