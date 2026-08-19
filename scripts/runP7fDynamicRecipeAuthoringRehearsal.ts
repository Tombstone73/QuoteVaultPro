import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { canonicalProductPublishOperations } from "../server/services/products/canonicalProductPublishOperations.js";
import { requireV2M0CloneDatabaseUrl } from "../v2/infrastructure/persistence/cloneSafety.js";
import { PostgresProductRecipeReader, PostgresProductRecipeTransactionRunner } from "../v2/infrastructure/products/postgresProductRecipes.js";
import { PostgresProductVersionTransactionRunner } from "../v2/infrastructure/products/postgresProductVersionLifecycle.js";
import { resolveMaterialRequirements, type MaterialRequirementMaterial } from "../v2/src/modules/materials/materialRequirementResolver.js";
import { ProductRecipeApplicationService } from "../v2/src/modules/products/productRecipes.js";
import { ProductVersionLifecycleApplicationService } from "../v2/src/modules/products/productVersionLifecycle.js";
import type { OperationContext } from "../v2/src/application/operation.js";
import type { OptionTreeV2 } from "../shared/optionTreeV2.js";

const cloneHost = "ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech";
const request = (label: string) => `p7f-${label}-${randomUUID()}`;
const context = (organizationId: string, userId: string, id: string): OperationContext => ({ organizationId, operationId: id, businessRequest: { id, payloadFingerprint: id }, principal: { kind: "staff", organizationId, userId, authority: { membershipId: `p7f-${organizationId}`, capabilities: ["product.edit"] as any } } });
type Candidate = { organizationId: string; productId: string; productName: string; activeId: string; activeUpdatedAt: Date; tree: OptionTreeV2; rollId: string; sheetId: string };
const choice = (tree: OptionTreeV2): { optionId: string; selectionKey: string; choiceValue: string } | null => {
  const nodes = tree.nodes && typeof tree.nodes === "object" ? Object.values(tree.nodes as Record<string, any>) : [];
  for (const node of nodes) {
    const selected = Array.isArray(node?.choices) ? node.choices.find((item: any) => typeof item?.value === "string" && item.value) : null;
    if (typeof node?.id === "string" && selected) return { optionId: node.id, selectionKey: typeof node.input?.selectionKey === "string" ? node.input.selectionKey : node.id, choiceValue: selected.value };
  }
  return null;
};

const main = async () => {
  const url = requireV2M0CloneDatabaseUrl(), target = new URL(url);
  assert.equal(target.hostname, cloneHost, "P7F refuses a target other than the authorized MAIN-derived clone.");
  assert.equal(target.pathname.replace(/^\//u, ""), "neondb", "P7F refuses a database other than neondb.");
  process.env.DATABASE_URL = url;
  const pool = new Pool({ connectionString: url, max: 4, application_name: "p7f-dynamic-recipe-authoring" });
  try {
    const actor = (await pool.query<{ id: string }>("SELECT id FROM users ORDER BY id LIMIT 1")).rows[0]?.id;
    assert(actor, "P7F needs a staff actor.");
    const rows = (await pool.query<any>(`SELECT p.organization_id,p.id product_id,p.name product_name,a.id active_id,a.updated_at active_updated_at,a.tree_json,
      (SELECT id FROM materials m WHERE m.organization_id=p.organization_id AND m.is_active AND m.material_form='roll' AND m.inventory_unit='square_foot' ORDER BY id LIMIT 1) roll_id,
      (SELECT id FROM materials m WHERE m.organization_id=p.organization_id AND m.is_active AND m.material_form='sheet' AND m.inventory_unit='sheet' AND m.consumption_unit='square_foot' ORDER BY id LIMIT 1) sheet_id
      FROM products p JOIN pbv2_tree_versions a ON a.id=p.pbv2_active_tree_version_id AND a.status='ACTIVE'
      WHERE p.is_active AND p.measurement_mode='dimensions_required'
        AND NOT EXISTS(SELECT 1 FROM pbv2_tree_versions d WHERE d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT') ORDER BY p.id`)).rows;
    let candidate: Candidate | undefined, applicability: ReturnType<typeof choice>;
    for (const row of rows) {
      const tree = row.tree_json as OptionTreeV2, selected = choice(tree);
      if (!row.roll_id || !row.sheet_id || !selected) continue;
      try { await canonicalProductPublishOperations.propose({ organizationId: row.organization_id, treeVersionId: row.active_id }); candidate = { organizationId: row.organization_id, productId: row.product_id, productName: row.product_name, activeId: row.active_id, activeUpdatedAt: row.active_updated_at, tree, rollId: row.roll_id, sheetId: row.sheet_id }; applicability = selected; break; } catch { /* select another real publishable product */ }
    }
    assert(candidate && applicability, "P7F found no real publishable dimensions Product with a stable option and normalized roll/sheet Materials.");
    const lifecycle = new ProductVersionLifecycleApplicationService(new PostgresProductVersionTransactionRunner(pool));
    const recipes = new ProductRecipeApplicationService(new PostgresProductRecipeTransactionRunner(pool));
    const reader = new PostgresProductRecipeReader(pool);
    const original = await reader.read(candidate.organizationId, candidate.productId, candidate.activeId);
    const createId = request("draft");
    const created = await lifecycle.createDraft(context(candidate.organizationId, actor, createId), { productId: candidate.productId, businessRequestId: createId, expectedActiveVersionUpdatedAt: candidate.activeUpdatedAt.toISOString() });
    assert(created.ok, "P7F could not create a Draft from the real ACTIVE Product.");
    const draft = (await pool.query<{ id: string; updated_at: Date }>("SELECT id,updated_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='DRAFT'", [candidate.organizationId, candidate.productId])).rows[0]!;
    const saveId = request("save");
    const saveCommand = { productId: candidate.productId, draftVersionId: draft.id, expectedDraftUpdatedAt: draft.updated_at.toISOString(), businessRequestId: saveId, components: [
      { materialId: candidate.rollId, quantity: "1", unit: "square_foot", quantityKind: "per_area", condition: { type: "selected", optionId: applicability.optionId, choiceValue: applicability.choiceValue }, replacesPbv2Compatibility: true },
      { materialId: candidate.sheetId, quantity: "1", unit: "square_foot", quantityKind: "per_area" },
    ] } as const;
    const saved = await recipes.updateDraftRecipe(context(candidate.organizationId, actor, saveId), saveCommand);
    assert(saved.ok, `P7F could not save dynamic Draft recipe: ${saved.ok ? "" : saved.error.publicMessage}`);
    assert.deepEqual(await reader.read(candidate.organizationId, candidate.productId, candidate.activeId), original, "P7F dynamic Draft edit changed ACTIVE recipe state.");
    const replay = await recipes.updateDraftRecipe(context(candidate.organizationId, actor, saveId), saveCommand);
    assert(replay.ok && replay.value.components.length === 2, "P7F exact recipe replay was not idempotent.");
    const materials = (await pool.query<MaterialRequirementMaterial>(`SELECT id,name,sku,material_form AS "materialForm",inventory_unit AS "inventoryUnit",consumption_unit AS "consumptionUnit",width,height,roll_length_ft AS "rollLengthFt",edge_waste_in_per_side AS "edgeWasteInPerSide",lead_waste_ft AS "leadWasteFt",tail_waste_ft AS "tailWasteFt" FROM materials WHERE organization_id=$1 AND id=ANY($2::varchar[])`, [candidate.organizationId, [candidate.rollId, candidate.sheetId]])).rows;
    const resolved = resolveMaterialRequirements(saved.value, { productId: candidate.productId, lineId: "p7f-line", quantity: 2, resolvedConfiguration: { pricingConfigurationId: draft.id as any, productId: candidate.productId as any, selections: { [applicability.selectionKey]: applicability.choiceValue }, dimensions: { width: "24", height: "36", unit: "in" } } } as any, { tree: candidate.tree, materials });
    assert(resolved.some((item) => item.recipeComponentId === saved.value.components[0]?.componentId && item.quantity === "12"), "P7F authored conditional area rule did not resolve 12 sqft for 24x36x2.");
    assert(resolved.some((item) => item.recipeComponentId === saved.value.components[1]?.componentId && item.unit === "sheet" && Number(item.quantity) > 0), "P7F authored sheet-normalized rule did not resolve physical sheets.");
    const proposal = await canonicalProductPublishOperations.propose({ organizationId: candidate.organizationId, treeVersionId: draft.id });
    await canonicalProductPublishOperations.execute({ organizationId: candidate.organizationId, actorUserId: actor, productId: candidate.productId, treeVersionId: draft.id, expectedProductUpdatedAt: proposal.expectedProductUpdatedAt, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt, confirmWarnings: true, auditContext: { source: "p7f_rehearsal", reference: draft.id } });
    const published = await reader.read(candidate.organizationId, candidate.productId, draft.id);
    assert.deepEqual(published?.components, saved.value.components, "P7F publication did not retain the immutable dynamic recipe.");
    const afterPublish = (await pool.query<{ updated_at: Date }>("SELECT updated_at FROM pbv2_tree_versions WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'", [candidate.organizationId, draft.id])).rows[0]!;
    const copyId = request("copy");
    const copiedDraft = await lifecycle.createDraft(context(candidate.organizationId, actor, copyId), { productId: candidate.productId, businessRequestId: copyId, expectedActiveVersionUpdatedAt: afterPublish.updated_at.toISOString() });
    assert(copiedDraft.ok, "P7F could not create a second Draft from the published dynamic recipe.");
    const copiedVersion = (await pool.query<{ id: string }>("SELECT id FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='DRAFT'", [candidate.organizationId, candidate.productId])).rows[0]!;
    const comparable = (components: readonly any[]) => components.map(({ componentId, ...component }) => component);
    assert.deepEqual(comparable((await reader.read(candidate.organizationId, candidate.productId, copiedVersion.id))?.components ?? []), comparable(published?.components ?? []), "P7F Draft copy lost dynamic component condition or dimensional metadata.");
    console.log(JSON.stringify({ product: candidate.productName, version: draft.id, areaSqft: "12", sheetRequirement: resolved.find((item) => item.recipeComponentId === saved.value.components[1]?.componentId)?.quantity, components: published?.components.length }, null, 2));
    console.log("[p7f] Dynamic Draft recipe authoring rehearsal passed.");
  } finally { await pool.end(); }
};
void main().catch((error: unknown) => { console.error(`[p7f] ${error instanceof Error ? error.stack ?? error.message : String(error)}`); process.exitCode = 1; });
