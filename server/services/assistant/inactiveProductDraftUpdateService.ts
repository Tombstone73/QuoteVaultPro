import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createDbProductIntakeDraftReviewService,
  type ProductIntakeDraftReview,
  type ProductIntakeDraftReviewService,
} from "../productIntakeWizard/productIntakeDraftReviewService";
import {
  productDraftRelationshipPatchSchema,
  type DraftRelationshipSnapshot,
  type ProductDraftRelationshipPatch,
} from "../productIntakeWizard/productIntakeDraftRelationships";

/** The assistant accepts only narrow, transactional Product Intake draft
 * patches. Pricing, configuration, and relationship operations are kept in
 * separate confirmation plans so their compatibility checks remain explicit. */
export const inactiveProductDraftConfigurationPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().min(1).max(100).nullable().optional(),
  description: z.string().trim().min(1).max(20_000).optional(),
  isTaxable: z.boolean().optional(),
  measurementMode: z.enum(["dimensions_required", "quantity_only"]).optional(),
  workflowIntent: z.enum(["standard_production", "fulfillment_only", "service_fee"]).optional(),
  primaryMaterialId: z.string().trim().min(1).max(128).nullable().optional(),
  useNestingCalculator: z.boolean().optional(),
  sheetWidth: z.number().positive().max(10_000).nullable().optional(),
  sheetHeight: z.number().positive().max(10_000).nullable().optional(),
  materialType: z.enum(["sheet", "roll"]).optional(),
  allowRotation: z.boolean().optional(),
  requiresDimensions: z.boolean().optional(),
  fixedDimensions: z.object({ widthIn: z.number().positive().max(10_000), heightIn: z.number().positive().max(10_000), label: z.string().trim().min(1).max(120).optional() }).strict().nullable().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "At least one draft configuration field is required.");

export const inactiveProductDraftPatchSchema = z.object({
  basePricing: z.object({
    perSqftCents: z.number().int().min(0).nullable().optional(),
    perPieceCents: z.number().int().min(0).nullable().optional(),
    minimumChargeCents: z.number().int().min(0).nullable().optional(),
  }).strict().optional(),
  configuration: inactiveProductDraftConfigurationPatchSchema.optional(),
  relationships: productDraftRelationshipPatchSchema.optional(),
}).strict().refine((patch) => Boolean((patch.basePricing && Object.keys(patch.basePricing).length) || patch.configuration || patch.relationships), "At least one supported draft field is required.").refine((patch) => [patch.basePricing, patch.configuration, patch.relationships].filter(Boolean).length === 1, "Pricing, configuration, and relationship updates require separate confirmation plans.");
export type InactiveProductDraftPatch = z.infer<typeof inactiveProductDraftPatchSchema>;

export type InactiveProductDraftSnapshot = {
  sessionId: string;
  productId: string;
  productName: string;
  editorLink: string;
  productIsActive: false;
  pbv2Status: "DRAFT";
  pbv2TreeVersionId: string;
  pbv2UpdatedAt: string;
  pricingBase: { perSqftCents: number | null; perPieceCents: number | null; minimumChargeCents: number | null };
  configuration: z.infer<typeof inactiveProductDraftConfigurationPatchSchema>;
  relationships: DraftRelationshipSnapshot;
  readiness: { status: string; findings: string[]; warnings: string[] };
  fingerprint: string;
};

export type InactiveProductDraftMatch = {
  sessionId: string;
  productId: string;
  productName: string;
  category: string | null;
  pbv2TreeVersionId: string;
};

export class InactiveProductDraftUpdateError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function relationshipPatchWouldChange(before: DraftRelationshipSnapshot, patch: ProductDraftRelationshipPatch): boolean {
  if (patch.routing) {
    if (patch.routing.operation === "clear" && before.routing) return true;
    if (patch.routing.operation === "set_primary") {
      const reference = patch.routing.station!;
      if (reference.id !== before.routing?.stationId && reference.key !== before.routing?.stationKey && reference.name !== before.routing?.stationName) return true;
    }
  }
  if (patch.options) {
    const templates = patch.options.templates ?? [];
    if (patch.options.operation === "clear" && before.optionTemplates.length) return true;
    if (patch.options.operation === "replace" && (templates.length || before.optionTemplates.length)) return true;
    if ((patch.options.operation === "add" || patch.options.operation === "remove") && templates.length) return true;
  }
  if (patch.setupNote) {
    if (patch.setupNote.operation === "clear" && before.setupNote) return true;
    if (patch.setupNote.operation === "replace" && before.setupNote !== patch.setupNote.text) return true;
    if (patch.setupNote.operation === "append" && !before.setupNote?.includes(patch.setupNote.text!)) return true;
  }
  if (patch.reviewWarnings) {
    const requested = patch.reviewWarnings.warnings ?? [];
    if (patch.reviewWarnings.operation === "clear" && before.reviewWarnings.length) return true;
    if (patch.reviewWarnings.operation === "replace" && stable(before.reviewWarnings) !== stable(requested)) return true;
    if ((patch.reviewWarnings.operation === "add" || patch.reviewWarnings.operation === "remove") && requested.length) return true;
  }
  return false;
}

function snapshotFromReview(review: ProductIntakeDraftReview): InactiveProductDraftSnapshot {
  if (review.intake.status !== "draft_created" || review.product.isActive || review.pbv2Tree.status !== "DRAFT" || review.product.pbv2ActiveTreeVersionId) {
    throw new InactiveProductDraftUpdateError("INACTIVE_DRAFT_REQUIRED", "Only an inactive Product Intake draft with a PBV2 DRAFT tree can be edited.");
  }
  const warnings = review.publishReadiness.findings.filter((finding) => finding.severity !== "ERROR").map((finding) => finding.message).slice(0, 50);
  const findings = review.publishReadiness.findings.filter((finding) => finding.severity === "ERROR").map((finding) => finding.message).slice(0, 50);
  const input = {
    sessionId: review.intake.sessionId, productId: review.product.id, pbv2TreeVersionId: review.pbv2Tree.id,
    pbv2UpdatedAt: review.pbv2Tree.updatedAt, productIsActive: review.product.isActive,
    pbv2Status: review.pbv2Tree.status, activeTree: review.product.pbv2ActiveTreeVersionId,
    pricingBase: review.pbv2Tree.basePricing, configuration: {
      name: review.product.name, category: review.product.category, description: review.product.description,
      isTaxable: review.product.isTaxable, measurementMode: review.product.measurementMode,
      workflowIntent: review.product.workflowIntent, primaryMaterialId: review.product.primaryMaterialId,
      useNestingCalculator: review.product.useNestingCalculator, sheetWidth: review.product.sheetWidth === null ? null : Number(review.product.sheetWidth),
      sheetHeight: review.product.sheetHeight === null ? null : Number(review.product.sheetHeight), materialType: review.product.materialType ?? "sheet",
      allowRotation: review.product.pricingProfileConfig?.allowRotation === true,
      requiresDimensions: review.pbv2Tree.requiresDimensions, fixedDimensions: review.pbv2Tree.fixedDimensions,
    }, relationships: review.pbv2Tree.relationships, readiness: review.publishReadiness.validationStatus,
  };
  return {
    sessionId: review.intake.sessionId, productId: review.product.id, productName: review.product.name,
    editorLink: `/admin/product-intake/sessions/${encodeURIComponent(review.intake.sessionId)}/review`,
    productIsActive: false, pbv2Status: "DRAFT", pbv2TreeVersionId: review.pbv2Tree.id,
    pbv2UpdatedAt: review.pbv2Tree.updatedAt, pricingBase: review.pbv2Tree.basePricing,
    configuration: input.configuration,
    relationships: input.relationships,
    readiness: { status: review.publishReadiness.validationStatus, findings, warnings },
    fingerprint: createHash("sha256").update(stable(input)).digest("hex"),
  };
}

export class InactiveProductDraftUpdateService {
  constructor(private readonly review: ProductIntakeDraftReviewService = createDbProductIntakeDraftReviewService()) {}

  async loadSnapshot(input: { organizationId: string; sessionId: string }): Promise<InactiveProductDraftSnapshot> {
    return snapshotFromReview(await this.review.getDraftReview(input));
  }

  async findInactiveDraftMatches(input: { organizationId: string; productId?: string; productName?: string; category?: string }): Promise<InactiveProductDraftMatch[]> {
    return this.review.findInactiveDraftMatches(input);
  }

  async buildProposal(input: { organizationId: string; sessionId: string; patch: InactiveProductDraftPatch }): Promise<{ before: InactiveProductDraftSnapshot; after: InactiveProductDraftPatch; fingerprint: string }> {
    const before = await this.loadSnapshot(input);
    const patch = inactiveProductDraftPatchSchema.parse(input.patch);
    const pricingChanged = (Object.keys(patch.basePricing ?? {}) as Array<keyof NonNullable<InactiveProductDraftPatch["basePricing"]>>)
      .some((key) => before.pricingBase[key] !== patch.basePricing?.[key]);
    const configurationChanged = (Object.keys(patch.configuration ?? {}) as Array<keyof InactiveProductDraftSnapshot["configuration"]>)
      .some((key) => stable(before.configuration[key]) !== stable(patch.configuration?.[key]));
    const relationshipChanged = patch.relationships ? relationshipPatchWouldChange(before.relationships, patch.relationships) : false;
    const changed = pricingChanged || configurationChanged || relationshipChanged;
    if (!changed) {
      throw new InactiveProductDraftUpdateError("INACTIVE_DRAFT_NO_CHANGES", "The requested inactive-draft update already matches the current values.");
    }
    return { before, after: patch, fingerprint: createHash("sha256").update(stable({ draft: before.fingerprint, patch })).digest("hex") };
  }

  async revalidateProposal(input: { organizationId: string; sessionId: string; patch: InactiveProductDraftPatch; expectedFingerprint: string }) {
    const proposal = await this.buildProposal(input);
    if (proposal.fingerprint !== input.expectedFingerprint) return { valid: false as const, code: "INACTIVE_DRAFT_STALE", summary: "The draft changed; review the current before-and-after preview." };
    return { valid: true as const, proposal };
  }

  async updateInactiveProductDraft(input: {
    organizationId: string;
    sessionId: string;
    patch: InactiveProductDraftPatch;
    expectedFingerprint: string;
    userId: string;
    userName?: string | null;
    assistantAudit?: { command: "products.update_inactive_draft@v1"; planId: string; idempotencyKey: string; correlationId: string };
  }) {
    const validation = await this.revalidateProposal(input);
    if (!validation.valid) throw new InactiveProductDraftUpdateError(validation.code, validation.summary);
    const review = validation.proposal.after.relationships
      ? await this.review.updateDraftRelationships({
        organizationId: input.organizationId, sessionId: input.sessionId, patch: validation.proposal.after.relationships as ProductDraftRelationshipPatch,
        userId: input.userId, expectedDraftUpdatedAt: validation.proposal.before.pbv2UpdatedAt,
        ...(input.assistantAudit ? { assistantAudit: input.assistantAudit } : {}),
      })
      : validation.proposal.after.configuration
      ? await this.review.updateDraftConfiguration({
        organizationId: input.organizationId, sessionId: input.sessionId, patch: validation.proposal.after.configuration,
        userId: input.userId, expectedDraftUpdatedAt: validation.proposal.before.pbv2UpdatedAt,
        ...(input.assistantAudit ? { assistantAudit: input.assistantAudit } : {}),
      })
      : await this.review.updateDraftPricing({
        organizationId: input.organizationId, sessionId: input.sessionId, base: validation.proposal.after.basePricing!,
        userId: input.userId, ...(input.userName ? { userName: input.userName } : {}),
        expectedDraftUpdatedAt: validation.proposal.before.pbv2UpdatedAt,
        ...(input.assistantAudit ? { assistantAudit: input.assistantAudit } : {}),
      });
    return snapshotFromReview(review);
  }
}

export const inactiveProductDraftUpdateService = new InactiveProductDraftUpdateService();
