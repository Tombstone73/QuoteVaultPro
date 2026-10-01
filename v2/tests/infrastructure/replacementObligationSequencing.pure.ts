import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
import { PostgresReplacementObligationService } from "../../infrastructure/fulfillment/postgresReplacementObligations.js";
import { reconcileOrderInTransaction } from "../../infrastructure/sales/postgresOrderAutomaticLifecycle.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";

type State = {
  order: "open" | "completed";
  obligations: Array<{ id: string; status: string }>;
  works: Array<{ id: string; replacement_obligation_id: string | null; rework_cycle_id: string | null }>;
  invoices: string[];
  events: Array<{ sequence: number; event_kind: string }>;
  reopenAudits: number;
  request?: Record<string, unknown>;
};

const context = (organizationId = "org-a", principalOrganizationId = organizationId) => ({
  organizationId,
  operationId: "replacement-sequencing-test",
  businessRequest: { id: "replacement-request", payloadFingerprint: "route-derived" },
  principal: { kind: "staff" as const, organizationId: principalOrganizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["fulfillment.replace" as const] } },
});
const input = {
  businessRequestId: "replacement-request", orderId: brandedId<"OrderId">("order-a"), orderLineId: brandedId<"OrderLineId">("line-a"),
  replacementQuantity: 1, reason: "print_defect" as const, responsibility: "titan" as const, billingTreatment: "no_charge" as const,
};

const fixture = (order: State["order"], failWorkInsert = false) => {
  let state: State = {
    order, obligations: [], invoices: ["original-paid"], events: [], reopenAudits: 0,
    works: [
      { id: "original-work", replacement_obligation_id: null, rework_cycle_id: null },
      { id: "rework-work", replacement_obligation_id: null, rework_cycle_id: "rework-cycle" },
    ],
  };
  let snapshot: State | undefined;
  const queries: string[] = [];
  const parameters: (readonly unknown[])[] = [];
  let connections = 0;
  const decisions: string[] = [];
  class ObservedAuthority extends AuthorityPolicy {
    override decide(...args: Parameters<AuthorityPolicy["decide"]>) { decisions.push(args[1].capability); return super.decide(...args); }
  }
  const client = {
    release: () => undefined,
    query: async (sql: string, values: readonly unknown[] = []) => {
      queries.push(sql);
      parameters.push(values);
      if (sql === "BEGIN") { snapshot = structuredClone(state); return { rows: [] }; }
      if (sql === "COMMIT") { snapshot = undefined; return { rows: [] }; }
      if (sql === "ROLLBACK") { assert.ok(snapshot); state = snapshot; snapshot = undefined; return { rows: [] }; }
      if (sql.includes("FROM v2_operation_requests") && sql.includes("FOR UPDATE")) return { rows: state.request ? [state.request] : [] };
      if (sql.includes("INSERT INTO v2_operation_requests")) {
        state.request = { id: "request-a", organization_id: "org-a", operation: "fulfillment.replacement.create.v1", business_request_id: input.businessRequestId, payload_fingerprint: values[3], status: "in_progress", result_resource_type: null, result_resource_id: null, result_json: null, initiated_principal_kind: "staff", initiated_principal_subject: "staff-a", staff_actor_user_id: "staff-a", created_at: new Date(), updated_at: new Date(), completed_at: null };
        return { rows: [state.request] };
      }
      if (sql.includes("UPDATE v2_operation_requests") && sql.includes("status = 'succeeded'")) {
        assert.ok(state.request); state.request = { ...state.request, status: "succeeded", result_json: JSON.parse(String(values[4])) }; return { rows: [state.request] };
      }
      if (sql.includes("INSERT INTO v2_principal_attributions")) return { rows: [] };
      if (sql.includes("SELECT l.id FROM v2_sales_documents")) return { rows: [{ id: "line-a" }] };
      if (sql.includes("FROM v2_fulfillment_handoffs h JOIN")) return { rows: [{ id: "original-handoff" }] };
      if (sql.includes("SELECT DISTINCT ON (w.requirement_key)")) return { rows: [{ id: "original-work", order_document_id: "order-a", order_line_id: "line-a", requirement_key: "front", artwork_assignment_id: "assignment-a", artwork_file_id: "file-a", prepress_unit_id: null, side: "front", source_page_index: null, layer_key: null, layer_order: null }] };
      if (sql.includes("INSERT INTO v2_order_replacement_obligations")) {
        const id = String(values[0]); state.obligations.push({ id, status: "open" });
        return { rows: [{ id, organization_id: "org-a", order_document_id: "order-a", order_line_id: "line-a", source_fulfillment_handoff_id: "original-handoff", source_shipment_id: null, predecessor_replacement_obligation_id: null, replacement_quantity: 1, reason: "print_defect", responsibility: "titan", billing_treatment: "no_charge", note: null, status: "open", created_at: new Date(), created_principal_kind: "staff", created_principal_subject: "staff-a" }] };
      }
      if (sql.includes("SELECT commercial_state state FROM v2_sales_order_details")) return { rows: [{ state: state.order }] };
      if (sql.includes("SELECT l.id,l.description,l.quantity")) return { rows: [{ id: "line-a", description: "Original", quantity: 2, workflow_intent: "standard_production", requires_production: false, production_complete: true, fulfilled_quantity: "2", route_complete: true, production_requirement: null }] };
      if (sql.includes("FROM v2_order_replacement_obligations r")) return { rows: [{ open_count: String(state.obligations.filter(value => value.status === "open").length) }] };
      if (sql.includes("SELECT EXISTS(SELECT 1 FROM v2_billing_invoices i")) return { rows: [{ settled: true }] };
      if (sql.startsWith("UPDATE v2_sales_order_details SET commercial_state='open'")) { state.order = "open"; return { rows: [] }; }
      if (sql.startsWith("UPDATE v2_sales_order_details SET commercial_state='completed'")) { state.order = "completed"; return { rows: [] }; }
      if (sql.includes("'order_auto_reopened'")) { state.reopenAudits++; return { rows: [] }; }
      if (sql.includes("'order_auto_closed'")) return { rows: [] };
      if (sql.includes("INSERT INTO v2_production_works")) {
        assert.equal(state.order, "open", "the unchanged Production guard sees an open Order");
        if (failWorkInsert) throw new Error("simulated successor Production insert failure");
        state.works.push({ id: String(values[0]), replacement_obligation_id: String(values[13]), rework_cycle_id: null }); return { rows: [] };
      }
      if (sql.includes("INSERT INTO v2_order_replacement_obligation_events")) { state.events.push({ sequence: Number(values[2]), event_kind: String(values[3]) }); return { rows: [] }; }
      if (sql.includes("v2_usable_production_good_quantity")) return { rows: [{ produced: "0", fulfilled: "0" }] };
      if (sql.includes("SELECT id,invoice_display_number,invoice_state,currency,total_cents FROM v2_billing_invoices WHERE")) return { rows: [] };
      if (sql.includes("SELECT sequence,event_kind,detail")) return { rows: state.events.map(event => ({ ...event, detail: {}, created_at: new Date(), created_principal_kind: "staff", created_principal_subject: "staff-a" })) };
      if (sql.includes("SELECT id FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$2 FOR UPDATE")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql.slice(0, 90)}`);
    },
  } as unknown as PoolClient;
  const service = new PostgresReplacementObligationService({ connect: async () => { connections++; return client; } } as unknown as Pool, undefined, new ObservedAuthority());
  return { service, client, queries, parameters, decisions, get connections() { return connections; }, get state() { return state; } };
};

const completed = fixture("completed");
const first = await completed.service.create(context(), input);
assert.equal(first.ok, true, "a completed Order creates a no-charge replacement");
assert.equal(completed.state.order, "open", "the active obligation canonically reopens the same Order");
assert.equal(completed.state.obligations.length, 1);
assert.equal(completed.state.works.filter(work => work.replacement_obligation_id).length, 1, "successor work is distinct from original/rework work");
assert.equal(completed.state.invoices.length, 1, "no-charge creation leaves the paid original Invoice untouched");
assert.deepEqual(completed.state.events.map(event => event.event_kind), ["created", "production_authority_created"]);
assert.equal(completed.queries.findIndex(sql => sql.includes("INSERT INTO v2_order_replacement_obligations")) < completed.queries.findIndex(sql => sql.startsWith("UPDATE v2_sales_order_details SET commercial_state='open'")), true, "obligation precedes canonical reopen");
assert.equal(completed.queries.findIndex(sql => sql.startsWith("UPDATE v2_sales_order_details SET commercial_state='open'")) < completed.queries.findIndex(sql => sql.includes("INSERT INTO v2_production_works")), true, "canonical reopen precedes successor work");
const creationParams = completed.parameters[completed.queries.findIndex(sql => sql.includes("INSERT INTO v2_production_works"))]!;
assert.deepEqual(creationParams.slice(1, 13), ["org-a", "order-a", "line-a", "front", "assignment-a", "file-a", null, "front", null, null, null, 1], "Production owner consumes frozen source units and partial replacement quantity");
assert.equal(creationParams[13], completed.state.obligations[0]!.id);
assert.deepEqual(creationParams.slice(14), ["original-work", "staff", "staff-a", "staff-a"], "new work retains original lineage and actual actor");
assert.equal(completed.connections, 1, "owner creation uses the caller's one client");
assert.deepEqual(completed.decisions, ["fulfillment.replace"], "creation preserves the current caller authority gate without adding a Production capability requirement");
assert.deepEqual(completed.queries.filter(sql => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)), ["BEGIN", "COMMIT"], "no nested transaction");

const replay = await completed.service.create(context(), input);
assert.equal(replay.ok, true, "same semantic request replays");
assert.equal(completed.state.obligations.length, 1, "replay creates no duplicate obligation");
assert.equal(completed.state.works.filter(work => work.replacement_obligation_id).length, 1, "replay creates no duplicate successor work");
assert.equal(completed.state.reopenAudits, 1, "replay creates no duplicate reopen audit");
assert.deepEqual(completed.decisions, ["fulfillment.replace", "fulfillment.replace"], "replay rechecks current caller authority");

completed.state.obligations[0]!.status = "fulfilled";
await reconcileOrderInTransaction(completed.client, brandedId<"OrganizationId">("org-a"), brandedId<"OrderId">("order-a"));
assert.equal(completed.state.order, "completed", "settled completed original recompletes after replacement fulfillment");

const alreadyOpen = fixture("open");
assert.equal((await alreadyOpen.service.create(context("org-a"), input)).ok, true);
assert.equal(alreadyOpen.state.order, "open", "an already-open Order remains open");
assert.equal(alreadyOpen.state.reopenAudits, 0, "already-open creation manufactures no reopen cycle");

const failed = fixture("completed", true);
const failedResult = await failed.service.create(context(), input);
assert.equal(failedResult.ok, false);
assert.equal(failed.state.order, "completed", "failed successor insertion rolls back canonical reopen");
assert.equal(failed.state.obligations.length, 0, "failed successor insertion rolls back obligation");
assert.equal(failed.state.works.filter(work => work.replacement_obligation_id).length, 0, "failed successor insertion leaves no replacement work");
assert.equal(failed.state.events.length, 0, "failed successor insertion leaves no replacement events");
assert.equal(failed.state.invoices.length, 1, "failed successor insertion leaves the original Invoice untouched");

const beforeDenied = completed.queries.length;
const beforeDeniedConnections = completed.connections;
const wrongTenant = await completed.service.create(context("org-b", "org-a"), input);
assert.equal(wrongTenant.ok, false, "tenant scope is enforced before replacement writes");
if (!wrongTenant.ok) assert.equal(wrongTenant.error.code, "WRONG_TENANT");
assert.equal(completed.state.obligations.length, 1, "wrong-tenant attempt cannot change canonical tenant state");
const denied = context();
denied.principal.authority.capabilities = [];
const forbidden = await completed.service.create(denied, input);
assert.equal(forbidden.ok, false);
if (!forbidden.ok) assert.equal(forbidden.error.code, "FORBIDDEN");
assert.equal(completed.queries.length, beforeDenied, "scope and authority denial perform no query");
assert.equal(completed.connections, beforeDeniedConnections, "denial does not connect");

const source = readFileSync(new URL("../../infrastructure/fulfillment/postgresReplacementObligations.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /INSERT INTO v2_production_works/, "Fulfillment does not mutate Production work");
assert.ok(source.indexOf("await reconcileOrderInTransaction") < source.indexOf(".createReplacementWork("), "billable and no-charge paths share reopen-before-owner-call sequencing");
assert.ok(source.indexOf(".createReplacementWork(") < source.indexOf("?await createOrReadReplacementInvoice"), "billable Invoice remains after successor Production authority");
assert.doesNotMatch(source, /await this\.lifecycle\?\.reconcileOrder\(brandedId<"OrganizationId">\(c\.organizationId\),input\.orderId\)/, "creation has no post-commit reopen gap");
console.log("replacement obligation sequencing, rollback, idempotency, lifecycle, lineage, and tenant contracts passed.");
