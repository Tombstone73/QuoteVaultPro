import assert from "node:assert/strict";
import { PostgresProductPublicationTransactionRunner } from "../../infrastructure/products/postgresProductPublication.js";

type Query = <T>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;

const reader = (treeJson: unknown, fallback: Readonly<{ workflowIntent: string; requiresProductionJob: boolean }>) => {
  const query: Query = async (sql) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("FROM products p")) return { rows: [{
      product_updated_at: new Date("2026-09-03T00:00:00.000Z"),
      draft_updated_at: new Date("2026-09-03T00:01:00.000Z"),
      status: "DRAFT",
      workflow_intent: fallback.workflowIntent,
      requires_production_job: fallback.requiresProductionJob,
      tree_json: treeJson,
    }] };
    if (sql.includes("FROM v2_product_version_routing_specs")) return { rows: [{
      routing_mode: "route_required",
      route_template_id: "route-a",
      source_template_revision: "1",
      source_template_fingerprint: "sha256:route",
      steps_json: [{ position: 0, kind: "production" }],
    }] };
    if (sql.includes("SELECT name FROM v2_route_templates")) return { rows: [{ name: "Standard Production" }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  return new PostgresProductPublicationTransactionRunner({ connect: async () => ({ query, release() {} }) } as never);
};

const staleProductButProductionDraft = await reader(
  { meta: { general: { workflowIntent: "standard_production", requiresProductionJob: true }, productionUnitSpecification: { schemaVersion: 1, rules: [{ key: "front", side: "front" }] } } },
  { workflowIntent: "standard_production", requiresProductionJob: false },
).transaction((tx) => tx.readDraftPublicationState({ organizationId: "org-a", productId: "product-a", draftVersionId: "draft-a" }));
assert.equal(staleProductButProductionDraft?.workflowIntent, "standard_production");
assert.equal(staleProductButProductionDraft?.requiresProductionJob, true, "Draft General must govern publish readiness before projection");

const staleProductionProductButServiceDraft = await reader(
  { meta: { general: { workflowIntent: "service_fee", requiresProductionJob: false }, productionUnitSpecification: null } },
  { workflowIntent: "standard_production", requiresProductionJob: true },
).transaction((tx) => tx.readDraftPublicationState({ organizationId: "org-a", productId: "product-a", draftVersionId: "draft-a" }));
assert.equal(staleProductionProductButServiceDraft?.workflowIntent, "service_fee");
assert.equal(staleProductionProductButServiceDraft?.requiresProductionJob, false, "A non-production Draft must not inherit an old production route gate");

const normalize = async (treeJson: unknown) => {
  let persisted = treeJson;
  let updated = false;
  const query: Query = async (sql, values) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("SELECT updated_at,status,tree_json")) return { rows: [{ updated_at: new Date("2026-09-03T00:01:00.000Z"), status: "DRAFT", tree_json: persisted }] };
    if (sql.includes("UPDATE pbv2_tree_versions SET tree_json")) {
      persisted = JSON.parse(String(values?.[0]));
      updated = true;
      return { rows: [{ updated_at: new Date("2026-09-03T00:02:00.000Z") }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const runner = new PostgresProductPublicationTransactionRunner({ connect: async () => ({ query, release() {} }) } as never);
  await runner.transaction((tx) => tx.normalizeLegacyDraftScaffold({ organizationId: "org-a", productId: "product-a", draftVersionId: "draft-a", expectedDraftUpdatedAt: "2026-09-03T00:01:00.000Z" }));
  return { persisted: persisted as any, updated };
};

const legacyScaffold = await normalize({
  rootNodeIds: ["product_configuration", "opt_a"],
  nodes: {
    product_configuration: { id: "product_configuration", kind: "group", label: "Product configuration" },
    opt_a: { id: "opt_a", kind: "question" },
  },
});
assert.equal(legacyScaffold.updated, true, "an old empty scaffold is normalized before publication");
assert.deepEqual(legacyScaffold.persisted.rootNodeIds, ["opt_a"]);
assert.equal(legacyScaffold.persisted.nodes.product_configuration, undefined);

const authoredGroup = await normalize({
  rootNodeIds: ["product_configuration", "opt_a"],
  nodes: {
    product_configuration: { id: "product_configuration", kind: "group", label: "Product configuration", children: ["opt_a"] },
    opt_a: { id: "opt_a", kind: "question" },
  },
});
assert.equal(authoredGroup.updated, false, "a non-empty group is never flattened by compatibility normalization");
assert.equal(authoredGroup.persisted.nodes.product_configuration.kind, "group");

console.log("Product publication readiness reads Draft General settings.");
