import {
  productDraftIntentSchema,
  type ProductDraftIntent,
  type ProductIntentCompilerResult,
} from "@shared/productDraftIntent";
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

function questionsFrom(issues: readonly ProductIntentIssue[]) {
  return {
    questions: issues.filter((issue) => issue.severity === "question").map((issue) => ({ id: issue.id ?? issue.code, path: issue.path, question: issue.message, required: true })),
  };
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
    private readonly compiler: ProductIntentCompiler,
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

  async create(input: { organizationId: string; actorUserId: string; conversationId: string; compilerInput: ProductIntentCompilerInput }): Promise<CanonicalProductIntentOutcome> {
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
      const session = await this.persistence.create({ organizationId: input.organizationId, actorUserId: input.actorUserId, conversationId: input.conversationId, intent, compilerResult: compiled.result, unresolvedQuestions: questionsFrom(issues), resolutionMetadata: { architecture: "canonical_product_intent", dismissedRecommendationIds: [] } });
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
    const compiled = await this.compiler.compile({ ...input.compilerInput, request: input.request, currentIntent: current.specification.session.revisions.at(-1)!.intent, currentRevision: current.specification.session.currentRevision });
    if (!compiled.ok) return { ok: false, code: compiled.error.code, message: compiled.error.message };
    if (compiled.result.kind !== "intent_patch") return { ok: false, code: "PRODUCT_INTENT_PATCH_REQUIRED", message: "The continuation must produce a typed patch against the current product intent." };
    const draft = current.specification.session.revisions.at(-1)!.intent;
    // Validate the complete post-patch result before it becomes a persisted revision.
    const { applyProductDraftIntentPatch } = await import("@shared/productDraftIntent");
    const { intent, issues } = await this.validate(applyProductDraftIntentPatch(draft, compiled.result.patch, { actorUserId: input.actorUserId }));
    const patch = replacementPatch(intent, current.specification.session.currentRevision);
    const session = await this.persistence.appendPatch({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: current.specification.session.currentRevision, expectedFingerprint: current.fingerprint, patch, reason: "correction", compilerResult: compiled.result, unresolvedQuestions: questionsFrom(issues) });
    return { ok: true, session, issues, card: await this.presentation(intent, issues) };
  }

  async acceptRecommendation(input: { organizationId: string; actorUserId: string; proposalId: string; recommendationId: string }): Promise<CanonicalProductIntentOutcome> {
    const current = await this.persistence.load(input); const intent = current.specification.session.revisions.at(-1)!.intent;
    const dismissed = Array.isArray(current.specification.resolutionMetadata.dismissedRecommendationIds) ? current.specification.resolutionMetadata.dismissedRecommendationIds.filter((value): value is string => typeof value === "string") : [];
    const currentValidation = await this.validate(intent); const card = await this.presentation(intent, currentValidation.issues, dismissed); const recommendation = card.optionalRecommendations.find((item) => item.id === input.recommendationId);
    if (!recommendation) return { ok: false, code: "PRODUCT_INTENT_INTERACTION_STALE", message: "That product suggestion is no longer available; review the latest revision." };
    const { applyProductDraftIntentPatch } = await import("@shared/productDraftIntent");
    const validation = await this.validate(applyProductDraftIntentPatch(intent, parseProductIntentRecommendation(recommendation).patch, { actorUserId: input.actorUserId }));
    const session = await this.persistence.appendPatch({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: intent.revision, expectedFingerprint: current.fingerprint, patch: replacementPatch(validation.intent, intent.revision), reason: "server_resolution", unresolvedQuestions: questionsFrom(validation.issues), resolutionMetadata: { ...current.specification.resolutionMetadata, dismissedRecommendationIds: [] } });
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
    const current = await this.persistence.load(input); const intent = current.specification.session.revisions.at(-1)!.intent;
    const validation = await this.validate(intent); const card = await this.presentation(intent, validation.issues);
    const action = card.candidateResolutions.find((item) => item.id === input.actionId);
    if (!action) throw new Error("PRODUCT_INTENT_INTERACTION_STALE");
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
    const session = await this.persistence.appendPatch({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: intent.revision, expectedFingerprint: current.fingerprint, patch: replacementPatch(next.intent, intent.revision), reason: "server_resolution", unresolvedQuestions: questionsFrom(next.issues) });
    return { outcome: { ok: true, session, issues: next.issues, card: await this.presentation(next.intent, next.issues) } };
  }
}
