import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { PostgresPrepressTransaction } from "../../infrastructure/prepress/postgresPrepressTransaction.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const queries: string[] = [];
const timestamp = new Date("2026-09-06T00:00:00.000Z");
const unit = { id:"unit-a",organization_id:"org-a",order_document_id:"order-a",order_line_id:"line-a",artwork_assignment_id:"assignment-a",artwork_file_id:"file-a",side:null,source_page_index:null,layer_key:null,layer_order:null,created_at:timestamp,created_principal_kind:"staff" as const,created_principal_subject:"staff-a",created_staff_actor_user_id:null,started_at:timestamp,started_principal_kind:"staff" as const,started_principal_subject:"staff-a",started_staff_actor_user_id:null,completed_at:timestamp,completed_principal_kind:"staff" as const,completed_principal_subject:"staff-a",completed_staff_actor_user_id:null };
const client = { query: async (sql: string) => {
  queries.push(sql);
  if (sql.startsWith("SELECT * FROM v2_prepress_units")) return { rows:[unit] };
  if (sql.includes("FROM v2_route_instances ri LEFT JOIN")) return { rows:[{id:"route-a",current_step_id:"prepress-step",revision:"4",step_kind:"prepress"}] };
  if (sql.startsWith("SELECT id,position,step_kind,production_destination_station_key")) return { rows:[{id:"prepress-step",position:1,step_kind:"prepress",production_destination_station_key:null},{id:"production-step",position:2,step_kind:"production",production_destination_station_key:"flatbed"}] };
  if (sql.includes("EXISTS(SELECT 1 FROM v2_proof_works")) return { rows:[{required:true,approved:true}] };
  if (sql.includes("FROM v2_sales_line_production_requirements requirement")) return { rows:[{assignment_id:"assignment-a"}] };
  if (sql.startsWith("SELECT id FROM v2_production_works")) return { rows:[{id:"work-a"}] };
  return { rows:[] };
} } as unknown as PoolClient;
const transaction = new PostgresPrepressTransaction(client);
const result = await transaction.handoffToProduction({ organizationId:brandedId<"OrganizationId">("org-a"),prepressUnitId:brandedId<"PrepressUnitId">("unit-a"),principalKind:"staff",principalSubject:"staff-a" });
assert.deepEqual(result, { unit:{ prepressUnitId:"unit-a",organizationId:"org-a",orderId:"order-a",orderLineId:"line-a",artworkAssignmentId:"assignment-a",artworkFileId:"file-a",createdAt:timestamp.toISOString(),createdPrincipalKind:"staff",createdPrincipalSubject:"staff-a",startedAt:timestamp.toISOString(),startedPrincipalKind:"staff",startedPrincipalSubject:"staff-a",completedAt:timestamp.toISOString(),completedPrincipalKind:"staff",completedPrincipalSubject:"staff-a" }, destination:"flatbed",productionWorkIds:["work-a"] });
assert.ok(queries.some(sql=>sql.includes("FOR UPDATE OF ri,o")), "handoff locks the open Order Route");
assert.ok(queries.some(sql=>sql.includes("production_destination_station_key")), "handoff uses frozen station mapping, not live template labels");
assert.ok(queries.some(sql=>sql.includes("v2_proof_works")), "proof approval is rechecked by the server");
assert.ok(queries.some(sql=>sql.includes("FOR SHARE OF l")), "handoff locks the Order line without trying to lock the nullable Product Version outer-join side");
assert.ok(queries.some(sql=>sql.includes("NOT EXISTS(SELECT 1 FROM v2_artwork_assignments successor")), "only current production artwork is eligible");
assert.ok(queries.some(sql=>sql.startsWith("UPDATE v2_route_instances")), "route moves only inside the same handoff transaction");
assert.ok(queries.some(sql=>sql.startsWith("INSERT INTO v2_production_works")), "canonical Production work is created, never a Prepress shadow job");
console.log("Prepress-to-Production frozen-route handoff contract passed.");
