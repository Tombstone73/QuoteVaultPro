import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { sanitizeAiDiagnosticEnvelope } from "@shared/aiDiagnostics";
import {
  productIntentCompilerResultSchema,
  type ProductDraftIntent,
  type ProductIntentCompilerResult,
  type UnresolvedQuestionAnswer,
} from "@shared/productDraftIntent";

/** The compiler is deliberately an interpretation boundary. It has no database,
 * routing, persistence, or command-execution dependency. */
export const PRODUCT_INTENT_COMPILER_PROMPT_VERSION = "product-intent-compiler-v1";
export const PRODUCT_INTENT_COMPILER_MAX_REPAIR_ATTEMPTS = 1;

const DEFAULT_COMPILER_TIMEOUT_MS = 45_000;
const MIN_COMPILER_TIMEOUT_MS = 5_000;
const MAX_COMPILER_TIMEOUT_MS = 90_000;

export type ProductIntentCandidateLabels = {
  categories?: string[];
  materials?: string[];
  productionRoutes?: string[];
  optionTemplates?: string[];
  existingProducts?: string[];
};

export type ProductIntentCompilerInput = {
  orgId: string;
  request: string;
  /** Present for a continuation, answer, or correction. This is server-loaded
   * state; the provider receives no tenant IDs beyond the opaque labels below. */
  currentIntent?: ProductDraftIntent | null;
  currentRevision?: number | null;
  operationContext: Record<string, unknown>;
  schemaDescription: string;
  allowedEnums: Record<string, readonly string[]>;
  supportedArchetypes: readonly string[];
  candidateLabels?: ProductIntentCandidateLabels;
  serverConstraints?: readonly string[];
  /** Server-issued active questions for a continuation. The provider sees
   * labels and canonical values, never authority to bind a revision itself. */
  activeRequiredIssues?: readonly UnresolvedQuestionAnswer[];
  timeoutMs?: number;
};

export type ProductIntentCompilerDiagnostics = {
  correlationId: string;
  provider: string;
  model: string;
  requestMetadata: Record<string, unknown>;
  attempts: number;
  stage: ProductIntentCompilerFailureStage | "success";
  parseFailureType?: "json_parse" | "json_extraction";
  schemaIssuePaths?: string[];
};

export type ProductIntentCompilerFailureStage =
  | "provider_request_failure"
  | "provider_http_failure"
  | "provider_empty_response"
  | "provider_response_failure"
  | "json_extraction_failure"
  | "runtime_schema_rejection"
  | "repair_response_schema_rejection";

export type ProductIntentCompilerSuccess = {
  ok: true;
  result: ProductIntentCompilerResult;
  diagnostics: ProductIntentCompilerDiagnostics;
};

export type ProductIntentCompilerFailureCode =
  | "provider_unavailable"
  | "provider_failure"
  | "invalid_json"
  | "invalid_contract";

export type ProductIntentCompilerFailure = {
  ok: false;
  error: {
    code: ProductIntentCompilerFailureCode;
    message: string;
    retryable: boolean;
    diagnosticCode: string;
  };
  diagnostics?: ProductIntentCompilerDiagnostics;
};

export type ProductIntentCompilerOutcome = ProductIntentCompilerSuccess | ProductIntentCompilerFailure;

export interface ProductIntentCompilerProvider {
  generateJson(request: {
    orgId: string;
    feature: "feature_review";
    system: string;
    user: string;
    promptVersion: string;
    repairAttempt: boolean;
    timeoutMs: number;
    timeoutUseCase: string;
  }): Promise<{ rawText: string; provider: string; model: string; requestMetadata: Record<string, unknown> }>;
}

function isProviderUnavailable(error: unknown): boolean {
  return error instanceof Error && error.name === "AiProviderUnavailableError";
}

function clampTimeout(timeoutMs?: number): number {
  if (!Number.isFinite(timeoutMs) || Number(timeoutMs) <= 0) return DEFAULT_COMPILER_TIMEOUT_MS;
  return Math.min(MAX_COMPILER_TIMEOUT_MS, Math.max(MIN_COMPILER_TIMEOUT_MS, Math.floor(Number(timeoutMs))));
}

function uniqueLabels(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).slice(0, 100);
}

function candidateLabelsForPrompt(candidates: ProductIntentCandidateLabels | undefined): ProductIntentCandidateLabels {
  return {
    categories: uniqueLabels(candidates?.categories),
    materials: uniqueLabels(candidates?.materials),
    productionRoutes: uniqueLabels(candidates?.productionRoutes),
    optionTemplates: uniqueLabels(candidates?.optionTemplates),
    existingProducts: uniqueLabels(candidates?.existingProducts),
  };
}

function safeRequestMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const allowed = ["providerRequestId", "finishReason", "latencyMs", "timeoutMs", "providerFamily"];
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = metadata?.[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? [[key, value]]
      : [];
  }));
}

/** This is a provider payload guide, not a relaxed persistence contract. The
 * compiler supplies the server-owned fields immediately before the existing
 * strict ProductDraftIntent schema validates the result. */
const providerPayloadGuide = {
  result: "One JSON object only: { kind: 'complete_intent', intent: { ... } } for an initial product. No Markdown or prose.",
  serverOwnedIntentFields: "Omit contractVersion, intentId, organizationId, revision, state, revisionMetadata, and operationContext. The server supplies and validates them.",
  requiredIntentFields: {
    operation: "new_product",
    identity: { name: "string", description: "string", category: "{ state: 'resolved', id, label } or { state: 'unresolved', label }" },
    lifecycle: { productStatus: "inactive", published: false },
    measurement: "{ mode: 'dimensions_required' } | { mode: 'fixed_size', dimensions: { widthIn, heightIn, allowRotation? } } | { mode: 'quantity_only' }",
    quantity: "{ behavior: 'customer_entered', minimum?, maximum? } | { behavior: 'fixed', quantity } | { behavior: 'not_applicable' }",
    pricing: "{ model: 'scalar', unit: 'per_piece'|'per_square_foot'|'flat_fee', priceCents } | { model: 'two_dimensional_matrix', unit: 'per_piece'|'per_square_foot'|'unresolved', rowOptionKey, columnOptionKey, cells: [{ row, column, priceCents }] } | { model: 'quantity_tiers', unit: 'per_piece'|'per_square_foot', tiers: [{ minimumQuantity: positive integer, maximumQuantity: positive integer | null, priceCents: positive integer }] } | { model: 'unresolved' }. Quantity tiers are ordered, continuous inclusive ranges beginning at 1; only the final tier may be open ended and it must use maximumQuantity: null. Prices are integer cents.",
    material: "{ state: 'resolved', id, label } | { state: 'unresolved', label } | { state: 'explicitly_unset' }",
    optionGroups: "[{ key, label, required, selectionMode: 'single'|'multiple', values: [{ key, label, isDefault }] }]",
    workflow: "{ kind: 'standard_production'|'fulfillment_only'|'service_fee', requiresProofApproval, requiresProductionJob }",
    production: "{ route: resolved|unresolved|explicitly_unset reference, configuration: {} }",
    visibility: { catalogVisible: false },
    unresolvedFields: "For an unknown matrix unit, preserve every matrix cell and add { path: 'pricing.unit', code: 'PRICING_UNIT_UNRESOLVED', question: 'Are these matrix prices per piece or per square foot?' }.",
    fieldMetadata: "object keyed by field path with { source: 'explicit_user'|'ai_interpreted'|'selected_template'|'canonical_default'|'unresolved', confidence?: number }",
    tenantReferenceRules: "For category, material, and production.route: use an exact tenant label only when the user explicitly selected it, an explicit selected tenant template supplies it, or a high-confidence interpretation has direct evidence. Never infer a material or route from option-group names, option values, product names, dimensions, or fuzzy similarity. Generic placeholders such as 'Product category', 'Material', or 'Route' must remain unresolved. If material or route is not supported by evidence, return { state: 'explicitly_unset' } and fieldMetadata source 'unresolved'.",
  },
  example: {
    kind: "complete_intent",
    intent: {
      operation: "new_product",
      identity: { name: "Example Panel", description: "", category: { state: "unresolved", label: "Product category" } },
      lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 },
      pricing: { model: "two_dimensional_matrix", unit: "unresolved", rowOptionKey: "finish", columnOptionKey: "sides", cells: [{ row: "standard", column: "front", priceCents: 100 }] },
      material: { state: "explicitly_unset" }, optionGroups: [{ key: "finish", label: "Finish", required: true, selectionMode: "single", values: [{ key: "standard", label: "Standard", isDefault: true }] }, { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "front", label: "Front", isDefault: true }] }],
      workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false },
      unresolvedFields: [{ path: "pricing.unit", code: "PRICING_UNIT_UNRESOLVED", question: "Are these matrix prices per piece or per square foot?" }], fieldMetadata: { "pricing.unit": { source: "unresolved" } },
    },
  },
};

function promptForCompilation(input: ProductIntentCompilerInput): { system: string; user: string } {
  const continuation = input.currentIntent != null;
  return {
    system: [
      "You are the PrintersHero Product Intent Compiler.",
      "Return exactly one strict JSON object and no markdown, commentary, or code fences.",
      "Your JSON must validate against the supplied canonical compiler-result contract.",
      "Interpret natural language only; do not execute commands, create products, invent tenant IDs, or claim that a database lookup succeeded.",
      "Use only candidate labels supplied by the server for tenant-scoped entities. If no supplied label is an unambiguous match, return an unresolved-question result.",
      "For continuations and corrections, preserve every existing authoritative intent field unless the request explicitly changes it.",
      continuation
        ? "This is a continuation. Return only { kind: 'intent_patch', patch: { operations: [...] } }. Never return a complete intent. Use only the active required issue supplied by the server, preserve every unrelated field, and omit contractVersion, baseRevision, and preserveUnchanged because the server binds them."
        : "For an initial request, return { kind: 'complete_intent', intent: { ... } }.",
      "Do not turn preservation instructions into product options, materials, or entity references.",
      "Never set an active or published lifecycle. Confidence never makes a value execution-authorizing.",
    ].join(" "),
    user: JSON.stringify({
      request: input.request,
      currentIntent: input.currentIntent ?? null,
      currentRevision: input.currentRevision ?? null,
      operationContext: input.operationContext,
      canonicalSchema: input.schemaDescription,
      providerPayloadGuide,
      allowedEnums: input.allowedEnums,
      supportedArchetypes: input.supportedArchetypes,
      candidateLabels: candidateLabelsForPrompt(input.candidateLabels),
      ...(continuation ? { activeRequiredIssues: input.activeRequiredIssues ?? [], canonicalPatchContract: { operations: "Typed ProductDraftIntentPatch operations only. Use set_pricing with the complete current pricing object when changing a matrix unit; do not alter unrelated fields.", serverOwnedFields: ["contractVersion", "baseRevision", "preserveUnchanged"] } } : {}),
      serverConstraints: input.serverConstraints ?? [],
    }),
  };
}

function repairPrompt(input: ProductIntentCompilerInput, invalidOutput: string, validationIssuePaths: readonly string[], stage: ProductIntentCompilerFailureStage): { system: string; user: string } {
  const original = promptForCompilation(input);
  return {
    system: `${original.system} Repair the previous response into valid JSON only. Do not add facts not supported by the original request or current intent. Do not add commentary, Markdown, or code fences. Preserve unresolved fields explicitly rather than using null, an empty string, or an invented default.`,
    user: JSON.stringify({
      originalInput: JSON.parse(original.user),
      invalidOutput: invalidOutput.slice(0, 24_000),
      validationIssuePaths,
      failedStage: stage,
      instruction: "Return a single compiler-result object that conforms exactly to providerPayloadGuide and canonicalSchema. Unknown keys are forbidden.",
    }),
  };
}

function parsedObject(candidate: string): unknown | null {
  try {
    const parsed: unknown = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function strictJsonObject(rawText: string): unknown {
  const direct = parsedObject(rawText.trim());
  if (direct) return direct;
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(rawText)) !== null) {
    const parsed = parsedObject(match[1]!.trim());
    if (parsed) return parsed;
  }
  const start = rawText.indexOf("{");
  for (let index = start; index >= 0 && index < rawText.length; index += 1) {
    if (rawText[index] !== "{") continue;
    let depth = 0; let quoted = false; let escaped = false;
    for (let end = index; end < rawText.length; end += 1) {
      const character = rawText[end]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = parsedObject(rawText.slice(index, end + 1));
          if (parsed) return parsed;
          break;
        }
      }
    }
  }
  throw new Error("Provider response did not contain one JSON object.");
}

function invalidResultMessage(result: z.SafeParseError<unknown>): string {
  const firstIssue = result.error.issues[0];
  return firstIssue ? `${firstIssue.path.join(".") || "result"}: ${firstIssue.message}` : "unknown schema error";
}

function schemaIssuePaths(result: z.SafeParseError<unknown>): string[] {
  return result.error.issues.slice(0, 20).flatMap((issue) => {
    const base = issue.path.join(".") || "result";
    if (issue.code === "unrecognized_keys" && "keys" in issue && Array.isArray(issue.keys)) {
      return issue.keys.map((key) => `${base}.${key}`);
    }
    return [base];
  });
}

function normalizedText(value: string): string { return value.toLocaleLowerCase().replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim(); }

/** The provider sometimes mirrors PBV2's minQty/maxQty spellings. Translate
 * only that structural alias at the compiler boundary; monetary units and
 * semantic tier coverage remain strictly validated by the canonical contract. */
function normalizeProviderQuantityTiers(pricing: unknown): unknown {
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) return pricing;
  const source = pricing as Record<string, unknown>;
  if (source.model !== "quantity_tiers" || !Array.isArray(source.tiers)) return pricing;
  return {
    ...source,
    tiers: source.tiers.map((value, index, tiers) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const tier = value as Record<string, unknown>;
      const { minQty: _minQty, minQuantity: _minQuantity, minimumQuantity, maxQty: _maxQty, maxQuantity: _maxQuantity, maximumQuantity: declaredMaximum, perPieceCents: _perPieceCents, priceCents: declaredPrice, ...rest } = tier;
      const minimum = minimumQuantity ?? _minQuantity ?? _minQty;
      const maximum = "maximumQuantity" in tier ? declaredMaximum : "maxQuantity" in tier ? _maxQuantity : "maxQty" in tier ? _maxQty : index === tiers.length - 1 ? null : undefined;
      const price = declaredPrice ?? _perPieceCents;
      return {
        ...rest,
        ...(minimum === undefined ? {} : { minimumQuantity: minimum }),
        ...(maximum === undefined ? {} : { maximumQuantity: maximum }),
        ...(price === undefined ? {} : { priceCents: price }),
      };
    }),
  };
}

const materialFamilyTerms = new Set(["coroplast", "vinyl", "acrylic", "banner", "pvc", "paper"]);
const materialVariantTerms = new Set(["adhesive", "cast", "calendered", "clear", "foam", "foamed", "gloss", "matte", "perforated", "rigid", "textured", "translucent", "white", "black", "blue", "red"]);
function escapeRegExp(value: string): string { return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"); }

/** A provider may identify a tenant material only when the request contains a
 * material-specific qualifier. Generic family wording must never authorize a
 * thickness, finish, weight, colour, or tenant variant. */
function requestSupportsResolvedMaterial(request: string, label: string): boolean {
  const source = normalizedText(request);
  const tokens = normalizedText(label).split(" ").filter(Boolean);
  const familyTerms = tokens.filter((token) => materialFamilyTerms.has(token));
  if (familyTerms.length && !familyTerms.every((term) => new RegExp(`(?:^|\\s)${escapeRegExp(term)}(?:$|\\s)`).test(source))) return false;
  const numericQualifiers = tokens.filter((token) => /\d/.test(token));
  const namedQualifiers = tokens.filter((token) => materialVariantTerms.has(token));
  const qualifiers = numericQualifiers.length ? numericQualifiers : namedQualifiers;
  if (qualifiers.length === 0) return true;
  return qualifiers.every((qualifier) => new RegExp(`(?:^|\\s)${escapeRegExp(qualifier)}(?:$|\\s)`).test(source));
}

function normalizeUnsafeProviderMaterial(request: string, intent: Record<string, unknown>): Record<string, unknown> {
  const material = intent.material;
  const metadata = intent.fieldMetadata;
  if (!material || typeof material !== "object" || Array.isArray(material) || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return intent;
  const reference = material as Record<string, unknown>;
  const fieldMetadata = metadata as Record<string, unknown>;
  const materialMetadata = fieldMetadata.material;
  const source = materialMetadata && typeof materialMetadata === "object" && !Array.isArray(materialMetadata) ? (materialMetadata as Record<string, unknown>).source : null;
  const label = typeof reference.label === "string" ? reference.label : "";
  if (reference.state !== "resolved" || source === "selected_template" || source === "canonical_default" || !label || requestSupportsResolvedMaterial(request, label)) return intent;
  // Preserve an unsupported provider material as an unresolved hint rather
  // than pretending the user chose no material. The resolver may offer only
  // relevant optional choices, but it can never silently select this record.
  return { ...intent, material: { state: "unresolved", label }, fieldMetadata: { ...fieldMetadata, material: { source: "unresolved" } } };
}

function normalizeInitialCompleteIntent(input: ProductIntentCompilerInput, value: unknown, intentId: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  if (root.kind !== "complete_intent" || !root.intent || typeof root.intent !== "object" || Array.isArray(root.intent)) return value;
  const candidate = root.intent as Record<string, unknown>;
  const forbidden = ["contractVersion", "intentId", "organizationId", "revision", "state", "revisionMetadata", "operationContext"].filter((key) => key in candidate);
  if (forbidden.length) throw new Error(`Provider included server-owned fields: ${forbidden.join(", ")}`);
  return {
    ...root,
    intent: {
      ...normalizeUnsafeProviderMaterial(input.request, { ...candidate, pricing: normalizeProviderQuantityTiers(candidate.pricing) }),
      contractVersion: 1,
      intentId,
      organizationId: input.orgId,
      revision: 0,
      state: "compiling",
      revisionMetadata: { parentRevision: null },
      operationContext: {},
    },
  };
}

function normalizeContinuationPatch(input: ProductIntentCompilerInput, value: unknown): unknown {
  if (!input.currentIntent || input.currentRevision == null || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  if (root.kind !== "intent_patch" || !root.patch || typeof root.patch !== "object" || Array.isArray(root.patch)) return value;
  const candidate = root.patch as Record<string, unknown>;
  const expected: Record<string, unknown> = { contractVersion: 1, baseRevision: input.currentRevision, preserveUnchanged: true };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (key in candidate && candidate[key] !== expectedValue) throw new Error(`Provider supplied an invalid server-owned patch field: ${key}`);
  }
  return { ...root, patch: { ...candidate, ...expected } };
}

function providerFailureStage(error: unknown): ProductIntentCompilerFailureStage {
  const kind = error && typeof error === "object" ? (error as { kind?: unknown }).kind : null;
  if (kind === "empty_response") return "provider_empty_response";
  if (kind === "http_failure" || kind === "authentication_failure" || kind === "rate_limit") return "provider_http_failure";
  return "provider_request_failure";
}

function logCompilerFailure(input: Pick<ProductIntentCompilerInput, "orgId">, correlationId: string, diagnostics: ProductIntentCompilerDiagnostics | undefined, stage: ProductIntentCompilerFailureStage, extra: Record<string, unknown> = {}) {
  console.warn("[PRODUCT_INTENT_COMPILER] Compilation failed.", {
    organizationId: input.orgId,
    correlationId: diagnostics?.correlationId ?? correlationId,
    provider: diagnostics?.provider ?? null,
    model: diagnostics?.model ?? null,
    providerRequestId: diagnostics?.requestMetadata.providerRequestId ?? null,
    stage,
    repairAttempted: (diagnostics?.attempts ?? 0) > 1,
    ...extra,
  });
}

async function persistCompilerDiagnostic(input: ProductIntentCompilerInput, diagnostics: ProductIntentCompilerDiagnostics | undefined, stage: ProductIntentCompilerFailureStage, errorCode: string) {
  try {
    const envelope = sanitizeAiDiagnosticEnvelope({ version: 1, referenceId: diagnostics?.correlationId, correlationId: diagnostics?.correlationId, diagnosticType: "product_intent_compiler", tenantId: input.orgId, actorId: null, conversationId: null, provider: diagnostics?.provider ?? null, model: diagnostics?.model ?? null, providerRequestId: diagnostics?.requestMetadata.providerRequestId ?? null, stage, errorCode, providerResponseState: stage === "json_extraction_failure" ? "parse_failed" : stage.includes("schema") ? "contract_failed" : "not_received", parseMethod: "none", repairAttempted: (diagnostics?.attempts ?? 0) > 1, repairResult: (diagnostics?.attempts ?? 0) > 1 ? "failed" : "not_attempted", validationSchema: stage.includes("schema") ? "ProductIntentCompilerResult" : null, validationIssuePaths: diagnostics?.schemaIssuePaths ?? [], validationIssueCodes: [], returnedTopLevelKeys: [], missingRequiredKeys: [], unknownKeys: [], plannerOperation: null, selectedCapability: "canonical_product_intent_compiler", specialistName: "product_intent_compiler", optionNormalizationStage: null, resolverStage: null, persistenceAttempted: false, persistenceResult: "not_attempted", createdAt: new Date().toISOString() });
    const { db } = await import("../../db"); const { aiAuditEvents } = await import("@shared/schema");
    await db.insert(aiAuditEvents).values({ orgId: input.orgId, eventType: "ai_diagnostic", status: "failed", correlationId: envelope.correlationId, metadata: envelope });
  } catch { /* Diagnostics must never conceal the original compiler failure. */ }
}

/**
 * Calls the configured provider and turns its JSON into the provider-neutral
 * canonical result. All provider-specific API behaviour remains inside the
 * existing configured provider adapter (including DeepSeek's request policy).
 */
export class ProductIntentCompiler {
  constructor(private readonly provider: ProductIntentCompilerProvider) {}

  async compile(input: ProductIntentCompilerInput): Promise<ProductIntentCompilerOutcome> {
    const timeoutMs = clampTimeout(input.timeoutMs);
    const correlationId = `pic-${randomUUID()}`;
    const initialIntentId = randomUUID();
    let lastDiagnostics: ProductIntentCompilerDiagnostics | undefined;
    let invalidOutput = "";
    let validationIssuePaths: string[] = [];
    let failureStage: ProductIntentCompilerFailureStage = "json_extraction_failure";

    for (let attempt = 0; attempt <= PRODUCT_INTENT_COMPILER_MAX_REPAIR_ATTEMPTS; attempt += 1) {
      const prompt = attempt === 0 ? promptForCompilation(input) : repairPrompt(input, invalidOutput, validationIssuePaths, failureStage);
      let response: Awaited<ReturnType<ProductIntentCompilerProvider["generateJson"]>>;
      try {
        response = await this.provider.generateJson({
          orgId: input.orgId,
          feature: "feature_review",
          system: prompt.system,
          user: prompt.user,
          promptVersion: PRODUCT_INTENT_COMPILER_PROMPT_VERSION,
          repairAttempt: attempt > 0,
          timeoutMs,
          timeoutUseCase: "product_intent_compiler",
        });
      } catch (error) {
        const unavailable = isProviderUnavailable(error);
        const stage = unavailable ? "provider_request_failure" : providerFailureStage(error);
        logCompilerFailure(input, correlationId, lastDiagnostics, stage, {
          failureKind: error && typeof error === "object" ? (error as { kind?: unknown }).kind ?? null : null,
          status: error && typeof error === "object" ? (error as { status?: unknown }).status ?? null : null,
          providerRequestId: error && typeof error === "object" ? (error as { providerRequestId?: unknown }).providerRequestId ?? null : null,
        });
        return {
          ok: false,
          error: {
            code: unavailable ? "provider_unavailable" : "provider_failure",
            message: unavailable
              ? "Product interpretation is unavailable until a compatible AI provider is configured."
              : `Product interpretation is temporarily unavailable. Nothing was changed. Reference: ${correlationId}.`,
            retryable: !unavailable,
            diagnosticCode: correlationId,
          },
          diagnostics: lastDiagnostics ?? { correlationId, provider: "unknown", model: "unknown", requestMetadata: {}, attempts: attempt, stage },
        };
      }

      lastDiagnostics = {
        correlationId,
        provider: response.provider,
        model: response.model,
        requestMetadata: safeRequestMetadata(response.requestMetadata),
        attempts: attempt + 1,
        stage: "success",
      };
      invalidOutput = response.rawText;

      let parsedJson: unknown;
      try {
        parsedJson = strictJsonObject(response.rawText);
      } catch {
        failureStage = "json_extraction_failure";
        validationIssuePaths = ["result"];
        lastDiagnostics = { ...lastDiagnostics, stage: failureStage, parseFailureType: "json_extraction", schemaIssuePaths: validationIssuePaths };
        logCompilerFailure(input, correlationId, lastDiagnostics, failureStage, { parseFailureType: "json_extraction", parseResult: "failed" });
        continue;
      }

      try {
        parsedJson = normalizeContinuationPatch(input, normalizeInitialCompleteIntent(input, parsedJson, initialIntentId));
      } catch {
        failureStage = attempt === 0 ? "runtime_schema_rejection" : "repair_response_schema_rejection";
        validationIssuePaths = ["intent.serverOwnedFields"];
        lastDiagnostics = { ...lastDiagnostics, stage: failureStage, schemaIssuePaths: validationIssuePaths };
        logCompilerFailure(input, correlationId, lastDiagnostics, failureStage, { parseResult: "success", schemaIssuePaths: validationIssuePaths });
        continue;
      }

      const result = productIntentCompilerResultSchema.safeParse(parsedJson);
      if (result.success) {
        return { ok: true, result: result.data, diagnostics: { ...lastDiagnostics, stage: "success", schemaIssuePaths: undefined } };
      }

      failureStage = attempt === 0 ? "runtime_schema_rejection" : "repair_response_schema_rejection";
      validationIssuePaths = schemaIssuePaths(result);
      lastDiagnostics = { ...lastDiagnostics, stage: failureStage, schemaIssuePaths: validationIssuePaths };
      logCompilerFailure(input, correlationId, lastDiagnostics, failureStage, {
        issueCount: result.error.issues.length,
        firstIssue: invalidResultMessage(result),
        parseResult: "success",
        schemaIssuePaths: validationIssuePaths,
      });
    }

    await persistCompilerDiagnostic(input, lastDiagnostics, failureStage, invalidOutput.trim().startsWith("{") ? "invalid_contract" : "invalid_json");
    return {
      ok: false,
      error: {
        code: invalidOutput.trim().startsWith("{") ? "invalid_contract" : "invalid_json",
        message: `I couldn't safely interpret that product request. Nothing was changed. Please try again. Reference: ${correlationId}.`,
        retryable: true,
        diagnosticCode: correlationId,
      },
      diagnostics: lastDiagnostics,
    };
  }
}

/** Uses the single existing OpenAI-compatible adapter. That adapter owns
 * provider request formatting for both OpenAI and DeepSeek, while this class
 * owns the provider-neutral compiler result boundary. */
export async function createConfiguredProductIntentCompiler(): Promise<ProductIntentCompiler | null> {
  // Keep the compiler module pure-testable: the configured provider imports
  // tenant AI persistence, which must not be loaded by contract tests.
  const { createConfiguredAiProvider } = await import("../ai/providers/configuredProvider");
  const provider = createConfiguredAiProvider();
  return provider ? new ProductIntentCompiler(provider) : null;
}
