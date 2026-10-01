import { beforeEach, expect, jest, test } from "@jest/globals";
import crypto from "node:crypto";
import express from "express";
import supertest from "supertest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { shippingDirectPrintRequestSchema, matchesShippingPrintRequest } from "../../shared/directPrintDocuments";
import { supportedAgentDocumentTypes, supportsShippingDocumentAgent } from "../lib/directPrintAgentCapabilities";

const dialect = new PgDialect();
const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
let rows: Record<string, any[]>;
const writes: any[] = [];
const reads: any[] = [];
const party = { name: "Recipient", company: null, address1: "123 Main", address2: null, city: "City", state: "CA", postalCode: "90210", country: "US", phone: null, email: null };
const frozenSource: any = { version: 1, basis: "draft", organizationId: "org", shipmentId: "shipment", shipmentReference: "S-1", shipDate: null, carrier: null, serviceLevel: null, trackingNumber: null, destination: party, sender: party, blindShipping: false, orders: [], internalNotes: null,
  packages: ["package-a", "package-b"].map((id, index) => ({ id, ordinal: index + 1, packageReference: id, weightLbs: null, dimLengthIn: null, dimWidthIn: null, dimHeightIn: null, internalNotes: null, lines: [] })), lines: [], capturedAt: "2026-10-01T12:00:00Z" };
const source = jest.fn(async () => frozenSource);
const wake = jest.fn(async (_hash: string) => ({ published: true, attempts: 1 }));
function matching(table: string, condition: any) {
  const { sql, params } = dialect.sqlToQuery(condition);
  reads.push({ table, sql, params });
  return (rows[table] ?? []).filter((row) => {
    for (const match of sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)) {
      if (row[camel(match[1])] !== params[Number(match[2]) - 1]) return false;
    }
    for (const match of sql.matchAll(/"[^"]+"\."([^"]+)" in \(([^)]+)\)/g)) {
      const allowed = Array.from(match[2].matchAll(/\$(\d+)/g), (entry) => params[Number(entry[1]) - 1]);
      if (!allowed.includes(row[camel(match[1])])) return false;
    }
    const capability = sql.match(/"supported_documents" \? \$(\d+)/);
    return !capability || row.supportedDocuments?.includes(params[Number(capability[1]) - 1]);
  });
}
const fakeDb: any = {
  select: () => {
    let table = "", condition: any, limit = Infinity;
    const chain: any = { from: (value: any) => { table = getTableName(value); return chain; }, where: (value: any) => { condition = value; return chain; }, limit: (value: number) => { limit = value; return chain; },
      then: (resolve: any) => Promise.resolve(matching(table, condition).slice(0, limit)).then(resolve) };
    chain.leftJoin = chain.innerJoin = () => chain; return chain;
  },
  insert: (table: any) => ({ values: (value: any) => ({ onConflictDoNothing: () => ({ returning: async () => {
    const name = getTableName(table);
    if (name !== "direct_print_jobs") throw new Error("Unexpected business write");
    if (rows[name].some((row) => row.organizationId === value.organizationId && row.requestKey === value.requestKey)) return [];
    const job = { id: "job", status: "queued", ...value }; writes.push({ table: name, value }); rows[name].push(job); return [job];
  } }) }) }),
  update: (table: any) => ({ set: (value: any) => ({ where: (condition: any) => {
    const name = getTableName(table);
    if (!["direct_print_jobs", "local_bridge_agents"].includes(name)) throw new Error("Unexpected business write");
    const selected = matching(name, condition); selected.forEach((row) => { const { attempts, ...fields } = value; Object.assign(row, fields); if (attempts) row.attempts = (row.attempts ?? 0) + 1; });
    const result: any = Promise.resolve(); result.returning = async () => selected; return result;
  } }) }),
};
jest.unstable_mockModule("../db", () => ({ db: fakeDb }));
jest.unstable_mockModule("../storage", () => ({ storage: {} }));
jest.unstable_mockModule("../tenantContext", () => ({ getRequestOrganizationId: (req: any) => req.organizationId }));
jest.unstable_mockModule("../services/shippingDocumentService", () => ({ getShippingDocumentSource: source }));
jest.unstable_mockModule("../services/orderTravelerSourceService", () => ({ getOrderTravelerSource: jest.fn() }));
jest.unstable_mockModule("../services/fulfillment/canonicalFulfillmentOperations", () => ({ canonicalFulfillmentOperations: {} }));
jest.unstable_mockModule("../services/printAgentWake", () => ({ publishPrintAgentWake: wake, getPrintAgentRealtimeConfiguration: () => null }));
jest.unstable_mockModule("../objectStorage", () => ({ ObjectStorageService: class {} }));
jest.unstable_mockModule("../lib/appRuntimeConfig", () => ({ getPublicWebOrigin: () => "https://dev.printershero.com" }));
const { registerPrinterProfileRoutes } = await import("../routes/printerProfiles.routes");
const { registerLocalBridgeRoutes } = await import("../routes/localBridge.routes");
const app = express(); app.use(express.json());
const auth = (req: any, res: any, next: any) => { if (req.headers["x-staff"] !== "yes") return res.sendStatus(401); req.organizationId = req.headers["x-org"] || "org"; next(); };
const next = (_req: any, _res: any, proceed: any) => proceed();
registerPrinterProfileRoutes(app, { isAuthenticated: auth, tenantContext: next, isAdminOrOwner: next });
registerLocalBridgeRoutes(app, { isAuthenticated: auth, tenantContext: next, requireOrgOwnerAdmin: next });
const payload = { documentType: "package_ticket", printerProfileId: "printer", requestKey: "key", copies: 2 };
const enqueue = (body = payload, shipmentId = "shipment", org = "org") => supertest(app).post(`/api/fulfillment/shipments/${shipmentId}/direct-print`).set("x-staff", "yes").set("x-org", org).send(body);
beforeEach(() => {
  writes.length = reads.length = 0; jest.clearAllMocks();
  source.mockImplementation(async () => frozenSource);
  rows = { direct_print_jobs: [], printer_profiles: [{ id: "printer", organizationId: "org", isActive: true, printAgentId: "agent", windowsQueueName: "queue-secret", queueName: "queue-secret", configuredQueueName: "queue-secret", displayName: "Office", location: "Shop", defaultCopies: 1, isDefault: true, supportedDocuments: ["packing_slip", "shipment_manifest", "package_ticket"], agentVersion: "1.0.25", agentStatus: "active", agentId: "agent" }],
    local_bridge_agents: [{ id: "agent", organizationId: "org", status: "active", tokenHash: crypto.createHash("sha256").update("bearer").digest("hex"), agentVersion: "1.0.25", configuredTravelerPrinterName: "queue-secret" }] };
});
test("one full package ticket set creates one frozen print job and no business writes", async () => {
  const response = await enqueue(); expect(response.status).toBe(202);
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ table: "direct_print_jobs", value: { documentType: "package_ticket", copies: 2, printContext: { shipmentId: "shipment", packageId: null, source: frozenSource } } });
  expect(wake).toHaveBeenCalledWith(rows.local_bridge_agents[0].tokenHash);
});
test("stable replay ignores edited live drafts, wakes actual saved agent, and never spools another job", async () => {
  await enqueue(); source.mockImplementation(async () => { throw new Error("Live source changed"); });
  rows.direct_print_jobs[0].agentId = "original-agent";
  rows.local_bridge_agents.push({ id: "original-agent", organizationId: "org", status: "active", tokenHash: "original-hash" });
  const replay = await enqueue(); expect(replay.status).toBe(200); expect(replay.body.data.duplicate).toBe(true);
  expect(source).toHaveBeenCalledTimes(1); expect(writes).toHaveLength(1); expect(wake).toHaveBeenLastCalledWith("original-hash");
});
test.each([{ copies: 3 }, { documentType: "packing_slip" }, { printerProfileId: "other" }, { packageId: "package-a" }])("reused key rejects changed semantics %j", async (change) => {
  await enqueue(); expect((await enqueue({ ...payload, ...change } as any)).status).toBe(409); expect(writes).toHaveLength(1);
});
test("cross-resource and cross-type key collisions conflict, not return unrelated jobs", async () => {
  await enqueue(); expect((await enqueue(payload, "other-shipment")).status).toBe(409);
  rows.direct_print_jobs[0].documentType = "traveler"; expect((await enqueue()).status).toBe(409);
});
test("rejects unsupported old profiles/agents, foreign tenants/packages, and operator HTML", async () => {
  rows.printer_profiles[0].supportedDocuments = ["traveler", "quick_note"]; expect((await enqueue()).status).toBe(409);
  rows.printer_profiles[0].supportedDocuments = ["package_ticket"]; rows.local_bridge_agents[0].agentVersion = "1.0.24"; expect((await enqueue()).status).toBe(409);
  rows.local_bridge_agents[0].agentVersion = "1.0.25"; expect((await enqueue(payload, "shipment", "other-org")).status).toBe(409);
  expect((await enqueue({ ...payload, packageId: "foreign" } as any)).status).toBe(404);
  expect((await enqueue({ ...payload, html: "<p>untrusted</p>" } as any)).status).toBe(400); expect(writes).toHaveLength(0);
});
test.each([0, 100, 1.5, "2"])("rejects invalid copies %j before any source/write", async (copies) => {
  expect((await enqueue({ ...payload, copies } as any)).status).toBe(400); expect(source).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
});
test("foreign shipment and missing package set cannot freeze a printable job", async () => {
  expect((await enqueue(payload, "foreign-shipment")).status).toBe(404);
  source.mockImplementation(async () => ({ ...frozenSource, packages: [] }));
  expect((await enqueue()).status).toBe(409); expect(writes).toHaveLength(0);
});
test("public destination DTO excludes all queue/token fields and requires staff auth", async () => {
  const path = "/api/fulfillment/shipping-print-destinations?documentType=package_ticket";
  expect((await supertest(app).get(path)).status).toBe(401);
  const response = await supertest(app).get(path).set("x-staff", "yes"); expect(response.status).toBe(200);
  expect(response.body.data[0]).toMatchObject({ id: "printer", available: true }); expect(JSON.stringify(response.body)).not.toContain("queue-secret"); expect(response.body.data[0]).not.toHaveProperty("agentId");
});
test("shipping claimed source enforces bearer, org, assigned agent, claimed status, and explicit type", async () => {
  await enqueue(); const path = "/api/local-bridge/direct-print/jobs/job/document";
  expect((await supertest(app).get(path)).status).toBe(401);
  const get = () => supertest(app).get(path).set("Authorization", "Bearer bearer");
  expect((await get()).status).toBe(404);
  const job = rows.direct_print_jobs[0]; job.status = "claimed";
  const valid = await get(); expect(valid.status).toBe(200); expect(valid.body.data).toMatchObject({ jobId: "job", source: frozenSource, documentType: "package_ticket", copies: 2 });
  expect((await supertest(app).get("/api/local-bridge/direct-print/jobs/job/traveler").set("Authorization", "Bearer bearer")).status).toBe(404);
  for (const [field, wrong] of [["organizationId", "foreign"], ["agentId", "foreign-agent"], ["status", "submitted"], ["documentType", "traveler"]]) {
    const saved = job[field]; job[field] = wrong; expect((await get()).status).toBe(404); job[field] = saved;
  }
  expect(source).toHaveBeenCalledTimes(1);
});
test("old agents cannot list or claim shipping jobs and unknown types never dispatch", async () => {
  await enqueue(); rows.local_bridge_agents[0].agentVersion = "1.0.24";
  const list = await supertest(app).get("/api/local-bridge/direct-print/jobs").set("Authorization", "Bearer bearer"); expect(list.body.data).toEqual([]);
  const claim = () => supertest(app).post("/api/local-bridge/direct-print/jobs/job/claim").set("Authorization", "Bearer bearer").send({});
  expect((await claim()).status).toBe(409); expect(rows.direct_print_jobs[0].status).toBe("queued");
  rows.local_bridge_agents[0].agentVersion = "1.0.25";
  const accepted = await claim(); expect(accepted.status).toBe(200); expect(accepted.body.data.travelerUrl).toBe("https://dev.printershero.com/print-agent/documents/job");
  rows.direct_print_jobs[0].status = "queued"; rows.direct_print_jobs[0].documentType = "unknown"; expect((await claim()).status).toBe(409);
});
test("claimed source rejects malformed, wrong tenant/resource/package snapshots rather than falling back live", async () => {
  await enqueue(); const job = rows.direct_print_jobs[0]; job.status = "claimed";
  for (const context of [{ shipmentId: "shipment", packageId: null, source: {} },
    { shipmentId: "shipment", packageId: null, source: { ...frozenSource, organizationId: "foreign" } },
    { shipmentId: "wrong-shipment", packageId: null, source: frozenSource },
    { shipmentId: "shipment", packageId: "foreign", source: frozenSource }]) {
    job.printContext = context;
    expect((await supertest(app).get("/api/local-bridge/direct-print/jobs/job/document").set("Authorization", "Bearer bearer")).status).toBe(404);
  }
  expect(source).toHaveBeenCalledTimes(1);
});
test("closed request and semantic/version helpers preserve intentional old capabilities", () => {
  expect(supportsShippingDocumentAgent("1.0.24")).toBe(false); expect(supportsShippingDocumentAgent("1.0.25")).toBe(true);
  expect(supportedAgentDocumentTypes("1.0.23")).toEqual(["traveler", "pickup_traveler"]);
  expect(shippingDirectPrintRequestSchema.safeParse({ ...payload, documentType: "unknown" }).success).toBe(false);
  expect(shippingDirectPrintRequestSchema.safeParse({ ...payload, documentType: "packing_slip", packageId: "a" }).success).toBe(false);
  expect(matchesShippingPrintRequest({ documentType: "package_ticket", destinationId: "printer", copies: 2, printContext: { shipmentId: "shipment", packageId: null, source: { changed: true } } }, "shipment", payload as any)).toBe(true);
});
