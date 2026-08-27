import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { PostgresFulfillmentTransaction, PostgresFulfillmentTransactionRunner } from "../../infrastructure/fulfillment/postgresFulfillmentTransaction.js";
import { PostgresFulfillmentDocumentService } from "../../infrastructure/fulfillment/postgresFulfillmentDocuments.js";
import { assertOwnerDocumentSafe, renderOwnerPdf } from "../../infrastructure/documents/ownerPdfRenderer.js";

const organizationId = "tenant-a" as any, handoffId = "handoff-a" as any;
const snapshotQueries: string[] = [];
const client = { query: async <T>(query: string) => {
  snapshotQueries.push(query);
  return { rows: [{ snapshot: { orderNumber: "ORD-1011", customer: "Customer Print", purchaseOrder: "PO-1011", requestedMethod: "shipping", destination: { company: "Customer Print", addressLine1: "1 Main St" }, method: "shipment", completedAt: "2026-08-27T12:00:00.000Z", lines: [{ description: "Frozen sign", quantity: 2 }] } }] as T[] };
} } as unknown as PoolClient;
await new PostgresFulfillmentTransaction(client).writeDocumentSnapshot({ organizationId, handoffId });
const snapshotSql = snapshotQueries[0] ?? "";
assert.match(snapshotSql, /'purchaseOrder',d\.purchase_order_number/);
assert.doesNotMatch(snapshotSql, /o\.purchase_order_number/);
assert.match(snapshotSql, /'requestedMethod',o\.requested_fulfillment_method/);
assert.match(snapshotSql, /'destination',o\.requested_destination/);
assert.match(snapshotSql, /'description',l\.description,'quantity',hl\.quantity/);
assert.match(snapshotSql, /ON CONFLICT \(organization_id,handoff_id\) DO NOTHING/);
assert.match(snapshotSql, /d\.purchase_order_number/);

const calls: string[] = [];
const failingClient = { query: async <T>(query: string) => { calls.push(query); if (query.includes("v2_fulfillment_handoff_document_snapshots")) throw new Error("snapshot failed"); return { rows: [] as T[] }; }, release: () => undefined } as unknown as PoolClient;
const failingPool = { connect: async () => failingClient } as unknown as Pool;
await assert.rejects(() => new PostgresFulfillmentTransactionRunner(failingPool).transaction(async tx => tx.writeDocumentSnapshot({ organizationId, handoffId })), /snapshot failed/);
assert.equal(calls[0], "BEGIN"); assert.equal(calls.at(-1), "ROLLBACK"); assert.equal(calls.includes("COMMIT"), false);

const documentQueries: string[] = [];
const documentPool = { query: async <T>(query: string) => {
  documentQueries.push(query);
  if (query.includes("FROM organizations o")) return { rows: [{ name: "Tenant Print", address: null, phone: null, email: null, website: null }] as T[] };
  return { rows: [{ customer_id: "customer-a", snapshot: { orderNumber: "ORD-1011", customer: "Customer Print", purchaseOrder: null, method: "pickup", completedAt: "2026-08-27T12:00:00.000Z", lines: [{ description: "Frozen sign", quantity: 2 }] } }] as T[] };
} } as unknown as Pool;
const document = await new PostgresFulfillmentDocumentService(documentPool).document(organizationId, handoffId);
assert.equal(document.kind, "pickup-receipt");
assert.match(JSON.stringify(document), /Frozen sign.*Qty 2/); assert.doesNotMatch(JSON.stringify(document), /customer-a|handoff-a|tenant-a/i);
assert.equal(document.sections[0]?.entries.some((entry) => entry.label === "Customer PO"), false);
assert.match(Buffer.from(await renderOwnerPdf(assertOwnerDocumentSafe(document))).subarray(0, 8).toString("ascii"), /^%PDF-/);
console.log("Fulfillment snapshot persistence tests passed.");
