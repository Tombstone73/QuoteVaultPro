import { jest } from "@jest/globals";
import { CanonicalProductIntentService } from "../services/productIntentCompiler/canonicalProductIntentService";
import { ProductIntentCompiler } from "../services/productIntentCompiler/productIntentCompiler";

describe("CanonicalProductIntentService compiler failures", () => {
  test("persists nothing and has no legacy fallback when both compiler attempts fail", async () => {
    const compiler = new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: "not-json", provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    });
    const persistence = { create: jest.fn() } as any;
    const service = new CanonicalProductIntentService(compiler, persistence, { categories: [], materials: [], productionRoutes: [] });

    const result = await service.create({
      organizationId: "org-1", actorUserId: "user-1", conversationId: "conversation-1",
      compilerInput: {
        orgId: "org-1", request: "Create Yard Signs Test", operationContext: { operation: "new_product" }, schemaDescription: "Product intent", allowedEnums: {}, supportedArchetypes: [], serverConstraints: [],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_json" });
    expect(persistence.create).not.toHaveBeenCalled();
  });
});
