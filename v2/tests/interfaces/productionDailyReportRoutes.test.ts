import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createProductionDailyReportRouter } from "../../src/interfaces/http/productionDailyReportRoutes.js";
import { ProductionDailyReportService, summarizeProductionDailyReport, type ProductionDailyReport } from "../../src/modules/production/productionDailyReport.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

const calendar = { asOf: "2026-10-01T05:00:00.000Z", timeZone: "UTC", todayDate: "2026-10-01", tomorrowDate: "2026-10-02" };
const report: ProductionDailyReport = { calendar, summary: summarizeProductionDailyReport([], calendar), rows: [], blockedWork: [], pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 }, coverage: { truncated: false, countsComplete: true, candidateLimit: 1_000, blockedWorkCount: 0 }, mode: "page" };
let reads = 0;
const seen: unknown[] = [];
let principal: StaffPrincipal = { kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["production.view"] } };
const app = express().use(express.json()).use("/v2/organizations/:organizationId/production", createProductionDailyReportRouter({
  principals: { principal: async () => principal },
  service: new ProductionDailyReportService({ readDailyReport: async (org, input) => { reads++; seen.push([org, input]); return { ...report, mode: input.mode, pagination: { ...report.pagination, page: input.page, pageSize: input.pageSize } }; } }),
}));
const endpoint = "/v2/organizations/org-a/production/daily-report";
const loaded = await request(app).get(endpoint).expect(200);
assert.deepEqual(loaded.body, { ok: true, data: report });
assert.equal(loaded.headers["cache-control"], "private, no-store");
assert.deepEqual(seen[0], ["org-a", { page: 1, pageSize: 25, mode: "page" }]);
await request(app).get(`${endpoint}?page=2&pageSize=50&mode=print`).expect(200);
assert.deepEqual(seen[1], ["org-a", { page: 2, pageSize: 50, mode: "print" }]);
for (const query of ["page=0", "page=-1", "page=Infinity", "page=1.2", "pageSize=101", "pageSize=0", "mode=pdf", "page=1&page=2", "mode[client]=print"]) await request(app).get(`${endpoint}?${query}`).expect(400);
await request(app).get("/v2/organizations/org-b/production/daily-report").expect(404).expect(response => assert.equal(response.body.error.code, "WRONG_TENANT"));
principal = { ...principal, authority: { membershipId: "membership-a", capabilities: ["production.work"] } };
await request(app).get(`${endpoint}?principal=owner&capability=production.view`).expect(403);
assert.equal(reads, 2, "actual owner service denies invalid paging, wrong tenant and forged authority before reads");
for (const method of ["post", "put", "patch", "delete"] as const) await request(app)[method](endpoint).send({ businessRequestId: "no-report-write" }).expect(404);
assert.equal(reads, 2);

const invalid = express().use("/v2/organizations/:organizationId/production", createProductionDailyReportRouter({ principals: { principal: async () => ({ ...principal, authority: { membershipId: "membership-a", capabilities: ["production.view"] } }) }, service: new ProductionDailyReportService({ readDailyReport: async () => { throw new V2ApplicationError("CONFLICT", "The operational projection returned inconsistent scopes."); } }) }));
await request(invalid).get(endpoint).expect(409).expect(response => assert.equal(response.body.error.code, "CONFLICT"));
const partial: ProductionDailyReport = { ...report, blockedWork: [{ productionWorkId: "lost-lineage", orderId: "order-a", orderLineId: "line-a", requirementKey: "unit", reasonCode: "unresolved_replacement_rework_lineage", reason: "BDR4: original/replacement classification is withheld." }], coverage: { ...report.coverage, countsComplete: false, blockedWorkCount: 1 } };
const blocked = express().use("/v2/organizations/:organizationId/production", createProductionDailyReportRouter({ principals: { principal: async () => ({ ...principal, authority: { membershipId: "membership-a", capabilities: ["production.view"] } }) }, service: new ProductionDailyReportService({ readDailyReport: async () => partial }) }));
await request(blocked).get(endpoint).expect(200).expect(response => { assert.deepEqual(response.body.data.blockedWork, partial.blockedWork); assert.equal(response.body.data.coverage.countsComplete, false); });
const hiddenError = express().use("/v2/organizations/:organizationId/production", createProductionDailyReportRouter({ principals: { principal: async () => { throw Error("private provider credential"); } }, service: new ProductionDailyReportService({ readDailyReport: async () => report }) }));
await request(hiddenError).get(endpoint).expect(500).expect(response => assert.doesNotMatch(JSON.stringify(response.body), /private|credential|provider/));
console.log("productionDailyReportRoutes: GET-only transport, scoped real authority, pagination, print and safe errors PASS");
