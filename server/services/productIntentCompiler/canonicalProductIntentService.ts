import {
  productDraftIntentFingerprint,
  productDraftIntentSchema,
  type ProductDraftIntent,
  type ProductIntentCompilerResult,
  type ProductDraftIntentPatch,
  type UnresolvedQuestionAnswer,
} from "@shared/productDraftIntent";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sanitizeAiDiagnosticEnvelope } from "@shared/aiDiagnostics";
import { persistAiDiagnostic } from "../aiDiagnosticsService";
import { ProductIntentCompiler, type ProductIntentCompilerInput } from "./productIntentCompiler";
import {
  ProductIntentPersistenceService,
  type CanonicalProductIntentSession,
} from "./productIntentPersistence";
import { presentProductDraftIntent, type CanonicalProductIntentProposalDto } from "./productIntentPresentation";
import {
  resolveAndValidateProductDraftIntent,
  resolveProductDraftIntentReferences,
  type ProductIntentIssue,
  type ProductIntentResolutionContext,
  type TenantIntentReference,
} from "./productIntentResolver";
import { generateProductIntentCandidateActions, generateProductIntentRecommendations, parseProductIntentCandidateAction, parseProductIntentRecommendation, type ExistingProductCandidate } from "./productIntentInteractions";

export type CanonicalProductIntentCandidates = {
  categories: readonly TenantIntentReference[];
  materials: readonly TenantIntentReference[];
  productionRoutes: readonly TenantIntentReference[];
  existingProducts?: readonly ExistingProductCandidate[];
};

export type CanonicalProductIntentOutcome =
  | { ok: true; session: CanonicalProductIntentSession; card: CanonicalProductIntentProposalDto; issues: ProductIntentIssue[] }
  | { ok: false; code: string; message: string };

/** Read-only view of the latest persisted revision. It is intentionally
 * separate from continuation so inquiries cannot append revisions or invoke
 * the compiler's patch-only contract. */
export type CanonicalProductIntentInspection = {
  session: CanonicalProductIntentSession;
  card: CanonicalProductIntentProposalDto;
  issues: ProductIntentIssue[];
};

function answerContract(intent: ProductDraftIntent, issue: ProductIntentIssue): UnresolvedQuestionAnswer | undefined {
  if (issue.id == null) return undefined;
  if (issue.path === "pricing.matrix.unit" && issue.code === "PRICING_UNIT_UNRESOLVED" && intent.pricing.model === "two_dimensional_matrix" && intent.pricing.unit === "unresolved") {
    return {
      issueId: issue.id, canonicalPath: "pricing.matrix.unit", answerType: "choice",
      allowedChoices: [
        { displayLabel: "Per piece", canonicalValue: "per_piece", safeAliases: ["per piece", "piece"] },
        { displayLabel: "Per square foot", canonicalValue: "per_square_foot", safeAliases: ["per square foot", "square foot", "per sqft"] },
      ],
      baseRevision: intent.revision,
    };
  }
  if (issue.code !== "OPTION_DEFAULT_UNRESOLVED" || !issue.path.startsWith("optionGroups.") || !issue.path.endsWith(".default")) return undefined;
  const key = issue.path.slice("optionGroups.".length, -".default".length);
  const group = intent.optionGroups.find((candidate) => candidate.key === key);
  if (!group || group.selectionMode !== "single" || !group.required || group.values.some((value) => value.isDefault)) return undefined;
  return {
    issueId: issue.id, canonicalPath: issue.path, answerType: "choice",
    allowedChoices: group.values.map((value) => ({ displayLabel: value.label, canonicalValue: value.key, safeAliases: [value.label, value.key] })),
    baseRevision: intent.revision,
  };
}

function questionsFrom(intent: ProductDraftIntent, issues: readonly ProductIntentIssue[]) {
  const questions = issues.filter((issue) => issue.severity === "question").map((issue) => {
      const answer = answerContract(intent, issue);
      return { id: issue.id ?? issue.code, path: issue.path, question: issue.message, required: true, ...(answer ? { answer } : {}) };
    });
  return questions.length ? { baseRevision: intent.revision, questions } : undefined;
}

const semanticNumberWords: Record<string, string> = {
  "1": "one", "1st": "one", first: "one", one: "one",
  "2": "two", "2nd": "two", second: "two", two: "two",
  "3": "three", "3rd": "three", third: "three", three: "three",
  "4": "four", "4th": "four", fourth: "four", four: "four",
  "5": "five", "5th": "five", fifth: "five", five: "five",
};
function normalizeAnswer(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .split(" ").filter(Boolean).map((token) => semanticNumberWords[token] ?? token.replace(/s$/, "")).join(" ");
}

function includesTokenSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  return haystack.some((_, index) => needle.every((token, offset) => haystack[index + offset] === token));
}

/** Resolve only wording that identifies exactly one server-issued choice.  This
 * protects a continuation when a provider notices one answer in a compound
 * reply but omits another; it has no access to arbitrary product values. */
function resolvedSemanticAnswers(intent: ProductDraftIntent, answers: readonly UnresolvedQuestionAnswer[], request: string) {
  const requestTokens = normalizeAnswer(request).split(" ").filter(Boolean);
  const resolved: Array<{ answer: UnresolvedQuestionAnswer; choice: UnresolvedQuestionAnswer["allowedChoices"][number] }> = [];
  for (const answer of answers) {
    const groupKey = answer.canonicalPath.startsWith("optionGroups.") ? answer.canonicalPath.slice("optionGroups.".length, -".default".length) : null;
    const group = groupKey ? intent.optionGroups.find((candidate) => candidate.key === groupKey) : null;
    const groupTokens = group ? normalizeAnswer(group.label).split(" ").filter(Boolean) : [];
    const choices = answer.allowedChoices.filter((choice) => {
      const variants = new Set<string>([choice.displayLabel, choice.canonicalValue, ...choice.safeAliases].map(normalizeAnswer).filter(Boolean));
      if (Array.from(variants).some((variant) => includesTokenSequence(requestTokens, variant.split(" ")))) return true;
      if (!groupTokens.length || !includesTokenSequence(requestTokens, groupTokens)) return false;
      // Display labels commonly contain a useful group-qualified prefix, such
      // as "1st Surface (Right Reading)".  Matching that prefix accepts a
      // natural answer without requiring the explanatory parenthetical.
      const displayTokens = normalizeAnswer(choice.displayLabel).split(" ").filter(Boolean);
      const groupIndex = displayTokens.findIndex((token, index) => groupTokens.every((part, offset) => displayTokens[index + offset] === part));
      if (groupIndex >= 0 && includesTokenSequence(requestTokens, displayTokens.slice(0, groupIndex + groupTokens.length))) return true;
      // Conversely, group-qualified language can use a distinctive label
      // suffix (for example "Surface ... right reading").
      return groupIndex >= 0 && displayTokens.length > groupIndex + groupTokens.length
        && includesTokenSequence(requestTokens, displayTokens.slice(groupIndex + groupTokens.length));
    });
    if (choices.length === 1 && answer.baseRevision === intent.revision) resolved.push({ answer, choice: choices[0]! });
  }
  return resolved;
}

function deterministicAnswersPatch(intent: ProductDraftIntent, answers: readonly UnresolvedQuestionAnswer[], request: string): ProductDraftIntentPatch | null {
  const resolved = resolvedSemanticAnswers(intent, answers, request);
  if (!resolved.length) return null;
  const nextGroups = structuredClone(intent.optionGroups);
  const metadata: Record<string, { source: "explicit_user" }> = {};
  let groupsChanged = false;
  let nextPricing = intent.pricing;
  let pricingChanged = false;
  let unresolvedFields = intent.unresolvedFields;
  let unresolvedChanged = false;
  for (const { answer, choice } of resolved) {
    if (answer.canonicalPath === "pricing.matrix.unit" && intent.pricing.model === "two_dimensional_matrix" && (choice.canonicalValue === "per_piece" || choice.canonicalValue === "per_square_foot")) {
      nextPricing = { ...intent.pricing, unit: choice.canonicalValue };
      pricingChanged = true;
      unresolvedFields = unresolvedFields.filter((field) => field.path !== "pricing.unit" && field.path !== answer.canonicalPath);
      unresolvedChanged = true;
      metadata["pricing.unit"] = { source: "explicit_user" };
      continue;
    }
    if (!answer.canonicalPath.startsWith("optionGroups.") || !answer.canonicalPath.endsWith(".default")) continue;
    const key = answer.canonicalPath.slice("optionGroups.".length, -".default".length);
    const group = nextGroups.find((candidate) => candidate.key === key);
    if (!group || group.selectionMode !== "single" || !group.required || !group.values.some((value) => value.key === choice.canonicalValue)) continue;
    group.values = group.values.map((value) => ({ ...value, isDefault: value.key === choice.canonicalValue }));
    groupsChanged = true;
    metadata[answer.canonicalPath] = { source: "explicit_user" };
  }
  const operations: ProductDraftIntentPatch["operations"] = [];
  if (groupsChanged) operations.push({ op: "replace_option_groups", value: nextGroups });
  if (pricingChanged) operations.push({ op: "set_pricing", value: nextPricing });
  if (unresolvedChanged) operations.push({ op: "set_unresolved_fields", value: unresolvedFields });
  if (Object.keys(metadata).length) operations.push({ op: "merge_field_metadata", value: metadata });
  return operations.length ? { contractVersion: 1, baseRevision: intent.revision, preserveUnchanged: true, operations } : null;
}

function deterministicAnswerPatch(intent: ProductDraftIntent, answers: readonly UnresolvedQuestionAnswer[], request: string): { issueId: string; patch: ProductDraftIntentPatch } | null {
  const semanticPatch = deterministicAnswersPatch(intent, answers, request);
  if (semanticPatch) return { issueId: "semantic_multi_answer", patch: semanticPatch };
  const normalizedRequest = normalizeAnswer(request);
  const matches = answers.flatMap((answer) => answer.allowedChoices.filter((choice) => choice.safeAliases.some((alias) => normalizeAnswer(alias) === normalizedRequest)).map((choice) => ({ answer, choice })));
  if (matches.length !== 1) return null;
  const { answer, choice } = matches[0]!;
  if (answer.baseRevision !== intent.revision) return null;
  if (answer.canonicalPath === "pricing.matrix.unit" && (choice.canonicalValue === "per_piece" || choice.canonicalValue === "per_square_foot") && intent.pricing.model === "two_dimensional_matrix" && intent.pricing.unit === "unresolved") {
    return {
      issueId: answer.issueId,
      patch: {
        contractVersion: 1, baseRevision: intent.revision, preserveUnchanged: true,
        operations: [
          { op: "set_pricing", value: { ...intent.pricing, unit: choice.canonicalValue } },
          { op: "set_unresolved_fields", value: intent.unresolvedFields.filter((field) => field.path !== "pricing.unit" && field.path !== answer.canonicalPath) },
          { op: "merge_field_metadata", value: { "pricing.unit": { source: "explicit_user" } } },
        ],
      },
    };
  }
  if (!answer.canonicalPath.startsWith("optionGroups.") || !answer.canonicalPath.endsWith(".default")) return null;
  const key = answer.canonicalPath.slice("optionGroups.".length, -".default".length);
  const group = intent.optionGroups.find((candidate) => candidate.key === key);
  if (!group || group.selectionMode !== "single" || !group.required || !group.values.some((value) => value.key === choice.canonicalValue)) return null;
  return {
    issueId: answer.issueId,
    patch: {
      contractVersion: 1, baseRevision: intent.revision, preserveUnchanged: true,
      operations: [
        { op: "replace_option_groups", value: intent.optionGroups.map((candidate) => candidate.key === key ? { ...candidate, values: candidate.values.map((value) => ({ ...value, isDefault: value.key === choice.canonicalValue })) } : candidate) },
        { op: "merge_field_metadata", value: { [answer.canonicalPath]: { source: "explicit_user" } } },
      ],
    },
  };
}

function providerPatchIsScopedToActiveAnswers(intent: ProductDraftIntent, patch: ProductDraftIntentPatch, answers: readonly UnresolvedQuestionAnswer[]): boolean {
  if (answers.length === 0) return true;
  const optionAnswers = new Map(answers
    .filter((answer) => answer.canonicalPath.startsWith("optionGroups.") && answer.canonicalPath.endsWith(".default"))
    .map((answer) => [answer.canonicalPath.slice("optionGroups.".length, -".default".length), answer]));
  const pricingAnswer = answers.find((answer) => answer.canonicalPath === "pricing.matrix.unit");
  const touchedPaths = new Set<string>();
  const metadataPaths = new Set<string>();
  let optionGroupsReplaced = false;
  let pricingUpdated = false;
  let unresolvedFieldsUpdated = false;
  for (const operation of patch.operations) {
    if (operation.op === "replace_option_groups") {
      if (optionGroupsReplaced || operation.value.length !== intent.optionGroups.length) return false;
      optionGroupsReplaced = true;
      for (let index = 0; index < intent.optionGroups.length; index += 1) {
        const current = intent.optionGroups[index]!;
        const next = operation.value[index]!;
        const answer = optionAnswers.get(current.key);
        if (next.key !== current.key || next.label !== current.label || next.required !== current.required || next.selectionMode !== current.selectionMode || next.values.length !== current.values.length) return false;
        const unchanged = JSON.stringify(next) === JSON.stringify(current);
        if (unchanged) continue;
        if (!answer) {
          return false;
        }
        if (next.values.some((value, valueIndex) => {
          const prior = current.values[valueIndex]!;
          const { isDefault: _nextDefault, ...nextWithoutDefault } = value;
          const { isDefault: _priorDefault, ...priorWithoutDefault } = prior;
          return JSON.stringify(nextWithoutDefault) !== JSON.stringify(priorWithoutDefault);
        })) return false;
        const selected = next.values.filter((value) => value.isDefault);
        if (selected.length !== 1 || !answer.allowedChoices.some((choice) => choice.canonicalValue === selected[0]!.key)) return false;
        touchedPaths.add(answer.canonicalPath);
      }
      continue;
    }
    if (operation.op === "set_pricing") {
      if (!pricingAnswer || intent.pricing.model !== "two_dimensional_matrix" || pricingUpdated) return false;
      pricingUpdated = true;
      if (!(operation.value.model === "two_dimensional_matrix"
        && (operation.value.unit === "per_piece" || operation.value.unit === "per_square_foot")
        && JSON.stringify({ ...operation.value, unit: "unresolved" }) === JSON.stringify(intent.pricing))) return false;
      touchedPaths.add(pricingAnswer.canonicalPath);
      continue;
    }
    if (operation.op === "set_unresolved_fields") {
      if (!pricingAnswer || unresolvedFieldsUpdated) return false;
      unresolvedFieldsUpdated = true;
      const expectedUnresolved = intent.unresolvedFields.filter((field) => field.path !== "pricing.unit" && field.path !== "pricing.matrix.unit");
      if (JSON.stringify(operation.value) !== JSON.stringify(expectedUnresolved)) return false;
      continue;
    }
    if (operation.op === "merge_field_metadata") {
      for (const path of Object.keys(operation.value)) {
        const canonicalPath = path === "pricing.unit" ? "pricing.matrix.unit" : path;
        if (!answers.some((answer) => answer.canonicalPath === canonicalPath)) return false;
        metadataPaths.add(canonicalPath);
      }
      continue;
    }
    return false;
  }
  return touchedPaths.size > 0
    && Array.from(touchedPaths).every((path) => metadataPaths.has(path))
    && (!pricingUpdated || unresolvedFieldsUpdated)
    && (!unresolvedFieldsUpdated || pricingUpdated);
}

function continuationIssueMetadata(error: unknown) {
  if (!(error instanceof z.ZodError)) return { paths: [] as string[], codes: [] as string[], missing: [] as string[], unknown: [] as string[] };
  const paths = error.issues.slice(0, 20).map((issue) => issue.path.join(".") || "patch");
  const codes = Array.from(new Set(error.issues.slice(0, 20).map((issue) => issue.code)));
  const missing = Array.from(new Set(error.issues.filter((issue) => issue.code === "invalid_type" && (issue as { received?: unknown }).received === "undefined").map((issue) => issue.path.join(".") || "patch")));
  const unknown = Array.from(new Set(error.issues.flatMap((issue) => issue.code === "unrecognized_keys" && Array.isArray((issue as { keys?: unknown }).keys)
    ? ((issue as { keys: unknown[] }).keys.filter((key): key is string => typeof key === "string").map((key) => `${issue.path.join(".") || "patch"}.${key}`)) : [])));
  return { paths, codes, missing, unknown };
}

function continuationPatchPaths(patch: ProductDraftIntentPatch | undefined): string[] {
  if (!patch) return [];
  return Array.from(new Set(patch.operations.flatMap((operation) => {
    if (operation.op === "merge_field_metadata") return Object.keys(operation.value);
    if (operation.op === "set_identity") return ["identity"];
    if (operation.op === "set_measurement") return ["measurement"];
    if (operation.op === "set_quantity") return ["quantity"];
    if (operation.op === "set_pricing") return ["pricing"];
    if (operation.op === "set_material") return ["material"];
    if (operation.op === "replace_option_groups") return ["optionGroups"];
    if (operation.op === "set_workflow") return ["workflow"];
    if (operation.op === "set_production") return ["production"];
    if (operation.op === "set_visibility") return ["visibility"];
    if (operation.op === "set_unresolved_fields") return ["unresolvedFields"];
    return ["state"];
  }))).slice(0, 30);
}

async function continuationFailure(input: {
  referenceId: string; organizationId: string; actorUserId: string; proposalId: string;
  stage: string; current?: CanonicalProductIntentSession; activeIssueIds: readonly string[];
  deterministicAttempted: boolean; providerRequested: boolean; provider?: string | null; model?: string | null;
  providerResultType?: string; patch?: ProductDraftIntentPatch; error?: unknown;
  validationSchema?: string | null; repairAttempted?: boolean; repairResult?: "not_attempted" | "succeeded" | "failed";
  parseMethod?: "none" | "raw_json" | "extracted_json" | "repaired_json";
  providerResponseState?: "not_received" | "received" | "empty" | "parse_failed" | "contract_failed" | "accepted";
  resolverStage?: string | null; persistenceAttempted?: boolean; persistenceResult?: "not_attempted" | "succeeded" | "failed";
  code: string; message: string;
}) {
  const issue = continuationIssueMetadata(input.error);
  const current = input.current;
  try {
    await persistAiDiagnostic(sanitizeAiDiagnosticEnvelope({
      version: 1, referenceId: input.referenceId, correlationId: input.referenceId,
      diagnosticType: "product_intent_compiler", tenantId: input.organizationId, actorId: input.actorUserId,
      conversationId: current?.conversationId ?? null, provider: input.provider ?? null, model: input.model ?? null,
      providerRequestId: null, stage: input.stage, errorCode: input.code,
      providerResponseState: input.providerResponseState ?? (input.providerRequested ? "accepted" : "not_received"),
      parseMethod: input.parseMethod ?? "none", repairAttempted: input.repairAttempted ?? false,
      repairResult: input.repairResult ?? "not_attempted", validationSchema: input.validationSchema ?? (input.error instanceof z.ZodError ? "ProductDraftIntentPatch" : null),
      validationIssuePaths: issue.paths, validationIssueCodes: issue.codes, returnedTopLevelKeys: [],
      missingRequiredKeys: issue.missing, unknownKeys: issue.unknown, plannerOperation: null,
      selectedCapability: "canonical_product_intent_compiler", specialistName: "product_intent_compiler",
      optionNormalizationStage: null, resolverStage: input.resolverStage ?? null,
      persistenceAttempted: input.persistenceAttempted ?? false, persistenceResult: input.persistenceResult ?? "not_attempted",
      createdAt: new Date().toISOString(), sessionId: current?.proposalId ?? input.proposalId,
      currentRevision: current?.specification.session.currentRevision ?? null,
      patchOperationCount: input.patch?.operations.length ?? null, patchPaths: continuationPatchPaths(input.patch),
    }));
  } catch { /* Diagnostic persistence is fail-soft and cannot replace the safe continuation error. */ }
  console.warn("[PRODUCT_INTENT_CONTINUATION] Canonical continuation failed.", {
    referenceId: input.referenceId, stage: input.stage, sessionId: current?.proposalId ?? input.proposalId, currentRevision: current?.specification.session.currentRevision ?? null,
    activeIssueIds: input.activeIssueIds, deterministicAttempted: input.deterministicAttempted, providerRequested: input.providerRequested,
    providerResultType: input.providerResultType ?? null, patchSchemaPaths: issue.paths, code: input.code,
  });
  return { ok: false as const, code: input.code, message: input.message };
}

type CanonicalIntentPipelineStage = "tenant_reference_resolution" | "canonical_validation" | "presentation" | "persistence_preparation";

function pipelineFailure(input: {
  stage: CanonicalIntentPipelineStage;
  error: unknown;
  correlationId: string;
  provider: string;
  model: string;
  repairAttempted: boolean;
  revision: number;
}): CanonicalProductIntentOutcome {
  const schemaIssuePaths = input.error instanceof z.ZodError
    ? input.error.issues.slice(0, 20).map((issue) => issue.path.join(".") || "intent")
    : [];
  const code = input.error && typeof input.error === "object" && "code" in input.error && typeof (input.error as { code?: unknown }).code === "string"
    ? (input.error as { code: string }).code
    : input.error instanceof z.ZodError
      ? "PRODUCT_INTENT_SCHEMA_REJECTION"
      : "PRODUCT_INTENT_PIPELINE_FAILURE";
  // Do not log provider output, prompts, credentials, or raw tenant data.
  console.error("[PRODUCT_INTENT_PIPELINE] Initial canonical session failed.", {
    stage: input.stage,
    code,
    correlationId: input.correlationId,
    provider: input.provider,
    model: input.model,
    repairAttempted: input.repairAttempted,
    revision: input.revision,
    schemaIssuePaths,
  });
  return {
    ok: false,
    code: "PRODUCT_INTENT_SESSION_CREATION_FAILED",
    message: `The canonical product intent could not be prepared safely. Nothing was created. Reference: ${input.correlationId}.`,
  };
}

function setDerivedState(raw: ProductDraftIntent, issues: readonly ProductIntentIssue[]): ProductDraftIntent {
  const intent = structuredClone(raw);
  intent.state = issues.length === 0 ? "ready_for_review" : issues.some((issue) => issue.severity === "blocker") ? "needs_resolution" : "needs_answers";
  return productDraftIntentSchema.parse(intent);
}

function replacementPatch(intent: ProductDraftIntent, baseRevision: number) {
  return {
    contractVersion: 1 as const, baseRevision, preserveUnchanged: true as const,
    operations: [
      { op: "set_identity" as const, value: intent.identity }, { op: "set_measurement" as const, value: intent.measurement }, { op: "set_quantity" as const, value: intent.quantity },
      { op: "set_pricing" as const, value: intent.pricing }, { op: "set_material" as const, value: intent.material }, { op: "replace_option_groups" as const, value: intent.optionGroups },
      { op: "set_workflow" as const, value: intent.workflow }, { op: "set_production" as const, value: intent.production }, { op: "set_visibility" as const, value: intent.visibility },
      { op: "set_unresolved_fields" as const, value: intent.unresolvedFields }, { op: "merge_field_metadata" as const, value: intent.fieldMetadata }, { op: "set_state" as const, value: intent.state },
    ],
  };
}

/** The one authoritative orchestration path for canonical sessions. It only
 * accepts structured compiler results and never delegates to legacy parsing. */
export class CanonicalProductIntentService {
  constructor(
    private readonly compiler: ProductIntentCompiler | null,
    private readonly persistence: ProductIntentPersistenceService,
    private readonly candidates: CanonicalProductIntentCandidates,
    private readonly validation: Omit<ProductIntentResolutionContext, "categoryLabels" | "materialLabels" | "productionRouteLabels"> = {},
  ) {}

  private async validate(raw: ProductDraftIntent, setStage?: (stage: Extract<CanonicalIntentPipelineStage, "tenant_reference_resolution" | "canonical_validation">) => void) {
    setStage?.("tenant_reference_resolution");
    const resolved = resolveProductDraftIntentReferences(raw, this.candidates);
    setStage?.("canonical_validation");
    const validation = await resolveAndValidateProductDraftIntent(resolved, {
      ...this.validation,
      categoryLabels: this.candidates.categories.map((item) => item.label),
      materialLabels: this.candidates.materials.map((item) => item.label),
      productionRouteLabels: this.candidates.productionRoutes.map((item) => item.label),
    });
    const intent = setDerivedState(validation.intent, validation.issues);
    return { intent, issues: validation.issues };
  }

  private async presentation(intent: ProductDraftIntent, issues: ProductIntentIssue[], dismissed: readonly string[] = []) {
    const fingerprint = (await import("@shared/productDraftIntent")).productDraftIntentFingerprint(intent);
    return presentProductDraftIntent(intent, issues, {
      candidateResolutions: generateProductIntentCandidateActions(intent, fingerprint, issues, this.candidates),
      optionalRecommendations: generateProductIntentRecommendations(intent, fingerprint, dismissed, {
        materials: this.candidates.materials,
        materialRequired: this.validation.requiresMaterial?.(intent) === true,
      }),
    });
  }

  async inspect(input: { organizationId: string; actorUserId: string; proposalId: string }): Promise<CanonicalProductIntentInspection> {
    const session = await this.persistence.load(input);
    const intent = session.specification.session.revisions.at(-1)!.intent;
    const dismissed = Array.isArray(session.specification.resolutionMetadata.dismissedRecommendationIds)
      ? session.specification.resolutionMetadata.dismissedRecommendationIds.filter((value): value is string => typeof value === "string")
      : [];
    const validation = await this.validate(intent);
    return { session, issues: validation.issues, card: await this.presentation(validation.intent, validation.issues, dismissed) };
  }

  async create(input: { organizationId: string; actorUserId: string; conversationId: string; compilerInput: ProductIntentCompilerInput }): Promise<CanonicalProductIntentOutcome> {
    if (!this.compiler) return { ok: false, code: "PRODUCT_INTENT_PROVIDER_UNAVAILABLE", message: "Product interpretation is unavailable until a compatible AI provider is configured." };
    const compiled = await this.compiler.compile(input.compilerInput);
    if (!compiled.ok) return { ok: false, code: compiled.error.code, message: compiled.error.message };
    if (compiled.result.kind !== "complete_intent") return { ok: false, code: "PRODUCT_INTENT_INITIAL_RESULT_INVALID", message: "The product request needs a complete structured intent before it can be saved." };
    const diagnostics = compiled.diagnostics;
    let stage: CanonicalIntentPipelineStage = "tenant_reference_resolution";
    try {
      const { intent, issues } = await this.validate(compiled.result.intent, (nextStage) => { stage = nextStage; });
      stage = "presentation";
      const card = await this.presentation(intent, issues);
      stage = "persistence_preparation";
      const session = await this.persistence.create({ organizationId: input.organizationId, actorUserId: input.actorUserId, conversationId: input.conversationId, intent, compilerResult: compiled.result, unresolvedQuestions: questionsFrom(intent, issues), resolutionMetadata: { architecture: "canonical_product_intent", dismissedRecommendationIds: [] } });
      return { ok: true, session, issues, card };
    } catch (error) {
      return pipelineFailure({
        stage,
        error,
        correlationId: diagnostics.correlationId,
        provider: diagnostics.provider,
        model: diagnostics.model,
        repairAttempted: diagnostics.attempts > 1,
        revision: compiled.result.intent.revision,
      });
    }
  }

  async continue(input: { organizationId: string; actorUserId: string; proposalId: string; request: string; compilerInput: ProductIntentCompilerInput }): Promise<CanonicalProductIntentOutcome> {
    const referenceId = `pic-${randomUUID()}`;
    let current: CanonicalProductIntentSession | undefined;
    let activeIssueIds: string[] = [];
    let sourcePatch: ProductDraftIntentPatch | undefined;
    let compilerResult: ProductIntentCompilerResult | undefined;
    let provider: string | null = null;
    let model: string | null = null;
    let continuationStage = "active_session_lookup";
    let providerRequested = false;
    let deterministicAttempted = false;
    try {
      current = await this.persistence.load({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId });
      const draft = current.specification.session.revisions.at(-1)?.intent;
      if (!draft) return await continuationFailure({ referenceId, organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, stage: "missing_base_revision", current, activeIssueIds, deterministicAttempted, providerRequested, code: "PRODUCT_INTENT_MISSING_BASE_REVISION", message: `I could not apply that answer to the current product question. Please refresh and try again. Reference: ${referenceId}.` });
      continuationStage = "active_intent_validation";
      const active = await this.validate(draft);
      const activeAnswers = active.issues.flatMap((issue) => {
        const answer = answerContract(draft, issue);
        return answer ? [answer] : [];
      });
      activeIssueIds = active.issues.map((issue) => issue.id ?? issue.code);
      const deterministic = deterministicAnswerPatch(draft, activeAnswers, input.request);
      deterministicAttempted = true;
      if (deterministic) {
        sourcePatch = deterministic.patch;
      } else {
        if (!this.compiler) return await continuationFailure({ referenceId, organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, stage: "provider_unavailable", current, activeIssueIds, deterministicAttempted, providerRequested, code: "PRODUCT_INTENT_PROVIDER_UNAVAILABLE", message: `Product interpretation is unavailable until a compatible AI provider is configured. Reference: ${referenceId}.` });
        providerRequested = true;
        continuationStage = "provider_continuation";
        const compiled = await this.compiler.compile({ ...input.compilerInput, request: input.request, currentIntent: draft, currentRevision: current.specification.session.currentRevision, activeRequiredIssues: activeAnswers, diagnosticReferenceId: referenceId, diagnosticContext: { actorId: input.actorUserId, conversationId: current.conversationId, sessionId: current.proposalId, currentRevision: current.specification.session.currentRevision } });
        provider = compiled.diagnostics?.provider ?? null;
        model = compiled.diagnostics?.model ?? null;
        // Compiler terminal failures have already been persisted using this
        // continuation reference and context. Do not write a duplicate event.
        if (!compiled.ok) return { ok: false, code: compiled.error.code, message: compiled.error.message };
        if (compiled.result.kind !== "intent_patch") return await continuationFailure({ referenceId, organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, stage: "provider_result_validation", current, activeIssueIds, deterministicAttempted, providerRequested, provider, model, providerResultType: compiled.result.kind, code: "PRODUCT_INTENT_REQUIRED_ANSWER_UNMATCHED", message: activeAnswers.length === 1 ? `I could not apply that answer to the current product question. Please choose ${activeAnswers[0]!.allowedChoices.map((choice) => choice.displayLabel).join(" or ")}. Reference: ${referenceId}.` : `I could not apply that answer to the current product question. Please answer the outstanding product question. Reference: ${referenceId}.` });
        if (!providerPatchIsScopedToActiveAnswers(draft, compiled.result.patch, activeAnswers)) return await continuationFailure({ referenceId, organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, stage: "patch_scope_validation", current, activeIssueIds, deterministicAttempted, providerRequested, provider, model, providerResultType: compiled.result.kind, patch: compiled.result.patch, code: "PRODUCT_INTENT_PATCH_OUT_OF_SCOPE", message: `I could not apply that answer to the current product question. Please review the available choices and try again. Reference: ${referenceId}.` });
        sourcePatch = compiled.result.patch;
        compilerResult = compiled.result;
      }
      continuationStage = "patch_application";
      const { applyProductDraftIntentPatch } = await import("@shared/productDraftIntent");
      const patched = applyProductDraftIntentPatch(draft, sourcePatch!, { actorUserId: input.actorUserId });
      continuationStage = "full_intent_validation";
      const { intent, issues } = await this.validate(patched, (stage) => { continuationStage = stage === "tenant_reference_resolution" ? "tenant_reference_resolution" : "resolver_validation"; });
      const resolvedAnswers = activeAnswers.filter((answer) => !issues.some((issue) => issue.id === `${intent.revision}:${answer.canonicalPath}:required`));
      if (resolvedAnswers.length === 0) return await continuationFailure({ referenceId, organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, stage: "resolver_validation", current, activeIssueIds, deterministicAttempted, providerRequested, provider, model, providerResultType: compilerResult?.kind, patch: sourcePatch, resolverStage: "required_answer_resolution", code: "PRODUCT_INTENT_REQUIRED_ANSWER_UNRESOLVED", message: `I could not apply that answer to the current product question. Please review the available choices and try again. Reference: ${referenceId}.` });
      const patch = replacementPatch(intent, current.specification.session.currentRevision);
      continuationStage = "revision_persistence";
      const session = await this.persistence.appendPatch({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: current.specification.session.currentRevision, expectedFingerprint: current.fingerprint, patch, reason: deterministic ? "answer" : "correction", compilerResult, unresolvedQuestions: questionsFrom(intent, issues) });
      return { ok: true, session, issues, card: await this.presentation(intent, issues) };
    } catch (error) {
      const persistenceFailure = continuationStage === "revision_persistence";
      const stale = error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "PRODUCT_INTENT_STALE_REVISION";
      return await continuationFailure({ referenceId, organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, stage: stale ? "stale_revision" : continuationStage, current, activeIssueIds, deterministicAttempted, providerRequested, provider, model, patch: sourcePatch, error, validationSchema: error instanceof z.ZodError ? (continuationStage === "patch_application" ? "ProductDraftIntentPatch" : "ProductDraftIntent") : null, resolverStage: continuationStage === "resolver_validation" ? "canonical_resolver" : null, persistenceAttempted: persistenceFailure, persistenceResult: persistenceFailure ? "failed" : "not_attempted", code: stale ? "PRODUCT_INTENT_STALE_REVISION" : "PRODUCT_INTENT_CONTINUATION_REJECTED", message: `I could not apply that answer to the current product question. Please review the available choices and try again. Reference: ${referenceId}.` });
    }
  }

  async acceptRecommendation(input: { organizationId: string; actorUserId: string; proposalId: string; recommendationId: string }): Promise<CanonicalProductIntentOutcome> {
    const current = await this.persistence.load(input); const intent = current.specification.session.revisions.at(-1)!.intent;
    const dismissed = Array.isArray(current.specification.resolutionMetadata.dismissedRecommendationIds) ? current.specification.resolutionMetadata.dismissedRecommendationIds.filter((value): value is string => typeof value === "string") : [];
    const currentValidation = await this.validate(intent); const card = await this.presentation(intent, currentValidation.issues, dismissed); const recommendation = card.optionalRecommendations.find((item) => item.id === input.recommendationId);
    if (!recommendation) return { ok: false, code: "PRODUCT_INTENT_INTERACTION_STALE", message: "That product suggestion is no longer available; review the latest revision." };
    const { applyProductDraftIntentPatch } = await import("@shared/productDraftIntent");
    const validation = await this.validate(applyProductDraftIntentPatch(intent, parseProductIntentRecommendation(recommendation).patch, { actorUserId: input.actorUserId }));
    const session = await this.persistence.appendPatch({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: intent.revision, expectedFingerprint: current.fingerprint, patch: replacementPatch(validation.intent, intent.revision), reason: "server_resolution", unresolvedQuestions: questionsFrom(validation.intent, validation.issues), resolutionMetadata: { ...current.specification.resolutionMetadata, dismissedRecommendationIds: [] } });
    return { ok: true, session, issues: validation.issues, card: await this.presentation(validation.intent, validation.issues) };
  }

  async dismissRecommendation(input: { organizationId: string; actorUserId: string; proposalId: string; recommendationId: string }): Promise<CanonicalProductIntentOutcome> {
    const current = await this.persistence.load(input); const intent = current.specification.session.revisions.at(-1)!.intent;
    const dismissed = Array.isArray(current.specification.resolutionMetadata.dismissedRecommendationIds) ? current.specification.resolutionMetadata.dismissedRecommendationIds.filter((value): value is string => typeof value === "string") : [];
    const validation = await this.validate(intent); const card = await this.presentation(intent, validation.issues, dismissed);
    if (!card.optionalRecommendations.some((item) => item.id === input.recommendationId)) return { ok: false, code: "PRODUCT_INTENT_INTERACTION_STALE", message: "That product suggestion is no longer available; review the latest revision." };
    const session = await this.persistence.updateResolutionMetadata({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: intent.revision, expectedFingerprint: current.fingerprint, resolutionMetadata: { ...current.specification.resolutionMetadata, dismissedRecommendationIds: [...dismissed, input.recommendationId].sort() } });
    return { ok: true, session, issues: validation.issues, card: await this.presentation(intent, validation.issues, [...dismissed, input.recommendationId]) };
  }

  async applyCandidateAction(input: { organizationId: string; actorUserId: string; proposalId: string; actionId: string; newProductName?: string }): Promise<{ outcome?: CanonicalProductIntentOutcome; navigation?: { href: string; abandon: boolean; cloneProductId?: string } }> {
    const correlationId = `pica-${randomUUID()}`;
    const current = await this.persistence.load(input); const intent = current.specification.session.revisions.at(-1)!.intent;
    const validation = await this.validate(intent); const card = await this.presentation(intent, validation.issues);
    const action = card.candidateResolutions.find((item) => item.id === input.actionId);
    if (!action) {
      console.warn("[PRODUCT_INTENT_CANDIDATE_ACTION] Candidate action rejected.", {
        correlationId, sessionId: current.proposalId, baseRevision: intent.revision, latestRevision: current.specification.session.currentRevision,
        actionId: input.actionId, reason: "stale_or_unknown_action",
      });
      throw new Error("PRODUCT_INTENT_INTERACTION_STALE");
    }
    const parsed = parseProductIntentCandidateAction(action);
    if (parsed.navigationOnly) {
      if (parsed.kind === "open_existing_product") await this.persistence.abandon({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: intent.revision, expectedFingerprint: current.fingerprint });
      return { navigation: { href: parsed.candidate?.href ?? `/products/${parsed.candidate?.id}`, abandon: parsed.kind === "open_existing_product", ...(parsed.kind === "clone_existing_product_to_inactive_draft" && parsed.candidate ? { cloneProductId: parsed.candidate.id } : {}) } };
    }
    const candidatePatch = parsed.input === "new_product_name"
      ? replacementPatch({ ...intent, identity: { ...intent.identity, name: String(input.newProductName ?? "").trim() } }, intent.revision)
      : parsed.patch;
    if (!candidatePatch || (parsed.input === "new_product_name" && !String(input.newProductName ?? "").trim())) throw new Error("PRODUCT_INTENT_ACTION_INPUT_INVALID");
    const { applyProductDraftIntentPatch } = await import("@shared/productDraftIntent");
    const next = await this.validate(applyProductDraftIntentPatch(intent, candidatePatch, { actorUserId: input.actorUserId }));
    const semanticChangeDetected = productDraftIntentFingerprint(intent) !== productDraftIntentFingerprint(next.intent);
    const candidate = parsed.candidate;
    const patchPaths = candidatePatch.operations.map((operation) => operation.op === "set_identity" ? "identity.category" : operation.op).sort();
    if (!semanticChangeDetected) {
      console.warn("[PRODUCT_INTENT_CANDIDATE_ACTION] Candidate action made no semantic change.", {
        correlationId, sessionId: current.proposalId, baseRevision: intent.revision, latestRevision: current.specification.session.currentRevision,
        issueId: parsed.issueId, actionId: parsed.id, candidateType: parsed.kind, candidateId: candidate?.id ?? null,
        candidateLabel: candidate?.label ?? null, patchPaths, patchApplicationResult: "no_change", semanticChangeDetected,
        resolverResult: next.intent.identity.category.state,
      });
      return { outcome: { ok: false, code: "PRODUCT_INTENT_ACTION_NO_CHANGE", message: "That product selection no longer changes the current intent. Refresh and choose an active option." } };
    }
    const session = await this.persistence.appendPatch({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: intent.revision, expectedFingerprint: current.fingerprint, patch: replacementPatch(next.intent, intent.revision), reason: "server_resolution", unresolvedQuestions: questionsFrom(next.intent, next.issues) });
    console.info("[PRODUCT_INTENT_CANDIDATE_ACTION] Candidate action persisted.", {
      correlationId, sessionId: current.proposalId, baseRevision: intent.revision, latestRevision: current.specification.session.currentRevision,
      issueId: parsed.issueId, actionId: parsed.id, candidateType: parsed.kind, candidateId: candidate?.id ?? null,
      candidateLabel: candidate?.label ?? null, patchPaths, patchApplicationResult: "applied", semanticChangeDetected,
      newRevision: session.specification.session.currentRevision, resolverResult: next.intent.identity.category.state, persistenceResult: "persisted",
    });
    return { outcome: { ok: true, session, issues: next.issues, card: await this.presentation(next.intent, next.issues) } };
  }
}
