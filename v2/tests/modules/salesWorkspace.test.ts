import { describe, expect, it, jest } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation.js";
import { SalesWorkspaceApplicationService, assertSalesWorkspaceMutable, authorizeSalesWorkspace,
  bumpSalesWorkspaceRevision, salesWorkspaceFingerprint, validateSalesWorkspaceHeader,
  validateSalesWorkspaceLineInput, validateSalesWorkspaceMutation, visibleSalesWorkspaceState } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspaceStore } from "../../src/modules/sales/workspaceContracts.js";

const org = "10000000-0000-4000-8000-000000000001";
const user = "10000000-0000-4000-8000-000000000002";
const context: OperationContext = { organizationId: org, operationId: "workspace-test", principal: {
  kind: "staff", organizationId: org, userId: user, authority: { membershipId: "verified-membership", capabilities: ["quote.create"] },
} };
const draft: SalesWorkspace = { id: "10000000-0000-4000-8000-000000000003", organizationId: org,
  creatorUserId: user, kind: "new_sales", state: "draft", revision: 1, header: {}, lines: [],
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-10-31T00:00:00.000Z" };

describe("Sales workspace foundation", () => {
  it("permits either current creation capability, never role or administrator wildcard", () => {
    expect(authorizeSalesWorkspace(context, draft).userId).toBe(user);
    expect(authorizeSalesWorkspace({ ...context, principal: { ...context.principal, kind: "staff", userId: user,
      authority: { membershipId: "verified", capabilities: ["order.create"] } } }, draft).userId).toBe(user);
    expect(() => authorizeSalesWorkspace({ ...context, principal: { kind: "staff", organizationId: org, userId: user,
      authority: { membershipId: "verified", role: "administrator", capabilities: [] } } }, draft)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
  it("blocks foreign tenants, other creators and nonstaff before storage", async () => {
    const run = jest.fn<SalesWorkspaceStore["run"]>();
    const service = new SalesWorkspaceApplicationService({ run, withWorkspace: jest.fn() } as SalesWorkspaceStore);
    await expect(service.get({ ...context, organizationId: "foreign" }, draft.id)).rejects.toMatchObject({ code: "WRONG_TENANT" });
    await expect(service.get({ ...context, principal: { kind: "service", organizationId: org, clientId: "worker", capabilities: ["order.create"] } }, draft.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() => authorizeSalesWorkspace(context, { ...draft, creatorUserId: "another" })).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(run).not.toHaveBeenCalled();
  });
  it("allows incomplete draft headers, bounds fields and rejects injected commercial facts", () => {
    expect(validateSalesWorkspaceHeader({}, org)).toEqual({});
    expect(validateSalesWorkspaceHeader({ jobLabel: "Window graphics", terms: {} }, org)).toEqual({ jobLabel: "Window graphics", terms: {} });
    for (const input of [{ currency: "USD" }, { totalCents: 1 }, { jobLabel: "x".repeat(301) }, { notes: "x".repeat(4001) }, { requestedDueDate: "tomorrow" }, { terms: { paid: true } }]) {
      expect(() => validateSalesWorkspaceHeader(input, org)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    }
    expect(() => validateSalesWorkspaceHeader({ customerContact: { organizationId: user, customerId: user } }, org)).toThrow(expect.objectContaining({ code: "WRONG_TENANT" }));
  });
  it("validates line instructions without accepting client-calculated prices or previews", () => {
    const line = { productId: draft.id, quantity: 2, selections: { color: ["red", "blue"] }, selling: { kind: "calculated" } };
    expect(validateSalesWorkspaceLineInput(line)).toEqual(line);
    for (const input of [{ ...line, preview: {} }, { ...line, previews: {} }, { ...line, pricingResult: {} }, { ...line, quantity: -1 },
      { ...line, selling: { kind: "discount", discountBasisPoints: 1000, reason: "x" } },
      { ...line, selling: { kind: "total_override", totalCents: 100, reason: " " } },
      { ...line, selling: { kind: "unit_override", unitCents: 100, reason: " \t\r\n " } },
      { ...line, selections: { value: new Date() } }, { ...line, selections: { value: "x".repeat(4001) } }]) {
      expect(() => validateSalesWorkspaceLineInput(input)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    }
    expect(() => validateSalesWorkspaceLineInput({ ...line, selections: JSON.parse('{"__proto__":{"polluted":true}}') })).toThrow();
    expect(() => validateSalesWorkspaceLineInput({ ...line, selections: JSON.parse('{"safe":{"__proto__":{"polluted":true}}}') })).toThrow();
    let deep: unknown = 1;
    for (let depth = 0; depth < 9; depth++) deep = { next: deep };
    expect(() => validateSalesWorkspaceLineInput({ ...line, selections: deep })).toThrow();
  });
  it("requires bounded request identity and numeric positive CAS", () => {
    expect(validateSalesWorkspaceMutation({ requestId: "save:1", expectedRevision: 1 })).toEqual({ requestId: "save:1", expectedRevision: 1 });
    for (const mutation of [{ requestId: " ", expectedRevision: 1 }, { requestId: "x".repeat(129), expectedRevision: 1 },
      { requestId: "save", expectedRevision: 0 }, { requestId: "save", expectedRevision: "1" }]) {
      expect(() => validateSalesWorkspaceMutation(mutation as never)).toThrow();
    }
  });
  it("rejects stale, terminal, expired and reserved source-edit drafts", () => {
    const now = new Date(draft.createdAt);
    expect(() => assertSalesWorkspaceMutable(draft, 1, now)).not.toThrow();
    expect(() => assertSalesWorkspaceMutable(draft, 2, now)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    for (const state of ["promoting", "promoted", "discarded", "expired"] as const) {
      expect(() => assertSalesWorkspaceMutable({ ...draft, state }, 1, now)).toThrow();
    }
    expect(() => assertSalesWorkspaceMutable(draft, 1, new Date(draft.expiresAt))).toThrow();
    expect(() => assertSalesWorkspaceMutable({ ...draft, expiresAt: "invalid" }, 1, now)).toThrow();
    expect(() => assertSalesWorkspaceMutable({ ...draft, kind: "order_edit" }, 1, now)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(bumpSalesWorkspaceRevision(draft, now)).toEqual({ ...draft, revision: 2 });
    expect(draft.revision).toBe(1);
    expect(visibleSalesWorkspaceState(draft, new Date(draft.expiresAt))).toEqual({ ...draft, state: "expired" });
    expect(visibleSalesWorkspaceState(draft, now)).toBe(draft);
    for (const state of ["promoted", "discarded", "expired"] as const) {
      const terminal = { ...draft, state };
      expect(visibleSalesWorkspaceState(terminal, new Date(draft.expiresAt))).toBe(terminal);
    }
  });
  it("rejects edit creation and malformed identity before transaction acquisition", async () => {
    const run = jest.fn<SalesWorkspaceStore["run"]>();
    const service = new SalesWorkspaceApplicationService({ run, withWorkspace: jest.fn() } as SalesWorkspaceStore);
    await expect(service.create(context, { requestId: "edit", kind: "order_edit", sourceDocumentId: draft.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.get(context, "bad-id")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.expire(context, 101)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(run).not.toHaveBeenCalled();
  });
  it("fingerprints normalized key order without dropping input differences", () => {
    expect(salesWorkspaceFingerprint({ header: { jobLabel: "x", notes: undefined }, revision: 1 }))
      .toBe(salesWorkspaceFingerprint({ revision: 1, header: { jobLabel: "x" } }));
    expect(salesWorkspaceFingerprint({ revision: 1 })).not.toBe(salesWorkspaceFingerprint({ revision: 2 }));
  });
});
