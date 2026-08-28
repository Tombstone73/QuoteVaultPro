import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { sanitizeAiDiagnosticEnvelope } from "@shared/aiDiagnostics";
import { persistAiDiagnostic } from "../aiDiagnosticsService";
import {
  productIntentCompilerResultSchema,
  type ProductDraftIntent,
  type ProductIntentCompilerResult,
  type UnresolvedQuestionAnswer,
} from "@shared/productDraftIntent";
import { compileSemanticProductOperations, semanticProductOperationsResultSchema } from "./semanticProductOperations";

/** The compiler is deliberately an interpretation boundary. It has no database,
 * routing, persistence, or command-execution dependency. */
export const PRODUCT_INTENT_COMPILER_PROMPT_VERSION = "product-intent-compiler-v1";
export const PRODUCT_INTENT_COMPILER_MAX_REPAIR_ATTEMPTS = 1;

const DEFAULT_COMPILER_TIMEOUT_MS = 45_000;
const MIN_COMPILER_TIMEOUT_MS = 5_000;
const MAX_COMPILER_TIMEOUT_MS = 90_000;
export const DEFAULT_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS = 4_096;
const MIN_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS = 512;
const MAX_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS = 4_096;

/** Product intent is the largest structured response we request. Keep its
 * bounded budget separate from unrelated small JSON features. */
export function resolveProductIntentCompilerMaxOutputTokens(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.AI_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS;
  return Math.min(MAX_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS, Math.max(MIN_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS, Math.floor(configured)));
}

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
  /** A server-generated public diagnostic reference for a continuation. It is
   * deliberately not part of the provider prompt and lets every terminal
   * continuation failure round-trip through the admin diagnostic lookup. */
  diagnosticReferenceId?: string;
  diagnosticContext?: {
    actorId: string | null;
    conversationId: string | null;
    sessionId: string | null;
    currentRevision: number | null;
  };
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
  schemaIssueCodes?: string[];
  missingRequiredKeys?: string[];
  unknownKeys?: string[];
  /** Protocol tokens only; never raw provider output or business content. */
  providerResponseKinds?: string[];
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
    maxTokens: number;
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
    pricing: "{ model: 'scalar', unit: 'per_piece'|'per_square_foot'|'per_hour'|'flat_fee', priceCents } | { model: 'one_dimensional_matrix', unit: 'per_piece'|'per_square_foot'|'unresolved', optionKey, cells: [{ option, priceCents }] } | { model: 'two_dimensional_matrix', unit: 'per_piece'|'per_square_foot'|'unresolved', rowOptionKey, columnOptionKey, cells: [{ row, column, priceCents }] } | { model: 'quantity_tiers', unit: 'per_piece'|'per_square_foot', tiers: [{ minimumQuantity, maximumQuantity, priceCents }] } | { model: 'option_quantity_tiers', unit: 'per_piece'|'per_square_foot', optionKey, rows: [{ option, tiers: [{ minimumQuantity, maximumQuantity, priceCents }] }] } | { model: 'unresolved' }. Use per_hour only for a stated hourly service rate. Quantity tiers are continuous inclusive ranges beginning at 1; only the final tier is open ended. Prices are integer cents.",
    material: "{ state: 'resolved', id, label } | { state: 'unresolved', label } | { state: 'explicitly_unset' }",
    optionGroups: "[{ key, label, required, selectionMode: 'single'|'multiple', availableWhen?: { optionGroupKey, optionValueKey }, values: [{ key, label, isDefault, priceImpact?: { kind: 'percentage_of_base', percent }, totalPercentOfBaseWhenEnabled?: { percent, prerequisite: { optionGroupKey, optionValueKey } } }] }]. Use priceImpact only for an explicit percentage of the resolved base price. For a dependent total, use totalPercentOfBaseWhenEnabled: e.g. Contour has priceImpact 10, Weed and Tape has totalPercentOfBaseWhenEnabled percent 30 with prerequisite Contour. The server derives +20, so selection totals +30 rather than +40. A dependent group must use availableWhen with the same prerequisite. Never invent a material or route.",
    workflow: "{ kind: 'standard_production'|'fulfillment_only'|'service_fee', requiresProofApproval, requiresProductionJob }",
    production: "{ route: resolved|unresolved|explicitly_unset reference, configuration: {} }",
    visibility: { catalogVisible: false },
    unresolvedFields: "For an unknown matrix unit, preserve every matrix cell and add { path: 'pricing.unit', code: 'PRICING_UNIT_UNRESOLVED', question: 'Are these matrix prices per piece or per square foot?' }.",
    fieldMetadata: "object keyed by field path with { source: 'explicit_user'|'structured_candidate'|'ai_interpreted'|'selected_template'|'canonical_default'|'unresolved', confidence?: number }",
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

const canonicalCompilerResultKinds = ["complete_intent", "intent_patch", "unresolved_questions", "compiler_error"] as const;

function providerResponseContract(continuation: boolean) {
  return continuation
    ? {
      providerRootKinds: ["semantic_operations"],
      postNormalizationCompilerResultKinds: canonicalCompilerResultKinds,
      instruction: "For a continuation, semantic_operations is a provider-only protocol. The server converts it into a canonical intent_patch after strict business-label resolution.",
    }
    : {
      providerRootKinds: ["complete_intent"],
      postNormalizationCompilerResultKinds: canonicalCompilerResultKinds,
      instruction: "For an initial request, return a complete_intent. The server supplies all server-owned fields before canonical validation.",
    };
}

function businessReference(reference: ProductDraftIntent["identity"]["category"] | ProductDraftIntent["material"] | ProductDraftIntent["production"]["route"]): string {
  const businessReference = reference as { state: string; label?: string };
  return businessReference.state === "explicitly_unset" ? "Not selected" : businessReference.label ?? "Not selected";
}

/** Continuations receive the facts needed to interpret a correction, never
 * canonical IDs, revisions, lifecycle state, fingerprints, or patch shape. */
function continuationBusinessContext(intent: ProductDraftIntent) {
  const groupByKey = new Map(intent.optionGroups.map((group) => [group.key, group]));
  const labelFor = (groupKey: string, valueKey: string) => groupByKey.get(groupKey)?.values.find((value) => value.key === valueKey)?.label ?? valueKey;
  const currentPricing = intent.pricing;
  const pricing = currentPricing.model === "one_dimensional_matrix"
    ? { model: currentPricing.model, unit: currentPricing.unit, rates: currentPricing.cells.map((cell) => ({ option: labelFor(currentPricing.optionKey, cell.option), priceCents: cell.priceCents })) }
    : currentPricing.model === "two_dimensional_matrix"
      ? { model: currentPricing.model, unit: currentPricing.unit, rates: currentPricing.cells.map((cell) => ({ row: labelFor(currentPricing.rowOptionKey, cell.row), column: labelFor(currentPricing.columnOptionKey, cell.column), priceCents: cell.priceCents })) }
      : currentPricing.model === "scalar"
        ? { model: currentPricing.model, unit: currentPricing.unit, priceCents: currentPricing.priceCents }
        : { model: currentPricing.model };
  return {
    product: { name: intent.identity.name, description: intent.identity.description, category: businessReference(intent.identity.category) },
    measurement: intent.measurement, quantity: intent.quantity, pricing,
    optionGroups: intent.optionGroups.map((group) => ({ label: group.label, required: group.required, selectionMode: group.selectionMode, values: group.values.map((value) => ({ label: value.label, isDefault: value.isDefault, priceImpact: value.priceImpact ?? null, totalPercentOfBaseWhenEnabled: value.totalPercentOfBaseWhenEnabled?.percent ?? null })), availableWhen: group.availableWhen ? `${labelFor(group.availableWhen.optionGroupKey, group.availableWhen.optionValueKey)}` : null })),
    material: businessReference(intent.material), workflow: { kind: intent.workflow.kind, requiresProofApproval: intent.workflow.requiresProofApproval, requiresProductionJob: intent.workflow.requiresProductionJob }, productionRoute: businessReference(intent.production.route),
  };
}

function continuationQuestions(input: ProductIntentCompilerInput) {
  return (input.activeRequiredIssues ?? []).map((issue) => ({
    choices: issue.allowedChoices.map((choice) => choice.displayLabel),
  }));
}

function promptForCompilation(input: ProductIntentCompilerInput): { system: string; user: string } {
  const continuation = input.currentIntent != null;
  const user = continuation
    ? {
      request: input.request,
      currentBusinessContext: continuationBusinessContext(input.currentIntent!),
      providerResponseContract: providerResponseContract(true),
      semanticOperationContract: { operations: "Return every explicitly requested supported intent as business-label operations. The server plans group/value/default dependencies into canonical Product and PBV2 proposal order. Use set_category with the user's category phrase, set_product_name with the explicitly requested name, and record_unsupported_detail only for an enumerated unsupported detail while retaining independent supported work. Do not use canonical keys, paths, patch operations, revisions, IDs, audit data, lifecycle data, or PBV2 structures." },
      activeRequiredQuestions: continuationQuestions(input),
      candidateLabels: candidateLabelsForPrompt(input.candidateLabels),
    }
    : {
      request: input.request,
      operationContext: input.operationContext,
      canonicalSchema: input.schemaDescription,
      providerPayloadGuide,
      providerResponseContract: providerResponseContract(false),
      allowedEnums: input.allowedEnums,
      supportedArchetypes: input.supportedArchetypes,
      candidateLabels: candidateLabelsForPrompt(input.candidateLabels),
      serverConstraints: input.serverConstraints ?? [],
    };
  return {
    system: [
      "You are the PrintersHero Product Intent Compiler.",
      "Return exactly one strict JSON object and no markdown, commentary, or code fences.",
      "Your JSON must follow the supplied provider response contract. The server alone validates and constructs the canonical compiler-result contract.",
      "Interpret natural language only; do not execute commands, create products, invent tenant IDs, or claim that a database lookup succeeded.",
      "Use only candidate labels supplied by the server for tenant-scoped entities. If no supplied label is an unambiguous match, return an unresolved-question result.",
      "For continuations and corrections, preserve every existing business field unless the request explicitly changes it.",
      continuation
        ? "This is a continuation. Return only { kind: 'semantic_operations', operations: [...] }. Never return a complete intent or a canonical patch. Resolve every unambiguous active required issue answered by this message in one operation set; use business labels only and preserve every unrelated field. For set_category, return the user's category phrase; the server resolves it only when one supplied tenant category unambiguously contains that phrase."
        : "For an initial request, return { kind: 'complete_intent', intent: { ... } }.",
      "Do not turn preservation instructions into product options, materials, or entity references.",
      "Never set an active or published lifecycle. Confidence never makes a value execution-authorizing.",
    ].join(" "),
    user: JSON.stringify(user),
  };
}

function repairPrompt(input: ProductIntentCompilerInput, invalidOutput: string, validationIssuePaths: readonly string[], stage: ProductIntentCompilerFailureStage): { system: string; user: string } {
  const original = promptForCompilation(input);
  const continuation = input.currentIntent != null;
  const contract = providerResponseContract(continuation);
  const invalidRootKind = safeProviderRootKindFromRaw(invalidOutput);
  return {
    system: `${original.system} Repair the previous response into valid JSON only. Do not add facts not supported by the original request or current business context. Do not add commentary, Markdown, or code fences. Preserve unresolved fields explicitly rather than using null, an empty string, or an invented default. ${continuation ? "This is a continuation: return the provider-only semantic_operations protocol, never a complete intent or canonical patch. Server-owned fields are prohibited and unavailable to you. Preserve the intended business operation details and correct only the provider protocol shape." : "Return the initial provider complete_intent protocol."}`,
    user: JSON.stringify({
      originalInput: JSON.parse(original.user),
      invalidOutput: invalidOutput.slice(0, 24_000),
      validationIssuePaths,
      failedStage: stage,
      invalidRootKind,
      allowedProviderRootKinds: contract.providerRootKinds,
      postNormalizationCompilerResultKinds: contract.postNormalizationCompilerResultKinds,
      instruction: continuation
        ? "Return exactly one semantic_operations provider-protocol object. The server, not you, creates intent_patch and all canonical state. Server-owned fields are prohibited. Preserve the business operation target unless its shape itself is invalid. Unknown keys are forbidden."
        : "Return exactly one complete_intent provider-protocol object. The server, not you, supplies canonical server-owned fields. Unknown keys are forbidden.",
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

/** Extract only a bounded protocol token suitable for diagnostics and repair.
 * Do not retain arbitrary provider text, object values, or business content. */
function safeProviderRootKind(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = (value as Record<string, unknown>).kind;
  return typeof kind === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(kind) ? kind : null;
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

function safeProviderRootKindFromRaw(rawText: string): string | null {
  try {
    return safeProviderRootKind(strictJsonObject(rawText));
  } catch {
    return null;
  }
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

function schemaIssueMetadata(result: z.SafeParseError<unknown>) {
  const issues = result.error.issues.slice(0, 20);
  const path = (issue: z.ZodIssue) => issue.path.join(".") || "result";
  return {
    paths: schemaIssuePaths(result),
    codes: Array.from(new Set(issues.map((issue) => issue.code))),
    missing: Array.from(new Set(issues.filter((issue) => issue.code === "invalid_type" && "received" in issue && issue.received === "undefined").map(path))),
    unknown: Array.from(new Set(issues.flatMap((issue) => issue.code === "unrecognized_keys" && "keys" in issue && Array.isArray(issue.keys) ? issue.keys.map((key) => `${path(issue)}.${key}`) : []))),
  };
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

/** Categories and routes are consequential tenant capabilities.  A model may
 * suggest a label, but it cannot make it canonical merely because that label
 * exists in this tenant: the user request must contain the exact business
 * label unless a server-owned template or explicit user source supplied it. */
function normalizeUnsafeProviderOperationalReferences(request: string, intent: Record<string, unknown>): Record<string, unknown> {
  const metadata = intent.fieldMetadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return intent;
  const nextMetadata = { ...(metadata as Record<string, unknown>) };
  const next = { ...intent };
  for (const [path, root, unset] of [["identity.category", "identity", false], ["production.route", "production", true]] as const) {
    const rootValue = next[root];
    const source = nextMetadata[path];
    if (!rootValue || typeof rootValue !== "object" || Array.isArray(rootValue) || !source || typeof source !== "object" || Array.isArray(source)) continue;
    const reference = path === "identity.category" ? (rootValue as Record<string, unknown>).category : (rootValue as Record<string, unknown>).route;
    const sourceKind = (source as Record<string, unknown>).source;
    const label = reference && typeof reference === "object" && !Array.isArray(reference) ? (reference as Record<string, unknown>).label : null;
    // A provider cannot self-assert that a tenant capability was supplied by
    // the user. Only direct request evidence (or server/template provenance)
    // may carry an operational reference into canonical state.
    if (["selected_template", "canonical_default"].includes(String(sourceKind))) continue;
    if (typeof label !== "string" || !label.trim() || !normalizedText(request).includes(normalizedText(label))) {
      nextMetadata[path] = { source: "unresolved" };
      next[root] = path === "identity.category"
        ? { ...(rootValue as Record<string, unknown>), category: { state: "unresolved", label: typeof label === "string" && label.trim() ? label : "Product category" } }
        : { ...(rootValue as Record<string, unknown>), route: unset ? { state: "explicitly_unset" } : { state: "unresolved", label } };
      continue;
    }
    // Direct wording establishes the business source even if the provider
    // initially labelled its interpretation differently.
    nextMetadata[path] = { source: "explicit_user" };
  }
  return { ...next, fieldMetadata: nextMetadata };
}

/** Product Builder owns safe starting workflow policy.  The provider may
 * interpret explicit proof/production language, but absent such language the
 * defaults are server-written and visibly attributed as canonical defaults. */
function normalizeServerOwnedProductDefaults(request: string, intent: Record<string, unknown>): Record<string, unknown> {
  const metadata = intent.fieldMetadata;
  const workflow = intent.workflow;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !workflow || typeof workflow !== "object" || Array.isArray(workflow)) return intent;
  const source = normalizedText(request);
  const mentionsProof = /\bproof\b/.test(source);
  const mentionsProductionJob = /\bproduction job\b/.test(source);
  const nextMetadata = { ...(metadata as Record<string, unknown>) };
  const nextWorkflow = { ...(workflow as Record<string, unknown>) };
  if (!mentionsProof) {
    nextWorkflow.requiresProofApproval = false;
    nextMetadata["workflow.requiresProofApproval"] = { source: "canonical_default" };
  }
  if (!mentionsProductionJob && nextWorkflow.kind === "standard_production") {
    nextWorkflow.requiresProductionJob = true;
    nextMetadata["workflow.requiresProductionJob"] = { source: "canonical_default" };
  }
  nextMetadata["lifecycle.productStatus"] = { source: "canonical_default" };
  nextMetadata["lifecycle.published"] = { source: "canonical_default" };
  nextMetadata["visibility.catalogVisible"] = { source: "canonical_default" };
  return { ...intent, workflow: nextWorkflow, lifecycle: { productStatus: "inactive", published: false }, visibility: { catalogVisible: false }, fieldMetadata: nextMetadata };
}

function optionDefaultMetadataPath(key: string): string { return `optionGroups.${key}.default`; }

/** Provider output may describe an explicit or template-owned default, but it
 * must never manufacture a meaningful customer choice just by flagging the
 * first value. Canonical defaults are applied later by the server only for a
 * proven neutral optional value. */
function normalizeUnsafeProviderOptionDefaults(intent: Record<string, unknown>): Record<string, unknown> {
  const groups = intent.optionGroups;
  const metadata = intent.fieldMetadata;
  if (!Array.isArray(groups) || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return intent;
  const fieldMetadata = metadata as Record<string, unknown>;
  return {
    ...intent,
    optionGroups: groups.map((group) => {
      if (!group || typeof group !== "object" || Array.isArray(group)) return group;
      const candidate = group as Record<string, unknown>;
      const key = typeof candidate.key === "string" ? candidate.key : "";
      const source = key && fieldMetadata[optionDefaultMetadataPath(key)] && typeof fieldMetadata[optionDefaultMetadataPath(key)] === "object"
        ? (fieldMetadata[optionDefaultMetadataPath(key)] as Record<string, unknown>).source
        : null;
      const authoritative = source === "explicit_user" || source === "structured_candidate" || source === "selected_template";
      if (authoritative || !Array.isArray(candidate.values)) return candidate;
      return { ...candidate, values: candidate.values.map((value) => value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>), isDefault: false } : value) };
    }),
  };
}

function hourlyRateCents(request: string): number | null {
  const match = request.match(/\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/|per\s*)?(?:hour|hours|hr|hrs)\b/i);
  if (!match) return null;
  const amount = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

/** Server-owned semantic inference keeps fee language from being forced into
 * physical-product schema defaults. It does not select a tenant record: the
 * resolver below still resolves the semantic Fees label against this tenant. */
function normalizeServiceFeeIntent(request: string, candidate: Record<string, unknown>): Record<string, unknown> {
  const text = normalizedText(request);
  const hourly = /\b(?:hour|hours|hourly|hr|hrs)\b/.test(text);
  const feeLanguage = /\b(?:fee|fees)\b/.test(text)
    || /\bservice\s+(?:product|fee)\b/.test(text)
    || (hourly && /\b(?:design|installation)\b/.test(text));
  if (!feeLanguage) return candidate;
  const rateCents = hourlyRateCents(request);
  const metadata = candidate.fieldMetadata && typeof candidate.fieldMetadata === "object" && !Array.isArray(candidate.fieldMetadata)
    ? candidate.fieldMetadata as Record<string, unknown>
    : {};
  const unresolved = Array.isArray(candidate.unresolvedFields) ? candidate.unresolvedFields.filter((field: any) =>
    field?.path !== "material" && field?.path !== "production.route" && field?.path !== "workflow.requiresProofApproval" && field?.path !== "workflow.requiresProductionJob" && field?.path !== "pricing"
  ) : [];
  if (hourly && rateCents === null) unresolved.push({ path: "pricing", code: "HOURLY_RATE_UNRESOLVED", question: "What hourly rate should this service use?" });
  const identity = candidate.identity && typeof candidate.identity === "object" && !Array.isArray(candidate.identity)
    ? candidate.identity as Record<string, unknown>
    : {};
  return {
    ...candidate,
    identity: { ...identity, category: { state: "unresolved", label: "Fees" } },
    measurement: { mode: "quantity_only" },
    quantity: hourly ? { behavior: "not_applicable" } : candidate.quantity,
    ...(hourly ? { pricing: rateCents === null ? { model: "unresolved", unit: "per_hour" } : { model: "scalar", unit: "per_hour", priceCents: rateCents } } : {}),
    material: { state: "explicitly_unset" },
    workflow: { kind: "service_fee", requiresProofApproval: false, requiresProductionJob: false },
    production: { route: { state: "explicitly_unset" }, configuration: {} },
    unresolvedFields: unresolved,
    fieldMetadata: {
      ...metadata,
      "identity.category": { source: "semantic_inference" },
      "measurement.mode": { source: "semantic_inference" },
      pricing: { source: rateCents === null ? "unresolved" : "semantic_inference" },
      material: { source: "semantic_inference" },
      "workflow.kind": { source: "semantic_inference" },
      "workflow.requiresProofApproval": { source: "semantic_inference" },
      "workflow.requiresProductionJob": { source: "semantic_inference" },
      "production.route": { source: "semantic_inference" },
    },
  };
}

function normalizeInitialCompleteIntent(input: ProductIntentCompilerInput, value: unknown, intentId: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  if (root.kind !== "complete_intent" || !root.intent || typeof root.intent !== "object" || Array.isArray(root.intent)) return value;
  const candidate = root.intent as Record<string, unknown>;
  const forbidden = ["contractVersion", "intentId", "organizationId", "revision", "state", "revisionMetadata", "operationContext"].filter((key) => key in candidate);
  if (forbidden.length) throw new Error(`Provider included server-owned fields: ${forbidden.join(", ")}`);
  const normalizedCandidate = normalizeServerOwnedProductDefaults(
    input.request,
    normalizeServiceFeeIntent(
      input.request,
      normalizeUnsafeProviderOptionDefaults(
        normalizeUnsafeProviderOperationalReferences(
          input.request,
          normalizeUnsafeProviderMaterial(input.request, { ...candidate, pricing: normalizeProviderQuantityTiers(candidate.pricing) }),
        ),
      ),
    ),
  );
  return {
    ...root,
    intent: {
      ...normalizedCandidate,
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

/** The provider can speak in business labels for continuations. The existing
 * ProductDraftIntentPatch remains server-only and is built only after exact
 * resolution against the current canonical intent. */
function normalizeSemanticContinuation(input: ProductIntentCompilerInput, value: unknown): unknown {
  if (!input.currentIntent || input.currentRevision == null || !value || typeof value !== "object" || Array.isArray(value)) return value;
  if (input.currentIntent.workflow.kind === "service_fee" && input.currentIntent.pricing.model === "unresolved" && input.currentIntent.pricing.unit === "per_hour") {
    const rateCents = hourlyRateCents(input.request) ?? (/\$\s*\d/.test(input.request) ? (() => {
      const amount = input.request.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/)?.[1];
      return amount ? Math.round(Number(amount.replace(/,/g, "")) * 100) : null;
    })() : null);
    if (rateCents !== null && Number.isFinite(rateCents)) {
      return { kind: "intent_patch", patch: {
        contractVersion: 1, baseRevision: input.currentRevision, preserveUnchanged: true,
        operations: [
          { op: "set_pricing", value: { model: "scalar", unit: "per_hour", priceCents: rateCents } },
          { op: "set_unresolved_fields", value: input.currentIntent.unresolvedFields.filter((field) => field.path !== "pricing") },
          { op: "merge_field_metadata", value: { pricing: { source: "explicit_user" } } },
        ],
      } };
    }
  }
  const parsed = semanticProductOperationsResultSchema.safeParse(value);
  if (!parsed.success) return value;
  return { kind: "intent_patch", patch: compileSemanticProductOperations(input.currentIntent, parsed.data, input.currentRevision, input.request, { categoryLabels: input.candidateLabels?.categories }) };
}

const forbiddenContinuationStateFields = new Set(["contractVersion", "intentId", "organizationId", "revision", "state", "revisionMetadata", "operationContext", "serverOwnedFields", "fingerprint", "proposalId", "sessionId", "actorUserId", "createdAt", "updatedAt"]);

/** A continuation provider is never allowed to provide an intent or patch.
 * Detect this before any canonical normalizer can observe its values. */
function forbiddenContinuationStatePath(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const intent = root.intent;
  if (intent && typeof intent === "object" && !Array.isArray(intent)
    && Object.keys(intent as Record<string, unknown>).some((key) => forbiddenContinuationStateFields.has(key))) return "intent.serverOwnedFields";
  if ("intent" in root || "patch" in root || Object.keys(root).some((key) => forbiddenContinuationStateFields.has(key))) return "provider_output.server_owned_fields";
  return null;
}

function safeContinuationOperation(operation: unknown): Record<string, unknown> | null {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return null;
  const source = operation as Record<string, unknown>;
  const op = source.op;
  if (op === "set_category") return typeof source.category === "string" ? { op, category: source.category } : null;
  if (op === "set_pricing_basis") return typeof source.basis === "string" ? { op, basis: source.basis } : null;
  if (op === "set_product_name") return typeof source.name === "string" ? { op, name: source.name } : null;
  if (op === "add_option_group") return typeof source.optionGroup === "string" && typeof source.required === "boolean" && (source.selectionMode === "single" || source.selectionMode === "multiple") ? { op, optionGroup: source.optionGroup, required: source.required, selectionMode: source.selectionMode } : null;
  if (op === "add_option_value") return typeof source.optionGroup === "string" && typeof source.value === "string" ? { op, optionGroup: source.optionGroup, value: source.value } : null;
  if (op === "add_text_input") return typeof source.optionGroup === "string" && typeof source.label === "string" && typeof source.multiline === "boolean" && typeof source.required === "boolean" ? { op, optionGroup: source.optionGroup, label: source.label, multiline: source.multiline, required: source.required, ...(typeof source.whenOptionGroup === "string" && typeof source.whenValue === "string" ? { whenOptionGroup: source.whenOptionGroup, whenValue: source.whenValue } : {}) } : null;
  if (op === "record_unsupported_detail") return source.detail === "customer_specific_availability" || source.detail === "grommet_quantity" ? { op, detail: source.detail } : null;
  if (op === "set_proof_requirement") return typeof source.requiresProofApproval === "boolean" ? { op, requiresProofApproval: source.requiresProofApproval } : null;
  if (op === "set_option_default" || op === "remove_option_value") return typeof source.optionGroup === "string" && typeof source.value === "string" ? { op, optionGroup: source.optionGroup, value: source.value } : null;
  if (op === "remove_option_group") return typeof source.optionGroup === "string" ? { op, optionGroup: source.optionGroup } : null;
  if (op === "set_matrix_rate") return typeof source.optionGroup === "string" && typeof source.value === "string" && typeof source.priceCents === "number" ? { op, optionGroup: source.optionGroup, value: source.value, priceCents: source.priceCents } : null;
  return null;
}

/** Repair receives only business-level continuation content. In particular it
 * never receives a model-supplied canonical intent for it to echo again. */
function safeContinuationRepairOutput(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify({ kind: "invalid_provider_envelope" });
  const root = value as Record<string, unknown>;
  if (root.kind === "semantic_operations" && Array.isArray(root.operations)) {
    return JSON.stringify({ kind: "semantic_operations", operations: root.operations.map(safeContinuationOperation).filter((operation): operation is Record<string, unknown> => operation != null) });
  }
  return JSON.stringify({ kind: safeProviderRootKind(root) ?? "invalid_provider_envelope" });
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
    const referenceId = diagnostics?.correlationId ?? input.diagnosticReferenceId;
    if (!referenceId) return;
    const repaired = (diagnostics?.attempts ?? 0) > 1;
    const envelope = sanitizeAiDiagnosticEnvelope({ version: 1, referenceId, correlationId: referenceId, diagnosticType: "product_intent_compiler", tenantId: input.orgId, actorId: input.diagnosticContext?.actorId ?? null, conversationId: input.diagnosticContext?.conversationId ?? null, provider: diagnostics?.provider ?? null, model: diagnostics?.model ?? null, providerRequestId: diagnostics?.requestMetadata.providerRequestId ?? null, stage, errorCode, providerResponseState: stage === "json_extraction_failure" ? "parse_failed" : stage.includes("schema") ? "contract_failed" : "not_received", parseMethod: stage === "json_extraction_failure" ? "none" : repaired ? "repaired_json" : "raw_json", repairAttempted: repaired, repairResult: repaired ? "failed" : "not_attempted", validationSchema: stage.includes("schema") ? "ProductIntentCompilerResult" : null, validationIssuePaths: diagnostics?.schemaIssuePaths ?? [], validationIssueCodes: diagnostics?.schemaIssueCodes ?? [], returnedTopLevelKeys: [], providerResponseKinds: diagnostics?.providerResponseKinds ?? [], missingRequiredKeys: diagnostics?.missingRequiredKeys ?? [], unknownKeys: diagnostics?.unknownKeys ?? [], plannerOperation: null, selectedCapability: "canonical_product_intent_compiler", specialistName: "product_intent_compiler", optionNormalizationStage: null, resolverStage: null, persistenceAttempted: true, persistenceResult: "succeeded", createdAt: new Date().toISOString(), sessionId: input.diagnosticContext?.sessionId ?? null, currentRevision: input.diagnosticContext?.currentRevision ?? null, patchOperationCount: null, patchPaths: [] });
    await persistAiDiagnostic(envelope);
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
    const correlationId = input.diagnosticReferenceId ?? `pic-${randomUUID()}`;
    const initialIntentId = randomUUID();
    let lastDiagnostics: ProductIntentCompilerDiagnostics | undefined;
    let invalidOutput = "";
    let validationIssuePaths: string[] = [];
    let failureStage: ProductIntentCompilerFailureStage = "json_extraction_failure";
    let providerResponseKinds: string[] = [];

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
          maxTokens: resolveProductIntentCompilerMaxOutputTokens(),
        });
      } catch (error) {
        const unavailable = isProviderUnavailable(error);
        const stage = unavailable ? "provider_request_failure" : providerFailureStage(error);
        logCompilerFailure(input, correlationId, lastDiagnostics, stage, {
          failureKind: error && typeof error === "object" ? (error as { kind?: unknown }).kind ?? null : null,
          status: error && typeof error === "object" ? (error as { status?: unknown }).status ?? null : null,
          providerRequestId: error && typeof error === "object" ? (error as { providerRequestId?: unknown }).providerRequestId ?? null : null,
        });
        const diagnostics = lastDiagnostics ?? { correlationId, provider: "unknown", model: "unknown", requestMetadata: {}, attempts: attempt, stage };
        await persistCompilerDiagnostic(input, diagnostics, stage, unavailable ? "provider_unavailable" : "provider_failure");
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
          diagnostics,
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
        if (input.currentIntent) invalidOutput = JSON.stringify({ kind: "invalid_json" });
        lastDiagnostics = { ...lastDiagnostics, stage: failureStage, parseFailureType: "json_extraction", schemaIssuePaths: validationIssuePaths };
        logCompilerFailure(input, correlationId, lastDiagnostics, failureStage, { parseFailureType: "json_extraction", parseResult: "failed" });
        continue;
      }

      const providerRootKind = safeProviderRootKind(parsedJson);
      if (providerRootKind) {
        providerResponseKinds = Array.from(new Set([...providerResponseKinds, providerRootKind])).slice(0, 2);
        lastDiagnostics = { ...lastDiagnostics, providerResponseKinds };
      }

      const forbiddenStatePath = input.currentIntent ? forbiddenContinuationStatePath(parsedJson) : null;
      if (forbiddenStatePath) {
        failureStage = attempt === 0 ? "runtime_schema_rejection" : "repair_response_schema_rejection";
        validationIssuePaths = [forbiddenStatePath];
        invalidOutput = safeContinuationRepairOutput(parsedJson);
        lastDiagnostics = { ...lastDiagnostics, stage: failureStage, schemaIssuePaths: validationIssuePaths };
        logCompilerFailure(input, correlationId, lastDiagnostics, failureStage, { parseResult: "success", schemaIssuePaths: validationIssuePaths });
        continue;
      }

      try {
        parsedJson = input.currentIntent
          ? normalizeContinuationPatch(input, normalizeSemanticContinuation(input, parsedJson))
          : normalizeInitialCompleteIntent(input, parsedJson, initialIntentId);
      } catch {
        failureStage = attempt === 0 ? "runtime_schema_rejection" : "repair_response_schema_rejection";
        validationIssuePaths = ["intent.serverOwnedFields"];
        if (input.currentIntent) invalidOutput = safeContinuationRepairOutput(parsedJson);
        lastDiagnostics = { ...lastDiagnostics, stage: failureStage, schemaIssuePaths: validationIssuePaths };
        logCompilerFailure(input, correlationId, lastDiagnostics, failureStage, { parseResult: "success", schemaIssuePaths: validationIssuePaths });
        continue;
      }

      const result = productIntentCompilerResultSchema.safeParse(parsedJson);
      if (result.success) {
        return { ok: true, result: result.data, diagnostics: { ...lastDiagnostics, stage: "success", schemaIssuePaths: undefined } };
      }

      failureStage = attempt === 0 ? "runtime_schema_rejection" : "repair_response_schema_rejection";
      const issueMetadata = schemaIssueMetadata(result);
      validationIssuePaths = issueMetadata.paths;
      if (input.currentIntent) invalidOutput = safeContinuationRepairOutput(parsedJson);
      lastDiagnostics = { ...lastDiagnostics, stage: failureStage, schemaIssuePaths: validationIssuePaths, schemaIssueCodes: issueMetadata.codes, missingRequiredKeys: issueMetadata.missing, unknownKeys: issueMetadata.unknown };
      logCompilerFailure(input, correlationId, lastDiagnostics, failureStage, {
        issueCount: result.error.issues.length,
        firstIssue: invalidResultMessage(result),
        parseResult: "success",
        schemaIssuePaths: validationIssuePaths,
      });
    }

    const finalDiagnostics = lastDiagnostics ? { ...lastDiagnostics, schemaIssuePaths: validationIssuePaths } : lastDiagnostics;
    await persistCompilerDiagnostic(input, finalDiagnostics, failureStage, invalidOutput.trim().startsWith("{") ? "invalid_contract" : "invalid_json");
    return {
      ok: false,
      error: {
        code: invalidOutput.trim().startsWith("{") ? "invalid_contract" : "invalid_json",
        message: `Product Builder could not prepare that correction because its AI response did not match the required internal contract. Nothing was changed. Please try again. Reference: ${correlationId}.`,
        retryable: true,
        diagnosticCode: correlationId,
      },
      diagnostics: finalDiagnostics,
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
