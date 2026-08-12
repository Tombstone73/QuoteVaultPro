import { and, eq } from "drizzle-orm";
import { pbv2TreeVersions, products } from "@shared/schema";
import { loadCurrentPbv2DraftTreeVersion } from "../pricing/PricingService";
import { CanonicalProductConfigurationError, canonicalProductConfigurationOperations, type ProductConfigurationChanges } from "../products/canonicalProductConfigurationOperations";
import { CanonicalPbv2OptionConfigurationError, canonicalPbv2OptionConfigurationOperations, type Pbv2OptionConfigurationMutations } from "../products/canonicalPbv2OptionConfigurationOperations";
import { existingProductEditOperationsSchema, type ExistingProductEditOperations } from "./existingProductEditContract";
export { existingProductEditOperationsSchema, type ExistingProductEditOperations } from "./existingProductEditContract";

/**
 * This is deliberately the narrow first existing-product operation.  It uses
 * the same business-labelled semantic operation as Product Builder, but its
 * target is the Product Editor's current linked PBV2 DRAFT rather than an
 * unfinished new-product intent.
 */
export type ExistingProductEditProposal = {
  productId: string;
  productName: string;
  productActive: boolean;
  treeId?: string;
  treeUpdatedAt?: string;
  sourceLifecycle: "DRAFT" | "ACTIVE" | "PRODUCT";
  canonicalOperationReference?: "products.update_configuration.v1" | "products.update_option_configuration.v1";
  expectedProductUpdatedAt?: string;
  changes: Array<{ field: string; before: string; after: string }>;
  fingerprint: string;
};

export type TrustedExistingProductEditContext = {
  name: string;
  lifecycle: "active" | "inactive";
  pricingLifecycle: "DRAFT" | "ACTIVE";
  optionGroups: Array<{ label: string; selectionKey?: string; inputType?: string; required?: boolean; defaultValue: string | null; values: string[]; choices?: Array<{ value: string; label: string }> }>;
};

export class ExistingProductEditError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function asNodes(tree: Record<string, any>): any[] {
  const raw = tree.nodes;
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === "object")
    : raw && typeof raw === "object" ? Object.values(raw).filter((item) => item && typeof item === "object")
      : [];
}

function displayDefault(node: any): string {
  const current = node?.input?.defaultValue;
  const choice = Array.isArray(node?.choices) ? node.choices.find((candidate: any) => candidate?.value === current) : null;
  return typeof choice?.label === "string" ? choice.label : typeof current === "string" ? current : "(none)";
}

function canonicalPbv2Mutations(operations: ExistingProductEditOperations): Pbv2OptionConfigurationMutations {
  const canonical = operations.operations.find((operation) => operation.op === "update_pbv2_option_configuration");
  if (canonical?.op === "update_pbv2_option_configuration") return canonical.mutations;
  return operations.operations.flatMap((operation) => operation.op === "set_option_default" ? [{ kind: "set_default" as const, input: operation.optionGroup, choice: operation.value }] : []);
}

export class ExistingProductEditService {
  private async editableTree(input: { organizationId: string; product: { id: string; pbv2ActiveTreeVersionId: string | null } }) {
    const { db } = await import("../../db");
    const draft = await loadCurrentPbv2DraftTreeVersion({ organizationId: input.organizationId, productId: input.product.id });
    if (draft) return draft;
    if (!input.product.pbv2ActiveTreeVersionId) return null;
    const [active] = await db.select().from(pbv2TreeVersions).where(and(
      eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.productId, input.product.id), eq(pbv2TreeVersions.id, input.product.pbv2ActiveTreeVersionId),
    )).limit(1);
    return active ?? null;
  }

  async trustedContext(input: { organizationId: string; productId: string }): Promise<TrustedExistingProductEditContext | null> {
    const { db } = await import("../../db");
    const [product] = await db.select({ id: products.id, name: products.name, isActive: products.isActive, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
      .from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    if (!product) return null;
    const tree = await this.editableTree({ organizationId: input.organizationId, product });
    if (!tree || !tree.treeJson || typeof tree.treeJson !== "object" || Array.isArray(tree.treeJson)) return null;
    const optionGroups = asNodes(tree.treeJson as Record<string, any>).flatMap((node) => {
      if (node.kind === "group") return [];
      const label = typeof node.label === "string" && node.label.trim() ? node.label : node.input?.selectionKey;
      if (typeof label !== "string" || !label.trim() || !Array.isArray(node.choices)) return [];
      const choices = node.choices.flatMap((choice: any) => typeof choice?.value === "string" && choice.value.trim() ? [{ value: choice.value, label: typeof choice?.label === "string" && choice.label.trim() ? choice.label : choice.value }] : []);
      return [{ label, selectionKey: String(node.input?.selectionKey ?? node.key ?? node.id), inputType: String(node.input?.type ?? "unknown"), required: Boolean(node.input?.required), defaultValue: displayDefault(node) === "(none)" ? null : displayDefault(node), values: choices.map((choice: any) => choice.label), choices }];
    }).slice(0, 24);
    return { name: product.name, lifecycle: product.isActive ? "active" : "inactive", pricingLifecycle: tree.status === "DRAFT" ? "DRAFT" : "ACTIVE", optionGroups };
  }

  async buildProposal(input: { organizationId: string; productId: string; operations: unknown }): Promise<ExistingProductEditProposal> {
    const { db } = await import("../../db");
    const operations = existingProductEditOperationsSchema.parse(input.operations);
    const configuration = operations.operations.find((operation): operation is { op: "update_product_configuration"; changes: ProductConfigurationChanges } => operation.op === "update_product_configuration");
    if (configuration) {
      const proposal = await canonicalProductConfigurationOperations.propose({ organizationId: input.organizationId, productId: input.productId, changes: configuration.changes });
      const [product] = await db.select({ isActive: products.isActive }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
      if (!product) throw new ExistingProductEditError("EXISTING_PRODUCT_NOT_FOUND", "The trusted product is no longer available.");
      return { productId: proposal.productId, productName: proposal.productName, productActive: product.isActive, sourceLifecycle: "PRODUCT", canonicalOperationReference: proposal.operationReference, expectedProductUpdatedAt: proposal.expectedUpdatedAt, changes: proposal.appliedChanges.map((change) => ({ field: String(change.field), before: String(change.before ?? "(none)"), after: String(change.after ?? "(none)") })), fingerprint: proposal.fingerprint };
    }
    try {
      const proposal = await canonicalPbv2OptionConfigurationOperations.propose({ organizationId: input.organizationId, productId: input.productId, mutations: canonicalPbv2Mutations(operations) });
      return { productId: proposal.productId, productName: proposal.productName, productActive: proposal.productActive, treeId: proposal.sourceTreeId, treeUpdatedAt: proposal.expectedTreeUpdatedAt, sourceLifecycle: proposal.sourceTreeStatus, canonicalOperationReference: proposal.operationReference, changes: proposal.changes, fingerprint: proposal.fingerprint };
    } catch (error) {
      if (error instanceof CanonicalPbv2OptionConfigurationError) throw new ExistingProductEditError(error.code, error.message);
      throw error;
    }
  }

  async revalidateProposal(input: { organizationId: string; productId: string; operations: unknown; expectedFingerprint: string }) {
    const proposal = await this.buildProposal(input);
    if (proposal.fingerprint !== input.expectedFingerprint) return { valid: false as const, code: "EXISTING_PRODUCT_EDIT_STALE", summary: "The product's editable PBV2 DRAFT changed; review a fresh preview." };
    return { valid: true as const, proposal };
  }

  async execute(input: { organizationId: string; productId: string; operations: unknown; expectedFingerprint: string; userId: string }) {
    const validation = await this.revalidateProposal(input);
    if (!validation.valid) throw new ExistingProductEditError(validation.code, validation.summary);
    const operations = existingProductEditOperationsSchema.parse(input.operations);
    const configuration = operations.operations.find((operation): operation is { op: "update_product_configuration"; changes: ProductConfigurationChanges } => operation.op === "update_product_configuration");
    if (configuration) {
      if (!validation.proposal.expectedProductUpdatedAt) throw new ExistingProductEditError("EXISTING_PRODUCT_EDIT_STALE", "The product configuration proposal is incomplete; review it again.");
      try {
        const result = await canonicalProductConfigurationOperations.execute({ organizationId: input.organizationId, actorUserId: input.userId, productId: input.productId, changes: configuration.changes, expectedUpdatedAt: validation.proposal.expectedProductUpdatedAt, auditContext: { source: "assistant_go", reference: `assistant-plan:${input.expectedFingerprint}` } });
        return { ...validation.proposal, changes: result.appliedChanges.map((change) => ({ field: String(change.field), before: String(change.before ?? "(none)"), after: String(change.after ?? "(none)") })), canonicalOperationReference: result.operationReference };
      } catch (error) {
        if (error instanceof CanonicalProductConfigurationError) throw new ExistingProductEditError(error.code === "PRODUCT_CONFIGURATION_STALE" ? "EXISTING_PRODUCT_EDIT_STALE" : error.code, error.message);
        throw error;
      }
    }
    if (!validation.proposal.treeId || !validation.proposal.treeUpdatedAt) throw new ExistingProductEditError("EXISTING_PRODUCT_EDIT_STALE", "The PBV2 option proposal is incomplete; review it again.");
    try {
      const result = await canonicalPbv2OptionConfigurationOperations.execute({ organizationId: input.organizationId, actorUserId: input.userId, productId: input.productId, mutations: canonicalPbv2Mutations(operations), expectedTreeId: validation.proposal.treeId, expectedTreeUpdatedAt: validation.proposal.treeUpdatedAt, auditContext: { source: "assistant_go", reference: `assistant-plan:${input.expectedFingerprint}` } });
      return { ...validation.proposal, changes: result.appliedChanges, canonicalOperationReference: result.operationReference };
    } catch (error) {
      if (error instanceof CanonicalPbv2OptionConfigurationError) throw new ExistingProductEditError(error.code === "PBV2_DRAFT_STALE" ? "EXISTING_PRODUCT_EDIT_STALE" : error.code, error.message);
      throw error;
    }
  }
}

export const existingProductEditService = new ExistingProductEditService();
