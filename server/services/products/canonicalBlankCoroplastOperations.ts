import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { blankCoroplastPricingSchema, readBlankCoroplastPricing, withBlankCoroplastPricing, COROPLAST_FLUTE_KEY, COROPLAST_PRINT_MODE_KEY, type BlankCoroplastPricing } from "@shared/blankCoroplast";
import type { OptionTreeV2 } from "@shared/optionTreeV2";
import { materials, pbv2TreeVersions, pricingFormulas, products } from "@shared/schema";
import { collectPbv2MaterialValidationIds } from "../pbv2MaterialValidation";
import { evaluatePricingPreviewFromTree } from "../pricing/PricingService";
import { CanonicalProductEditorSaveError, saveActiveProductEditorConfiguration } from "./canonicalProductEditorSaveOperations";
import { validateCanonicalProductPublishTarget } from "./canonicalProductPublishOperations";

export class BlankCoroplastOperationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export type BlankCoroplastProposal = {
  productId: string;
  productName: string;
  expectedProductUpdatedAt: string;
  expectedActiveTreeVersionId: string;
  fingerprint: string;
  before: BlankCoroplastPricing | null;
  after: BlankCoroplastPricing;
  examples: Array<{ dimensions: string; quantity: number; totalCents: number }>;
  hiddenPrintOnlyOptions: string[];
  warnings: Array<{ code: string; message: string }>;
  treeJson: OptionTreeV2;
};

export class CanonicalBlankCoroplastOperations {
  async propose(input: { organizationId: string; productId: string; pricing: unknown }): Promise<BlankCoroplastProposal> {
    const { db } = await import("../../db");
    const pricing = blankCoroplastPricingSchema.parse(input.pricing);
    const [product] = await db.select().from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    if (!product || !product.isActive || !product.pbv2ActiveTreeVersionId) throw new BlankCoroplastOperationError("PRODUCT_UNAVAILABLE", "Select an active Product with published PBV2 pricing.");
    if (!/\b(?:coroplast|corrugated\s+plastic)\b/i.test(product.name)) throw new BlankCoroplastOperationError("PRODUCT_NOT_COROPLAST", "Blank substrate pricing is currently supported for Coroplast Products only.");
    const [tree] = await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.productId, product.id), eq(pbv2TreeVersions.id, product.pbv2ActiveTreeVersionId), eq(pbv2TreeVersions.status, "ACTIVE"))).limit(1);
    if (!tree) throw new BlankCoroplastOperationError("PRODUCT_STALE", "The Product's active pricing version is unavailable. Reload it.");
    const previousTree = tree.treeJson as OptionTreeV2;
    const before = readBlankCoroplastPricing(previousTree);
    const treeJson = withBlankCoroplastPricing(previousTree, pricing);
    const materialIds = collectPbv2MaterialValidationIds({ treeJson, productPrimaryMaterialId: product.primaryMaterialId });
    const materialRows = materialIds.length
      ? await db.select({ id: materials.id, name: materials.name, sku: materials.sku, weightOzPerBasis: materials.weightOzPerBasis })
        .from(materials).where(and(eq(materials.organizationId, input.organizationId), inArray(materials.id, materialIds)))
      : [];
    const [formula] = product.pricingFormulaId
      ? await db.select({ id: pricingFormulas.id, isActive: pricingFormulas.isActive }).from(pricingFormulas)
        .where(and(eq(pricingFormulas.organizationId, input.organizationId), eq(pricingFormulas.id, product.pricingFormulaId))).limit(1)
      : [];
    const review = validateCanonicalProductPublishTarget({
      product: { id: product.id, organizationId: input.organizationId, name: product.name, isActive: product.isActive,
        primaryMaterialId: product.primaryMaterialId, pbv2ActiveTreeVersionId: tree.id, updatedAt: product.updatedAt,
        pricingEngine: product.pricingEngine, pricingFormulaId: product.pricingFormulaId },
      tree: { ...tree, status: "DRAFT", treeJson: { ...treeJson, status: "DRAFT" } },
      materials: materialRows, pricingFormula: formula ?? null,
    });
    if (review.errors.length) throw new BlankCoroplastOperationError("PRODUCT_SAVE_INVALID",
      `The Product configuration needs review: ${review.errors.map((finding) => finding.message).join(" ")}`);
    const warnings = review.warnings.map((finding) => ({ code: finding.code, message: finding.message }));
    const hiddenPrintOnlyOptions = Object.values(treeJson.nodes).filter((node) => node?.visibility?.rules?.some((rule) => rule.type === "notEquals" && rule.selectionKey === COROPLAST_PRINT_MODE_KEY && rule.value === "unprinted")).map((node) => node.label);
    const examples = [
      { widthIn: 12, heightIn: 12, quantity: 1 },
      { widthIn: 24, heightIn: 18, quantity: 10 },
    ].map((scenario) => {
      const preview = evaluatePricingPreviewFromTree({ treeJson, ...scenario,
        pbv2ExplicitSelections: { [COROPLAST_PRINT_MODE_KEY]: "unprinted", [COROPLAST_FLUTE_KEY]: "vertical" },
        pricingProfileKey: product.pricingProfileKey,
        pricingProfileConfig: product.pricingProfileConfig,
        measurementMode: product.measurementMode });
      return { dimensions: `${scenario.widthIn} × ${scenario.heightIn} in`, quantity: scenario.quantity, totalCents: Math.round(preview.totalPrice * 100) };
    });
    const fingerprint = createHash("sha256").update(JSON.stringify({ organizationId: input.organizationId, productId: product.id,
      productUpdatedAt: product.updatedAt.toISOString(), treeId: tree.id, treeUpdatedAt: tree.updatedAt.toISOString(), pricing, warnings })).digest("hex");
    return { productId: product.id, productName: product.name, expectedProductUpdatedAt: product.updatedAt.toISOString(),
      expectedActiveTreeVersionId: tree.id, fingerprint, before, after: pricing, examples, hiddenPrintOnlyOptions, warnings, treeJson };
  }

  async execute(input: { organizationId: string; productId: string; actorUserId: string; pricing: unknown; expectedFingerprint: string; operationId: string }) {
    const proposal = await this.propose(input);
    if (proposal.fingerprint !== input.expectedFingerprint) throw new BlankCoroplastOperationError("PRODUCT_STALE", "The Product changed after review. Prepare a fresh proposal.");
    const result = await saveActiveProductEditorConfiguration({ organizationId: input.organizationId, productId: input.productId,
      actorUserId: input.actorUserId,
      request: { expectedProductUpdatedAt: proposal.expectedProductUpdatedAt, expectedActiveTreeVersionId: proposal.expectedActiveTreeVersionId,
        product: {}, treeJson: proposal.treeJson, confirmWarnings: proposal.warnings.length > 0 },
      auditContext: { source: "assistant_go", reference: input.operationId, before: { blankCoroplastPricing: proposal.before }, after: { blankCoroplastPricing: proposal.after, examples: proposal.examples } },
    }).catch((error: unknown) => {
      if (error instanceof CanonicalProductEditorSaveError) {
        throw new BlankCoroplastOperationError(error.code === "PRODUCT_SAVE_STALE" ? "PRODUCT_STALE" : error.code, error.message);
      }
      throw error;
    });
    const database = (await import("../../db")).db;
    const [saved] = await database.select({ activeTreeVersionId: products.pbv2ActiveTreeVersionId }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    if (!saved || saved.activeTreeVersionId !== result.activeTreeVersionId) throw new BlankCoroplastOperationError("PRODUCT_READBACK_FAILED", "The Product changed before saved configuration could be verified.");
    const [savedTree] = await database.select({ treeJson: pbv2TreeVersions.treeJson }).from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.productId, input.productId), eq(pbv2TreeVersions.id, result.activeTreeVersionId))).limit(1);
    if (JSON.stringify(readBlankCoroplastPricing(savedTree?.treeJson)) !== JSON.stringify(proposal.after)) throw new BlankCoroplastOperationError("PRODUCT_READBACK_FAILED", "Saved blank pricing did not match the approved proposal.");
    return { ...proposal, resultingActiveTreeVersionId: result.activeTreeVersionId, unchanged: result.unchanged };
  }
}

export const canonicalBlankCoroplastOperations = new CanonicalBlankCoroplastOperations();
