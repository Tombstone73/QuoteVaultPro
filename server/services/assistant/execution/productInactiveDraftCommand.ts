import { z } from "zod";
import type {
  AssistantCanonicalCommandAdapter,
  AssistantCommandDefinition,
  AssistantCommandExecutionContext,
} from "./commandRegistry";

export const productInactiveDraftCommandName = "products.create_inactive_draft" as const;
export const productInactiveDraftCommandVersion = "v1" as const;
export const productInactiveDraftConfirmationTtlMs = 5 * 60_000;

/**
 * This command receives references to a server-validated Product Intake
 * proposal only. It intentionally cannot receive product, pricing, material,
 * PBV2, routing, activation, or arbitrary configuration data from a model.
 */
export const productInactiveDraftCommandInputSchema = z.object({
  intakeSessionId: z.string().trim().min(1).max(128),
  proposalFingerprint: z.string().trim().regex(/^[a-f0-9]{64}$/i, "Proposal fingerprint must be a SHA-256 digest."),
  proposalId: z.string().trim().min(1).max(128).optional(),
}).strict();
export type ProductInactiveDraftCommandInput = z.infer<typeof productInactiveDraftCommandInputSchema>;

const productSourceLinkSchema = z.string().regex(/^\/products\/[^\s/]+(?:\/edit\?draftTreeVersionId=[^\s/&]+)?$/);
const productIntakeSourceLinkSchema = z.string().regex(/^\/(?:admin\/catalog-migration-lab(?:\/[^\s/]+)?|admin\/product-intake\/sessions\/[^\s/]+\/review)$/);

export const productInactiveDraftPreviewSchema = z.object({
  intakeSessionId: z.string().min(1),
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  productName: z.string().min(1).max(255),
  statusToCreate: z.literal("inactive_draft"),
  affectedProductCount: z.literal(1),
  recordsToCreate: z.array(z.enum(["product", "pbv2_draft", "pricing_draft", "option_draft"])).max(4),
  recordsToReuse: z.array(z.enum(["material", "routing", "option_template", "pricing_template"])).max(50),
  warnings: z.array(z.string().min(1).max(1_000)).max(50),
  proposedFields: z.object({
    category: z.string().min(1).max(160).nullable(),
    measurementMode: z.string().min(1).max(120),
    requiresDimensions: z.boolean(),
    fixedDimensions: z.string().min(1).max(120).nullable(),
    pricingModel: z.string().min(1).max(120),
    perSqftCents: z.number().int().nonnegative().nullable(),
    perPieceCents: z.number().int().nonnegative().nullable(),
    minimumChargeCents: z.number().int().nonnegative().nullable(),
    material: z.string().min(1).max(255).nullable(),
    productionRoute: z.string().min(1).max(120).nullable(),
    sheetOrRollConstraints: z.string().min(1).max(160).nullable(),
    allowRotation: z.boolean().nullable(),
    quantityBehavior: z.string().min(1).max(120),
    taxable: z.literal(true),
    commonOptions: z.array(z.string().min(1).max(160)).max(12),
    status: z.literal("inactive_draft"),
  }).strict(),
  sourceLinks: z.array(z.union([productSourceLinkSchema, productIntakeSourceLinkSchema])).min(1).max(50),
  unchanged: z.tuple([
    z.literal("product_activation"),
    z.literal("active_product_modification"),
    z.literal("quote_or_order_pricing"),
    z.literal("inventory_adjustment"),
    z.literal("production_job_creation"),
    z.literal("customer_facing_catalog_change"),
    z.literal("material_record_duplication"),
    z.literal("routing_record_duplication"),
  ]),
}).strict();
export type ProductInactiveDraftPreview = z.infer<typeof productInactiveDraftPreviewSchema>;

export const productInactiveDraftCommandResultSchema = z.object({
  product: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(255),
    active: z.literal(false),
    sourceLink: productSourceLinkSchema,
  }).strict(),
  intakeSession: z.object({
    id: z.string().min(1),
    status: z.literal("draft_created"),
    sourceLink: productIntakeSourceLinkSchema,
  }).strict(),
  pbv2DraftTreeVersionId: z.string().min(1).nullable(),
  domainAuditReference: z.string().min(1).optional(),
}).strict();
export type ProductInactiveDraftCommandResult = z.infer<typeof productInactiveDraftCommandResultSchema>;

/**
 * The Product Intake service remains the sole authority for proposal loading,
 * diagnostics, PBV2/pricing/material/routing validation, transaction scope,
 * and draft persistence. The assistant adapter has no database or route path.
 */
export interface ProductInactiveDraftCanonicalService {
  createInactiveDraft(input: ProductInactiveDraftCommandInput & {
    organizationId: string;
    actorUserId: string;
    assistantPlanId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProductInactiveDraftCommandResult>;
}

export function createProductInactiveDraftCanonicalAdapter(
  service: ProductInactiveDraftCanonicalService,
): AssistantCanonicalCommandAdapter<ProductInactiveDraftCommandInput, ProductInactiveDraftCommandResult> {
  return {
    async execute(input: ProductInactiveDraftCommandInput, context: AssistantCommandExecutionContext) {
      const normalized = productInactiveDraftCommandInputSchema.parse(input);
      const result = await service.createInactiveDraft({
        ...normalized,
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
        assistantPlanId: context.planId,
        idempotencyKey: context.idempotencyKey,
        correlationId: context.correlationId,
      });
      return productInactiveDraftCommandResultSchema.parse(result);
    },
  };
}

/** Exactly one high-risk draft command; activation is not represented anywhere in this contract. */
export function createProductInactiveDraftCommandDefinition(
  service: ProductInactiveDraftCanonicalService,
): AssistantCommandDefinition<ProductInactiveDraftCommandInput, ProductInactiveDraftPreview, ProductInactiveDraftCommandResult> {
  return {
    name: productInactiveDraftCommandName,
    version: productInactiveDraftCommandVersion,
    domain: "products",
    mode: "write",
    description: "Create one server-validated inactive product draft through Product Intake.",
    risk: "high",
    requiredCapability: "assistant.products.create_inactive_draft",
    allowedRoles: ["owner", "admin"],
    inputSchema: productInactiveDraftCommandInputSchema,
    previewSchema: productInactiveDraftPreviewSchema,
    resultSchema: productInactiveDraftCommandResultSchema,
    maxAffectedRecords: 1,
    bulkAllowed: false,
    confirmationRequired: true,
    reauthenticationRequired: true,
    confirmationExpiresInMs: productInactiveDraftConfirmationTtlMs,
    idempotencyPolicy: "server_generated_with_request_hash",
    recordFingerprintStrategy: "stable_field_hash",
    transactionPolicy: "required",
    partialFailurePolicy: "forbid",
    auditCategory: "assistant_product_inactive_draft",
    undoSupport: "metadata_only",
    abandonmentPolicy: "session_abandonment_only",
    testOnly: false,
    devEnabled: true,
    mainEnabled: true,
    adapter: createProductInactiveDraftCanonicalAdapter(service),
  };
}
