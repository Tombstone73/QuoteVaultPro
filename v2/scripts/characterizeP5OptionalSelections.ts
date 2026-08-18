import assert from "node:assert/strict";
import { Pool } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { PostgresProductDraftPricingPreview, PostgresProductDraftPricingReader } from "../infrastructure/products/postgresProductVersionLifecycle.js";
import { resolveRuntimeVisibility, validateOptionTreeV2 } from "../../shared/optionTreeV2Runtime.js";
import type { OptionTreeV2 } from "../../shared/optionTreeV2.js";

const cloneHost = "ep-nameless-mud-aedtoak5-pooler.c-2.us-east-2.aws.neon.tech";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const keyFor = (node: Record<string, unknown>) => typeof record(node.input).selectionKey === "string" ? record(node.input).selectionKey as string : typeof node.key === "string" ? node.key as string : String(node.id ?? "");
const referenced = (tree: unknown, key: string, nodeId: string) => {
  const copy = structuredClone(record(tree));
  const nodes = record(copy.nodes); delete nodes[nodeId]; copy.nodes = nodes;
  return JSON.stringify(copy).includes(`"${key}"`) || JSON.stringify(copy).includes(`"${nodeId}"`);
};
async function main() {
  const url = requireV2M0CloneDatabaseUrl(), parsed = new URL(url);
  assert.equal(parsed.hostname, cloneHost); assert.equal(parsed.pathname.replace(/^\//u, ""), "neondb");
  const pool = new Pool({ connectionString: url, max: 3 });
  try {
    const reader = new PostgresProductDraftPricingReader(pool), preview = new PostgresProductDraftPricingPreview(pool);
    const candidates = (await pool.query<{ organizationId: string; productId: string; product: string; draftId: string; tree: unknown; measurementMode: "dimensions_required" | "quantity_only" }>(`SELECT p.organization_id AS "organizationId",p.id AS "productId",p.name product,d.id "draftId",d.tree_json tree,p.measurement_mode AS "measurementMode" FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' WHERE p.is_active=TRUE ORDER BY d.updated_at,p.id LIMIT 250`)).rows;
    const output: unknown[] = [];
    for (const candidate of candidates) {
      const pricing = await reader.read(candidate.organizationId, candidate.productId);
      if (!pricing?.editable || (pricing.base.perPieceCents === null && pricing.base.perSqftCents === null)) continue;
      const parsedTree = validateOptionTreeV2(candidate.tree as OptionTreeV2); if (!parsedTree.ok) continue;
      const tree = candidate.tree as OptionTreeV2, visibility = resolveRuntimeVisibility(tree, {});
      const nodes = Object.values(tree.nodes).filter(node => keyFor(node as unknown as Record<string, unknown>) === "base");
      let previewResult: unknown;
      try { previewResult = { ok: true, lineCents: (await preview.preview(candidate.organizationId, candidate.productId, { quantity: 1, ...(candidate.measurementMode === "dimensions_required" ? { width: 12, height: 12 } : {}) })).calculatedLineAmount.cents }; }
      catch (error) { previewResult = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
      output.push({ product: candidate.product, draftVersion: candidate.draftId, pricing: { measurementMode: pricing.measurementMode, base: pricing.base, tierBasis: pricing.tierBasis }, preview: previewResult, baseNodes: nodes.map(node => ({ nodeId: node.id, kind: node.kind, label: node.label, inputType: node.input?.type, selectionKey: keyFor(node as unknown as Record<string, unknown>), required: Boolean(node.input?.required), defaultValue: node.input?.defaultValue, choices: node.choices?.map(choice => ({ value: choice.value, label: choice.label, priceDeltaCents: choice.priceDeltaCents, pricingImpact: choice.pricingImpact })), pricingImpact: node.pricingImpact, visible: visibility.visibleNodeIds.includes(node.id), effectiveSelection: visibility.effectiveSelections["base"], referencedOutsideNode: referenced(tree, "base", node.id) })) });
    }
    console.log(JSON.stringify(output, null, 2));
  } finally { await pool.end(); }
}
void main().catch(error => { console.error(`[p5-characterize] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
