import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { pbv2TreeVersions, products } from "@shared/schema";
import { db } from "../../db";
import { loadCurrentPbv2DraftTreeVersion } from "../pricing/PricingService";

/**
 * This is deliberately the narrow first existing-product operation.  It uses
 * the same business-labelled semantic operation as Product Builder, but its
 * target is the Product Editor's current linked PBV2 DRAFT rather than an
 * unfinished new-product intent.
 */
export const existingProductEditOperationsSchema = z.object({
  operations: z.array(z.object({
    op: z.literal("set_option_default"),
    optionGroup: z.string().trim().min(1).max(160),
    value: z.string().trim().min(1).max(160),
  }).strict()).min(1).max(12),
}).strict();

export type ExistingProductEditOperations = z.infer<typeof existingProductEditOperationsSchema>;

export type ExistingProductEditProposal = {
  productId: string;
  productName: string;
  productActive: boolean;
  treeId: string;
  treeUpdatedAt: string;
  sourceLifecycle: "DRAFT" | "ACTIVE";
  changes: Array<{ field: string; before: string; after: string }>;
  fingerprint: string;
};

export type TrustedExistingProductEditContext = {
  name: string;
  lifecycle: "active" | "inactive";
  pricingLifecycle: "DRAFT" | "ACTIVE";
  optionGroups: Array<{ label: string; defaultValue: string | null; values: string[] }>;
};

export class ExistingProductEditError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function asNodes(tree: Record<string, any>): any[] {
  const raw = tree.nodes;
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === "object")
    : raw && typeof raw === "object" ? Object.values(raw).filter((item) => item && typeof item === "object")
      : [];
}

function optionNode(tree: Record<string, any>, label: string): any {
  const matches = asNodes(tree).filter((node) => {
    if (node.kind === "group") return false;
    const candidate = typeof node.label === "string" && node.label.trim()
      ? node.label : typeof node.input?.selectionKey === "string" ? node.input.selectionKey : node.key;
    return typeof candidate === "string" && normalized(candidate) === normalized(label);
  });
  if (matches.length !== 1) throw new ExistingProductEditError("EXISTING_PRODUCT_OPTION_GROUP_UNRESOLVED", "The requested option group is not uniquely available on this product.");
  return matches[0]!;
}

function optionChoice(node: any, label: string): any {
  const matches = Array.isArray(node.choices) ? node.choices.filter((choice: any) => {
    const candidate = typeof choice?.label === "string" && choice.label.trim() ? choice.label : choice?.value;
    return typeof candidate === "string" && normalized(candidate) === normalized(label);
  }) : [];
  if (matches.length !== 1) throw new ExistingProductEditError("EXISTING_PRODUCT_OPTION_VALUE_UNRESOLVED", "The requested option value is not uniquely available on this product.");
  return matches[0]!;
}

function displayDefault(node: any): string {
  const current = node?.input?.defaultValue;
  const choice = Array.isArray(node?.choices) ? node.choices.find((candidate: any) => candidate?.value === current) : null;
  return typeof choice?.label === "string" ? choice.label : typeof current === "string" ? current : "(none)";
}

function applyOperations(tree: Record<string, any>, operations: ExistingProductEditOperations): { tree: Record<string, any>; changes: ExistingProductEditProposal["changes"] } {
  const next = structuredClone(tree);
  const changes: ExistingProductEditProposal["changes"] = [];
  for (const operation of operations.operations) {
    const node = optionNode(next, operation.optionGroup);
    if (node?.input?.type && node.input.type !== "select") throw new ExistingProductEditError("EXISTING_PRODUCT_DEFAULT_UNSUPPORTED", "Only single-select option defaults can be changed through this capability.");
    const choice = optionChoice(node, operation.value);
    const before = displayDefault(node);
    const after = typeof choice.label === "string" ? choice.label : choice.value;
    if (before === after) continue;
    node.input = { ...(node.input && typeof node.input === "object" ? node.input : {}), defaultValue: choice.value };
    const label = typeof node.label === "string" && node.label.trim() ? node.label : operation.optionGroup;
    changes.push({ field: `${label} default`, before, after });
  }
  if (!changes.length) throw new ExistingProductEditError("EXISTING_PRODUCT_NO_CHANGES", "The requested existing-product configuration already matches the current values.");
  return { tree: next, changes };
}

export class ExistingProductEditService {
  private async editableTree(input: { organizationId: string; product: { id: string; pbv2ActiveTreeVersionId: string | null } }) {
    const draft = await loadCurrentPbv2DraftTreeVersion({ organizationId: input.organizationId, productId: input.product.id });
    if (draft) return draft;
    if (!input.product.pbv2ActiveTreeVersionId) return null;
    const [active] = await db.select().from(pbv2TreeVersions).where(and(
      eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.productId, input.product.id), eq(pbv2TreeVersions.id, input.product.pbv2ActiveTreeVersionId),
    )).limit(1);
    return active ?? null;
  }

  async trustedContext(input: { organizationId: string; productId: string }): Promise<TrustedExistingProductEditContext | null> {
    const [product] = await db.select({ id: products.id, name: products.name, isActive: products.isActive, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
      .from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    if (!product) return null;
    const tree = await this.editableTree({ organizationId: input.organizationId, product });
    if (!tree || !tree.treeJson || typeof tree.treeJson !== "object" || Array.isArray(tree.treeJson)) return null;
    const optionGroups = asNodes(tree.treeJson as Record<string, any>).flatMap((node) => {
      if (node.kind === "group") return [];
      const label = typeof node.label === "string" && node.label.trim() ? node.label : node.input?.selectionKey;
      if (typeof label !== "string" || !label.trim() || !Array.isArray(node.choices)) return [];
      return [{ label, defaultValue: displayDefault(node) === "(none)" ? null : displayDefault(node), values: node.choices.flatMap((choice: any) => typeof choice?.label === "string" && choice.label.trim() ? [choice.label] : typeof choice?.value === "string" ? [choice.value] : []) }];
    }).slice(0, 24);
    return { name: product.name, lifecycle: product.isActive ? "active" : "inactive", pricingLifecycle: tree.status === "DRAFT" ? "DRAFT" : "ACTIVE", optionGroups };
  }

  async buildProposal(input: { organizationId: string; productId: string; operations: unknown }): Promise<ExistingProductEditProposal> {
    const operations = existingProductEditOperationsSchema.parse(input.operations);
    const [product] = await db.select({ id: products.id, name: products.name, isActive: products.isActive, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
      .from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    if (!product) throw new ExistingProductEditError("EXISTING_PRODUCT_NOT_FOUND", "The trusted product is no longer available.");
    // This mirrors Product Editor lifecycle: update a current DRAFT when one
    // exists; otherwise read the active configuration and create a DRAFT only
    // after GO. The active tree itself is never changed.
    const draft = await this.editableTree({ organizationId: input.organizationId, product });
    if (!draft) throw new ExistingProductEditError("EXISTING_PRODUCT_DRAFT_UNAVAILABLE", "This product has no editable PBV2 pricing configuration.");
    const tree = draft.treeJson;
    if (!tree || typeof tree !== "object" || Array.isArray(tree)) throw new ExistingProductEditError("EXISTING_PRODUCT_DRAFT_INVALID", "The current PBV2 DRAFT configuration is not editable.");
    const applied = applyOperations(tree as Record<string, any>, operations);
    const treeUpdatedAt = new Date(draft.updatedAt).toISOString();
    return {
      productId: product.id, productName: product.name, productActive: product.isActive, treeId: draft.id, treeUpdatedAt, sourceLifecycle: draft.status === "DRAFT" ? "DRAFT" : "ACTIVE",
      changes: applied.changes,
      fingerprint: fingerprint({ productId: product.id, treeId: draft.id, treeUpdatedAt, operations }),
    };
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
    const [product] = await db.select({ id: products.id, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    if (!product) throw new ExistingProductEditError("EXISTING_PRODUCT_NOT_FOUND", "The trusted product is no longer available.");
    const current = await this.editableTree({ organizationId: input.organizationId, product });
    if (!current || current.id !== validation.proposal.treeId || new Date(current.updatedAt).toISOString() !== validation.proposal.treeUpdatedAt) {
      throw new ExistingProductEditError("EXISTING_PRODUCT_EDIT_STALE", "The product's editable PBV2 DRAFT changed; review a fresh preview.");
    }
    const applied = applyOperations(current.treeJson as Record<string, any>, operations);
    if (current.status === "DRAFT") {
      const [updated] = await db.update(pbv2TreeVersions).set({ treeJson: { ...applied.tree, status: "DRAFT" }, updatedByUserId: input.userId, updatedAt: new Date() })
        .where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.productId, input.productId), eq(pbv2TreeVersions.id, current.id), eq(pbv2TreeVersions.status, "DRAFT"), eq(pbv2TreeVersions.updatedAt, current.updatedAt))).returning({ id: pbv2TreeVersions.id });
      if (!updated) throw new ExistingProductEditError("EXISTING_PRODUCT_EDIT_STALE", "The product's editable PBV2 DRAFT changed; review a fresh preview.");
    } else {
      await db.insert(pbv2TreeVersions).values({ organizationId: input.organizationId, productId: input.productId, status: "DRAFT", schemaVersion: current.schemaVersion, treeJson: { ...applied.tree, status: "DRAFT" }, createdByUserId: input.userId, updatedByUserId: input.userId });
    }
    return { ...validation.proposal, changes: applied.changes };
  }
}

export const existingProductEditService = new ExistingProductEditService();
