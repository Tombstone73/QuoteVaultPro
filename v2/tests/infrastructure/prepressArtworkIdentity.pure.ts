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
  { order_line_id: orderLineId, assignment_id: "source-assignment", artwork_file_id: "source-file", display_filename: "customer.pdf", content_type: "application/pdf", purpose: "customer_supplied", side: "front", source_page_index: 0, layer_key: null, layer_order: null, detected_width_microns: 25400, detected_height_microns: 50800 },
  { order_line_id: orderLineId, assignment_id: inkAssignmentId, artwork_file_id: "file-ink", display_filename: "ink-current.pdf", content_type: "application/pdf", purpose: "production", side: "front", source_page_index: 0, layer_key: "ink", layer_order: 0, detected_width_microns: null, detected_height_microns: null },
  { order_line_id: orderLineId, assignment_id: varnishAssignmentId, artwork_file_id: "file-varnish", display_filename: "varnish-current.pdf", content_type: "application/pdf", purpose: "production", side: "front", source_page_index: 0, layer_key: "varnish", layer_order: 1, detected_width_microns: null, detected_height_microns: null },
];
const client = {
  query: async (sql: string, values?: readonly unknown[]) => {
    queries.push({ sql, values });
    if (sql.startsWith("SELECT count(*) count")) return { rows: [{ count: "1" }] };
     if (sql.startsWith("SELECT d.id order_id")) return { rows: values?.[1] === "missing" ? [] : [{ order_id: "order-a", order_number: "ORD-1", customer_id: null, customer_display_name: "Customer", line_id: orderLineId, line_description: "Layered print", quantity: 1, requested_due_date: "2026-10-20", step_kind: "prepress", production_requirement_state: "configured", resolved_configuration: { dimensions: { width: "1", height: "2", unit: "in" } }, requires_proof: true, production_destination: "flatbed" }] };
    if (sql.startsWith("SELECT order_line_id,requirement_key")) return { rows: requirements };
    if (sql.startsWith("SELECT r.order_line_id coverage_order_line_id")) return { rows: evidence };
    if (sql.includes("FROM v2_current_artwork_assignments a JOIN v2_artwork_files")) return { rows: currentArtwork };
    if (sql.startsWith("SELECT l.id order_line_id,CASE")) return { rows: [{ order_line_id: orderLineId, state: "approved" }] };
    if (sql.startsWith("SELECT order_line_id,material_name_snapshot")) return { rows: [{ order_line_id: orderLineId, material_name_snapshot: "Vinyl", material_sku_snapshot: "V-1" }] };
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

queries.length = 0;
const exact = await new PostgresPrepressTransaction(client).getLine(organizationId, orderLineId);
assert.deepEqual(exact, item, "exact lookup uses the entire canonical queue context composer");
assert.equal(exact!.operational.sourceArtwork[0]!.artworkFileId, "source-file");
assert.deepEqual(exact!.operational.proof, { required: true, state: "approved" });
assert.deepEqual(exact!.operational.materials, ["Vinyl · V-1"]);
assert.deepEqual(exact!.operational.expectedDimensions, { width: "1", height: "2", unit: "in" });
assert.equal(exact!.operational.productionDestination, "flatbed");
assert.equal(exact!.requestedDueDate, "2026-10-20");
const exactQuery = queries[0]!;
assert.deepEqual(exactQuery.values, [organizationId, orderLineId]);
assert.match(exactQuery.sql, /l.organization_id=\$1 AND l.id=\$2/u);
assert.match(exactQuery.sql, /o.commercial_state='open' AND o.archived_at IS NULL/u);
assert.match(exactQuery.sql, /ri.route_state IN \('pending','active'\)/u);
assert.match(exactQuery.sql, /step.step_kind IN \('proofing','prepress'\)/u);
assert.match(exactQuery.sql, /bypass.prepress_requirement='not_required'/u);
assert.doesNotMatch(exactQuery.sql, /LIMIT \$6|OFFSET|ILIKE|\$3/u, "deep links are not queue-page or search constrained");
assert.equal(queries.length, 6, "exact lookup does not count or scan queue pages");
for (const query of queries.slice(1)) assert.deepEqual(query.values, [organizationId, [orderLineId]]);
assert.ok(queries.every(query => query.sql.startsWith("SELECT")), "exact recovery never writes");
queries.length = 0;
assert.equal(await new PostgresPrepressTransaction(client).getLine(organizationId, brandedId<"OrderLineId">("missing")), null);
assert.equal(queries.length, 1, "missing/ineligible lines do not load operational context");

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
