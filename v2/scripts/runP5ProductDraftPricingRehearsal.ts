import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { PostgresProductDraftPricingPreview, PostgresProductDraftPricingReader, PostgresProductVersionTransactionRunner } from "../infrastructure/products/postgresProductVersionLifecycle.js";
import { PostgresProductsCompatibilityReader } from "../infrastructure/compatibility/postgresProductsRead.js";
import { ProductVersionLifecycleApplicationService } from "../src/modules/products/productVersionLifecycle.js";
import type { OperationContext } from "../src/application/operation.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";

const cloneHost = "ep-nameless-mud-aedtoak5-pooler.c-2.us-east-2.aws.neon.tech";
const requestId = (label: string) => `p5-pricing-${label}-${randomUUID()}`;
const context = (organizationId: string, userId: string, id: string, capabilities: readonly any[] = ["product.edit"]): OperationContext => ({ organizationId, operationId: id, businessRequest: { id, payloadFingerprint: id }, principal: { kind: "staff", organizationId, userId, authority: { membershipId: `p5-${organizationId}`, capabilities } } });
type Candidate = { organizationId: string; productId: string; name: string; activeId: string; draftId: string; measurementMode: "dimensions_required" | "quantity_only" };
const dimensions = (candidate: Candidate) => candidate.measurementMode === "dimensions_required" ? { width: 100, height: 100 } : {};

async function main() {
  const url = requireV2M0CloneDatabaseUrl(), parsed = new URL(url);
  assert.equal(parsed.hostname, cloneHost, "P5 rehearsal refuses a database other than the authorized DEV clone.");
  assert.equal(parsed.pathname.replace(/^\//u, ""), "neondb", "P5 rehearsal refuses a database other than neondb.");
  const pool = new Pool({ connectionString: url, max: 4 });
  try {
    await pool.query("SELECT 1");
    const actor = (await pool.query<{ id: string }>("SELECT id FROM users ORDER BY id LIMIT 1")).rows[0]?.id;
    assert(actor, "The authorized clone needs a Staff user.");
    const reader = new PostgresProductDraftPricingReader(pool), preview = new PostgresProductDraftPricingPreview(pool);
    const service = new ProductVersionLifecycleApplicationService(new PostgresProductVersionTransactionRunner(pool));
    const sales = new PostgresProductsCompatibilityReader(pool);
    const candidates = (await pool.query<Candidate>(`SELECT p.organization_id AS "organizationId",p.id AS "productId",p.name,a.id AS "activeId",d.id AS "draftId",p.measurement_mode AS "measurementMode" FROM products p JOIN pbv2_tree_versions a ON a.id=p.pbv2_active_tree_version_id AND a.status='ACTIVE' JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' WHERE p.is_active=TRUE ORDER BY d.updated_at,p.id LIMIT 250`)).rows;
    let candidate: Candidate | undefined, pricing: Awaited<ReturnType<typeof reader.read>>;
    for (const item of candidates) {
      const value = await reader.read(item.organizationId, item.productId);
      if (!value?.editable || (value.base.perPieceCents === null && value.base.perSqftCents === null)) continue;
      try { await preview.preview(item.organizationId, item.productId, { quantity: 1, ...dimensions(item) }); candidate = item; pricing = value; break; }
      catch { /* Existing compatibility defects are not P5 candidates. */ }
    }
    assert(candidate && pricing, "The authorized clone needs a simple editable Draft Price supported by the existing parity adapter for P5 rehearsal.");
    const beforeProduct = (await pool.query("SELECT name,category,description,measurement_mode,workflow_intent,requires_proof_approval,requires_production_job,pbv2_active_tree_version_id FROM products WHERE organization_id=$1 AND id=$2", [candidate.organizationId, candidate.productId])).rows[0];
    const beforeActive = (await pool.query<{ tree_json: unknown }>("SELECT tree_json FROM pbv2_tree_versions WHERE id=$1 AND organization_id=$2", [candidate.activeId, candidate.organizationId])).rows[0]!;
    const baseline = await preview.preview(candidate.organizationId, candidate.productId, { quantity: 1, ...dimensions(candidate) });
    const rateKey = pricing.base.perSqftCents !== null ? "perSqftCents" : "perPieceCents";
    const nextBase = { ...pricing.base, [rateKey]: (pricing.base[rateKey] ?? 0) + 101 };
    const id = requestId("draft-difference");
    const updateInput = { productId: candidate.productId, draftVersionId: pricing.draftVersionId, expectedDraftUpdatedAt: pricing.draftUpdatedAt, businessRequestId: id, base: nextBase, tierBasis: pricing.tierBasis, tiers: pricing.tiers };
    const updated = await service.updateDraftPricing(context(candidate.organizationId, actor, id), updateInput);
    assert(updated.ok, "Draft Pricing save failed.");
    const replay = await service.updateDraftPricing(context(candidate.organizationId, actor, id), updateInput);
    assert.deepEqual(replay, updated, "Exact Pricing request did not replay.");
    const changed = await preview.preview(candidate.organizationId, candidate.productId, { quantity: 1, ...dimensions(candidate) });
    assert.notEqual(changed.calculatedLineAmount.cents, baseline.calculatedLineAmount.cents, "Draft Preview did not use the changed Draft price.");
    const invalidId = requestId("invalid");
    const invalid = await service.updateDraftPricing(context(candidate.organizationId, actor, invalidId), { ...updateInput, businessRequestId: invalidId, expectedDraftUpdatedAt: updated.value.draftUpdatedAt, base: { ...nextBase, perPieceCents: 1, perSqftCents: 1 } });
    assert(!invalid.ok && invalid.error.code === "VALIDATION_ERROR", "Mixed simple pricing was accepted.");
    const staleId = requestId("stale");
    const stale = await service.updateDraftPricing(context(candidate.organizationId, actor, staleId), { ...updateInput, businessRequestId: staleId, base: pricing.base, expectedDraftUpdatedAt: pricing.draftUpdatedAt });
    assert(!stale.ok && stale.error.code === "STALE_STATE", "Stale Draft Pricing was accepted.");
    const deniedId = requestId("denied");
    const denied = await service.updateDraftPricing(context(candidate.organizationId, actor, deniedId, ["product.view"]), { ...updateInput, businessRequestId: deniedId, expectedDraftUpdatedAt: updated.value.draftUpdatedAt });
    assert(!denied.ok && denied.error.code === "FORBIDDEN", "Product view edited Draft Pricing.");
    const active = await sales.getActivePricingConfiguration(brandedId<"OrganizationId">(candidate.organizationId), brandedId<"ProductId">(candidate.productId));
    assert.equal(active?.id, candidate.activeId, "Normal Product resolution did not remain Active-only.");
    const other = (await pool.query<{ id: string }>("SELECT id FROM organizations WHERE id<>$1 LIMIT 1", [candidate.organizationId])).rows[0]?.id;
    assert(other, "The authorized clone needs a second organization.");
    assert.equal(await reader.read(other, candidate.productId), null, "Foreign tenant read Draft Pricing.");
    const afterProduct = (await pool.query("SELECT name,category,description,measurement_mode,workflow_intent,requires_proof_approval,requires_production_job,pbv2_active_tree_version_id FROM products WHERE organization_id=$1 AND id=$2", [candidate.organizationId, candidate.productId])).rows[0];
    const afterActive = (await pool.query<{ tree_json: unknown }>("SELECT tree_json FROM pbv2_tree_versions WHERE id=$1 AND organization_id=$2", [candidate.activeId, candidate.organizationId])).rows[0]!;
    assert.deepEqual(afterProduct, beforeProduct, "Pricing save changed the Product row.");
    assert.deepEqual(afterActive.tree_json, beforeActive.tree_json, "Pricing save changed the Active tree.");
    console.log(JSON.stringify({ product: candidate.name, draftPreviewBefore: baseline.calculatedLineAmount.cents, draftPreviewAfter: changed.calculatedLineAmount.cents, activeVersion: candidate.activeId, draftVersion: candidate.draftId }, null, 2));
    console.log("[p5] Product Draft Pricing clone rehearsal passed.");
  } finally { await pool.end(); }
}
void main().catch(error => { console.error(`[p5] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
