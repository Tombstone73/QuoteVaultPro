import {
  productDraftIntentSchema,
  type ProductDraftIntent,
  type ProductIntentCompilerResult,
} from "@shared/productDraftIntent";
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

export type CanonicalProductIntentCandidates = {
  categories: readonly TenantIntentReference[];
  materials: readonly TenantIntentReference[];
  productionRoutes: readonly TenantIntentReference[];
};

export type CanonicalProductIntentOutcome =
  | { ok: true; session: CanonicalProductIntentSession; card: CanonicalProductIntentProposalDto; issues: ProductIntentIssue[] }
  | { ok: false; code: string; message: string };

function questionsFrom(issues: readonly ProductIntentIssue[]) {
  return {
    questions: issues.filter((issue) => issue.severity === "question").map((issue) => ({ id: issue.code, path: issue.path, question: issue.message, required: true })),
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

  private async validate(raw: ProductDraftIntent) {
    const resolved = resolveProductDraftIntentReferences(raw, this.candidates);
    const validation = await resolveAndValidateProductDraftIntent(resolved, {
      ...this.validation,
      categoryLabels: this.candidates.categories.map((item) => item.label),
      materialLabels: this.candidates.materials.map((item) => item.label),
      productionRouteLabels: this.candidates.productionRoutes.map((item) => item.label),
    });
    const intent = setDerivedState(validation.intent, validation.issues);
    return { intent, issues: validation.issues };
  }

  async create(input: { organizationId: string; actorUserId: string; conversationId: string; compilerInput: ProductIntentCompilerInput }): Promise<CanonicalProductIntentOutcome> {
    const compiled = await this.compiler.compile(input.compilerInput);
    if (!compiled.ok) return { ok: false, code: compiled.error.code, message: compiled.error.message };
    if (compiled.result.kind !== "complete_intent") return { ok: false, code: "PRODUCT_INTENT_INITIAL_RESULT_INVALID", message: "The product request needs a complete structured intent before it can be saved." };
    const { intent, issues } = await this.validate(compiled.result.intent);
    const session = await this.persistence.create({ organizationId: input.organizationId, actorUserId: input.actorUserId, conversationId: input.conversationId, intent, compilerResult: compiled.result, unresolvedQuestions: questionsFrom(issues), resolutionMetadata: { architecture: "canonical_product_intent" } });
    return { ok: true, session, issues, card: presentProductDraftIntent(intent, issues) };
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
    return { ok: true, session, issues, card: presentProductDraftIntent(intent, issues) };
  }
}
