import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { PostgresPrepressTransaction } from "../../infrastructure/prepress/postgresPrepressTransaction.js";
import { PostgresProofingTransaction } from "../../infrastructure/proofing/postgresProofingTransaction.js";
import { PostgresSuccessorWorkCreation } from "../../infrastructure/production/postgresSuccessorWorkCreation.js";
import { resolvePrepressProductionArtwork } from "../../src/modules/prepress/contracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const organizationId = brandedId<"OrganizationId">("org-artwork-identity");
const orderLineId = brandedId<"OrderLineId">("line-artwork-identity");
const oldAssignmentId = brandedId<"ArtworkAssignmentId">("assignment-replaced");
const inkAssignmentId = brandedId<"ArtworkAssignmentId">("assignment-ink");
const varnishAssignmentId = brandedId<"ArtworkAssignmentId">("assignment-varnish");
const queries: Array<{ sql: string; values: readonly unknown[] | undefined }> = [];
const requirements = [
  { order_line_id: orderLineId, requirement_key: "front-ink", side: "front", source_page_index: 0, layer_key: "ink", layer_order: 0 },
  { order_line_id: orderLineId, requirement_key: "front-varnish", side: "front", source_page_index: 0, layer_key: "varnish", layer_order: 1 },
];
const evidence = [
  { coverage_order_line_id: orderLineId, requirement_key: "front-ink", artwork_assignment_id: inkAssignmentId },
  { coverage_order_line_id: orderLineId, requirement_key: "front-varnish", artwork_assignment_id: varnishAssignmentId },
];
const currentArtwork = [
  { order_line_id: orderLineId, assignment_id: inkAssignmentId, artwork_file_id: "file-ink", display_filename: "ink-current.pdf", content_type: "application/pdf", purpose: "production", side: "front", source_page_index: 0, layer_key: "ink", layer_order: 0, detected_width_microns: null, detected_height_microns: null },
  { order_line_id: orderLineId, assignment_id: varnishAssignmentId, artwork_file_id: "file-varnish", display_filename: "varnish-current.pdf", content_type: "application/pdf", purpose: "production", side: "front", source_page_index: 0, layer_key: "varnish", layer_order: 1, detected_width_microns: null, detected_height_microns: null },
];
const client = {
  query: async (sql: string, values?: readonly unknown[]) => {
    queries.push({ sql, values });
    if (sql.startsWith("SELECT count(*) count")) return { rows: [{ count: "1" }] };
    if (sql.startsWith("SELECT d.id order_id")) return { rows: [{ order_id: "order-a", order_number: "ORD-1", customer_id: null, customer_display_name: "Customer", line_id: orderLineId, line_description: "Layered print", quantity: 1, requested_due_date: null, step_kind: "prepress", production_requirement_state: "configured", resolved_configuration: null, requires_proof: false, production_destination: "flatbed" }] };
    if (sql.startsWith("SELECT order_line_id,requirement_key")) return { rows: requirements };
    if (sql.startsWith("SELECT r.order_line_id coverage_order_line_id")) return { rows: evidence };
    if (sql.includes("FROM v2_current_artwork_assignments a JOIN v2_artwork_files")) return { rows: currentArtwork };
    return { rows: [] };
  },
} as unknown as PoolClient;

const page = await new PostgresPrepressTransaction(client).listQueue(organizationId, { page: 1, pageSize: 25 });
assert.equal(page.items.length, 1);
const item = page.items[0]!;
assert.deepEqual(item.coverage.state === "configured" ? item.coverage.requirements.map((entry) => entry.artworkAssignmentIds) : [], [[inkAssignmentId], [varnishAssignmentId]]);
assert.deepEqual(item.operational.productionArtwork.map((entry) => [entry.artworkAssignmentId, entry.layerKey, entry.layerOrder]), [[inkAssignmentId, "ink", 0], [varnishAssignmentId, "varnish", 1]]);
const selected = item.coverage.state === "configured"
  ? item.coverage.requirements.map((coverage) => resolvePrepressProductionArtwork(coverage, item.operational.productionArtwork))
  : [];
assert.deepEqual(selected.map((selection) => selection.kind === "selected" ? selection.artwork.artworkAssignmentId : selection.kind), [inkAssignmentId, varnishAssignmentId], "same side/page layers resolve their own source and predecessor IDs");
assert.ok(!item.operational.productionArtwork.some((reference) => reference.artworkAssignmentId === oldAssignmentId), "the historical predecessor is absent from the current Artwork projection");
const artworkQuery = queries.find(({ sql }) => sql.includes("FROM v2_current_artwork_assignments a JOIN v2_artwork_files"));
const coverageQuery = queries.find(({ sql }) => sql.startsWith("SELECT r.order_line_id coverage_order_line_id"));
assert.ok(artworkQuery && coverageQuery);
assert.match(artworkQuery.sql, /a\.layer_key,a\.layer_order/u, "the projection retains Artwork-owned layer identity");
assert.match(coverageQuery.sql, /a\.layer_key IS NOT DISTINCT FROM r\.layer_key AND a\.layer_order IS NOT DISTINCT FROM r\.layer_order/u, "coverage joins exact layer assignments");
assert.match(artworkQuery.sql, /FROM v2_current_artwork_assignments a/u, "historical or replaced assignments are not projected as current");
assert.match(artworkQuery.sql, /NOT EXISTS\(SELECT 1 FROM v2_artwork_assignments successor/u, "the explicit predecessor exclusion stays in place");

const proofQueries: string[] = [];
const proofing = new PostgresProofingTransaction({ query: async (sql: string) => { proofQueries.push(sql); return { rows: [] }; } } as unknown as PoolClient);
await assert.rejects(proofing.createVersion({ id: brandedId<"ProofVersionId">("proof-version"), organizationId, proofWorkId: brandedId<"ProofWorkId">("proof-work"), sequence: 1, artworkAssignmentIds: [oldAssignmentId], principalKind: "staff", principalSubject: "staff-a" }), /Proof Artwork must be the current assignments/u);
assert.equal(proofQueries.length, 1, "Proofing rejects replaced Artwork before creating a version");
assert.match(proofQueries[0]!, /FROM v2_current_artwork_assignments/u);

const productionQueries: string[] = [];
const production = new PostgresSuccessorWorkCreation({ query: async (sql: string) => { productionQueries.push(sql); return { rows: [] }; } } as unknown as PoolClient);
await assert.rejects(production.createOrReadCompletedPrepressWork({ organizationId, orderLineId, artworkAssignmentIds: [oldAssignmentId], principalKind: "staff", principalSubject: "staff-a" }), /Production work could not be created/u);
assert.match(productionQueries[0]!, /FROM v2_current_artwork_assignments a/u, "Production creates work only from current Artwork");
assert.match(productionQueries[0]!, /a\.layer_key IS NOT DISTINCT FROM req\.layer_key AND a\.layer_order IS NOT DISTINCT FROM req\.layer_order/u, "Production binds work to the exact required layer");
assert.equal(productionQueries.length, 2, "the stale assignment produced no Production work row");

console.log("Prepress Artwork identity projection, ambiguity, and stale-consumer regressions passed.");
