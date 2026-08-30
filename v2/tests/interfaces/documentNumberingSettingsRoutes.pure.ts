import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createDocumentNumberingSettingsRouter } from "../../src/interfaces/http/documentNumberingSettingsRoutes.js";

const actor = { kind: "staff" as const, organizationId: "org-a", userId: "owner-a", authority: { membershipId: "member-a", source: "permission_set" as const, authorityRevision: "7", capabilities: ["numbering.configure"] as const } };
const snapshot = { revision: "quote:1|order:1", documents: [{ kind: "quote", prefix: "QT-", nextNumber: "1000", nextDisplayNumber: "QT-1000", status: "ready" as const, adoption: "native_v2" as const }, { kind: "order", prefix: "ORD-", nextNumber: "1000", nextDisplayNumber: "ORD-1000", status: "ready" as const, adoption: "native_v2" as const }], sharedJobNumber: { owner: "order_number" as const, behavior: "order_display_number" as const, configurableSeparately: false }, compatibility: { legacyQuoteOrder: "converged" as const, legacyInvoice: "native_job_derived" as const, legacyPurchaseOrder: "compatibility_managed" as const, importedHistoricalDocuments: "preserved" as const }, readiness: { status: "migration_required" as const, reasons: ["legacy"] } };
const app = (principal = actor) => { const calls: string[] = []; const settings: any = { read: async () => snapshot, save: async () => { calls.push("save"); return snapshot; } }; const value = express(); value.use(express.json()); value.use("/v2/organizations/:organizationId/settings/organization/numbering", createDocumentNumberingSettingsRouter({ settings, principals: { principal: async () => principal } as any })); return { value, calls }; };

{
  const { value } = app();
  const response = await request(value).get("/v2/organizations/org-a/settings/organization/numbering").expect(200);
  assert.equal(response.body.data.sharedJobNumber.configurableSeparately, false);
  assert.equal(response.body.data.compatibility.importedHistoricalDocuments, "preserved");
}
{
  const { value, calls } = app();
  await request(value).put("/v2/organizations/org-a/settings/organization/numbering").send({ businessRequestId: "numbering-save", expectedRevision: "quote:1|order:1", quote: { prefix: "Q-", nextNumber: "2000" }, order: { prefix: "O-", nextNumber: "2000" } }).expect(200);
  assert.deepEqual(calls, ["save"]);
}
{
  const weak = { ...actor, authority: { ...actor.authority, capabilities: [] as const } };
  const { value, calls } = app(weak);
  await request(value).get("/v2/organizations/org-a/settings/organization/numbering").expect(403);
  assert.deepEqual(calls, []);
}
{
  const crossTenant = { ...actor, organizationId: "org-b" };
  const { value, calls } = app(crossTenant);
  await request(value).get("/v2/organizations/org-a/settings/organization/numbering").expect(403);
  assert.deepEqual(calls, []);
}
console.log("document numbering settings HTTP pure contracts passed");
