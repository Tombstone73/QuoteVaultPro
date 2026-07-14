import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  ProductParsingDescriptionGeneratorError,
  ProductParsingDescriptionGeneratorService,
} from "../services/products/ProductParsingDescriptionGeneratorService";

function makeService(overrides: Record<string, any> = {}) {
  const provider = overrides.provider ?? {
    generateJson: jest.fn(async () => ({
      rawText: JSON.stringify({
        generatedDescription: "Match common customer phrases for vinyl banners, printed banners, hems, grommets, and pole pockets. Avoid retractable banner hardware unless hardware is explicitly requested.",
        sourceFields: ["name", "description", "options"],
      }),
      provider: "openai",
      model: "test-model",
      requestMetadata: {
        mode: "printershero_managed",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        providerRequestId: "req_1",
      },
    })),
  };
  const aiFoundationRepo = overrides.aiFoundationRepo ?? {
    recordUsage: jest.fn(async () => ({})),
  };
  const resolveProvider = overrides.resolveProvider ?? jest.fn(async () => ({
    enabled: true,
    provider: "openai",
    model: "test-model",
    endpoint: "https://example.test",
    apiKey: "key",
    mode: "printershero_managed",
    source: "settings",
    settings: null,
  }));
  const productStore = overrides.productStore ?? {
    getProductById: jest.fn(async () => ({ id: "product_1", organizationId: "org_1" })),
  };

  return {
    provider,
    aiFoundationRepo,
    resolveProvider,
    productStore,
    service: new ProductParsingDescriptionGeneratorService(provider as any, aiFoundationRepo as any, resolveProvider as any, productStore as any),
  };
}

describe("ProductParsingDescriptionGeneratorService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("generates from unsaved product context and records AI usage without saving product", async () => {
    const { service, provider, aiFoundationRepo, productStore } = makeService();

    const result = await service.generate({
      organizationId: "org_1",
      actorUserId: "user_1",
      input: {
        mode: "new",
        name: "Vinyl Banner",
        category: "Banners",
        description: "Printed banner product.",
        optionTreeJson: {
          nodes: {
            opt_grommets: { label: "Grommets", input: { choices: [{ label: "Corners" }] } },
            opt_pole: { label: "Pole Pocket", input: { choices: [{ label: "Top" }, { label: "Top and bottom" }] } },
          },
        },
      },
    });

    expect(result.generatedDescription).toContain("vinyl banners");
    expect(result.mode).toBe("new");
    expect(result.sourceFields).toEqual(expect.arrayContaining(["name", "category", "description", "options"]));
    expect(provider.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      feature: "order_parsing",
      user: expect.stringContaining("Pole Pocket"),
    }));
    expect(aiFoundationRepo.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      feature: "order_parsing",
      totalTokens: 30,
      source: "product_ai_parsing_description",
    }));
    expect(productStore.getProductById).not.toHaveBeenCalled();
  });

  test("improve existing sends current description as context", async () => {
    const { service, provider } = makeService();

    await service.generate({
      organizationId: "org_1",
      actorUserId: "user_1",
      input: {
        mode: "improve",
        name: "PVC Sign",
        existingAiParsingDescription: "Use for Sintra.",
      },
    });

    expect(provider.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining("Use for Sintra."),
    }));
  });

  test("replace creates a fresh proposed description", async () => {
    const { service, provider } = makeService();

    const result = await service.generate({
      organizationId: "org_1",
      actorUserId: "user_1",
      input: {
        mode: "replace",
        name: "ACM Panel",
        existingAiParsingDescription: "Old guidance.",
      },
    });

    expect(result.mode).toBe("replace");
    expect(provider.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining("Mode: replace"),
    }));
  });

  test("rejects insufficient product context before calling AI", async () => {
    const { service, provider } = makeService();

    await expect(service.generate({
      organizationId: "org_1",
      actorUserId: "user_1",
      input: { mode: "new" },
    })).rejects.toMatchObject({
      code: "insufficient_context",
      statusCode: 400,
    });
    expect(provider.generateJson).not.toHaveBeenCalled();
  });

  test("validates tenant access when product ID is supplied", async () => {
    const { service, productStore, provider } = makeService({
      productStore: {
        getProductById: jest.fn(async () => null),
      },
    });

    await expect(service.generate({
      organizationId: "org_2",
      actorUserId: "user_1",
      input: {
        productId: "product_1",
        mode: "new",
        name: "Banner",
      },
    })).rejects.toMatchObject({
      code: "product_not_found",
      statusCode: 404,
    });
    expect(productStore.getProductById).toHaveBeenCalledWith("org_2", "product_1");
    expect(provider.generateJson).not.toHaveBeenCalled();
  });

  test("fails softly when provider is disabled", async () => {
    const { service, provider } = makeService({
      resolveProvider: jest.fn(async () => ({ enabled: false, mode: "disabled" })),
    });

    await expect(service.generate({
      organizationId: "org_1",
      actorUserId: "user_1",
      input: { mode: "new", name: "Banner" },
    })).rejects.toBeInstanceOf(ProductParsingDescriptionGeneratorError);
    expect(provider.generateJson).not.toHaveBeenCalled();
  });
});
