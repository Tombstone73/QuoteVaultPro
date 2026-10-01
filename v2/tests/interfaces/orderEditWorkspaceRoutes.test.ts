import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, jest, test } from "@jest/globals";
import request from "supertest";
import type { Request, RequestHandler } from "express";
import type { OperationContext } from "../../src/application/operation.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { PermissionSetPrincipalIssuer, type PermissionAuthorityReader } from "../../src/authorization/permissionSets.js";
import { success, V2ApplicationError } from "../../src/errors/applicationError.js";
import { authorizeOrderEditWorkspace } from "../../src/modules/sales/orderEditWorkspace.js";
import { authorizeSalesWorkspace } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace } from "../../src/modules/sales/workspaceContracts.js";
import type { WorkspacePromotionReceipt } from "../../src/modules/sales/workspacePromotion.js";
import { createV2HttpApp } from "../../src/interfaces/http/app.js";
import type { SalesWorkspaceHttpDependencies } from "../../src/interfaces/http/salesWorkspaceRoutes.js";
import { IssuedV2PrincipalProvider, PassportSessionIdentitySource } from "../../infrastructure/authentication/trustedHostPrincipalProvider.js";

// These are injected-service HTTP tests, not DB tests. Authentication issuance
// and the application's real CSRF mount are exercised without root Jest setup.
assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
assert.deepEqual(Object.keys(process.env).filter(key => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);

const org = randomUUID(), otherOrg = randomUUID(), staff = randomUUID(), otherStaff = randomUUID();
const orderId = randomUUID(), workspaceId = randomUUID(), assignmentId = randomUUID(), fileId = randomUUID(), lineId = randomUUID();
const base = `/v2/organizations/${org}/sales-workspaces`;
const csrf = "a-server-issued-session-csrf-token";
const initialCapabilities: readonly Capability[] = ["order.view", "order.edit", "artwork.view", "artwork.assign", "artwork.adopt"];
function fixture(overrides: Partial<SalesWorkspaceHttpDependencies> = {}) {
  const control = { userId: staff, capabilities: [...initialCapabilities] as Capability[], revision: 1, authenticated: true, replayed: false };
  const workspace: SalesWorkspace = { id: workspaceId, organizationId: org, creatorUserId: staff, kind: "order_edit", state: "draft", sourceDocumentKind: "order",
    sourceDocumentId: orderId, baseRevision: "7", sourceArtifactFingerprint: "a".repeat(64), sourceHeader: { organizationId: org, orderId, currency: "USD",
      customerContact: { organizationId: org }, terms: { termsCode: "net_30", commercialNotes: "Full canonical terms" }, commercialState: "open", jobLabel: "Canonical Job Label" } as SalesWorkspace["sourceHeader"],
    revision: 3, header: { jobLabel: "Canonical Job Label" }, lines: [], removedLines: [], createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" };
  const receipt: WorkspacePromotionReceipt = { workspaceId, organizationId: org, requestId: "save-request", inputRevision: 3, fingerprint: "b".repeat(64), target: "order", documentId: orderId,
    documentRevision: "8", displayNumber: "ORD-7001", header: workspace.header, lineMap: [], artworkPromoted: false, promotedAt: "2026-10-01T00:00:00.000Z",
    result: { order: { orderId, jobLabel: "Canonical Job Label" }, revision: "8", number: { core: "7001", display: "ORD-7001" } } };
  const resolveStaff = jest.fn<PermissionAuthorityReader["resolveStaff"]>(async (userId, organizationId) => {
    if (organizationId !== org || (userId !== staff && userId !== otherStaff)) return null;
    return { organizationId, organizationActive: true, authorityRevision: String(control.revision), staff: { userId, membershipId: `${userId}-membership`, membershipActive: true,
      permissionSets: [{ id: "scoped-staff-set", name: "Scoped staff", active: true, revision: control.revision }], capabilities: control.capabilities, teamAccessManagement: false } };
  });
  const principals = new IssuedV2PrincipalProvider(new PassportSessionIdentitySource(), new PermissionSetPrincipalIssuer({ resolveStaff, resolvePortal: async () => null }));
  const trustedHostMiddleware: RequestHandler = (incoming, _response, next) => {
    const carrier = incoming as Request & { isAuthenticated?: () => boolean; user?: { id: string }; sessionID?: string; session?: { v2CsrfToken: string } };
    Object.assign(carrier, { session: { v2CsrfToken: csrf } });
    carrier.sessionID = "verified-fixture-session";
    carrier.isAuthenticated = () => control.authenticated;
    if (control.authenticated) carrier.user = { id: control.userId };
    next();
  };
  const authorize = (actor: OperationContext, id: string) => {
    if (id !== workspace.id || actor.organizationId !== workspace.organizationId) throw new V2ApplicationError("NOT_FOUND", "Sales workspace was not found.");
    authorizeSalesWorkspace(actor, workspace);
  };
  const requireArtwork = (actor: OperationContext, capability: Capability) => {
    authorize(actor, workspaceId);
    if (!new AuthorityPolicy().decide(actor.principal, { capability, resource: { organizationId: actor.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "Artwork authority is unavailable.");
  };
  const get = jest.fn(async (actor: OperationContext, id: string) => { authorize(actor, id); return workspace; });
  const start = jest.fn(async (actor: OperationContext, input: { requestId: string; sourceOrderId: string; expectedSourceRevision?: string }) => {
    authorizeOrderEditWorkspace(actor);
    if (input.sourceOrderId !== orderId) throw new V2ApplicationError("NOT_FOUND", "Source Order was not found.");
    return workspace;
  });
  const readArtwork = jest.fn(async (actor: OperationContext, id: string) => {
    authorize(actor, id); requireArtwork(actor, "artwork.view");
    return [{ workspaceLineId: lineId, sourceCanonicalLineId: lineId, sourceAssignmentId: assignmentId, artworkFileId: fileId, status: "current" as const, action: "KEEP" as const,
      filename: "Original source.pdf", contentType: "application/pdf", byteSize: 240, purpose: "customer_supplied" as const, sourceQuoteAcceptedArtworkSnapshotId: null }];
  });
  const stageIntent = jest.fn(async (actor: OperationContext, id: string, sourceAssignmentId: string, action: "KEEP" | "REMOVE", expectedRevision: number, requestId: string) => {
    authorize(actor, id); requireArtwork(actor, "artwork.view"); requireArtwork(actor, "artwork.assign");
    assert.equal(actor.businessRequest?.id, requestId);
    return { sourceAssignmentId, action, workspaceRevision: expectedRevision + 1 };
  });
  const promote = jest.fn(async (actor: OperationContext, input: { workspaceId: string; target: "quote" | "order"; requestId: string; expectedRevision: number }) => {
    authorize(actor, input.workspaceId); assert.equal(actor.businessRequest?.id, input.requestId);
    return success({ receipt: { ...receipt, requestId: input.requestId }, replayed: control.replayed, promotedWorkspaceHeader: receipt.header });
  });
  const create = jest.fn(async () => { throw new Error("Edit endpoint must never call neutral new-sales creation."); });
  const unused = jest.fn(async () => { throw new Error("Unexpected unowned HTTP operation."); });
  const dependencies: SalesWorkspaceHttpDependencies = {
    principals, service: { get, create, list: async () => [workspace], saveDraft: async (actor, id) => { authorize(actor, id); return workspace; }, discard: async (actor, id) => { authorize(actor, id); return { ...workspace, state: "discarded" }; } },
    lines: { add: unused, update: unused, remove: unused, reorder: unused, refresh: unused }, promotion: { promote }, orderEdits: { start },
    orderEditArtwork: { readOrderEditArtwork: readArtwork, stageOrderEditArtworkIntent: stageIntent },
    formReads: { customers: async () => [], contacts: async () => [], products: async () => [], configuration: async () => null }, preview: unused,
    artwork: { uploads: { upload: unused }, lifecycle: { list: async () => [], assign: unused, remove: unused } }, ...overrides,
  };
  const args: Parameters<typeof createV2HttpApp> = [{ environment: "test", serviceName: "order-edit-http-acceptance", port: 8080 }, { log: () => {} }];
  args[22] = { dependencies, trustedHostMiddleware };
  const app = createV2HttpApp(...args);
  return { app, control, workspace, receipt, resolveStaff, get, start, readArtwork, stageIntent, promote, create, unused };
}

describe("Order edit workspace HTTP with actual principal issuance and CSRF mount", () => {
  test("view+edit without create starts an Order edit and adapts the precise server-owned source DTO", async () => {
    const f = fixture(); f.control.capabilities = ["order.view", "order.edit"];
    const response = await request(f.app).post(`${base}/order-edits`).set("x-v2-csrf-token", csrf).send({ requestId: "start-request", orderId, expectedSourceRevision: "7" });
    assert.equal(response.status, 200); assert.equal(response.body.ok, true); assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.body.data.kind, "order_edit"); assert.equal(response.body.data.sourceDocumentId, orderId); assert.equal(f.create.mock.calls.length, 0);
    const [actor, input] = f.start.mock.calls[0]!;
    assert.deepEqual(input, { requestId: "start-request", sourceOrderId: orderId, expectedSourceRevision: "7" });
    assert.equal(actor.organizationId, org); assert.equal(actor.principal.kind, "staff"); assert.equal(actor.businessRequest?.id, "start-request");
    if (actor.principal.kind !== "staff") throw new Error("Expected issued Staff principal.");
    assert.equal(actor.principal.authority?.source, "permission_set"); assert.equal(actor.principal.authority?.authorityRevision, "1");
    assert.deepEqual(actor.principal.authority?.capabilities, ["order.edit", "order.view"]);
    assert.equal(f.resolveStaff.mock.calls.length, 1); assert.deepEqual([...f.resolveStaff.mock.calls[0]!], [staff, org]);
  });

  test.each(["sourceOrderId", "organizationId", "creatorUserId", "sourceHeader", "sourceArtifactFingerprint", "sourceLineSnapshot", "baseRevision", "principal", "pricingResult", "permissionSetIds"])("strict start rejects client-authored %s before invoking the injected owner", async key => {
    const f = fixture(); const response = await request(f.app).post(`${base}/order-edits`).set("x-v2-csrf-token", csrf).send({ requestId: "strict-request", orderId, [key]: "not-authority" });
    assert.equal(response.status, 400); assert.equal(response.body.error.code, "VALIDATION_ERROR"); assert.equal(f.start.mock.calls.length, 0);
  });

  test.each(["0", "-1", "1.5", " 7 ", "1000000000000000000"])("invalid source revision %s is rejected", async expectedSourceRevision => {
    const f = fixture(); const response = await request(f.app).post(`${base}/order-edits`).set("x-v2-csrf-token", csrf).send({ requestId: "revision-request", orderId, expectedSourceRevision });
    assert.equal(response.status, 400); assert.equal(f.start.mock.calls.length, 0);
  });

  test.each([["/order-edits", { requestId: "csrf-start", orderId }], [`/${workspaceId}/promote`, { requestId: "csrf-save", expectedRevision: 3, target: "order" }],
    [`/${workspaceId}/artwork-edit`, { requestId: "csrf-artwork", expectedRevision: 3, sourceAssignmentId: assignmentId, action: "remove" }],
    [`/${workspaceId}/discard`, { requestId: "csrf-discard", expectedRevision: 3 }]])("actual mount rejects CSRF-less mutation %s before principal issuance or owner calls", async (path, body) => {
    const f = fixture(); const response = await request(f.app).post(`${base}${path}`).send(body);
    assert.equal(response.status, 403); assert.equal(response.body.error.code, "FORBIDDEN"); assert.match(response.body.error.message, /CSRF/);
    assert.equal(f.resolveStaff.mock.calls.length, 0); assert.equal(f.start.mock.calls.length + f.promote.mock.calls.length + f.stageIntent.mock.calls.length, 0);
  });

  test("a wrong session CSRF token cannot authorize Edit even with valid current permissions", async () => {
    const f = fixture(); const response = await request(f.app).post(`${base}/order-edits`).set("x-v2-csrf-token", `${csrf}-other-session`).send({ requestId: "csrf-mismatch", orderId });
    assert.equal(response.status, 403); assert.equal(f.start.mock.calls.length, 0);
  });

  test("body/header identity claims cannot replace the trusted verified host identity", async () => {
    const f = fixture(); f.control.authenticated = false;
    const response = await request(f.app).post(`${base}/order-edits`).set("x-v2-csrf-token", csrf).set("x-user-id", staff).set("x-organization-id", org).set("x-permissions", "order.edit")
      .send({ requestId: "unverified-request", orderId });
    assert.equal(response.status, 403); assert.equal(f.resolveStaff.mock.calls.length, 0); assert.equal(f.start.mock.calls.length, 0);
  });

  test("create-only, view-only and revoked current edit capability do not authorize starting Edit", async () => {
    for (const capabilities of [["order.create"], ["order.view"], ["order.view", "artwork.view"]] as Capability[][]) {
      const f = fixture(); f.control.capabilities = capabilities;
      const response = await request(f.app).post(`${base}/order-edits`).set("x-v2-csrf-token", csrf).send({ requestId: randomUUID(), orderId });
      assert.equal(response.status, 403); assert.equal(f.create.mock.calls.length, 0);
    }
  });

  test("creator isolation and foreign tenant return scoped unavailable results, not metadata", async () => {
    const f = fixture(); f.control.userId = otherStaff;
    const denied = await request(f.app).get(`${base}/${workspaceId}/artwork-edit`);
    assert.equal(denied.status, 404); assert.equal(denied.body.error.code, "NOT_FOUND"); assert.equal(denied.body.data, undefined);
    for (const targetOrder of [orderId, randomUUID()]) {
      const foreign = await request(f.app).post(`/v2/organizations/${otherOrg}/sales-workspaces/order-edits`).set("x-v2-csrf-token", csrf).send({ requestId: randomUUID(), orderId: targetOrder });
      assert.equal(foreign.status, 404); assert.equal(foreign.body.error.code, "NOT_FOUND"); assert.equal(foreign.body.data, undefined);
    }
  });

  test("GET and HEAD Artwork references are read-only, no-store, and expose no private storage key", async () => {
    const f = fixture(); const response = await request(f.app).get(`${base}/${workspaceId}/artwork-edit`);
    assert.equal(response.status, 200); assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.body.data[0].sourceAssignmentId, assignmentId); assert.equal(response.body.data[0].action, "KEEP"); assert.equal(response.body.data[0].objectKey, undefined);
    const head = await request(f.app).head(`${base}/${workspaceId}/artwork-edit`); assert.equal(head.status, 200); assert.equal(head.text, undefined);
    assert.equal(f.readArtwork.mock.calls.length, 2); assert.equal(f.stageIntent.mock.calls.length + f.promote.mock.calls.length, 0);
  });

  test.each(["keep", "remove"] as const)("Artwork intent %s adapts to the exact owner action with request and CAS", async action => {
    const f = fixture(); const response = await request(f.app).post(`${base}/${workspaceId}/artwork-edit`).set("x-v2-csrf-token", csrf)
      .send({ requestId: "artifact-request", expectedRevision: 3, sourceAssignmentId: assignmentId, action });
    assert.equal(response.status, 200); assert.equal(response.body.data.action, action.toUpperCase()); assert.equal(response.body.data.workspaceRevision, 4);
    const [actor, id, source, ownerAction, revision, requestId] = f.stageIntent.mock.calls[0]!;
    assert.equal(actor.businessRequest?.id, "artifact-request"); assert.deepEqual([id, source, ownerAction, revision, requestId], [workspaceId, assignmentId, action.toUpperCase(), 3, "artifact-request"]);
    assert.equal(f.promote.mock.calls.length, 0);
  });

  test.each(["replace", "designate", "REMOVE", "delete"])("unpublished Artwork action %s is rejected rather than guessed", async action => {
    const f = fixture(); const response = await request(f.app).post(`${base}/${workspaceId}/artwork-edit`).set("x-v2-csrf-token", csrf)
      .send({ requestId: "unsupported-action", expectedRevision: 3, sourceAssignmentId: assignmentId, action });
    assert.equal(response.status, 400); assert.equal(f.stageIntent.mock.calls.length, 0);
  });

  test.each(["lineMap", "canonicalLineId", "artworkFileId", "objectKey", "sourceEvidence", "billingInvoiceId"])("Artwork intent rejects client-owned %s", async key => {
    const f = fixture(); const response = await request(f.app).post(`${base}/${workspaceId}/artwork-edit`).set("x-v2-csrf-token", csrf)
      .send({ requestId: "strict-artifact", expectedRevision: 3, sourceAssignmentId: assignmentId, action: "remove", [key]: "untrusted" });
    assert.equal(response.status, 400); assert.equal(f.stageIntent.mock.calls.length, 0);
  });

  test("current Artwork capability revocation is enforced by the injected owner after fresh principal issuance", async () => {
    const f = fixture(); f.control.capabilities = ["order.view", "order.edit", "artwork.view"];
    const response = await request(f.app).post(`${base}/${workspaceId}/artwork-edit`).set("x-v2-csrf-token", csrf)
      .send({ requestId: "revoked-artifact", expectedRevision: 3, sourceAssignmentId: assignmentId, action: "remove" });
    assert.equal(response.status, 403); assert.equal(response.body.data, undefined); assert.equal(f.resolveStaff.mock.calls.length, 1);
  });

  test("Save uses the existing promotion endpoint, returns the persisted receipt and reissues authority before replay", async () => {
    const f = fixture(), input = { requestId: "save-request", expectedRevision: 3, target: "order" };
    const saved = await request(f.app).post(`${base}/${workspaceId}/promote`).set("x-v2-csrf-token", csrf).send(input);
    assert.equal(saved.status, 200); assert.equal(saved.body.data.receipt.documentId, orderId); assert.equal(saved.body.data.receipt.result.number.core, "7001");
    assert.equal(saved.body.data.replayed, false); assert.equal(f.create.mock.calls.length, 0);
    assert.deepEqual(f.promote.mock.calls[0]![1], { ...input, workspaceId });
    f.control.replayed = true; f.control.revision++;
    const replay = await request(f.app).post(`${base}/${workspaceId}/promote`).set("x-v2-csrf-token", csrf).send(input);
    assert.equal(replay.status, 200); assert.equal(replay.body.data.replayed, true); assert.deepEqual(replay.body.data.receipt, saved.body.data.receipt);
    const secondActor = f.promote.mock.calls[1]![0]; assert.equal(secondActor.principal.kind, "staff");
    if (secondActor.principal.kind !== "staff") throw new Error("Expected Staff principal.");
    assert.equal(secondActor.principal.authority?.authorityRevision, "2");
    f.control.capabilities = ["order.view"]; f.control.revision++;
    const denied = await request(f.app).post(`${base}/${workspaceId}/promote`).set("x-v2-csrf-token", csrf).send(input);
    assert.equal(denied.status, 403); assert.equal(denied.body.data, undefined); assert.equal(f.promote.mock.calls.length, 2); assert.equal(f.resolveStaff.mock.calls.length, 3);
  });

  test.each(["touchRevision", "lineMap", "sourceHeader", "sourceArtifactFingerprint"])("Save rejects client-authored %s, never exposing the internal coordination flag", async key => {
    const f = fixture(); const response = await request(f.app).post(`${base}/${workspaceId}/promote`).set("x-v2-csrf-token", csrf)
      .send({ requestId: "strict-save", expectedRevision: 3, target: "order", [key]: true });
    assert.equal(response.status, 400); assert.equal(response.body.error.code, "VALIDATION_ERROR"); assert.equal(f.promote.mock.calls.length, 0);
  });

  test.each(["STALE_STATE", "CONFLICT", "RETRYABLE_FAILURE", "INTERNAL_ERROR"] as const)("owner %s failure is mapped safely with no success receipt", async code => {
    const f = fixture(); f.start.mockImplementationOnce(async () => { throw new V2ApplicationError(code, "Bounded owner error."); });
    const response = await request(f.app).post(`${base}/order-edits`).set("x-v2-csrf-token", csrf).send({ requestId: "owner-failure", orderId });
    assert.equal(response.status, code === "RETRYABLE_FAILURE" ? 503 : code === "INTERNAL_ERROR" ? 500 : 409); assert.equal(response.body.error.code, code); assert.equal(response.body.data, undefined);
  });

  test("unexpected owner exception does not expose SQL/provider details", async () => {
    const f = fixture(); f.start.mockImplementationOnce(async () => { throw new Error("private database relation and provider diagnostics"); });
    const response = await request(f.app).post(`${base}/order-edits`).set("x-v2-csrf-token", csrf).send({ requestId: "private-failure", orderId });
    assert.equal(response.status, 500); assert.equal(response.body.error.code, "INTERNAL_ERROR"); assert.doesNotMatch(JSON.stringify(response.body), /private database|provider diagnostics/);
  });

  test("unfinished owner composition fails closed instead of creating another Order or using generic Artwork", async () => {
    const f = fixture({ orderEdits: undefined, orderEditArtwork: undefined });
    const start = await request(f.app).post(`${base}/order-edits`).set("x-v2-csrf-token", csrf).send({ requestId: "not-configured", orderId });
    const artwork = await request(f.app).get(`${base}/${workspaceId}/artwork-edit`);
    assert.equal(start.status, 503); assert.equal(artwork.status, 503); assert.equal(f.create.mock.calls.length + f.unused.mock.calls.length, 0);
  });
});
