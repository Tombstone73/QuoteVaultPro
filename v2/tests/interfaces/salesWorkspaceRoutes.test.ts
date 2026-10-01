import express from "express";
import request from "supertest";
import { describe, expect, jest, test } from "@jest/globals";
import { requireV2CsrfToken } from "../../infrastructure/authentication/sessionCsrf.js";
import type { Principal, StaffPrincipal } from "../../src/authorization/principals.js";
import { failure, success, V2ApplicationError, type ApplicationErrorCode } from "../../src/errors/applicationError.js";
import { SalesWorkspaceApplicationService } from "../../src/modules/sales/workspaceApplication.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";
import type { SalesWorkspace, SalesWorkspaceTransaction } from "../../src/modules/sales/workspaceContracts.js";
import { createSalesWorkspaceRouter, type SalesWorkspaceHttpDependencies } from "../../src/interfaces/http/salesWorkspaceRoutes.js";
import { createV2HttpApp } from "../../src/interfaces/http/app.js";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const lineId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const claimId = "66666666-6666-4666-8666-666666666666";
const customerId = "77777777-7777-4777-8777-777777777777";
const contactId = brandedId<"ContactId">("88888888-8888-4888-8888-888888888888");
const base = `/v2/organizations/${org}/sales-workspaces`;
const path = `${base}/${id}`;
const command = { requestId: "request-1", expectedRevision: 7 };
const line = { productId, quantity: 2, selections: { finish: "matte" }, description: "Signs" };
const principal: StaffPrincipal = { kind: "staff", organizationId: org, userId: "staff-1",
  authority: { membershipId: "membership-1", capabilities: ["order.create"] } };
const workspace: SalesWorkspace = { id, organizationId: org, creatorUserId: principal.userId, kind: "new_sales", state: "draft",
  revision: 7, header: {}, lines: [], createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-10-31T00:00:00.000Z" };
const claim = { id: claimId, workspaceId: id, workspaceLineId: lineId, filename: "source.pdf", contentType: "application/pdf" as const,
  byteSize: 20, checksumSha256: "a".repeat(64), state: "uploaded" as const, artworkFileId: null, assignmentId: null };
const artworkResult = { claim, workspaceRevision: 8 };

function fixture(actor: Principal = principal) {
  const service = {
    create: jest.fn<SalesWorkspaceHttpDependencies["service"]["create"]>().mockResolvedValue(workspace),
    get: jest.fn<SalesWorkspaceHttpDependencies["service"]["get"]>().mockResolvedValue(workspace),
    list: jest.fn<SalesWorkspaceHttpDependencies["service"]["list"]>().mockResolvedValue([workspace]),
    saveDraft: jest.fn<SalesWorkspaceHttpDependencies["service"]["saveDraft"]>().mockResolvedValue(workspace),
    discard: jest.fn<SalesWorkspaceHttpDependencies["service"]["discard"]>().mockResolvedValue({ ...workspace, state: "discarded" }),
  };
  const lines = {
    add: jest.fn<SalesWorkspaceHttpDependencies["lines"]["add"]>().mockResolvedValue(workspace),
    update: jest.fn<SalesWorkspaceHttpDependencies["lines"]["update"]>().mockResolvedValue(workspace),
    remove: jest.fn<SalesWorkspaceHttpDependencies["lines"]["remove"]>().mockResolvedValue(workspace),
    reorder: jest.fn<SalesWorkspaceHttpDependencies["lines"]["reorder"]>().mockResolvedValue(workspace),
    refresh: jest.fn<SalesWorkspaceHttpDependencies["lines"]["refresh"]>().mockResolvedValue(workspace),
  };
  const principals = { principal: jest.fn<SalesWorkspaceHttpDependencies["principals"]["principal"]>().mockResolvedValue(actor) };
  const promotion = { promote: jest.fn<SalesWorkspaceHttpDependencies["promotion"]["promote"]>().mockResolvedValue(success({
    receipt: { workspaceId: id, organizationId: org, requestId: command.requestId, inputRevision: 7, fingerprint: "server-derived",
      target: "order", documentId: productId, documentRevision: "1", header: {}, lineMap: [], promotedAt: workspace.createdAt,
      result: { number: { core: "1001" } }, artworkPromoted: false }, replayed: false, promotedWorkspaceHeader: {},
  })) };
  const formReads = {
    products: jest.fn<SalesWorkspaceHttpDependencies["formReads"]["products"]>().mockResolvedValue([{ productId, displayName: "Sign", measurementMode: "quantity_only", requiresDimensions: false }]),
    customers: jest.fn<SalesWorkspaceHttpDependencies["formReads"]["customers"]>().mockResolvedValue([{ customerId, displayName: "Customer" }]),
    contacts: jest.fn<SalesWorkspaceHttpDependencies["formReads"]["contacts"]>().mockResolvedValue([]),
    configuration: jest.fn<SalesWorkspaceHttpDependencies["formReads"]["configuration"]>().mockResolvedValue({ productId, fields: [], effectiveSelections: {} }),
  };
  const contactRows = [{ organizationId: org, linkedCustomerId: customerId, id: contactId, label: "Casey Contact" }];
  const contactSelection = {
    lookupActiveContacts: jest.fn<SalesWorkspaceHttpDependencies["contactSelection"]["lookupActiveContacts"]>().mockImplementation(async (organizationId, query) => {
      const eligible = contactRows.filter(row => row.organizationId === organizationId && (query.customerId === undefined || row.linkedCustomerId === query.customerId));
      const choices = eligible.map(({ id, label }) => ({ id, label }));
      return { items: choices.filter(row => row.label.toLowerCase().includes(query.search?.trim().toLowerCase() ?? "")).slice(0, query.limit ?? 25),
        selectedContact: choices.find(row => row.id === query.selectedContactId) ?? null };
    }),
  };
  const preview = jest.fn<SalesWorkspaceHttpDependencies["preview"]>();
  const artwork = {
    uploads: { upload: jest.fn<SalesWorkspaceHttpDependencies["artwork"]["uploads"]["upload"]>().mockResolvedValue(success(artworkResult)) },
    lifecycle: {
      list: jest.fn<SalesWorkspaceHttpDependencies["artwork"]["lifecycle"]["list"]>().mockResolvedValue([claim]),
      assign: jest.fn<SalesWorkspaceHttpDependencies["artwork"]["lifecycle"]["assign"]>().mockResolvedValue(artworkResult),
      remove: jest.fn<SalesWorkspaceHttpDependencies["artwork"]["lifecycle"]["remove"]>().mockResolvedValue({ ...artworkResult, claim: { ...claim, state: "cleanup_pending" } }),
    },
    download: jest.fn<NonNullable<SalesWorkspaceHttpDependencies["artwork"]["download"]>>().mockResolvedValue({ filename: "source.pdf", bytes: Buffer.from("%PDF-1.4\nread-only") }),
  };
  const dependencies: SalesWorkspaceHttpDependencies = { service, lines, principals, promotion, formReads, contactSelection, preview, artwork };
  const app = express().use(express.json()).use("/v2/organizations/:organizationId/sales-workspaces", createSalesWorkspaceRouter(dependencies));
  const operations = [...Object.values(service), ...Object.values(lines), promotion.promote, ...Object.values(formReads), contactSelection.lookupActiveContacts, preview,
    artwork.uploads.upload, ...Object.values(artwork.lifecycle), artwork.download];
  return { app, dependencies, service, lines, principals, promotion, formReads, contactSelection, preview, artwork, operations };
}

function protectedFixture(actor: Principal = principal) {
  const f = fixture(actor);
  const csrfToken = "test-workspace-session-csrf";
  const trustedHost = jest.fn<express.RequestHandler>().mockImplementation((request, _response, next) => {
    Object.assign(request, { session: { v2CsrfToken: csrfToken } });
    next();
  });
  const app = express().use(express.json({ limit: "1mb" })).use(
    "/v2/organizations/:organizationId/sales-workspaces", trustedHost, requireV2CsrfToken, createSalesWorkspaceRouter(f.dependencies),
  );
  return { ...f, app, csrfToken, trustedHost };
}

describe("Sales workspace HTTP transport", () => {
  test("actual optional app mount bootstraps order-only Staff and applies trusted session plus CSRF before workspace services", async () => {
    const f = fixture();
    const session = { v2CsrfToken: "host-issued-csrf", v2SessionScope: "host-session-scope" };
    const trustedHostMiddleware = jest.fn<express.RequestHandler>().mockImplementation((request, _response, next) => {
      Object.assign(request, { session }); next();
    });
    // Unrelated Quote/CRM ports only satisfy the host's mount shape, and fail if used.
    const unusedPorts = new Proxy({}, { get: (_target, key) => { throw new Error(`Unexpected non-workspace port: ${String(key)}`); } }) as never;
    const args: Parameters<typeof createV2HttpApp> = [
      { environment: "test", serviceName: "workspace-mount-regression", port: 8080 }, { log: () => undefined },
    ];
    await request(createV2HttpApp(...args)).get(base).expect(404);
    args[3] = {
      trustedHostMiddleware, dependencies: { principals: f.principals, service: unusedPorts, formReads: unusedPorts },
      customerDependencies: unusedPorts, contactDependencies: unusedPorts, productDependencies: unusedPorts,
      taxSettingsDependencies: unusedPorts, organizationSettingsDependencies: unusedPorts, teamAccessDependencies: unusedPorts,
      documentNumberingSettingsDependencies: unusedPorts, actionCenterDependencies: unusedPorts,
    };
    args[22] = { dependencies: f.dependencies, trustedHostMiddleware };
    const app = createV2HttpApp(...args);
    const bootstrap = await request(app).get(`/v2/organizations/${org}/ui-bootstrap`).expect(200);
    expect(Object.keys(bootstrap.body).sort()).toEqual(["data", "ok"]);
    expect(bootstrap.body.data).toMatchObject({ organizationId: org, userId: principal.userId,
      csrfToken: session.v2CsrfToken, sessionScope: session.v2SessionScope,
      capabilities: { orderCreate: true, quoteCreate: false, quoteView: false } });
    expect(bootstrap.headers["x-v2-session-scope"]).toBe(session.v2SessionScope);
    f.principals.principal.mockClear();
    await request(app).post(base).send({ requestId: "create-mount" }).expect(403);
    expect(f.principals.principal).not.toHaveBeenCalled();
    expect(f.service.create).not.toHaveBeenCalled();
    await request(app).post(base).set("x-v2-csrf-token", bootstrap.body.data.csrfToken).send({ requestId: "create-mount" }).expect(200);
    expect(f.service.create).toHaveBeenCalledWith(expect.objectContaining({ principal, organizationId: org,
      businessRequest: expect.objectContaining({ id: "create-mount" }) }), { requestId: "create-mount", kind: undefined });
    const products = await request(app).get(`${path}/products`).expect(200);
    expect(products.headers["x-v2-session-scope"]).toBe(session.v2SessionScope);
    expect(f.formReads.products).toHaveBeenCalledWith(org, undefined);
    await request(app).get(`${path}/products/${productId}/configuration`).expect(200);
    expect(f.formReads.configuration).toHaveBeenCalledWith(org, productId);
    expect(trustedHostMiddleware).toHaveBeenCalledTimes(5);
    expect(principal.authority.capabilities).toEqual(["order.create"]);
  });

  test("trusted-host wrapped JSON and multipart endpoints reject missing CSRF before principal or service calls", async () => {
    const f = protectedFixture();
    const requests = [
      ["post", base, { requestId: "create-1" }],
      ["patch", path, { ...command, header: {} }],
      ["post", `${path}/discard`, command],
      ["post", `${path}/promote`, { ...command, target: "order" }],
      ["post", `${path}/lines`, { ...command, line }],
      ["patch", `${path}/lines/${lineId}`, { ...command, line }],
      ["delete", `${path}/lines/${lineId}`, command],
      ["post", `${path}/lines/reorder`, { ...command, lineIds: [lineId] }],
      ["post", `${path}/lines/refresh`, command],
      ["delete", `${path}/artwork/${claimId}`, command],
      ["post", `${path}/artwork/${claimId}/assign`, { ...command, workspaceLineId: lineId }],
      ["post", `${path}/products/${productId}/resolve`, { selections: {} }],
      ["post", `${path}/products/${productId}/preview`, { quantity: 2 }],
    ] as const;
    for (const [method, url, body] of requests) {
      const response = await request(f.app)[method](url).send(body).expect(403);
      expect(response.body).toEqual({ ok: false, error: { code: "FORBIDDEN", message: "A valid V2 CSRF token is required." } });
    }
    await request(f.app).post(`${path}/artwork`).field("requestId", "upload-1").field("expectedRevision", "7")
      .attach("file", Buffer.from("%PDF-1.4"), "source.pdf").expect(403);
    expect(f.trustedHost).toHaveBeenCalledTimes(requests.length + 1);
    expect(f.principals.principal).not.toHaveBeenCalled();
    expect(f.operations.every((operation) => operation.mock.calls.length === 0)).toBe(true);
  });

  test("CSRF must match a trusted session and never replaces verified principal authorization", async () => {
    const f = protectedFixture();
    await request(f.app).post(base).set("X-V2-CSRF-Token", "wrong-session-token").send({ requestId: "create-1" }).expect(403);
    f.trustedHost.mockImplementationOnce((_request, _response, next) => next());
    await request(f.app).post(base).set("X-V2-CSRF-Token", f.csrfToken).send({ requestId: "create-1" }).expect(403);
    expect(f.principals.principal).not.toHaveBeenCalled();
    f.principals.principal.mockRejectedValueOnce(new V2ApplicationError("FORBIDDEN", "Verified membership required."));
    await request(f.app).post(base).set("X-V2-CSRF-Token", f.csrfToken).send({ requestId: "create-1" }).expect(403);
    expect(f.service.create).not.toHaveBeenCalled();
    const created = await request(f.app).post(base).set("X-V2-CSRF-Token", f.csrfToken).set("X-Request-Id", "http-trace-1")
      .send({ requestId: "business-create-1" }).expect(200);
    expect(created.body).toEqual({ ok: true, data: workspace });
    expect(f.service.create.mock.calls[0]?.[0]).toEqual({ principal, organizationId: org, operationId: "http:POST:/",
      businessRequest: { id: "business-create-1", payloadFingerprint: "route-fingerprint-is-derived-by-operation" } });
  });

  test("wrapped GET and HEAD do not require CSRF or trigger cleanup", async () => {
    const f = protectedFixture();
    await request(f.app).get(path).expect(200);
    await request(f.app).head(path).expect(200);
    await request(f.app).get(`${path}/artwork`).expect(200);
    await request(f.app).head(`${path}/artwork/${claimId}/content`).expect(200);
    expect(f.trustedHost).toHaveBeenCalledTimes(4);
    expect(f.principals.principal).toHaveBeenCalledTimes(4);
    expect(f.service.saveDraft).not.toHaveBeenCalled();
    expect(f.service.discard).not.toHaveBeenCalled();
    expect(f.artwork.lifecycle.remove).not.toHaveBeenCalled();
    expect(f.artwork.uploads.upload).not.toHaveBeenCalled();
  });

  test("uses fresh verified Staff and route organization for neutral creation and save", async () => {
    const f = fixture();
    const created = await request(f.app).post(base).send({ requestId: "create-1", kind: "new_sales", header: {} }).expect(200);
    expect(created.body).toEqual({ ok: true, data: workspace });
    const refreshed = { ...principal, authority: { ...principal.authority, authorityRevision: "fresh-2" } };
    f.principals.principal.mockResolvedValue(refreshed);
    const header = { jobLabel: "Storefront", customerContact: { organizationId: org, customerId } };
    await request(f.app).patch(path).send({ ...command, header }).expect(200);
    expect(f.principals.principal).toHaveBeenCalledTimes(2);
    expect(f.principals.principal.mock.calls.every(([, organizationId]) => organizationId === org)).toBe(true);
    expect(f.service.create.mock.calls[0]).toEqual([
      { principal, organizationId: org, operationId: "http:POST:/", businessRequest: { id: "create-1", payloadFingerprint: "route-fingerprint-is-derived-by-operation" } },
      { requestId: "create-1", kind: "new_sales", header: {} },
    ]);
    expect(f.service.saveDraft.mock.calls[0]).toEqual([
      { principal: refreshed, organizationId: org, operationId: `http:PATCH:/${id}`, businessRequest: { id: command.requestId, payloadFingerprint: "route-fingerprint-is-derived-by-operation" } },
      id, { ...command, header },
    ]);
    expect(f.promotion.promote).not.toHaveBeenCalled();
  });

  test.each([
    { requestId: "x", organizationId: otherOrg }, { requestId: "x", principal }, { requestId: "x", creatorUserId: "other" },
    { requestId: "x", header: { extra: true } }, { requestId: "x", header: { jobLabel: "x".repeat(301) } },
    { requestId: "x", header: { terms: { capability: "order.create" } } }, { requestId: "x", kind: "order_edit" },
    { requestId: "" }, { requestId: "x".repeat(129) }, { requestId: "request 1" }, { requestId: 123 },
  ])("rejects malformed or authority-bearing create input before service: %j", async (body) => {
    const f = fixture();
    await request(f.app).post(base).send(body).expect(400);
    expect(f.operations.every((operation) => operation.mock.calls.length === 0)).toBe(true);
  });

  test.each<[Principal, number]>([
    [{ ...principal, organizationId: otherOrg }, 404],
    [{ kind: "service", organizationId: org, clientId: "client", capabilities: ["order.create"] }, 403],
    [{ kind: "portal", organizationId: org, customerId, subjectId: "portal", capabilities: ["order.create"] }, 403],
    [{ ...principal, authority: { ...principal.authority, role: "administrator", capabilities: [] } }, 403],
  ])("rejects untrusted kind/capability or tenant before all service calls", async (actor, expected) => {
    const f = fixture(actor);
    await request(f.app).post(base).set("X-Organization-Id", org).send({ requestId: "create-1" }).expect(expected);
    await request(f.app).get(`${path}/products`).expect(expected);
    expect(f.operations.every((operation) => operation.mock.calls.length === 0)).toBe(true);
  });

  test("failed principal issuance never invokes an operation or consumes an upload", async () => {
    const f = fixture();
    f.principals.principal.mockRejectedValue(new V2ApplicationError("FORBIDDEN", "Verified membership required."));
    await request(f.app).post(`${path}/artwork`).field("requestId", "upload-1").field("expectedRevision", "7").attach("file", Buffer.from("%PDF-1.4"), "a.pdf").expect(403);
    expect(f.operations.every((operation) => operation.mock.calls.length === 0)).toBe(true);
  });

  test.each([0, -1, 1.5, "7", null, 2147483647])("rejects invalid workspace CAS revision %j", async (expectedRevision) => {
    const f = fixture();
    await request(f.app).patch(path).send({ ...command, expectedRevision, header: {} }).expect(400);
    expect(f.service.saveDraft).not.toHaveBeenCalled();
  });

  test("rejects a customer header from another tenant", async () => {
    const f = fixture();
    await request(f.app).patch(path).send({ ...command, header: { customerContact: { organizationId: otherOrg, customerId } } }).expect(404);
    expect(f.service.saveDraft).not.toHaveBeenCalled();
  });

  test("transport trace correlation cannot replace the body business request identity", async () => {
    const f = fixture();
    await request(f.app).post(`${path}/discard`).set("X-Request-Id", "trace-only").set("X-Business-Request-Id", "ignored-unapproved-header").send(command).expect(200);
    expect(f.service.discard.mock.calls[0]?.[0].businessRequest?.id).toBe(command.requestId);
    await request(f.app).post(`${path}/discard`).set("X-Request-Id", "trace-only").send({ expectedRevision: 7 }).expect(400);
    expect(f.service.discard).toHaveBeenCalledTimes(1);
  });

  test.each(["0", "101", "-1", "1.5", "garbage", "", "1e2"])("rejects invalid list limit %s", async (limit) => {
    const f = fixture();
    await request(f.app).get(base).query({ limit }).expect(400);
    expect(f.service.list).not.toHaveBeenCalled();
  });

  test("GET and HEAD are read-only and keep service-projected expiry", async () => {
    const f = fixture();
    f.service.get.mockResolvedValue({ ...workspace, state: "expired" });
    const read = await request(f.app).get(path).expect(200);
    expect(read.body.data.state).toBe("expired");
    expect(read.headers["cache-control"]).toBe("private, no-store");
    await request(f.app).head(path).expect(200);
    await request(f.app).get(base).query({ limit: 100 }).expect(200);
    expect(f.service.get).toHaveBeenCalledTimes(2);
    expect(f.service.list).toHaveBeenCalledWith(expect.objectContaining({ organizationId: org, principal }), 100);
    expect(f.service.get.mock.calls.every(([context]) => context.businessRequest === undefined)).toBe(true);
    expect(f.service.saveDraft).not.toHaveBeenCalled();
    expect(f.service.discard).not.toHaveBeenCalled();
    expect(f.artwork.lifecycle.remove).not.toHaveBeenCalled();
  });

  test("delegates all line operations with stable path IDs and an atomic optional header", async () => {
    const f = fixture();
    const header = { jobLabel: "Atomic header" };
    await request(f.app).post(`${path}/lines`).send({ ...command, header, line }).expect(200);
    await request(f.app).patch(`${path}/lines/${lineId}`).send({ ...command, header, line }).expect(200);
    await request(f.app).delete(`${path}/lines/${lineId}`).send({ ...command, header }).expect(200);
    await request(f.app).post(`${path}/lines/reorder`).send({ ...command, header, lineIds: [lineId] }).expect(200);
    await request(f.app).post(`${path}/lines/refresh`).send({ ...command, header }).expect(200);
    for (const [method, payload] of [
      ["add", { ...command, header, line }], ["update", { ...command, header, line, lineId }],
      ["remove", { ...command, header, lineId }], ["reorder", { ...command, header, lineIds: [lineId] }], ["refresh", { ...command, header }],
    ] as const) {
      expect(f.lines[method]).toHaveBeenCalledWith(expect.objectContaining({ principal, organizationId: org, businessRequest: { id: command.requestId, payloadFingerprint: "route-fingerprint-is-derived-by-operation" } }), id, payload);
    }
    expect(f.service.saveDraft).not.toHaveBeenCalled();
  });

  test("rejects unstable IDs, excess reorder, raw configuration evidence and unknown line fields", async () => {
    const f = fixture();
    await request(f.app).patch(`${path}/lines/temporary-1`).send({ ...command, line }).expect(400);
    await request(f.app).post(`${path}/lines/reorder`).send({ ...command, lineIds: Array(501).fill(lineId) }).expect(400);
    await request(f.app).post(`${path}/lines`).send({ ...command, line, preview: { calculatedLineAmount: 1 } }).expect(400);
    await request(f.app).post(`${path}/lines`).send({ ...command, line: { ...line, resolvedConfiguration: { tree: "caller" } } }).expect(400);
    await request(f.app).post(`${path}/lines`).send({ ...command, line: { ...line, quantity: "2" } }).expect(400);
    expect(Object.values(f.lines).every((operation) => operation.mock.calls.length === 0)).toBe(true);
  });

  test("neutral configuration uses existing form primitives after actual creator authorization", async () => {
    const f = fixture();
    const get = jest.fn<SalesWorkspaceTransaction["get"]>().mockResolvedValue(workspace);
    const owner = new SalesWorkspaceApplicationService({
      run: async (work) => work({ get } as unknown as SalesWorkspaceTransaction),
      withWorkspace: async () => { throw new Error("No mutation expected"); },
    }, { now: () => new Date(workspace.createdAt) });
    f.service.get.mockImplementation((context, workspaceId) => owner.get(context, workspaceId));
    await request(f.app).get(`${path}/products`).query({ q: "Signs" }).expect(200);
    await request(f.app).get(`${path}/products/${productId}/configuration`).expect(200);
    await request(f.app).post(`${path}/products/${productId}/resolve`).send({ selections: { finish: "matte" } }).expect(200);
    const refreshed = { ...principal, authority: { ...principal.authority, authorityRevision: "fresh-contact-read" } };
    f.principals.principal.mockResolvedValueOnce(refreshed);
    const contactRead = await request(f.app).get(`${path}/contacts`).query({ customerId, search: "Casey", limit: "1", selectedContactId: contactId }).expect(200);
    expect(f.formReads.products).toHaveBeenCalledWith(org, "Signs");
    expect(f.formReads.configuration).toHaveBeenLastCalledWith(org, productId, { finish: "matte" });
    expect(contactRead.headers["cache-control"]).toBe("private, no-store");
    expect(contactRead.body.data).toEqual({ items: [{ id: contactId, label: "Casey Contact" }], selectedContact: { id: contactId, label: "Casey Contact" } });
    expect(f.contactSelection.lookupActiveContacts).toHaveBeenCalledWith(org, { customerId, search: "Casey", limit: 1, selectedContactId: contactId });
    expect(f.service.get).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: org, principal: refreshed }), id);
    expect(f.principals.principal.mock.invocationCallOrder.at(-1)!).toBeLessThan(f.service.get.mock.invocationCallOrder.at(-1)!);
    expect(get.mock.invocationCallOrder.at(-1)!).toBeLessThan(f.contactSelection.lookupActiveContacts.mock.invocationCallOrder[0]!);
    expect(f.formReads.contacts).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(org, principal.userId, id, false);
    expect(get).toHaveBeenCalledTimes(4);
    get.mockResolvedValue({ ...workspace, creatorUserId: "someone-else" });
    await request(f.app).get(`${path}/products`).expect(404);
    await request(f.app).post(`${path}/products/${productId}/preview`).send({ quantity: 2 }).expect(404);
    await request(f.app).get(`${path}/contacts`).query({ selectedContactId: contactId }).expect(404);
    expect(f.formReads.products).toHaveBeenCalledTimes(1);
    expect(f.preview).not.toHaveBeenCalled();
    expect(f.contactSelection.lookupActiveContacts).toHaveBeenCalledTimes(1);
    expect(get.mock.calls.every(([, , , lock]) => lock === false)).toBe(true);
    expect(principal.authority.capabilities).toEqual(["order.create"]);
  });

  test("contact-only reads hydrate only scoped fixture IDs independently of search and reauthorize every request", async () => {
    const f = fixture();
    const response = await request(f.app).get(`${path}/contacts`).query({ search: "no-match", limit: "1", selectedContactId: contactId }).expect(200);
    expect(response.body.data).toEqual({ items: [], selectedContact: { id: contactId, label: "Casey Contact" } });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(f.contactSelection.lookupActiveContacts).toHaveBeenLastCalledWith(org, { search: "no-match", limit: 1, selectedContactId: contactId });
    expect(f.service.get.mock.invocationCallOrder[0]!).toBeLessThan(f.contactSelection.lookupActiveContacts.mock.invocationCallOrder[0]!);
    const unknown = await request(f.app).get(`${path}/contacts`).query({ selectedContactId: otherOrg }).expect(200);
    expect(unknown.body.data.selectedContact).toBeNull();
    const incompatible = await request(f.app).get(`${path}/contacts`).query({ customerId: otherOrg, selectedContactId: contactId }).expect(200);
    expect(incompatible.body.data).toEqual({ items: [], selectedContact: null });
    f.service.get.mockRejectedValueOnce(new V2ApplicationError("FORBIDDEN", "Workspace authority was revoked."));
    await request(f.app).get(`${path}/contacts`).query({ selectedContactId: contactId }).expect(403);
    expect(f.principals.principal).toHaveBeenCalledTimes(4);
    expect(f.service.get).toHaveBeenCalledTimes(4);
    expect(f.contactSelection.lookupActiveContacts).toHaveBeenCalledTimes(3);
    expect(f.formReads.contacts).not.toHaveBeenCalled();
    expect(f.service.saveDraft).not.toHaveBeenCalled(); expect(f.promotion.promote).not.toHaveBeenCalled();
  });

  test("neutral preview passes only original input and the authorized workspace to its owner", async () => {
    const f = fixture();
    const preview = { calculatedUnitAmount: money(currencyCode("USD"), 175), calculatedLineAmount: money(currencyCode("USD"), 350),
      currency: "USD", explanation: { optionImpacts: [], minimumChargeApplied: false } };
    f.preview.mockResolvedValue(preview);
    const input = { quantity: 2, selections: { finish: "matte" }, dimensions: { width: "12", height: "18", unit: "in" } };
    const result = await request(f.app).post(`${path}/products/${productId}/preview`).send(input).expect(200);
    expect(result.body.data).toEqual(preview);
    expect(f.preview).toHaveBeenCalledWith(expect.objectContaining({ principal, organizationId: org }), workspace, { productId, ...input });
    expect(f.preview.mock.calls[0]?.[0].businessRequest).toBeUndefined();
    await request(f.app).post(`${path}/products/${productId}/preview`).send({ ...input, selling: { kind: "unit_override", unitCents: 1 } }).expect(400);
    await request(f.app).post(`${path}/products/${productId}/resolve`).send({}).expect(400);
    await request(f.app).post(`${path}/products/${productId}/resolve`).send({ selections: {}, pricingResult: {} }).expect(400);
    expect(f.preview).toHaveBeenCalledTimes(1);
    expect(f.formReads.configuration).not.toHaveBeenCalled();
    expect(Object.values(f.lines).every((operation) => operation.mock.calls.length === 0)).toBe(true);
  });

  test("malformed paths and repeated query values are rejected before downstream calls", async () => {
    const f = fixture();
    await request(f.app).get("/v2/organizations/not-an-id/sales-workspaces").expect(400);
    expect(f.principals.principal).not.toHaveBeenCalled();
    await request(f.app).get(`${base}/not-a-workspace`).expect(400);
    await request(f.app).get(`${base}?limit=1&limit=2`).expect(400);
    await request(f.app).get(`${path}/products?q=a&q=b`).expect(400);
    await request(f.app).get(`${path}/products?creatorUserId=someone-else`).expect(400);
    expect(f.operations.every((operation) => operation.mock.calls.length === 0)).toBe(true);
  });

  test.each<[ApplicationErrorCode, number]>([
    ["FORBIDDEN", 403], ["NOT_FOUND", 404], ["WRONG_TENANT", 404], ["CONFLICT", 409], ["STALE_STATE", 409],
    ["IDEMPOTENCY_CONFLICT", 409], ["VALIDATION_ERROR", 400], ["RETRYABLE_FAILURE", 503], ["INTERNAL_ERROR", 500],
  ])("preserves owner error %s without leaking internal details", async (code, expectedStatus) => {
    const f = fixture();
    f.service.saveDraft.mockRejectedValue(new V2ApplicationError(code, "Safe owner message.", { privateSql: "sensitive" }, { cause: new Error("provider secret") }));
    const response = await request(f.app).patch(path).send({ ...command, header: {} }).expect(expectedStatus);
    expect(response.body).toEqual({ ok: false, error: { code, message: "Safe owner message." } });
    expect(JSON.stringify(response.body)).not.toMatch(/sensitive|provider secret|stack/);
  });

  test("unexpected errors are sanitized and promotion preserves its result envelope", async () => {
    const f = fixture();
    f.service.get.mockRejectedValueOnce(new Error("SQL connection password private"));
    const denied = await request(f.app).get(path).expect(500);
    expect(denied.body.error).toEqual({ code: "INTERNAL_ERROR", message: "Sales workspace operation could not be completed." });
    await request(f.app).post(`${path}/promote`).send({ ...command, target: "invoice" }).expect(400);
    expect(f.promotion.promote).not.toHaveBeenCalled();
    const promoted = await request(f.app).post(`${path}/promote`).send({ ...command, target: "order" }).expect(200);
    expect(promoted.body.data.receipt.result).toEqual({ number: { core: "1001" } });
    expect(f.promotion.promote).toHaveBeenCalledWith(expect.objectContaining({ principal, businessRequest: expect.objectContaining({ id: command.requestId }) }), { ...command, workspaceId: id, target: "order" });
    f.promotion.promote.mockResolvedValue(failure(new V2ApplicationError("CONFLICT", "Refresh stale pricing.")));
    await request(f.app).post(`${path}/promote`).send({ ...command, target: "quote" }).expect(409);
  });

  test("stages exact binary bytes and MIME metadata without trusting MIME acceptance", async () => {
    const f = fixture();
    const bytes = Buffer.from("%PDF-1.4\nraw-binary-\x00-evidence");
    await request(f.app).post(`${path}/artwork`)
      .field("requestId", command.requestId).field("expectedRevision", "7").field("workspaceLineId", lineId)
      .attach("file", bytes, { filename: "source.pdf", contentType: "application/octet-stream" }).expect(200);
    expect(f.artwork.uploads.upload).toHaveBeenCalledWith(expect.objectContaining({ principal, organizationId: org,
      businessRequest: expect.objectContaining({ id: command.requestId }) }), {
      ...command, workspaceId: id, workspaceLineId: lineId, filename: "source.pdf", contentType: "application/octet-stream", bytes,
    });
    f.artwork.uploads.upload.mockResolvedValue(failure(new V2ApplicationError("NOT_PDF", "File is not a PDF.")));
    await request(f.app).post(`${path}/artwork`).field("requestId", "upload-2").field("expectedRevision", "7")
      .attach("file", Buffer.from("not a PDF"), { filename: "fake.pdf", contentType: "application/pdf" }).expect(400);
    expect(f.artwork.uploads.upload).toHaveBeenCalledTimes(2);
  });

  test("multipart rejects missing, duplicate, extra fields/files and malformed framing", async () => {
    const f = fixture();
    const upload = () => request(f.app).post(`${path}/artwork`).field("requestId", command.requestId).field("expectedRevision", "7");
    await upload().expect(400);
    await upload().field("requestId", "again").attach("file", Buffer.from("pdf"), "source.pdf").expect(400);
    await upload().field("organizationId", otherOrg).attach("file", Buffer.from("pdf"), "source.pdf").expect(400);
    await upload().attach("wrong", Buffer.from("pdf"), "source.pdf").expect(400);
    await upload().attach("file", Buffer.from("pdf"), "source.pdf").attach("file", Buffer.from("pdf"), "other.pdf").expect(400);
    await request(f.app).post(`${path}/artwork`).set("Content-Type", "multipart/form-data").send("no boundary").expect(400);
    expect(f.artwork.uploads.upload).not.toHaveBeenCalled();
  });

  test("10 MB transport bound prevents owner upload and does not use temporary files", async () => {
    const f = fixture();
    const response = await request(f.app).post(`${path}/artwork`).field("requestId", "large").field("expectedRevision", "7")
      .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1, 65), "too-large.pdf").expect(400);
    expect(response.body.error.code).toBe("SIZE_LIMIT");
    expect(f.artwork.uploads.upload).not.toHaveBeenCalled();
  });

  test("accepts exactly 10 MB with valid CSRF despite the host JSON limit and maximum business identity length", async () => {
    const f = protectedFixture();
    const bytes = Buffer.alloc(10 * 1024 * 1024, 65);
    await request(f.app).post(`${path}/artwork`).set("X-V2-CSRF-Token", f.csrfToken).field("requestId", "a".repeat(128)).field("expectedRevision", "7")
      .attach("file", bytes, "boundary.pdf").expect(200);
    const uploaded = f.artwork.uploads.upload.mock.calls[0]?.[1].bytes;
    expect(uploaded?.byteLength).toBe(bytes.byteLength);
    expect(Buffer.from(uploaded!).equals(bytes)).toBe(true);
    await request(f.app).post(`${path}/artwork`).set("X-V2-CSRF-Token", f.csrfToken).field("requestId", "a".repeat(129)).field("expectedRevision", "7")
      .attach("file", Buffer.from("pdf"), "boundary.pdf").expect(400);
    expect(f.artwork.uploads.upload).toHaveBeenCalledTimes(1);
  });

  test("Artwork cleanup is explicit DELETE; list/download/HEAD never request cleanup", async () => {
    const f = fixture();
    await request(f.app).get(`${path}/artwork`).expect(200);
    const content = await request(f.app).get(`${path}/artwork/${claimId}/content`).expect(200);
    expect(content.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(content.headers["content-disposition"]).toBe('attachment; filename="source.pdf"');
    expect(content.headers["x-content-type-options"]).toBe("nosniff");
    await request(f.app).head(`${path}/artwork/${claimId}/content`).expect(200);
    expect(f.artwork.lifecycle.remove).not.toHaveBeenCalled();
    expect(f.artwork.uploads.upload).not.toHaveBeenCalled();
    expect(f.artwork.download).toHaveBeenCalledWith(expect.objectContaining({ principal, organizationId: org }), id, claimId);
    await request(f.app).delete(`${path}/artwork/${claimId}`).send(command).expect(200);
    expect(f.artwork.lifecycle.remove).toHaveBeenCalledWith(expect.objectContaining({ principal }), { ...command, workspaceId: id, claimId });
    await request(f.app).post(`${path}/artwork/${claimId}/assign`).send({ ...command, workspaceLineId: lineId }).expect(200);
    expect(f.artwork.lifecycle.assign).toHaveBeenCalledWith(expect.objectContaining({ principal }), { ...command, workspaceId: id, claimId, workspaceLineId: lineId });
    f.service.get.mockRejectedValue(new V2ApplicationError("NOT_FOUND", "Workspace unavailable."));
    await request(f.app).get(`${path}/artwork/${claimId}/content`).expect(404);
    expect(f.artwork.download).toHaveBeenCalledTimes(2);
  });
});
