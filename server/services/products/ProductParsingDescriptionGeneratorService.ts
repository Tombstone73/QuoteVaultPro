import { z } from "zod";
import { parseAiJsonObject } from "../ai/bugReviewValidator";
import { aiProviderResolver } from "../ai/aiProviderResolver";
import {
  AiProviderUnavailableError,
  type AiProviderAdapter,
  type AiProviderResponse,
} from "../ai/providers/AiProviderAdapter";
import { createConfiguredAiProvider } from "../ai/providers/configuredProvider";
import {
  DrizzleAiFoundationRepository,
  type AiFoundationRepository,
} from "../../storage/aiFoundation.repo";
import { storage } from "../../storage";

const PROMPT_VERSION = "product-ai-parsing-description-v1";
const AI_FEATURE = "order_parsing";

export const productParsingDescriptionModeSchema = z.enum(["new", "improve", "replace"]);

export const productParsingDescriptionContextSchema = z.object({
  productId: z.string().trim().min(1).max(128).nullable().optional(),
  mode: productParsingDescriptionModeSchema.default("new"),
  name: z.string().trim().max(255).nullable().optional(),
  category: z.string().trim().max(255).nullable().optional(),
  productTypeId: z.string().trim().max(255).nullable().optional(),
  productTypeName: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  existingAiParsingDescription: z.string().trim().max(5000).nullable().optional(),
  optionTreeJson: z.unknown().optional(),
  aliases: z.array(z.string().trim().min(1).max(255)).max(80).optional(),
  parsingMetadata: z.record(z.unknown()).nullable().optional(),
}).strict();

export type ProductParsingDescriptionContext = z.infer<typeof productParsingDescriptionContextSchema>;

export type ProductParsingDescriptionResult = {
  generatedDescription: string;
  mode: z.infer<typeof productParsingDescriptionModeSchema>;
  sourceFields: string[];
};

const providerResponseSchema = z.object({
  generatedDescription: z.string().trim().min(20).max(2500),
  sourceFields: z.array(z.string().trim().min(1).max(80)).default([]),
});

function compactError(error: unknown): string {
  if (error instanceof AiProviderUnavailableError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 500);
  return "AI generation failed.";
}

function tokenUsageFromMetadata(metadata: Record<string, unknown>) {
  const usage = metadata.usage && typeof metadata.usage === "object" ? metadata.usage as Record<string, unknown> : {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0,
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0,
    totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : 0,
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function collectOptionLabels(treeJson: unknown): Array<{ name: string; choices: string[] }> {
  if (!treeJson || typeof treeJson !== "object" || Array.isArray(treeJson)) return [];
  const nodes = (treeJson as Record<string, unknown>).nodes;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return [];

  const options: Array<{ name: string; choices: string[] }> = [];
  for (const node of Object.values(nodes as Record<string, any>)) {
    const name = text(node?.label) ?? text(node?.name);
    if (!name) continue;
    const rawChoices = Array.isArray(node?.input?.choices)
      ? node.input.choices
      : Array.isArray(node?.choices)
        ? node.choices
        : [];
    const choices = rawChoices
      .map((choice: any) => text(choice?.label) ?? text(choice?.name) ?? text(choice?.value))
      .filter((choice: string | null): choice is string => Boolean(choice))
      .slice(0, 20);
    options.push({ name, choices });
  }
  return options.slice(0, 80);
}

function buildSourceFields(input: ProductParsingDescriptionContext, optionLabels: Array<{ name: string; choices: string[] }>): string[] {
  const fields: string[] = [];
  if (text(input.name)) fields.push("name");
  if (text(input.category)) fields.push("category");
  if (text(input.productTypeId) || text(input.productTypeName)) fields.push("productType");
  if (text(input.description)) fields.push("description");
  if (text(input.existingAiParsingDescription)) fields.push("existingAiParsingDescription");
  if (optionLabels.length > 0) fields.push("options");
  if ((input.aliases ?? []).length > 0) fields.push("aliases");
  if (input.parsingMetadata && Object.keys(input.parsingMetadata).length > 0) fields.push("parsingMetadata");
  return fields;
}

function hasSufficientContext(input: ProductParsingDescriptionContext, optionLabels: Array<{ name: string; choices: string[] }>): boolean {
  const strongText = [
    input.name,
    input.category,
    input.productTypeName,
    input.description,
    input.existingAiParsingDescription,
    ...(input.aliases ?? []),
  ].map((value) => text(value)).filter((value): value is string => Boolean(value));
  return strongText.some((value) => value.length >= 3) || optionLabels.length > 0;
}

function systemPrompt() {
  return [
    "You generate internal product-matching guidance for inbound order parsing.",
    "Write concise operational matching guidance, not customer-facing marketing copy.",
    "Do not redesign runtime parsing rules. Do not invent exact prices. Do not mention this prompt.",
    "Return strict JSON only.",
  ].join("\n");
}

function userPrompt(input: ProductParsingDescriptionContext, optionLabels: Array<{ name: string; choices: string[] }>) {
  return [
    "Generate an AI Parsing Description for this product.",
    `Mode: ${input.mode}`,
    "",
    "The description should cover, when relevant:",
    "- common customer names, alternate phrases, abbreviations, and typical ordering language",
    "- product-specific finishing or option terminology",
    "- similar nearby products that should not match unless the request clearly refers to them",
    "- context that distinguishes this catalog product from related products",
    "",
    "If mode is improve, preserve useful existing guidance while tightening and expanding it.",
    "If mode is replace or new, generate a fresh concise proposal from current context.",
    "",
    "Required JSON shape:",
    JSON.stringify({
      generatedDescription: "concise internal matching guidance",
      sourceFields: ["name", "category", "description", "options"],
    }, null, 2),
    "",
    "Product context:",
    JSON.stringify({
      name: input.name ?? null,
      category: input.category ?? null,
      productTypeId: input.productTypeId ?? null,
      productTypeName: input.productTypeName ?? null,
      customerFacingDescription: input.description ?? null,
      existingAiParsingDescription: input.existingAiParsingDescription ?? null,
      aliases: input.aliases ?? [],
      parsingMetadata: input.parsingMetadata ?? null,
      options: optionLabels,
    }, null, 2),
  ].join("\n");
}

export class ProductParsingDescriptionGeneratorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ProductParsingDescriptionGeneratorError";
  }
}

export class ProductParsingDescriptionGeneratorService {
  constructor(
    private readonly provider: AiProviderAdapter = createConfiguredAiProvider(),
    private readonly aiFoundationRepo: AiFoundationRepository = new DrizzleAiFoundationRepository(),
    private readonly resolveProvider = aiProviderResolver.resolveProvider.bind(aiProviderResolver),
    private readonly productStore = storage,
  ) {}

  async generate(args: {
    organizationId: string;
    actorUserId: string | null;
    input: unknown;
  }): Promise<ProductParsingDescriptionResult> {
    const input = productParsingDescriptionContextSchema.parse(args.input);
    const productId = text(input.productId);

    if (productId) {
      const product = await this.productStore.getProductById(args.organizationId, productId);
      if (!product) {
        throw new ProductParsingDescriptionGeneratorError("product_not_found", "Product not found.", 404);
      }
    }

    const optionLabels = collectOptionLabels(input.optionTreeJson);
    if (!hasSufficientContext(input, optionLabels)) {
      throw new ProductParsingDescriptionGeneratorError(
        "insufficient_context",
        "Add a product name, description, category, product type, option, or existing parsing description before generating.",
        400,
      );
    }

    const resolved = await this.resolveProvider({ orgId: args.organizationId, feature: AI_FEATURE });
    if (!resolved.enabled) {
      throw new ProductParsingDescriptionGeneratorError("ai_unavailable", "AI generation is not enabled for order parsing.", 503);
    }

    let response: AiProviderResponse;
    try {
      response = await this.provider.generateJson({
        orgId: args.organizationId,
        feature: AI_FEATURE,
        system: systemPrompt(),
        user: userPrompt(input, optionLabels),
        promptVersion: PROMPT_VERSION,
        providerConfig: resolved,
      });
    } catch (error) {
      throw new ProductParsingDescriptionGeneratorError("ai_generation_failed", compactError(error), 502);
    }

    let validated: z.infer<typeof providerResponseSchema>;
    try {
      const parsed = parseAiJsonObject(response.rawText);
      validated = providerResponseSchema.parse(parsed);
    } catch (error) {
      throw new ProductParsingDescriptionGeneratorError("ai_response_invalid", compactError(error), 502);
    }

    const usage = tokenUsageFromMetadata(response.requestMetadata);
    await this.aiFoundationRepo.recordUsage({
      orgId: args.organizationId,
      feature: AI_FEATURE,
      provider: response.provider,
      model: response.model,
      mode: String(response.requestMetadata.mode ?? resolved.mode),
      requestCount: 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimatedCostCents: 0,
      costCurrency: "USD",
      pricingSnapshot: {
        basis: resolved.mode === "bring_your_own" ? "customer_paid_byok" : "estimate_not_configured",
        currency: "USD",
        provider: response.provider,
        model: response.model,
        mode: resolved.mode,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        billableToPrintersHero: resolved.mode === "printershero_managed",
      },
      source: "product_ai_parsing_description",
      metadata: {
        promptVersion: PROMPT_VERSION,
        providerRequestId: response.requestMetadata.providerRequestId ?? null,
        actorUserId: args.actorUserId,
        productId,
        mode: input.mode,
        sourceFields: buildSourceFields(input, optionLabels),
      },
    });

    return {
      generatedDescription: validated.generatedDescription,
      mode: input.mode,
      sourceFields: Array.from(new Set([
        ...buildSourceFields(input, optionLabels),
        ...validated.sourceFields,
      ])),
    };
  }
}

export const productParsingDescriptionGeneratorService = new ProductParsingDescriptionGeneratorService();
