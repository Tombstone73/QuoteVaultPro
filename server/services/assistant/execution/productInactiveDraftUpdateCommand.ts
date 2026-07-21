import { z } from "zod";
import type {
  AssistantCanonicalCommandAdapter,
  AssistantCommandDefinition,
  AssistantCommandExecutionContext,
} from "./commandRegistry";

export const productInactiveDraftUpdateCommandName = "products.update_inactive_draft" as const;
export const productInactiveDraftUpdateCommandVersion = "v1" as const;
export const productInactiveDraftUpdateConfirmationTtlMs = 5 * 60_000;

/**
 * The proposed patch is persisted, validated, and fingerprinted by the
 * Product Management domain before a plan exists.  The only currently safe
 * update path is the canonical base-pricing patch below.  This command never
 * accepts a generic JSON patch, product status, activation directives, or
 * repository instructions.
 */
export const productInactiveDraftBasePricingPatchSchema = z.object({
  perSqftCents: z.number().int().min(0).max(10_000_000).optional(),
  perPieceCents: z.number().int().min(0).max(10_000_000).optional(),
  minimumChargeCents: z.number().int().min(0).max(10_000_000).optional(),
}).strict().refine(
  (patch) => patch.perSqftCents !== undefined || patch.perPieceCents !== undefined || patch.minimumChargeCents !== undefined,
  "At least one base pricing field is required.",
);
export type ProductInactiveDraftBasePricingPatch = z.infer<typeof productInactiveDraftBasePricingPatchSchema>;

export const productInactiveDraftUpdateCommandInputSchema = z.object({
  productIntakeSessionId: z.string().trim().min(1).max(128),
  proposalFingerprint: z.string().trim().regex(/^[a-f0-9]{64}$/i, "Proposal fingerprint must be a SHA-256 digest."),
  /** Only allowlisted base pricing fields may be changed in this milestone. */
  patch: z.object({
    basePricing: productInactiveDraftBasePricingPatchSchema,
  }).strict(),
}).strict();
export type ProductInactiveDraftUpdateCommandInput = z.infer<typeof productInactiveDraftUpdateCommandInputSchema>;

const productSourceLinkSchema = z.string().regex(/^\/products\/[^\s/]+$/);
const productIntakeSourceLinkSchema = z.string().regex(/^\/(?:admin\/catalog-migration-lab(?:\/[^\s/]+)?|admin\/product-intake\/sessions\/[^\s/]+\/review)$/);
const displayValueSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);

export const productInactiveDraftUpdatePreviewSchema = z.object({
  product: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(255),
    status: z.literal("inactive_draft"),
    sourceLink: productSourceLinkSchema,
  }).strict(),
  productIntakeSessionId: z.string().min(1),
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  affectedProductCount: z.literal(1),
  changes: z.array(z.object({
    field: z.string().min(1).max(160),
    before: displayValueSchema,
    after: displayValueSchema,
  }).strict()).min(1).max(100),
  unchanged: z.tuple([
    z.literal("product_activation"),
    z.literal("active_product_modification"),
    z.literal("quote_or_order_pricing"),
    z.literal("inventory_adjustment"),
    z.literal("production_job_creation"),
    z.literal("customer_facing_catalog_change"),
  ]),
  readinessBefore: z.enum(["ready", "not_ready", "unknown"]),
  expectedReadinessAfter: z.enum(["ready", "not_ready", "unknown"]),
  warnings: z.array(z.string().min(1).max(1_000)).max(50),
  validationErrors: z.array(z.string().min(1).max(1_000)).max(50),
  sourceLinks: z.array(z.union([productSourceLinkSchema, productIntakeSourceLinkSchema])).min(1).max(50),
}).strict();
export type ProductInactiveDraftUpdatePreview = z.infer<typeof productInactiveDraftUpdatePreviewSchema>;

export const productInactiveDraftUpdateCommandResultSchema = z.object({
  product: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(255),
    active: z.literal(false),
    sourceLink: productSourceLinkSchema,
  }).strict(),
  productIntakeSession: z.object({
    id: z.string().min(1),
    sourceLink: productIntakeSourceLinkSchema,
  }).strict(),
  pbv2DraftTreeVersionId: z.string().min(1).nullable(),
  readiness: z.enum(["ready", "not_ready", "unknown"]),
  domainAuditReference: z.string().min(1).optional(),
}).strict();
export type ProductInactiveDraftUpdateCommandResult = z.infer<typeof productInactiveDraftUpdateCommandResultSchema>;

/**
 * The only assistant-to-domain boundary for Stage 6 draft updates.  The
 * canonical service resolves the draft and persisted validated patch inside
 * the tenant scope, rechecks its fingerprint, applies one transaction, and
 * keeps PBV2 in DRAFT.  It must reject active, archived, deleted, or foreign
 * products; this command contract provides no way to override those checks.
 */
export interface ProductInactiveDraftUpdateCanonicalService {
  updateInactiveDraft(input: ProductInactiveDraftUpdateCommandInput & {
    organizationId: string;
    actorUserId: string;
    assistantPlanId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProductInactiveDraftUpdateCommandResult>;
}

export function createProductInactiveDraftUpdateCanonicalAdapter(
  service: ProductInactiveDraftUpdateCanonicalService,
): AssistantCanonicalCommandAdapter<ProductInactiveDraftUpdateCommandInput, ProductInactiveDraftUpdateCommandResult> {
  return {
    async execute(input: ProductInactiveDraftUpdateCommandInput, context: AssistantCommandExecutionContext) {
      const normalized = productInactiveDraftUpdateCommandInputSchema.parse(input);
      const result = await service.updateInactiveDraft({
        ...normalized,
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
        assistantPlanId: context.planId,
        idempotencyKey: context.idempotencyKey,
        correlationId: context.correlationId,
      });
      return productInactiveDraftUpdateCommandResultSchema.parse(result);
    },
  };
}

/** Exactly one confirmed, high-risk update to one already-inactive product draft. */
export function createProductInactiveDraftUpdateCommandDefinition(
  service: ProductInactiveDraftUpdateCanonicalService,
): AssistantCommandDefinition<ProductInactiveDraftUpdateCommandInput, ProductInactiveDraftUpdatePreview, ProductInactiveDraftUpdateCommandResult> {
  return {
    name: productInactiveDraftUpdateCommandName,
    version: productInactiveDraftUpdateCommandVersion,
    domain: "products",
    mode: "write",
    description: "Apply one validated base-pricing patch to one inactive product draft through canonical Product Intake services.",
    risk: "high",
    requiredCapability: "assistant.products.update_inactive_draft",
    allowedRoles: ["owner", "admin"],
    inputSchema: productInactiveDraftUpdateCommandInputSchema,
    previewSchema: productInactiveDraftUpdatePreviewSchema,
    resultSchema: productInactiveDraftUpdateCommandResultSchema,
    maxAffectedRecords: 1,
    bulkAllowed: false,
    confirmationRequired: true,
    reauthenticationRequired: true,
    confirmationExpiresInMs: productInactiveDraftUpdateConfirmationTtlMs,
    idempotencyPolicy: "server_generated_with_request_hash",
    recordFingerprintStrategy: "updated_at_and_critical_fields",
    transactionPolicy: "required",
    partialFailurePolicy: "forbid",
    auditCategory: "assistant_product_inactive_draft_update",
    undoSupport: "metadata_only",
    abandonmentPolicy: "none",
    testOnly: false,
    devEnabled: true,
    mainEnabled: true,
    adapter: createProductInactiveDraftUpdateCanonicalAdapter(service),
  };
}
