import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auditLogs, materials, pbv2TreeVersions, products, stations } from "@shared/schema";
import { parseProductDraftIntent, type ProductDraftIntent } from "@shared/productDraftIntent";
import {
  projectProductDraftIntentToProductBuilderDraft,
  type ProjectedProductBuilderDraft,
} from "./productIntentProjection";
import { db as defaultDb } from "../../db";
import { canonicalProductMaterialProposalFromReference, validateCanonicalProductMaterialSelection } from "../products/canonicalProductMaterialOperations";

/** A write failure which is safe to present as a failed canonical GO action. */
export class ProductIntentDraftExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProductIntentDraftExecutionError";
  }
}

export type CanonicalProductDraftExecutionInput = {
  /** The exact canonical revision bound by confirmation; never source text. */
  intent: unknown;
  organizationId: string;
  actorUserId: string | null;
  /** Server-generated idempotency key from the confirmation/assistant plan. */
  idempotencyKey: string;
  /** Optional opaque references retained as audit metadata only. */
  sessionId?: string;
  assistantPlanId?: string;
  correlationId?: string;
};

export type CanonicalProductDraftExecutionResult = {
  productId: string;
  pbv2TreeVersionId: string;
  inactive: true;
  reused: boolean;
  sourceLink: string;
};

type ExactDraftIds = { productId: string; pbv2TreeVersionId: string };

function assertNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ProductIntentDraftExecutionError("INVALID_EXECUTION_INPUT", `${field} is required.`);
  return normalized;
}

/**
 * Stable UUIDs make a replay address the same two rows. They deliberately do
 * not contain the product name, avoiding name-based draft discovery entirely.
 */
function stableUuid(scope: string): string {
  const hex = createHash("sha256").update(scope).digest("hex");
  const chars = hex.slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20, 32).join("")}`;
}

export function canonicalProductDraftExecutionIds(input: Pick<CanonicalProductDraftExecutionInput, "organizationId" | "idempotencyKey"> & { intent: ProductDraftIntent }): ExactDraftIds {
  // The intent ID plus key is the idempotency namespace. Omitting the revision
  // and fingerprint is intentional: reuse of a key against changed canonical
  // state reaches these exact records and is rejected below.
  const scope = `${input.organizationId}\u0000${input.intent.intentId}\u0000${input.idempotencyKey}`;
  return {
    productId: stableUuid(`${scope}\u0000product`),
    pbv2TreeVersionId: stableUuid(`${scope}\u0000pbv2-draft`),
  };
}

function canonicalExecutionMetadata(input: CanonicalProductDraftExecutionInput, projected: ProjectedProductBuilderDraft, ids: ExactDraftIds) {
  return {
    architecture: "product_draft_intent_execution" as const,
    intentId: projected.audit.intentId,
    revision: projected.audit.revision,
    fingerprint: projected.audit.fingerprint,
    idempotencyKey: input.idempotencyKey,
    productId: ids.productId,
    pbv2TreeVersionId: ids.pbv2TreeVersionId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.assistantPlanId ? { assistantPlanId: input.assistantPlanId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
}

function executionMetadataMatches(value: unknown, expected: ReturnType<typeof canonicalExecutionMetadata>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  return actual.architecture === expected.architecture
    && actual.intentId === expected.intentId
    && actual.revision === expected.revision
    && actual.fingerprint === expected.fingerprint
    && actual.idempotencyKey === expected.idempotencyKey
    && actual.productId === expected.productId
    && actual.pbv2TreeVersionId === expected.pbv2TreeVersionId;
}

function projectedTreeWithExecutionMetadata(projected: ProjectedProductBuilderDraft, metadata: ReturnType<typeof canonicalExecutionMetadata>): Record<string, unknown> {
  const tree = structuredClone(projected.treeJson);
  const meta = tree.meta && typeof tree.meta === "object" && !Array.isArray(tree.meta) ? tree.meta as Record<string, unknown> : {};
  tree.meta = { ...meta, canonicalExecution: metadata };
  return tree;
}

async function validateResolvedRelationships(tx: any, intent: ProductDraftIntent, organizationId: string): Promise<void> {
  if (intent.material.state === "resolved") {
    const [material] = await tx.select({ id: materials.id, organizationId: materials.organizationId, name: materials.name, isActive: materials.isActive }).from(materials).where(and(
      eq(materials.organizationId, organizationId),
      eq(materials.id, intent.material.id),
    )).limit(1);
    try {
      validateCanonicalProductMaterialSelection(canonicalProductMaterialProposalFromReference(intent.material), material ?? null);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "MATERIAL_NOT_FOUND";
      throw new ProductIntentDraftExecutionError(code, error instanceof Error ? error.message : "The selected material is no longer available for this tenant.");
    }
  }
  if (intent.production.route.state === "resolved") {
    const [station] = await tx.select({ id: stations.id }).from(stations).where(and(
      eq(stations.organizationId, organizationId),
      eq(stations.id, intent.production.route.id),
      eq(stations.active, true),
    )).limit(1);
    if (!station) throw new ProductIntentDraftExecutionError("ROUTE_NOT_FOUND", "The selected production route is no longer available for this tenant.");
  }
}

function assertReplayMatches(input: {
  product: any;
  tree: any;
  ids: ExactDraftIds;
  organizationId: string;
  expectedMetadata: ReturnType<typeof canonicalExecutionMetadata>;
}): CanonicalProductDraftExecutionResult {
  const { product, tree, ids, organizationId, expectedMetadata } = input;
  if (!product || !tree
    || product.organizationId !== organizationId
    || product.id !== ids.productId
    || product.isActive !== false
    || product.pbv2ActiveTreeVersionId !== null
    || tree.organizationId !== organizationId
    || tree.id !== ids.pbv2TreeVersionId
    || tree.productId !== ids.productId
    || tree.status !== "DRAFT"
    || tree.schemaVersion !== 2
    || !executionMetadataMatches(tree.treeJson?.meta?.canonicalExecution, expectedMetadata)) {
    throw new ProductIntentDraftExecutionError("IDEMPOTENCY_CONFLICT", "This idempotency key is already associated with different or incomplete draft records.");
  }
  return {
    productId: ids.productId,
    pbv2TreeVersionId: ids.pbv2TreeVersionId,
    inactive: true,
    reused: true,
    sourceLink: `/products/${encodeURIComponent(ids.productId)}/edit?draftTreeVersionId=${encodeURIComponent(ids.pbv2TreeVersionId)}`,
  };
}

/**
 * Creates one inactive product and one PBV2 DRAFT from a fully resolved
 * canonical intent. This service has no route or command registration and
 * does not persist proposal/session state; its caller owns confirmation and
 * execution-state transitions.
 */
export function createCanonicalProductDraftExecutionWriter(database: any = defaultDb) {
  return {
    async execute(rawInput: CanonicalProductDraftExecutionInput): Promise<CanonicalProductDraftExecutionResult> {
      const organizationId = assertNonEmpty(rawInput.organizationId, "organizationId");
      const idempotencyKey = assertNonEmpty(rawInput.idempotencyKey, "idempotencyKey");
      const input = { ...rawInput, organizationId, idempotencyKey };
      const intent = parseProductDraftIntent(input.intent);
      if (intent.organizationId !== organizationId) throw new ProductIntentDraftExecutionError("TENANT_MISMATCH", "The canonical intent belongs to a different tenant.");
      if (intent.operation !== "new_product") throw new ProductIntentDraftExecutionError("UNSUPPORTED_OPERATION", "Canonical execution currently creates new inactive products only.");

      // Projection has no database access and rejects unresolved or unsafe
      // combinations before this transaction can write anything.
      const projected = projectProductDraftIntentToProductBuilderDraft(intent);
      const ids = canonicalProductDraftExecutionIds({ organizationId, idempotencyKey, intent });
      const executionMetadata = canonicalExecutionMetadata(input, projected, ids);
      const treeJson = projectedTreeWithExecutionMetadata(projected, executionMetadata);

      return database.transaction(async (tx: any) => {
        // An idempotent replay is addressed by exact deterministic IDs, never
        // by a product name or a best-match query.
        const [existingProduct] = await tx.select().from(products).where(eq(products.id, ids.productId)).limit(1);
        const [existingTree] = await tx.select().from(pbv2TreeVersions).where(eq(pbv2TreeVersions.id, ids.pbv2TreeVersionId)).limit(1);
        if (existingProduct || existingTree) {
          return assertReplayMatches({ product: existingProduct, tree: existingTree, ids, organizationId, expectedMetadata: executionMetadata });
        }

        await validateResolvedRelationships(tx, intent, organizationId);
        const now = new Date();
        await tx.insert(products).values({
          id: ids.productId,
          organizationId,
          name: projected.product.name,
          description: projected.product.description,
          category: projected.product.category,
          pricingMode: projected.product.pricingMode,
          measurementMode: projected.product.measurementMode,
          workflowIntent: intent.workflow.kind,
          pricingEngine: projected.product.pricingEngine,
          pricingProfileKey: projected.product.pricingProfileKey,
          pricingFormula: projected.product.pricingFormula,
          pricingProfileConfig: projected.product.pricingProfileConfig,
          primaryMaterialId: projected.relationships.material.state === "resolved" ? projected.relationships.material.id : null,
          requiresProductionJob: projected.product.requiresProductionJob,
          requiresProofApproval: projected.product.requiresProofApproval,
          isTaxable: projected.product.isTaxable,
          isService: projected.product.isService,
          isActive: false,
          showStoreLink: intent.visibility.catalogVisible,
          optionTreeJson: null,
          pbv2ActiveTreeVersionId: null,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(pbv2TreeVersions).values({
          id: ids.pbv2TreeVersionId,
          organizationId,
          productId: ids.productId,
          status: "DRAFT",
          schemaVersion: 2,
          treeJson: treeJson as any,
          publishedAt: null,
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(auditLogs).values({
          organizationId,
          userId: input.actorUserId,
          actionType: "assistant_product_intent_draft_created",
          entityType: "product",
          entityId: ids.productId,
          entityName: projected.product.name,
          description: `Canonical Product Intent created inactive product ${ids.productId} and PBV2 DRAFT ${ids.pbv2TreeVersionId}.`,
          newValues: { canonicalExecution: executionMetadata, productIsActive: false, pbv2Status: "DRAFT", activeTreeAssigned: false, materialOperationReference: "products.update_material_configuration.v1", primaryMaterialId: projected.relationships.material.state === "resolved" ? projected.relationships.material.id : null },
        } as any);
        return {
          productId: ids.productId,
          pbv2TreeVersionId: ids.pbv2TreeVersionId,
          inactive: true,
          reused: false,
          sourceLink: `/products/${encodeURIComponent(ids.productId)}/edit?draftTreeVersionId=${encodeURIComponent(ids.pbv2TreeVersionId)}`,
        };
      });
    },
  };
}

