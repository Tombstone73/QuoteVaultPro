import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createDbProductIntakeDraftReviewService,
  type ProductIntakeDraftReview,
  type ProductIntakeDraftReviewService,
} from "../productIntakeWizard/productIntakeDraftReviewService";

/** Stage 6 deliberately exposes only the existing canonical, transactional
 * pricing draft editor. Options, materials, and routing have no equivalent
 * narrow canonical patch service yet and are therefore never accepted here. */
export const inactiveProductDraftPatchSchema = z.object({
  basePricing: z.object({
    perSqftCents: z.number().int().min(0).nullable().optional(),
    perPieceCents: z.number().int().min(0).nullable().optional(),
    minimumChargeCents: z.number().int().min(0).nullable().optional(),
  }).strict(),
}).strict().refine((patch) => Object.keys(patch.basePricing).length > 0, "At least one supported draft pricing field is required.");
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
  readiness: { status: string; findings: string[]; warnings: string[] };
  fingerprint: string;
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
    pricingBase: review.pbv2Tree.basePricing, readiness: review.publishReadiness.validationStatus,
  };
  return {
    sessionId: review.intake.sessionId, productId: review.product.id, productName: review.product.name,
    editorLink: `/admin/product-intake/sessions/${encodeURIComponent(review.intake.sessionId)}/review`,
    productIsActive: false, pbv2Status: "DRAFT", pbv2TreeVersionId: review.pbv2Tree.id,
    pbv2UpdatedAt: review.pbv2Tree.updatedAt, pricingBase: review.pbv2Tree.basePricing,
    readiness: { status: review.publishReadiness.validationStatus, findings, warnings },
    fingerprint: createHash("sha256").update(stable(input)).digest("hex"),
  };
}

export class InactiveProductDraftUpdateService {
  constructor(private readonly review: ProductIntakeDraftReviewService = createDbProductIntakeDraftReviewService()) {}

  async loadSnapshot(input: { organizationId: string; sessionId: string }): Promise<InactiveProductDraftSnapshot> {
    return snapshotFromReview(await this.review.getDraftReview(input));
  }

  async buildProposal(input: { organizationId: string; sessionId: string; patch: InactiveProductDraftPatch }): Promise<{ before: InactiveProductDraftSnapshot; after: InactiveProductDraftPatch; fingerprint: string }> {
    const before = await this.loadSnapshot(input);
    const patch = inactiveProductDraftPatchSchema.parse(input.patch);
    return { before, after: patch, fingerprint: createHash("sha256").update(stable({ draft: before.fingerprint, patch })).digest("hex") };
  }

  async revalidateProposal(input: { organizationId: string; sessionId: string; patch: InactiveProductDraftPatch; expectedFingerprint: string }) {
    const proposal = await this.buildProposal(input);
    if (proposal.fingerprint !== input.expectedFingerprint) return { valid: false as const, code: "INACTIVE_DRAFT_STALE", summary: "The draft changed; review the current before-and-after preview." };
    return { valid: true as const, proposal };
  }

  async updateInactiveProductDraft(input: { organizationId: string; sessionId: string; patch: InactiveProductDraftPatch; expectedFingerprint: string; userId: string; userName?: string | null }) {
    const validation = await this.revalidateProposal(input);
    if (!validation.valid) throw new InactiveProductDraftUpdateError(validation.code, validation.summary);
    const review = await this.review.updateDraftPricing({
      organizationId: input.organizationId, sessionId: input.sessionId, base: validation.proposal.after.basePricing,
      userId: input.userId, ...(input.userName ? { userName: input.userName } : {}),
      expectedDraftUpdatedAt: validation.proposal.before.pbv2UpdatedAt,
    });
    return snapshotFromReview(review);
  }
}

export const inactiveProductDraftUpdateService = new InactiveProductDraftUpdateService();
