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
  if (issue.id == null || issue.path !== "pricing.matrix.unit" || issue.code !== "PRICING_UNIT_UNRESOLVED" || intent.pricing.model !== "two_dimensional_matrix" || intent.pricing.unit !== "unresolved") return undefined;
  return {
    issueId: issue.id, canonicalPath: "pricing.matrix.unit", answerType: "choice",
    allowedChoices: [
      { displayLabel: "Per piece", canonicalValue: "per_piece", safeAliases: ["per piece", "piece"] },
      { displayLabel: "Per square foot", canonicalValue: "per_square_foot", safeAliases: ["per square foot", "square foot", "per sqft"] },
    ],
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

function normalizeAnswer(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }

function deterministicAnswerPatch(intent: ProductDraftIntent, answers: readonly UnresolvedQuestionAnswer[], request: string): { issueId: string; patch: ProductDraftIntentPatch } | null {
  const normalizedRequest = normalizeAnswer(request);
  const matches = answers.flatMap((answer) => answer.allowedChoices.filter((choice) => choice.safeAliases.some((alias) => normalizeAnswer(alias) === normalizedRequest)).map((choice) => ({ answer, choice })));
  if (matches.length !== 1) return null;
  const { answer, choice } = matches[0]!;
  if (answer.baseRevision !== intent.revision || answer.canonicalPath !== "pricing.matrix.unit" || (choice.canonicalValue !== "per_piece" && choice.canonicalValue !== "per_square_foot") || intent.pricing.model !== "two_dimensional_matrix" || intent.pricing.unit !== "unresolved") return null;
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

function providerPatchIsScopedToActiveAnswers(intent: ProductDraftIntent, patch: ProductDraftIntentPatch, answers: readonly UnresolvedQuestionAnswer[]): boolean {
  if (answers.length === 0) return true;
  if (answers.length !== 1 || answers[0]!.canonicalPath !== "pricing.matrix.unit" || intent.pricing.model !== "two_dimensional_matrix") return false;
  const expectedUnresolved = intent.unresolvedFields.filter((field) => field.path !== "pricing.unit" && field.path !== "pricing.matrix.unit");
  let pricingUpdated = false;
  return patch.operations.every((operation) => {
    if (operation.op === "set_pricing") {
      pricingUpdated = true;
      return operation.value.model === "two_dimensional_matrix"
        && (operation.value.unit === "per_piece" || operation.value.unit === "per_square_foot")
        && JSON.stringify({ ...operation.value, unit: "unresolved" }) === JSON.stringify(intent.pricing);
    }
    if (operation.op === "set_unresolved_fields") return JSON.stringify(operation.value) === JSON.stringify(expectedUnresolved);
    if (operation.op === "merge_field_metadata") return Object.keys(operation.value).length === 1 && "pricing.unit" in operation.value;
    return false;
  }) && pricingUpdated;
}

function continuationFailure(input: { stage: string; current: CanonicalProductIntentSession; activeIssueIds: readonly string[]; deterministicAttempted: boolean; providerRequested: boolean; providerResultType?: string; patchSchemaPaths?: readonly string[]; code: string; message: string }) {
  console.warn("[PRODUCT_INTENT_CONTINUATION] Canonical continuation failed.", {
    stage: input.stage, sessionId: input.current.proposalId, currentRevision: input.current.specification.session.currentRevision,
    activeIssueIds: input.activeIssueIds, deterministicAttempted: input.deterministicAttempted, providerRequested: input.providerRequested,
    providerResultType: input.providerResultType ?? null, patchSchemaPaths: input.patchSchemaPaths ?? [], code: input.code,
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
      optionalRecommendations: generateProductIntentRecommendations(intent, fingerprint, dismissed),
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
    const current = await this.persistence.load({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId });
    const draft = current.specification.session.revisions.at(-1)!.intent;
    const active = await this.validate(draft);
    const activeAnswers = active.issues.flatMap((issue) => {
      const answer = answerContract(draft, issue);
      return answer ? [answer] : [];
    });
    const activeIssueIds = active.issues.map((issue) => issue.id ?? issue.code);
    const deterministic = deterministicAnswerPatch(draft, activeAnswers, input.request);
    let sourcePatch: ProductDraftIntentPatch;
    let compilerResult: ProductIntentCompilerResult | undefined;
    if (deterministic) {
      sourcePatch = deterministic.patch;
    } else {
      if (!this.compiler) return { ok: false, code: "PRODUCT_INTENT_PROVIDER_UNAVAILABLE", message: "Product interpretation is unavailable until a compatible AI provider is configured." };
      const compiled = await this.compiler.compile({ ...input.compilerInput, request: input.request, currentIntent: draft, currentRevision: current.specification.session.currentRevision, activeRequiredIssues: activeAnswers });
      if (!compiled.ok) return { ok: false, code: compiled.error.code, message: compiled.error.message };
      if (compiled.result.kind !== "intent_patch") return continuationFailure({ stage: "provider_result_validation", current, activeIssueIds, deterministicAttempted: true, providerRequested: true, providerResultType: compiled.result.kind, code: "PRODUCT_INTENT_REQUIRED_ANSWER_UNMATCHED", message: activeAnswers.length === 1 ? `I could not apply that answer to the current product question. Please choose ${activeAnswers[0]!.allowedChoices.map((choice) => choice.displayLabel).join(" or ")}.` : "I could not apply that answer to the current product question. Please answer the outstanding product question." });
      if (!providerPatchIsScopedToActiveAnswers(draft, compiled.result.patch, activeAnswers)) return continuationFailure({ stage: "patch_scope_validation", current, activeIssueIds, deterministicAttempted: true, providerRequested: true, providerResultType: compiled.result.kind, code: "PRODUCT_INTENT_PATCH_OUT_OF_SCOPE", message: "I could not apply that answer to the current product question. Please review the available choices and try again." });
      sourcePatch = compiled.result.patch;
      compilerResult = compiled.result;
    }
    try {
      const { applyProductDraftIntentPatch } = await import("@shared/productDraftIntent");
      const { intent, issues } = await this.validate(applyProductDraftIntentPatch(draft, sourcePatch, { actorUserId: input.actorUserId }));
      if (activeAnswers.some((answer) => issues.some((issue) => issue.id === `${intent.revision}:${answer.canonicalPath}:required`))) return continuationFailure({ stage: "resolver_validation", current, activeIssueIds, deterministicAttempted: true, providerRequested: !deterministic, providerResultType: compilerResult?.kind, code: "PRODUCT_INTENT_REQUIRED_ANSWER_UNRESOLVED", message: "I could not apply that answer to the current product question. Please review the available choices and try again." });
      const patch = replacementPatch(intent, current.specification.session.currentRevision);
      const session = await this.persistence.appendPatch({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: current.specification.session.currentRevision, expectedFingerprint: current.fingerprint, patch, reason: deterministic ? "answer" : "correction", compilerResult, unresolvedQuestions: questionsFrom(intent, issues) });
      return { ok: true, session, issues, card: await this.presentation(intent, issues) };
    } catch (error) {
      const patchSchemaPaths = error instanceof z.ZodError ? error.issues.map((issue) => issue.path.join(".") || "patch") : [];
      return continuationFailure({ stage: "patch_application", current, activeIssueIds, deterministicAttempted: true, providerRequested: !deterministic, providerResultType: compilerResult?.kind, patchSchemaPaths, code: "PRODUCT_INTENT_CONTINUATION_REJECTED", message: "I could not apply that answer to the current product question. Please review the available choices and try again." });
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
