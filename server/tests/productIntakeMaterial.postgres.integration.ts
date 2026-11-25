import { afterAll, beforeAll, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  materialProductLinks, materials, organizations, pbv2TreeVersions, productIntakeAnswers,
  productIntakeQuestions, productIntakeSessions, products, productTypes, users,
} from "@shared/schema";
import type { ProductIntakeBrief } from "@shared/productIntakeWizardSchemas";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { db, pool } from "../db";
import { registerProductRoutes } from "../routes/products.routes";
import { createDbProductIntakeDraftCreator } from "../services/productIntakeWizard/productIntakeDraftService";
import { createDbProductIntakeDraftReviewService } from "../services/productIntakeWizard/productIntakeDraftReviewService";
import { evaluatePricingPreviewFromTree } from "../services/pricing/PricingService";

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const userId = randomUUID();
const productTypeId = randomUUID();
const clipId = randomUUID();
const otherMaterialId = randomUUID();
const inactiveMaterialId = randomUUID();
const clipName = "Clear Adhesive Shelf Clip Stock";
const actualProductName = "Clear Adhesive Shelf Clip - PVC Sign/Tag Holder, 1in x 0.5in POP Display";
const draftReviews = createDbProductIntakeDraftReviewService();
const app = express();
app.use(express.json());
const auth: express.RequestHandler = (req, _res, next) => {
  Object.assign(req, { organizationId, user: { id: userId, role: "admin" } });
  next();
};
registerProductRoutes(app, { isAuthenticated: auth, tenantContext: auth, isAdmin: auth, isAdminOrOwner: auth, requireOrgOwnerAdmin: auth });

beforeAll(async () => {
  await db.insert(organizations).values([organizationId, otherOrganizationId].map((id) => ({ id, name: "Synthetic intake tenant", slug: id })));
  await db.insert(users).values({ id: userId, email: `${userId}@example.invalid`, role: "admin" });
  await db.insert(productTypes).values({ id: productTypeId, organizationId, name: "Fulfillment Items", sendToProductionDefault: false, requiresPrepressOverride: false });
  await db.insert(materials).values([
    { id: clipId, organizationId, name: clipName, sku: "QA-CLIP", isActive: true },
    { id: otherMaterialId, organizationId: otherOrganizationId, name: "Other tenant shelf clip", sku: "FOREIGN-CLIP", isActive: true },
    { id: inactiveMaterialId, organizationId, name: "Retired shelf clip", sku: "OLD-CLIP", isActive: false },
  ].map((row) => ({ ...row, type: "consumable", materialForm: "each" as const,
    inventoryUnit: "each", consumptionUnit: "each", costPerUnit: "0.1200", weightOzPerBasis: null })));
});

afterAll(async () => { await pool.end(); });

async function fixture(options: { confirmMaterialId?: string; candidateId?: string } = {}) {
  const fact = (value: string) => ({ value, confidence: 90, evidence: [] });
  const brief: ProductIntakeBrief = {
    workflowState: "REVIEW_READY", source: "live_ai", fallbackReason: null, overallConfidence: 80,
    productIdentity: { likelyProductName: fact("PVC Signs"), category: fact("Hardware"), productType: fact("Fulfillment Items") },
    materialAnalysis: {
      detectedMaterialReferences: ["PVC"],
      likelyMaterialMatches: [{ materialId: options.candidateId ?? clipId, sku: "QA-CLIP", name: clipName, confidence: 55, evidence: [] }],
      confidence: 55, evidence: [],
    },
    materialSelection: "auto", workflowIntent: "fulfillment_only",
    requiresProductionJob: false, requiresProofApproval: false,
    sizeBehavior: { behavior: "none", confidence: 90, evidence: [] },
    quantityBehavior: { behavior: "quantity_based", confidence: 90, evidence: [] },
    pricingAnalysis: { behavior: "per_piece", confidence: 90, evidence: [] },
    requiredOptions: [], optionalOptions: [], templateMatches: [], redundantFields: [], sourceEvidence: [],
    draftWarnings: [{ code: "material_unresolved", message: "Material association required.", severity: "warning", evidence: [] }],
    missingDecisions: [{ id: "select-material", question: "Which material should this product use?", reason: "55% match.", severity: "review", evidence: [] }],
  };
  const sessionId = randomUUID();
  await db.insert(productIntakeSessions).values({
    id: sessionId, organizationId, sourceType: "text_description", status: "ready_for_draft",
    sourceText: "PVC Signs. Quantity only. Fulfillment item. No production job or proof approval.",
    aiBriefJson: brief, createdByUserId: userId, updatedByUserId: userId,
  });
  if (options.confirmMaterialId) {
    const [question] = await db.insert(productIntakeQuestions).values({
      organizationId, sessionId, questionKey: "select-material", questionType: "select", label: "Primary Material",
    }).returning();
    await db.insert(productIntakeAnswers).values({
      organizationId, sessionId, questionId: question.id, questionKey: question.questionKey,
      answerJson: options.confirmMaterialId, answeredByUserId: userId,
    });
  }
  const { productId, pbv2TreeVersionId } = await createDbProductIntakeDraftCreator().createDraftFromSession({ organizationId, sessionId, userId });
  const read = () => draftReviews.getDraftReview({ organizationId, sessionId });
  const link = () => draftReviews.getDraftLinkForProduct({ organizationId, productId });
  const activate = () => draftReviews.activateProduct({ organizationId, sessionId, userId });
  return { sessionId, productId, pbv2TreeVersionId, read, link, activate };
}

test("renaming and saving an existing Material in Product Editor clears the false intake blocker and permits explicit publish and activation", async () => {
  const draft = await fixture();
  const initial = await draft.read();
  expect(initial.product).toMatchObject({ name: "PVC Signs", productTypeName: "Fulfillment Items", workflowIntent: "fulfillment_only",
    measurementMode: "quantity_only", requiresProductionJob: false, primaryMaterialId: null, isActive: false });
  expect(initial.intake.materialCandidates[0].confidence).toBe(55);
  expect((await draft.link())?.materialAssociationRequired).toBe(true);
  await expect(draft.activate()).rejects.toMatchObject({ errorCode: "PBV2_ACTIVATION_BLOCKED" });
  const productPath = `/api/products/${draft.productId}`;
  for (const rejectedId of [otherMaterialId, inactiveMaterialId, randomUUID()]) {
    const rejected = await request(app).patch(productPath).send({ primaryMaterialId: rejectedId });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect((await draft.read()).product.primaryMaterialId).toBeNull();
  }
  const patch = { name: actualProductName, shopName: "Shelf Clip", description: "Purchased hardware", primaryMaterialId: clipId };
  expect((await request(app).patch(productPath).send(patch)).status).toBe(200);
  expect((await request(app).patch(productPath).send({ primaryMaterialId: clipId })).status).toBe(200);
  const freshProduct = await request(app).get(productPath);
  expect(freshProduct.body).toMatchObject({ ...patch, isActive: false, requiresProductionJob: false, requiresProofApproval: false });
  const fresh = await draft.read();
  expect(fresh.intake).toMatchObject({ productName: "PVC Signs", materialAssociationRequired: false, materialMatchStatus: "resolved",
    warnings: [], unansweredDecisions: [] });
  expect(fresh.product.primaryMaterialName).toBe(clipName);
  expect(fresh.publishReadiness.materialLinked).toBe(true);
  expect((await draft.link())?.intakeWarnings).toEqual([]);
  expect(await db.select().from(materialProductLinks).where(eq(materialProductLinks.productId, draft.productId))).toEqual([]);

  await draftReviews.updateDraftPricing({ organizationId, sessionId: draft.sessionId, userId,
    base: { perSqftCents: 0, perPieceCents: 29, minimumChargeCents: 0 } });
  const [tree] = await db.select().from(pbv2TreeVersions).where(eq(pbv2TreeVersions.id, draft.pbv2TreeVersionId));
  const quantityTree = { ...tree.treeJson, meta: { ...tree.treeJson.meta,
    pricingFormula: "q * unitPrice", shippingConfig: { shippingPolicy: "pickup_only", baseWeight: null } } };
  await db.update(pbv2TreeVersions).set({ treeJson: quantityTree }).where(eq(pbv2TreeVersions.id, tree.id));
  const pricing = evaluatePricingPreviewFromTree({
    treeJson: quantityTree, quantity: 100, widthIn: 0, heightIn: 0, pricingProfileKey: "qty_only", measurementMode: "quantity_only", debug: true,
  });
  expect(pricing).toMatchObject({ unitPrice: 0.29, totalPrice: 29 });
  expect(pricing.debug?.errors?.map((finding) => finding.code)).not.toContain("PBV2_QTY_ONLY_IGNORED_NON_QUANTITY_FORMULA");
  const staleFormula = evaluatePricingPreviewFromTree({
    treeJson: { ...quantityTree, meta: { ...quantityTree.meta, pricingFormula: "total_sqft * p" } },
    quantity: 100, widthIn: 0, heightIn: 0, pricingProfileKey: "qty_only", measurementMode: "quantity_only", debug: true,
  });
  expect(staleFormula.totalPrice).toBe(29);
  expect(staleFormula.debug?.errors?.map((finding) => finding.code)).toContain("PBV2_QTY_ONLY_IGNORED_NON_QUANTITY_FORMULA");
  const ready = await draft.read();
  expect(ready.publishReadiness).toMatchObject({ validationStatus: "ready", pricingConfigured: true, materialLinked: true });
  const shippable = { ...quantityTree, meta: { ...quantityTree.meta, shippingConfig: { shippingPolicy: "shippable_estimate" } } };
  expect(validateTreeForPublish(shippable, DEFAULT_VALIDATE_OPTS).warnings.map((finding) => finding.code))
    .toContain("PBV2_W_WEIGHT_MISSING");
  await expect(draft.activate()).rejects.toMatchObject({ errorCode: "PBV2_NOT_PUBLISHED" });
  const published = await request(app).post(`/api/pbv2/tree-versions/${tree.id}/publish`).send({});
  expect(published.status).toBe(200);
  expect(published.body.requiresWarningsConfirm).toBeUndefined();
  expect((await draft.read()).product).toMatchObject({ isActive: false, pbv2ActiveTreeVersionId: tree.id });
  await db.update(materials).set({ isActive: false }).where(eq(materials.id, clipId));
  await expect(draft.activate()).rejects.toMatchObject({ errorCode: "PBV2_ACTIVATION_BLOCKED", message: expect.stringContaining("active Primary Material") });
  expect((await draft.read()).product.isActive).toBe(false);
  await db.update(materials).set({ isActive: true }).where(eq(materials.id, clipId));
  await expect(draft.activate()).resolves.toMatchObject({ productId: draft.productId, isActive: true });
  expect((await draft.read()).product).toMatchObject({ name: actualProductName, primaryMaterialId: clipId, isActive: true });
  const [material] = await db.select().from(materials).where(eq(materials.id, clipId));
  expect(material).toMatchObject({ costPerUnit: "0.1200", weightOzPerBasis: null });
  const ownMaterials = await db.select().from(materials).where(eq(materials.organizationId, organizationId));
  expect(ownMaterials).toHaveLength(2);
});

test("intake honors a confirmed stable Material ID and never links a foreign tenant's candidate", async () => {
  const confirmed = await fixture({ confirmMaterialId: clipId });
  expect((await confirmed.read()).product.primaryMaterialId).toBe(clipId);
  expect((await confirmed.link())?.materialAssociationRequired).toBe(false);
  await expect(createDbProductIntakeDraftCreator().createDraftFromSession({ organizationId, sessionId: confirmed.sessionId, userId }))
    .rejects.toMatchObject({ errorCode: "INTAKE_DRAFT_ALREADY_CREATED" });
  const foreign = await fixture({ candidateId: otherMaterialId, confirmMaterialId: otherMaterialId });
  expect((await foreign.read()).product.primaryMaterialId).toBeNull();
  expect((await foreign.link())?.materialAssociationRequired).toBe(true);
  expect(await draftReviews.getDraftLinkForProduct({ organizationId: otherOrganizationId, productId: confirmed.productId })).toBeNull();
  const generated = await db.select().from(products).where(and(eq(products.organizationId, organizationId), eq(products.id, confirmed.productId)));
  expect(generated).toHaveLength(1);
});
