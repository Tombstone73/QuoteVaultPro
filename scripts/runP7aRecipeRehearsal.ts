import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { canonicalProductPublishOperations } from "../server/services/products/canonicalProductPublishOperations.js";
import { requireV2M0CloneDatabaseUrl } from "../v2/infrastructure/persistence/cloneSafety.js";
import { PostgresProductRecipeReader, PostgresProductRecipeTransactionRunner } from "../v2/infrastructure/products/postgresProductRecipes.js";
import { PostgresProductVersionTransactionRunner } from "../v2/infrastructure/products/postgresProductVersionLifecycle.js";
import { ProductRecipeApplicationService } from "../v2/src/modules/products/productRecipes.js";
import { ProductVersionLifecycleApplicationService } from "../v2/src/modules/products/productVersionLifecycle.js";
import type { OperationContext } from "../v2/src/application/operation.js";

const cloneHost = "ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech";
const request = (label: string): string => `p7a-recipe-${label}-${randomUUID()}`;
const componentDefinitions = (components: readonly { materialId: string; materialName: string; materialSku: string | null; quantity: string; unit: string; quantityKind: string }[]) =>
  components.map(({ materialId, materialName, materialSku, quantity, unit, quantityKind }) => ({ materialId, materialName, materialSku, quantity, unit, quantityKind }));
const context = (organizationId: string, userId: string, requestId: string, capabilities: readonly string[] = ["product.edit"]): OperationContext => ({
  organizationId,
  operationId: requestId,
  businessRequest: { id: requestId, payloadFingerprint: requestId },
  principal: { kind: "staff", organizationId, userId, authority: { membershipId: `p7a-${organizationId}`, capabilities: capabilities as any } },
});

type Candidate = {
  organizationId: string;
  productId: string;
  productName: string;
  activeId: string;
  activeUpdatedAt: Date;
  primaryMaterialId: string;
  secondaryMaterialId: string;
};

const main = async (): Promise<void> => {
  const url = requireV2M0CloneDatabaseUrl();
  const target = new URL(url);
  assert.equal(target.hostname, cloneHost, "P7A rehearsal refuses a database other than the authorized MAIN-derived DEV clone.");
  assert.equal(target.pathname.replace(/^\//u, ""), "neondb", "P7A rehearsal refuses a database other than neondb.");

  // The canonical V1 publisher is deliberately exercised below. Its established
  // repository reads DATABASE_URL, but this child process has already passed the
  // no-fallback clone gate and receives that exact guarded clone URL only.
  process.env.DATABASE_URL = url;
  const pool = new Pool({ connectionString: url, max: 4 });
  try {
    const relations = (await pool.query<{ recipes: string | null; components: string | null; audit: string | null }>(
      "SELECT to_regclass('public.v2_product_recipes') recipes,to_regclass('public.v2_product_recipe_components') components,to_regclass('public.v2_audit_events') audit",
    )).rows[0]!;
    assert(relations.recipes && relations.components && relations.audit, "P7A setup is incomplete: the authorized clone is missing recipe/audit relations.");
    const actor = (await pool.query<{ id: string }>("SELECT id FROM users ORDER BY id LIMIT 1")).rows[0]?.id;
    assert(actor, "The authorized clone needs a Staff user.");

    const candidates = (await pool.query<Candidate>(`
      SELECT p.organization_id AS "organizationId",p.id AS "productId",p.name AS "productName",
        a.id AS "activeId",a.updated_at AS "activeUpdatedAt",p.primary_material_id AS "primaryMaterialId",
        (SELECT m.id FROM materials m WHERE m.organization_id=p.organization_id AND m.is_active=TRUE
          AND m.id<>p.primary_material_id ORDER BY m.id LIMIT 1) AS "secondaryMaterialId"
      FROM products p
      JOIN pbv2_tree_versions a ON a.id=p.pbv2_active_tree_version_id AND a.status='ACTIVE'
      WHERE p.is_active=TRUE AND p.primary_material_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM pbv2_tree_versions d WHERE d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT')
      ORDER BY p.id`)).rows;
    let candidate: Candidate | undefined;
    for (const item of candidates) {
      if (!item.secondaryMaterialId) continue;
      try {
        await canonicalProductPublishOperations.propose({ organizationId: item.organizationId, treeVersionId: item.activeId });
        candidate = item;
        break;
      } catch {
        // This is a representative-selection issue, not a reason to weaken a
        // real Product's existing publish validation. Try the next real Product.
      }
    }
    assert(candidate, "The authorized clone has no real publishable Product with two active Materials and no existing Draft.");

    const lifecycle = new ProductVersionLifecycleApplicationService(new PostgresProductVersionTransactionRunner(pool));
    const recipes = new ProductRecipeApplicationService(new PostgresProductRecipeTransactionRunner(pool));
    const reader = new PostgresProductRecipeReader(pool);
    const commercialBefore = (await pool.query<{ documents: string; lines: string }>(
      `SELECT count(DISTINCT d.id)::text documents,count(l.id)::text lines
       FROM v2_sales_documents d LEFT JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id AND l.product_id=$2
       WHERE d.organization_id=$1`,
      [candidate.organizationId, candidate.productId],
    )).rows[0]!;

    const createAId = request("create-a");
    const draftA = await lifecycle.createDraft(context(candidate.organizationId, actor, createAId), {
      productId: candidate.productId,
      businessRequestId: createAId,
      expectedActiveVersionUpdatedAt: candidate.activeUpdatedAt.toISOString(),
    });
    assert(draftA.ok, "P7A could not create the first Product Draft.");
    const preparedDraftA = (await pool.query<{ id: string; status: string; updated_at: Date }>(
      "SELECT id,status,updated_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='DRAFT' ORDER BY updated_at DESC,id DESC LIMIT 1",
      [candidate.organizationId, candidate.productId],
    )).rows[0];
    assert.equal(preparedDraftA?.status, "DRAFT", `P7A Draft preparation returned a non-DRAFT version (${preparedDraftA?.status ?? "missing"}).`);
    const savedAId = request("save-a");
    const recipeA = await recipes.updateDraftRecipe(context(candidate.organizationId, actor, savedAId), {
      productId: candidate.productId,
      draftVersionId: preparedDraftA!.id,
      expectedDraftUpdatedAt: preparedDraftA!.updated_at.toISOString(),
      businessRequestId: savedAId,
      components: [{ materialId: candidate.primaryMaterialId, quantity: "1.000000", unit: "sheet" }],
    });
    assert(recipeA.ok, `P7A could not save Recipe A to the first Draft: ${recipeA.ok ? "" : `${recipeA.error.code} ${recipeA.error.publicMessage}`}`);

    const publishA = await canonicalProductPublishOperations.propose({ organizationId: candidate.organizationId, treeVersionId: preparedDraftA!.id });
    await canonicalProductPublishOperations.execute({
      organizationId: candidate.organizationId, actorUserId: actor, productId: candidate.productId,
      treeVersionId: preparedDraftA!.id, expectedProductUpdatedAt: publishA.expectedProductUpdatedAt,
      expectedTreeUpdatedAt: publishA.expectedTreeUpdatedAt, confirmWarnings: true,
      auditContext: { source: "assistant_go", reference: `p7a-rehearsal:${preparedDraftA!.id}` },
    });
    const activeA = await reader.read(candidate.organizationId, candidate.productId, preparedDraftA!.id);
    assert(activeA && activeA.lifecycle === "active" && activeA.components.length === 1, "Publishing Recipe A did not retain the version-bound recipe.");

    const current = (await pool.query<{ active_id: string; active_updated_at: Date }>(
      "SELECT p.pbv2_active_tree_version_id active_id,a.updated_at active_updated_at FROM products p JOIN pbv2_tree_versions a ON a.id=p.pbv2_active_tree_version_id WHERE p.organization_id=$1 AND p.id=$2",
      [candidate.organizationId, candidate.productId],
    )).rows[0]!;
    const createBId = request("create-b");
    const draftB = await lifecycle.createDraft(context(candidate.organizationId, actor, createBId), {
      productId: candidate.productId, businessRequestId: createBId,
      expectedActiveVersionUpdatedAt: current.active_updated_at.toISOString(),
    });
    assert(draftB.ok, "P7A could not create the second Product Draft.");
    const preparedDraftB = (await pool.query<{ id: string; updated_at: Date }>(
      "SELECT id,updated_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='DRAFT' ORDER BY updated_at DESC,id DESC LIMIT 1",
      [candidate.organizationId, candidate.productId],
    )).rows[0];
    assert(preparedDraftB, "P7A second Draft creation did not persist a Draft version.");
    const inherited = await reader.read(candidate.organizationId, candidate.productId, preparedDraftB.id);
    assert.deepEqual(componentDefinitions(inherited?.components ?? []), componentDefinitions(activeA.components), "New Draft did not inherit the active version's immutable recipe definition.");

    const saveBId = request("save-b");
    const recipeB = await recipes.updateDraftRecipe(context(candidate.organizationId, actor, saveBId), {
      productId: candidate.productId, draftVersionId: preparedDraftB.id,
      expectedDraftUpdatedAt: inherited!.draftUpdatedAt, businessRequestId: saveBId,
      components: [
        { componentId: inherited!.components[0]!.componentId, materialId: candidate.primaryMaterialId, quantity: "1.000000", unit: "sheet" },
        { materialId: candidate.secondaryMaterialId, quantity: "2", unit: "each" },
      ],
    });
    assert(recipeB.ok && recipeB.value.components.length === 2, "P7A could not replace the Draft recipe with Recipe B.");
    assert.equal(recipeB.value.components[0]?.componentId, inherited!.components[0]?.componentId, "Draft recipe edit changed a retained component identity.");
    assert.deepEqual((await reader.read(candidate.organizationId, candidate.productId, current.active_id))?.components, activeA.components, "Draft Recipe B altered Active Recipe A.");

    const activeMutationId = request("active-rejected");
    const activeMutation = await recipes.updateDraftRecipe(context(candidate.organizationId, actor, activeMutationId), {
      productId: candidate.productId, draftVersionId: current.active_id,
      expectedDraftUpdatedAt: activeA.draftUpdatedAt, businessRequestId: activeMutationId,
      components: [],
    });
    assert(!activeMutation.ok && activeMutation.error.code === "CONFLICT", "An ACTIVE recipe was editable.");
    const rollbackId = request("rollback");
    const invalid = await recipes.updateDraftRecipe(context(candidate.organizationId, actor, rollbackId), {
      productId: candidate.productId, draftVersionId: preparedDraftB.id,
      expectedDraftUpdatedAt: recipeB.value.draftUpdatedAt, businessRequestId: rollbackId,
      components: [{ materialId: "missing-material", quantity: "1", unit: "each" }],
    });
    assert(!invalid.ok && invalid.error.code === "VALIDATION_ERROR", "Invalid Material references were accepted.");
    assert.deepEqual((await reader.read(candidate.organizationId, candidate.productId, preparedDraftB.id))?.components, recipeB.value.components, "Failed recipe update left a partial Draft recipe.");

    const materialBefore = (await pool.query<{ name: string }>("SELECT name FROM materials WHERE organization_id=$1 AND id=$2", [candidate.organizationId, candidate.primaryMaterialId])).rows[0]!;
    await pool.query("UPDATE materials SET name=$1 WHERE organization_id=$2 AND id=$3", [`${materialBefore.name} [P7A check]`, candidate.organizationId, candidate.primaryMaterialId]);
    assert.equal((await reader.read(candidate.organizationId, candidate.productId, current.active_id))?.components[0]?.materialName, activeA.components[0]?.materialName, "Mutable Material metadata changed a historical recipe snapshot.");
    await pool.query("UPDATE materials SET name=$1 WHERE organization_id=$2 AND id=$3", [materialBefore.name, candidate.organizationId, candidate.primaryMaterialId]);

    const publishB = await canonicalProductPublishOperations.propose({ organizationId: candidate.organizationId, treeVersionId: preparedDraftB.id });
    await canonicalProductPublishOperations.execute({
      organizationId: candidate.organizationId, actorUserId: actor, productId: candidate.productId,
      treeVersionId: preparedDraftB.id, expectedProductUpdatedAt: publishB.expectedProductUpdatedAt,
      expectedTreeUpdatedAt: publishB.expectedTreeUpdatedAt, confirmWarnings: true,
      auditContext: { source: "assistant_go", reference: `p7a-rehearsal:${preparedDraftB.id}` },
    });
    const oldRecipe = await reader.read(candidate.organizationId, candidate.productId, current.active_id);
    const nextRecipe = await reader.read(candidate.organizationId, candidate.productId, preparedDraftB.id);
    assert.deepEqual(oldRecipe?.components, activeA.components, "Previous Product Version recipe changed after publishing Recipe B.");
    assert.deepEqual(nextRecipe?.components, recipeB.value.components, "New Active Product Version did not retain Recipe B.");
    const foreignOrganization = (await pool.query<{ id: string }>("SELECT id FROM organizations WHERE id<>$1 ORDER BY id LIMIT 1", [candidate.organizationId])).rows[0]?.id;
    assert(foreignOrganization, "The authorized clone needs a second organization for tenant isolation.");
    assert.equal(await reader.read(foreignOrganization, candidate.productId, preparedDraftB.id), null, "Foreign tenant read a Product recipe.");
    const commercialAfter = (await pool.query<{ documents: string; lines: string }>(
      `SELECT count(DISTINCT d.id)::text documents,count(l.id)::text lines
       FROM v2_sales_documents d LEFT JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id AND l.product_id=$2
       WHERE d.organization_id=$1`,
      [candidate.organizationId, candidate.productId],
    )).rows[0]!;
    assert.deepEqual(commercialAfter, commercialBefore, "P7A recipe rehearsal changed Quote or Order history.");
    const orphaned = (await pool.query<{ count: string }>(
      "SELECT count(*)::text count FROM v2_product_recipe_components c LEFT JOIN v2_product_recipes r ON r.id=c.recipe_id WHERE r.id IS NULL",
    )).rows[0]!;
    assert.equal(orphaned.count, "0", "P7A left orphaned recipe components.");
    console.log(JSON.stringify({ product: candidate.productName, recipeAComponents: activeA.components.length, recipeBComponents: recipeB.value.components.length, activeA: current.active_id, activeB: preparedDraftB.id }, null, 2));
    console.log("[p7a] Draft-safe recipe clone rehearsal passed.");
  } finally {
    await pool.end();
  }
};

void main().catch((error: unknown) => {
  console.error(`[p7a] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
