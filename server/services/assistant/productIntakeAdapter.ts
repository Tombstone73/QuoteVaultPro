import { createHash } from "node:crypto";
import {
  createDbProductIntakeAiDiagnosticsStore,
  type ProductIntakeAiDiagnosticsStore,
} from "../productIntakeWizard/productIntakeDiagnosticsService";
import {
  createDbProductIntakeDraftCreator,
  buildProductIntakeDraftTree,
  type ProductIntakeDraftCreationResult,
  type ProductIntakeDraftCreator,
} from "../productIntakeWizard/productIntakeDraftService";
import {
  createDbProductIntakeDraftReviewService,
  type ProductIntakeDraftReviewService,
} from "../productIntakeWizard/productIntakeDraftReviewService";
import {
  createDbProductIntakeSessionStore,
  ProductIntakeSessionError,
  type ProductIntakeSessionStore,
} from "../productIntakeWizard/productIntakeSessionService";
import { productIntakeBriefSchema } from "@shared/productIntakeWizardSchemas";

/** Reduced, provider-safe diagnostic information. Raw AI responses stay in the Product Intake diagnostics store. */
export type AssistantProductIntakeDiagnosticsSummary = {
  count: number;
  failedSchemaPaths: string[];
  latestCreatedAt: string | null;
};

export type AssistantProductIntakeSessionSnapshot = {
  sessionId: string;
  status: string;
  readiness: {
    canCreateDraft: boolean;
    unansweredRequiredCount: number;
    reviewState?: "ready_for_draft" | "needs_review" | "not_ready";
    penalties: Array<{ code: string; label: string; severity: "review" | "blocker" }>;
  };
  createdProductId: string | null;
  createdPbv2TreeVersionId: string | null;
  diagnostics: AssistantProductIntakeDiagnosticsSummary;
};

export type AssistantProductIntakeDraftResult = {
  productId: string;
  pbv2TreeVersionId: string;
  productName: string;
  productIsActive: false;
  pbv2Status: "DRAFT";
  reused: boolean;
};

export type AssistantProductIntakeProposal = {
  sessionId: string;
  productName: string;
  sourceType: string;
  sourceLink: { label: string; href: string };
  preview: {
    title: string;
    summary: string;
    sideEffects: string[];
    warnings: string[];
    proposedFields: AssistantProductIntakeProposedFields;
  };
  fingerprint: string;
  executable: boolean;
};

export type AssistantProductIntakeProposedFields = {
  category: string | null;
  measurementMode: string;
  requiresDimensions: boolean;
  fixedDimensions: string | null;
  pricingModel: string;
  perSqftCents: number | null;
  perPieceCents: number | null;
  minimumChargeCents: number | null;
  quantityTiers: Array<{ label: string; minQty: number; perPieceCents: number }>;
  material: string | null;
  productionRoute: string | null;
  sheetOrRollConstraints: string | null;
  allowRotation: boolean | null;
  quantityBehavior: string;
  taxable: true;
  commonOptions: string[];
  status: "inactive_draft";
};

/** Optional durable bridge supplied by execution-plan integration. It is not a fallback cache. */
export interface AssistantProductIntakePlanResultStore {
  get(input: { organizationId: string; planId: string }): Promise<AssistantProductIntakeDraftResult | null>;
  put(input: { organizationId: string; planId: string; result: AssistantProductIntakeDraftResult }): Promise<void>;
}

export interface AssistantProductIntakeAdapterDependencies {
  sessionStore: ProductIntakeSessionStore;
  diagnosticsStore: ProductIntakeAiDiagnosticsStore;
  draftCreator: ProductIntakeDraftCreator;
  draftReviewService: ProductIntakeDraftReviewService;
  planResultStore?: AssistantProductIntakePlanResultStore;
}

/**
 * Assistant-facing façade over the Product Intake domain. It cannot analyze a
 * source, edit answers/pricing/PBV2/routing/materials, publish, activate, or
 * expose raw diagnostics. Draft creation is delegated unmodified to the
 * canonical transactional creator.
 */
export class AssistantProductIntakeAdapter {
  constructor(private readonly deps: AssistantProductIntakeAdapterDependencies = {
    sessionStore: createDbProductIntakeSessionStore(),
    diagnosticsStore: createDbProductIntakeAiDiagnosticsStore(),
    draftCreator: createDbProductIntakeDraftCreator(),
    draftReviewService: createDbProductIntakeDraftReviewService(),
  }) {}

  async loadSession(args: { organizationId: string; sessionId: string }): Promise<AssistantProductIntakeSessionSnapshot> {
    const detail = await this.deps.sessionStore.getSessionDetail(args.organizationId, args.sessionId);
    if (!detail) throw new ProductIntakeSessionError(404, "Product Intake session not found.", "SESSION_NOT_FOUND");
    const diagnostics = await this.deps.diagnosticsStore.listRecent(args.organizationId, { sessionId: args.sessionId });
    return {
      sessionId: detail.session.id,
      status: detail.session.status,
      readiness: {
        canCreateDraft: detail.readiness.canCreateDraft,
        unansweredRequiredCount: detail.readiness.unansweredRequiredCount,
        ...(detail.readiness.reviewState ? { reviewState: detail.readiness.reviewState } : {}),
        penalties: (detail.readiness.penalties ?? []).map((penalty) => ({
          code: penalty.code,
          label: penalty.label,
          severity: penalty.severity,
        })),
      },
      createdProductId: detail.session.createdProductId,
      createdPbv2TreeVersionId: detail.session.createdPbv2TreeVersionId,
      diagnostics: {
        count: diagnostics.length,
        failedSchemaPaths: Array.from(new Set(diagnostics.flatMap((item) => item.failedSchemaPaths))).slice(0, 30),
        latestCreatedAt: diagnostics[0]?.createdAt ?? null,
      },
    };
  }

  /**
 * Builds a server-authoritative confirmation preview. It never returns raw
 * source text/JSON or diagnostics; it only exposes the bounded fields staff
 * need to review before creating an inactive draft.
   */
  async buildProposal(args: { organizationId: string; sessionId: string }): Promise<AssistantProductIntakeProposal> {
    const detail = await this.deps.sessionStore.getSessionDetail(args.organizationId, args.sessionId);
    if (!detail) throw new ProductIntakeSessionError(404, "Product Intake session not found.", "SESSION_NOT_FOUND");
    const snapshot = await this.loadSession(args);
    const productName = String(detail.brief.productIdentity.likelyProductName.value ?? "Product Intake Draft").trim() || "Product Intake Draft";
    const penalties = snapshot.readiness.penalties.map((penalty) => penalty.label);
    const source = await this.deps.sessionStore.getSessionSource?.(args.organizationId, args.sessionId) ?? null;
    const sourceText = source?.sourceText ?? "";
    const parsedBrief = productIntakeBriefSchema.safeParse(detail.brief);
    const previewTree = parsedBrief.success
      ? buildProductIntakeDraftTree({
        brief: parsedBrief.data,
        sessionId: detail.session.id,
        productName,
        userId: null,
        sourceText,
        sourceJson: source?.sourceJson ?? undefined,
        answers: (detail.answers ?? []).map((answer) => ({ questionKey: answer.questionKey, answer: answer.answer })),
      })
      : null;
    const intake = previewTree?.meta?.productIntake as Record<string, any> | undefined;
    const base = previewTree?.meta?.pricingV2?.base as Record<string, unknown> | undefined;
    const quantityTiers = Array.isArray(previewTree?.meta?.pricingV2?.qtyTiers)
      ? previewTree!.meta!.pricingV2!.qtyTiers!.flatMap((tier) =>
        typeof tier?.minQty === "number" && typeof tier?.perPieceCents === "number"
          ? [{ label: typeof tier.label === "string" ? tier.label : `${tier.minQty}+`, minQty: tier.minQty, perPieceCents: tier.perPieceCents }]
          : [],
      )
      : [];
    const fixed = intake?.fixedDimensions as { label?: unknown } | undefined;
    const material = intake?.materialMatch as { name?: unknown } | null | undefined;
    const route = /\bflatbed\b/i.test(sourceText) ? "Flatbed" : /\broll\b/i.test(sourceText) ? "Roll printer" : /\brouter\b/i.test(sourceText) ? "Router" : null;
    const constraint = sourceText.match(/\b\d{1,3}(?:\.\d+)?\s*[x×]\s*\d{1,3}(?:\.\d+)?\s*(?:sheets?|sheet|rolls?|roll)\b/i)?.[0] ?? null;
    const rotation = /\b(?:allow|allows|allowed)\s+rotation\b|\brotation\s+(?:allowed|enabled)\b/i.test(sourceText)
      ? true
      : /\b(?:do not allow|no)\s+rotation\b|\brotation\s+(?:not allowed|disabled)\b/i.test(sourceText)
        ? false
        : null;
    const proposedFields: AssistantProductIntakeProposedFields = {
      category: detail.brief.productIdentity.category?.value ?? null,
      measurementMode: String(intake?.sizeMode ?? detail.brief.sizeBehavior?.behavior ?? "review_required"),
      requiresDimensions: previewTree?.meta?.requiresDimensions === true,
      fixedDimensions: typeof fixed?.label === "string" ? fixed.label : null,
      pricingModel: detail.brief.pricingAnalysis?.behavior ?? "review_required",
      perSqftCents: typeof base?.perSqftCents === "number" ? base.perSqftCents : null,
      perPieceCents: typeof base?.perPieceCents === "number" ? base.perPieceCents : null,
      minimumChargeCents: typeof base?.minimumChargeCents === "number" ? base.minimumChargeCents : null,
      quantityTiers,
      material: typeof material?.name === "string" ? material.name : null,
      productionRoute: route,
      sheetOrRollConstraints: constraint,
      allowRotation: rotation,
      quantityBehavior: detail.brief.quantityBehavior?.behavior ?? "review_required",
      taxable: true,
      commonOptions: [...(detail.brief.requiredOptions ?? []), ...(detail.brief.optionalOptions ?? [])].map((option) => option.label).filter(Boolean).slice(0, 12),
      status: "inactive_draft",
    };
    const fingerprint = createHash("sha256").update(JSON.stringify({
      organizationId: args.organizationId,
      sessionId: detail.session.id,
      status: detail.session.status,
      updatedAt: detail.session.updatedAt,
      sourceFingerprint: detail.session.sourceFingerprint,
      createdProductId: detail.session.createdProductId,
      createdPbv2TreeVersionId: detail.session.createdPbv2TreeVersionId,
      readiness: snapshot.readiness,
    })).digest("hex");
    return {
      sessionId: detail.session.id,
      productName,
      sourceType: detail.session.sourceType,
      sourceLink: { label: "Open Product Intake review", href: `/admin/product-intake/sessions/${encodeURIComponent(detail.session.id)}/review` },
      preview: {
        title: `Create inactive draft: ${productName}`,
        summary: "Creates one inactive product with a PBV2 DRAFT. Publishing, pricing changes, material/routing changes, and activation remain separate reviewed workflows.",
        sideEffects: ["Creates one inactive product draft.", "Creates one PBV2 DRAFT version linked to this intake session."],
        warnings: penalties,
        proposedFields,
      },
      fingerprint,
      executable: snapshot.status === "ready_for_draft" && snapshot.readiness.canCreateDraft,
    };
  }

  async revalidateProposal(args: { organizationId: string; sessionId: string; expectedFingerprint: string }): Promise<{ valid: true; proposal: AssistantProductIntakeProposal } | { valid: false; code: string; summary: string }> {
    const proposal = await this.buildProposal({ organizationId: args.organizationId, sessionId: args.sessionId });
    if (proposal.fingerprint !== args.expectedFingerprint) {
      return { valid: false, code: "PRODUCT_INTAKE_SESSION_CHANGED", summary: "The Product Intake session changed; review the updated proposal." };
    }
    if (!proposal.executable) {
      return { valid: false, code: "PRODUCT_INTAKE_NOT_READY", summary: "The Product Intake session is no longer ready to create a draft." };
    }
    return { valid: true, proposal };
  }

  async createInactiveDraft(args: {
    organizationId: string;
    userId: string | null;
    userName?: string | null;
    sessionId: string;
    planId: string;
    idempotencyKey?: string;
    correlationId?: string;
  }): Promise<AssistantProductIntakeDraftResult> {
    const existing = await this.deps.planResultStore?.get({ organizationId: args.organizationId, planId: args.planId });
    if (existing) return { ...existing, reused: true };

    const proposal = await this.buildProposal({ organizationId: args.organizationId, sessionId: args.sessionId });
    if (!proposal.executable) {
      throw new ProductIntakeSessionError(409, "This Product Intake session is not ready to create an inactive draft.", "INTAKE_NOT_READY");
    }

    const created = await this.deps.draftCreator.createDraftFromSession({
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      userId: args.userId,
      ...(args.userName ? { userName: args.userName } : {}),
      ...(args.idempotencyKey && args.correlationId ? {
        assistantAudit: {
          command: "products.create_inactive_draft@v1" as const,
          planId: args.planId,
          idempotencyKey: args.idempotencyKey,
          correlationId: args.correlationId,
          confirmationConsumed: true as const,
        },
      } : {}),
    });
    const result = await this.assertInactiveDraft(args.organizationId, args.sessionId, created, false);
    await this.deps.planResultStore?.put({ organizationId: args.organizationId, planId: args.planId, result });
    return result;
  }

  private async assertInactiveDraft(
    organizationId: string,
    sessionId: string,
    created: ProductIntakeDraftCreationResult,
    reused: boolean,
  ): Promise<AssistantProductIntakeDraftResult> {
    const review = await this.deps.draftReviewService.getDraftReview({ organizationId, sessionId });
    if (review.product.id !== created.productId || review.pbv2Tree.id !== created.pbv2TreeVersionId) {
      throw new ProductIntakeSessionError(409, "Product Intake draft references changed during creation.", "INTAKE_DRAFT_REFERENCE_CHANGED");
    }
    if (review.product.isActive || review.pbv2Tree.status !== "DRAFT" || review.publishReadiness.activeTreeAssigned) {
      throw new ProductIntakeSessionError(409, "The created Product Intake draft is not safely inactive.", "INTAKE_DRAFT_NOT_INACTIVE");
    }
    return {
      productId: created.productId,
      pbv2TreeVersionId: created.pbv2TreeVersionId,
      productName: review.product.name,
      productIsActive: false,
      pbv2Status: "DRAFT",
      reused,
    };
  }
}

export const assistantProductIntakeAdapter = new AssistantProductIntakeAdapter();
