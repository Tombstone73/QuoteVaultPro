import assert from "node:assert/strict";
import type { Pool } from "pg";
import { PostgresProductionDocumentService } from "../../infrastructure/production/postgresProductionDocuments.js";
import { assertOwnerDocumentSafe, renderOwnerPdf } from "../../infrastructure/documents/ownerPdfRenderer.js";

const organizationId = "tenant-a" as any;
const productionWorkId = "work-a" as any;
const queries: string[] = [];
const pool = {
  query: async <T>(query: string) => {
    queries.push(query);
    if (query.includes("FROM organizations o")) return { rows: [{ name: "Tenant Print", address: null, phone: null, email: null, website: null }] as T[] };
    return {
      rows: [{
        number: "ORD-1007", customer: null, po: null, due: "2026-08-27", description: "Historical flatbed sign", configuration: { dimensions: { width: 24, height: 18, unit: "in" }, selections: { finish: "matte" } }, ordered_quantity: 1,
        completed_quantity: "1", requirement_key: "front", side: "front", source_page_index: null, layer_key: null, layer_order: null, station: null, materials: null,
      }] as T[],
    };
  },
} as unknown as Pool;

const service = new PostgresProductionDocumentService(pool);
const document = await service.traveler(organizationId, productionWorkId);
assert.equal(document.number, "ORD-1007");
assert.equal(document.organization.name, "Tenant Print");
assert.equal(document.sections[0]?.entries.find((entry) => entry.label === "Requested due")?.value, "2026-08-27");
assert.equal(document.sections[1]?.entries.find((entry) => entry.label === "Station")?.value, "Not started");
assert.equal(document.sections[2]?.entries.find((entry) => entry.label === "Material"), undefined);
assert.match(document.sections[2]?.entries.find((entry) => entry.label === "Configuration")?.value ?? "", /24 × 18 in/);
assert.match(Buffer.from(await renderOwnerPdf(assertOwnerDocumentSafe(document))).subarray(0, 8).toString("ascii"), /^%PDF-/);
assert.match(queries.find((query) => query.includes("FROM v2_production_works")) ?? "", /d\.purchase_order_number po/);
assert.match(queries.find((query) => query.includes("FROM v2_production_works")) ?? "", /d\.requested_due_date::text due/);
assert.doesNotMatch(JSON.stringify(document), /work-a|tenant-a/i);
console.log("Production traveler document service tests passed.");
