import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { PostgresShipmentContainerRunner } from "../../infrastructure/fulfillment/postgresShipmentContainerTransaction.js";

const organizationId = "org-shipment-finalization" as any;
const shipmentId = "shipment-finalization";
const revisionId = "revision-current";
const now = new Date("2026-09-10T12:00:00.000Z");

const shipment = (status: "prepared" | "shipped") => ({
  id: shipmentId, organization_id: organizationId, customer_id: "customer-a", destination: { addressLine1: "1 Print Way" }, shipment_status: status,
  manual_carrier_name: "Manual", manual_carrier_service: null, manual_tracking_number: "TRACK-1", notes: null, package_count: null,
  prepared_revision_id: revisionId, created_at: now, created_principal_kind: "staff", created_principal_subject: "operator",
  shipped_at: status === "shipped" ? now : null, shipped_principal_kind: status === "shipped" ? "staff" : null, shipped_principal_subject: status === "shipped" ? "operator" : null,
  voided_at: null, voided_principal_kind: null, voided_principal_subject: null, void_reason: null,
});
const revision = {
  id: revisionId, organization_id: organizationId, shipment_id: shipmentId, revision_number: 2, revision_kind: "correction", supersedes_revision_id: "revision-prior", correction_reason: "Corrected quantity",
  customer_id: "customer-a", destination: { addressLine1: "1 Print Way" }, manual_carrier_name: "Manual", manual_carrier_service: null, manual_tracking_number: "TRACK-1", notes: null, package_count: null,
  created_at: now, created_principal_kind: "staff", created_principal_subject: "operator",
};
const allocation = { order_document_id: "order-a", order_line_id: "line-a", quantity: 5 };

const exercise = async (failSnapshot = false) => {
  const calls: string[] = [];
  let status: "prepared" | "shipped" = "prepared";
  const client = {
    query: async <T>(text: string) => {
      calls.push(text);
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] as T[] };
      if (text.startsWith("SELECT * FROM v2_fulfillment_shipments")) return { rows: [shipment(status)] as T[] };
      if (text.startsWith("SELECT COALESCE(max(sequence_number)")) return { rows: [{ sequence_number: 2 }] as T[] };
      if (text.includes("FROM v2_fulfillment_shipment_events")) return { rows: [] as T[] };
      if (text.includes("FROM v2_fulfillment_shipment_prepared_revisions")) return { rows: [revision] as T[] };
      if (text.includes("FROM v2_fulfillment_shipment_prepared_revision_lines")) return { rows: [allocation] as T[] };
      if (text.includes("SELECT d.id order_document_id,l.id order_line_id")) return { rows: [{ ...allocation, customer_id: "customer-a", requested_destination: { addressLine1: "1 Print Way" } }] as T[] };
      if (text.startsWith("WITH production_output")) return { rows: [{ ...allocation, ordered_quantity: 5, pickup_quantity: "0", shipment_quantity: "0", completed_production_quantity: "0", workflow_intent: "fulfillment_only", requires_production: false }] as T[] };
      if (text.startsWith("SELECT line.order_line_id")) return { rows: [] as T[] };
      if (text.startsWith("SELECT d.id order_document_id,d.customer_id")) return { rows: [{ order_document_id: "order-a", customer_id: "customer-a", contact_id: "contact-a" }] as T[] };
      if (text.includes("v2_fulfillment_handoff_document_snapshots")) {
        if (failSnapshot) throw new Error("snapshot write failed");
        return { rows: [{ snapshot: {} }] as T[] };
      }
      if (text.startsWith("UPDATE v2_fulfillment_shipments SET shipment_status='shipped'")) { status = "shipped"; return { rows: [shipment(status)] as T[] }; }
      return { rows: [] as T[] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const runner = new PostgresShipmentContainerRunner({ connect: async () => client } as unknown as Pool);
  const work = () => runner.transaction(tx => tx.finalizePrepared!({ organizationId, shipmentId, expectedPreparedRevisionId: revisionId, principalKind: "staff", principalSubject: "operator" }));
  return { calls, work };
};

const happy = await exercise();
const finalized = await happy.work();
assert.equal(finalized?.status, "shipped");
const handoffAt = happy.calls.findIndex(call => call.startsWith("INSERT INTO v2_fulfillment_handoffs"));
const lineAt = happy.calls.findIndex(call => call.startsWith("INSERT INTO v2_fulfillment_handoff_lines"));
const snapshotAt = happy.calls.findIndex(call => call.includes("v2_fulfillment_handoff_document_snapshots"));
const attachmentAt = happy.calls.findIndex(call => call.startsWith("INSERT INTO v2_fulfillment_shipment_handoffs"));
const shippedAt = happy.calls.findIndex(call => call.startsWith("UPDATE v2_fulfillment_shipments SET shipment_status='shipped'"));
assert.ok(handoffAt > 0 && handoffAt < lineAt && lineAt < snapshotAt && snapshotAt < attachmentAt && attachmentAt < shippedAt, "handoff facts, snapshot, and attachment precede the terminal state transition");
assert.equal(happy.calls.at(-1), "COMMIT");

const failed = await exercise(true);
await assert.rejects(failed.work, /snapshot write failed/);
assert.equal(failed.calls.at(-1), "ROLLBACK");
assert.equal(failed.calls.includes("COMMIT"), false, "a failed immutable snapshot prevents all finalization facts from committing");
assert.equal(failed.calls.some(call => call.startsWith("UPDATE v2_fulfillment_shipments SET shipment_status='shipped'")), false, "failed finalization never transitions the container");

console.log("Shipment finalization transaction ordering and rollback tests passed.");
