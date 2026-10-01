import assert from "node:assert/strict";
import { ProductionDailyReportService, normalizeProductionDailyReportRequest, productionDueCategory, summarizeProductionDailyReport, validateProductionCalendar, type ProductionCalendar, type ProductionDailyReport } from "../../src/modules/production/productionDailyReport.js";
import type { OperationContext } from "../../src/application/operation.js";

const calendar: ProductionCalendar = { asOf: "2026-10-01T00:01:00.000Z", timeZone: "Pacific/Honolulu", todayDate: "2026-09-30", tomorrowDate: "2026-10-01" };
validateProductionCalendar(calendar);
assert.deepEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", null].map(date => productionDueCategory(date, calendar)), ["overdue", "today", "tomorrow", "future", "undated"]);
const boundary = { ...calendar, asOf: "2026-11-01T05:59:59.999Z", timeZone: "America/New_York", todayDate: "2026-11-01", tomorrowDate: "2026-11-02" };
assert.equal(productionDueCategory("2026-11-01", boundary), "today", "classification uses the injected calendar, not asOf's UTC date or host timezone");
assert.equal(productionDueCategory("2026-11-02", { ...boundary, asOf: "2026-11-02T04:59:59.999Z" }), "tomorrow");
assert.equal(productionDueCategory("2028-03-01", { ...calendar, todayDate: "2028-02-29", tomorrowDate: "2028-03-01" }), "tomorrow");
assert.throws(() => validateProductionCalendar({ ...calendar, tomorrowDate: calendar.todayDate }));
assert.throws(() => validateProductionCalendar({ ...calendar, asOf: "2026-10-01" }));
assert.throws(() => validateProductionCalendar({ ...calendar, timeZone: "" }));

const facts = [
  { productionWorkId: "roll-a", orderId: "mixed", destination: "roll" as const, dueDate: "2026-09-29", activeAttemptId: "attempt-a" },
  { productionWorkId: "flat-a", orderId: "mixed", destination: "flatbed" as const, dueDate: "2026-09-29", activeAttemptId: null },
  { productionWorkId: "today", orderId: "order-today", destination: "roll" as const, dueDate: "2026-09-30", activeAttemptId: null },
  { productionWorkId: "tomorrow", orderId: "order-tomorrow", destination: "flatbed" as const, dueDate: "2026-10-01", activeAttemptId: "attempt-b" },
  { productionWorkId: "future", orderId: "order-future", destination: "roll" as const, dueDate: "2026-10-02", activeAttemptId: null },
  { productionWorkId: "unknown", orderId: "order-unknown", destination: "unknown" as const, dueDate: null, activeAttemptId: null },
];
const summary = summarizeProductionDailyReport(facts, calendar);
assert.deepEqual(summary, { totalActive: 6, overdue: 2, dueToday: 1, dueTomorrow: 1, future: 1, noDue: 1, roll: 3, flatbed: 2, unknownDestination: 1, distinctOrders: 5, activeAttempts: 2 });
assert.equal(summary.roll + summary.flatbed + summary.unknownDestination, summary.totalActive);
assert.throws(() => summarizeProductionDailyReport([...facts, facts[0]!], calendar), /duplicate work/);
assert.equal(summarizeProductionDailyReport([], calendar).totalActive, 0);
assert.deepEqual(normalizeProductionDailyReportRequest(), { page: 1, pageSize: 25, mode: "page" });
for (const request of [{ page: 0 }, { page: 1.5 }, { page: Infinity }, { page: 1_000_001 }, { pageSize: 101 }, { pageSize: 0 }, { mode: "pdf" }]) assert.throws(() => normalizeProductionDailyReportRequest(request as never));

let reads = 0;
const report: ProductionDailyReport = { calendar, summary, rows: [], blockedWork: [], pagination: { page: 1, pageSize: 25, totalCount: 6, totalPages: 1 }, coverage: { truncated: false, countsComplete: true, candidateLimit: 1_000, blockedWorkCount: 0 }, mode: "page" };
const service = new ProductionDailyReportService({ readDailyReport: async (org, request) => { reads++; assert.equal(org, "org-a"); assert.deepEqual(request, { page: 1, pageSize: 25, mode: "page" }); return report; } });
const context: OperationContext = { organizationId: "org-a", operationId: "report-test", principal: { kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["production.view"] } } };
assert.deepEqual(await service.dailyReport(context), { ok: true, value: report });
const wrongTenant = await service.dailyReport({ ...context, organizationId: "org-b" });
assert.equal(wrongTenant.ok, false); if (!wrongTenant.ok) assert.equal(wrongTenant.error.code, "WRONG_TENANT");
const denied = await service.dailyReport({ ...context, principal: { ...context.principal, authority: { membershipId: "membership-a", capabilities: ["production.work"] } } as OperationContext["principal"] });
assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, "FORBIDDEN");
assert.equal((await service.dailyReport(context, { pageSize: 999 })).ok, false);
assert.equal(reads, 1, "denied, cross-tenant and invalid requests never reach the read port");
const unavailable = await new ProductionDailyReportService({ readDailyReport: async () => { throw Error("private SQL password=secret"); } }).dailyReport(context);
assert.equal(unavailable.ok, false); if (!unavailable.ok) { assert.equal(unavailable.error.code, "INTERNAL_ERROR"); assert.doesNotMatch(unavailable.error.publicMessage, /private|password|secret/); }
console.log("productionDailyReport: calendar categories, unique summaries, pagination and real authority checks PASS");
