import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { resolveFulfillmentLineQuantity, summarizeFulfillmentOrderQuantities } from "@shared/fulfillmentReadiness";
import {
  orderFulfillmentReadinessReadResultSchema,
  readOrderFulfillmentReadiness,
  type OrderFulfillmentNativeReadDetail,
  type OrderFulfillmentReadinessReadScope,
} from "../services/assistant/orderFulfillmentReadinessRead";

// Adapter/security contract tests: synthetic persistence + native shared
// quantity projector. No DB, providers, workers, or mutation services run.
const scope = { organizationId: "synthetic_org", userId: "synthetic_actor", orderId: "223d4ed0-2aa4-4dc0-b4b7-0191556bb230" };
const authority = { organizationId: scope.organizationId, userId: scope.userId, organizationRole: "manager" };
const nativePermissions = {
  canConfirmPhysicalReadiness: true, canCompleteProductionOverride: false,
  canEditHistoryNotes: true, canEditPickupDate: false, canRevertStatus: true,
  revertPermission: "fulfillment.revert_status", canReverseTerminalFulfillment: false,
};

function fixture(): OrderFulfillmentNativeReadDetail {
  const projection = resolveFulfillmentLineQuantity({
    orderedQuantity: 12, workflowState: "completed", activeOwnerStationKey: "fulfillment",
    activeOwnerStatus: "queued", shippedQuantity: 2, pickedUpQuantity: 1,
    administrativelyReconciledQuantity: 3, readyWaitingQuantity: 4,
  });
  const summary = summarizeFulfillmentOrderQuantities([projection]);
  return {
    ...summary, orderId: scope.orderId, orderNumber: "SYNTHETIC-12", customerName: "Synthetic customer",
    fulfillmentType: "SHIP", fulfillmentMethod: "ship", status: "ADMINISTRATIVELY_RESOLVED",
    itemsRemaining: "6 item(s)", readySince: null, shipTo: "Synthetic city", overdue: false,
    isArchived: false, productionJobs: [], customer: { name: "Synthetic", email: "private@example.invalid", phone: "private" },
    permissions: nativePermissions,
    administrativeCorrection: { mode: "administrative", blockedReason: null, method: "ship", lines: [], expectedState: "private-version" },
    lineItems: [{
      id: "synthetic_line", productName: "Synthetic line", description: "Synthetic description", productType: null,
      quantity: 12, size: null, materialName: null, optionSummary: [], finishing: { requirements: [], lamination: null },
      production: {
        ...projection, jobId: "synthetic_job", stationKey: "fulfillment", stationLabel: "Fulfillment",
        status: projection.status, eligible: true, completedAt: null, availableForAllocationQuantity: 1,
      },
      artwork: [], checklist: { id: "", checked: false, fulfilledQuantity: 0, checkedByUserId: null, checkedAt: null, notes: "private" },
    }],
    checklistComplete: false, checklistSummary: { total: 1, checked: 0, unchecked: 1 },
    productionSummary: [], pickupTicket: null, operationalPickupDate: "2026-11-20", pickupHandoffs: [], shipments: [], events: [],
  };
}

const queryPredicates: SQL[] = [];
let membershipRows: Array<Record<string, unknown>>;
const select = jest.fn(() => {
  const query = {
    from: jest.fn(() => query), innerJoin: jest.fn(() => query),
    where: jest.fn((predicate: SQL) => { queryPredicates.push(predicate); return query; }),
    limit: jest.fn(async () => structuredClone(membershipRows)),
  };
  return query;
});
const nativeRead = jest.fn(async () => fixture());
jest.unstable_mockModule("../db", () => ({ db: { select } }));
jest.unstable_mockModule("../services/customerPortalAccessService", () => ({
  isPortalCustomerIdentity: (user: { accountType?: string; role?: string }) => user.accountType === "PORTAL_CUSTOMER" || user.role === "customer",
}));
jest.unstable_mockModule("../services/fulfillment/canonicalFulfillmentOperations", () => ({
  canonicalFulfillmentOperations: { getOrderDetail: nativeRead },
}));

beforeEach(() => {
  select.mockClear(); nativeRead.mockClear(); queryPredicates.length = 0;
  membershipRows = [{ organizationRole: "manager", deleteState: "active", isArchived: false, accountType: "INTERNAL_USER", role: "employee" }];
});

describe("current Order native fulfillment read evidence", () => {
  test("schema imports do not initialize native DB/service dependencies", () => {
    expect(select).not.toHaveBeenCalled(); expect(nativeRead).not.toHaveBeenCalled();
  });

  test("passes verified scope and exact persisted role to canonical read; preserves partial/admin/reservation facts", async () => {
    const detail = fixture(); const before = structuredClone(detail);
    const verify = jest.fn(async () => authority);
    const read = jest.fn(async () => detail);
    const result = await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: verify, readDetail: read });
    expect(read).toHaveBeenCalledWith(scope.organizationId, scope.orderId, "manager");
    expect(verify).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Missing native evidence");
    expect(result.quantities).toEqual({ orderedQuantity: 12, productionCompleteQuantity: 12, fulfilledQuantity: 3,
      shippedQuantity: 2, pickedUpQuantity: 1, readyWaitingQuantity: 4, notReadyQuantity: 2, remainingQuantity: 6 });
    expect(result.lines[0]).toMatchObject({ nativeStatus: "partially_ready", nativeLabel: "Ready 4 / 6",
      quantities: { administrativelyReconciledQuantity: 3, availableForAllocationQuantity: 1 },
      checklist: { checked: false, fulfilledQuantity: 0 } });
    expect(result.operationAuthority).toEqual(nativePermissions);
    expect(result.navigation).toEqual({ order: `/orders/${scope.orderId}`, fulfillment: `/fulfillment/orders/${scope.orderId}` });
    expect(result).not.toHaveProperty("eligible"); expect(result).not.toHaveProperty("canShip");
    expect(result.lines[0]).not.toHaveProperty("eligible"); expect(result.lines[0]).not.toHaveProperty("color");
    expect(result.lines[0]).not.toHaveProperty("description"); expect(result.omittedLineCount).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/private|example.invalid|synthetic_job/);
    expect(detail).toEqual(before);
    expect(orderFulfillmentReadinessReadResultSchema.parse(result)).toEqual(result);
  });

  test("default verifier rereads persisted tenant membership and canonical read, never writes", async () => {
    const result = await readOrderFulfillmentReadiness(scope);
    expect(result.status).toBe("available"); expect(select).toHaveBeenCalledTimes(2);
    expect(nativeRead).toHaveBeenCalledWith(scope.organizationId, scope.orderId, "manager");
    for (const predicate of queryPredicates) {
      const query = new PgDialect().sqlToQuery(predicate);
      expect(query.sql).toContain('"user_organizations"."organization_id"');
      expect(query.sql).toContain('"user_organizations"."user_id"');
      expect(query.params).toEqual([scope.organizationId, scope.userId]);
    }
  });

  test.each([
    { status: "tracked" as const, availableQuantity: 7 },
    { status: "tracked" as const, availableQuantity: 0 },
    { status: "untracked" as const, availableQuantity: null },
    { status: "reconcile" as const, availableQuantity: null },
  ])("preserves native stock evidence without inventing production completion or allocation eligibility (%#)", async stock => {
    const detail = fixture();
    // Mirror the native public DTO: non-production stock contributes zero to
    // production totals, even though it can have physically ready units.
    detail.productionCompleteQuantity = 0;
    detail.lineItems[0].production.productionRequired = false;
    detail.lineItems[0].production.productionCompleteQuantity = 0;
    const nativeStockWithPrivateField = { ...stock, materialId: "private_inventory_id" };
    detail.lineItems[0].stock = nativeStockWithPrivateField;
    const before = structuredClone(detail);
    const result = await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => detail });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Missing native stock evidence");
    expect(result.quantities.productionCompleteQuantity).toBe(0);
    expect(result.lines[0]).toMatchObject({ productionRequired: false, stock,
      quantities: { productionCompleteQuantity: 0, readyWaitingQuantity: 4, availableForAllocationQuantity: 1 } });
    expect(result.lines[0].stock).toEqual(stock);
    expect(result.lines[0]).not.toHaveProperty("eligible");
    expect(JSON.stringify(result)).not.toContain("private_inventory_id");
    expect(detail).toEqual(before);
  });

  test("does not infer stock facts from production flags when the native DTO has none", async () => {
    const detail = fixture();
    detail.lineItems[0].production.productionRequired = false;
    const result = await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => detail });
    expect(result.status).toBe("available");
    if (result.status === "available") expect(result.lines[0]).not.toHaveProperty("stock");
  });

  test.each([
    { status: "unknown", availableQuantity: 1 },
    { status: "tracked", availableQuantity: -1 },
    { status: "tracked", availableQuantity: Number.NaN },
  ])("omits malformed native stock facts rather than silently discarding them (%#)", async stock => {
    const detail = fixture();
    detail.lineItems[0].stock = stock as NonNullable<typeof detail.lineItems[number]["stock"]>;
    expect(await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => detail }))
      .toEqual({ status: "omitted", reason: "native_shape_unavailable" });
  });

  test("bounds line evidence to 25 and reports omissions without truncating native totals/checklist", async () => {
    const detail = fixture();
    detail.lineItems = Array.from({ length: 31 }, (_, index) => ({ ...structuredClone(detail.lineItems[0]), id: `synthetic_line_${index}` }));
    detail.orderedQuantity = 372;
    detail.checklistSummary = { total: 31, checked: 5, unchecked: 26 };
    const result = await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => detail });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Missing bounded native evidence");
    expect(result.lines).toHaveLength(25); expect(result.omittedLineCount).toBe(6);
    expect(result.lines[24].id).toBe("synthetic_line_24");
    expect(result.quantities.orderedQuantity).toBe(372);
    expect(result.checklist).toEqual({ complete: false, total: 31, checked: 5, unchecked: 26 });
    expect(detail.lineItems).toHaveLength(31);
  });

  test.each([
    [], [{ organizationRole: "manager", deleteState: "deleted", isArchived: false }],
    [{ organizationRole: "manager", deleteState: "active", isArchived: true }],
    [{ organizationRole: "platform_admin", deleteState: "active", isArchived: false }],
    [{ organizationRole: "owner", deleteState: "active", isArchived: false, accountType: "PORTAL_CUSTOMER" }],
    [{ organizationRole: "owner", deleteState: "active", isArchived: false, role: "customer" }],
  ].map(rows => [rows]))("omits native information for unavailable/disabled/unknown/portal membership (%#)", async (rows) => {
    membershipRows = rows as Array<Record<string, unknown>>;
    expect(await readOrderFulfillmentReadiness(scope)).toEqual({ status: "omitted", reason: "native_authority_unverified" });
    expect(nativeRead).not.toHaveBeenCalled();
  });

  test.each([null, { ...authority, userId: "foreign_actor" }, { ...authority, organizationId: "foreign_org" },
    { ...authority, organizationRole: "unknown" }])("does not read with unverified injected authority (%#)", async (value) => {
    const read = jest.fn(async () => fixture());
    expect(await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => value, readDetail: read }))
      .toEqual({ status: "omitted", reason: "native_authority_unverified" });
    expect(read).not.toHaveBeenCalled();
  });

  test.each([null, { ...authority, organizationRole: "member" }])("omits read facts if native membership revoked/changed during read (%#)", async (current) => {
    const verify = jest.fn<() => Promise<typeof authority | null>>().mockResolvedValueOnce(authority).mockResolvedValueOnce(current);
    expect(await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: verify, readDetail: async () => fixture() }))
      .toEqual({ status: "omitted", reason: "native_authority_unverified" });
  });

  test("does not manufacture permission decisions when native metadata is absent", async () => {
    const detail = fixture(); delete detail.permissions;
    const result = await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => detail });
    expect(result.status).toBe("available");
    if (result.status === "available") expect(JSON.stringify(result.operationAuthority)).toBe("{}");
  });

  test("does not substitute authority grants for native permission false or incomplete production", async () => {
    const detail = fixture();
    detail.lineItems[0].production.productionCompleteQuantity = 0;
    detail.lineItems[0].production.label = "Not yet marked ready";
    detail.permissions = { ...nativePermissions, canConfirmPhysicalReadiness: false };
    const result = await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => detail });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Missing native evidence");
    expect(result.lines[0].quantities.productionCompleteQuantity).toBe(0);
    expect(result.lines[0].nativeLabel).toBe("Not yet marked ready");
    expect(result.operationAuthority.canConfirmPhysicalReadiness).toBe(false);
  });

  test("null administrative mode is native absence, not invented 'none' workflow", async () => {
    const detail = fixture(); detail.administrativeCorrection!.mode = null;
    const result = await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => detail });
    expect(result.status === "available" && result.administrativeMode).toBeNull();
  });

  test("native failures are omitted without leaking error details; retry rereads", async () => {
    const read = jest.fn<() => Promise<OrderFulfillmentNativeReadDetail>>()
      .mockRejectedValueOnce(new Error("private SQL/provider failure")) .mockResolvedValueOnce(fixture());
    const deps = { verifyNativeReadAuthority: async () => authority, readDetail: read };
    expect(await readOrderFulfillmentReadiness(scope, deps)).toEqual({ status: "omitted", reason: "native_read_unavailable" });
    expect((await readOrderFulfillmentReadiness(scope, deps)).status).toBe("available");
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("authority lookup failures omit all facts without native read", async () => {
    const read = jest.fn(async () => fixture());
    expect(await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => { throw new Error("private"); }, readDetail: read }))
      .toEqual({ status: "omitted", reason: "native_authority_unverified" });
    expect(read).not.toHaveBeenCalled();
  });

  test("rejects extra model-supplied authority/target fields before reading", async () => {
    const read = jest.fn(async () => fixture());
    for (const invalid of [{ ...scope, organizationRole: "owner" }, { ...scope, orderId: "../foreign-order" }, { ...scope, permissions: ["*"] }]) {
      expect(await readOrderFulfillmentReadiness(invalid as OrderFulfillmentReadinessReadScope, { verifyNativeReadAuthority: async () => authority, readDetail: read }))
        .toEqual({ status: "omitted", reason: "native_authority_unverified" });
    }
    expect(read).not.toHaveBeenCalled();
  });

  test("does not release mismatched detail or malformed native facts", async () => {
    const detail = fixture(); detail.orderId = "foreign_order";
    expect(await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => detail }))
      .toEqual({ status: "omitted", reason: "native_target_mismatch" });
    detail.orderId = scope.orderId; detail.lineItems[0].production.remainingQuantity = Number.NaN;
    expect(await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => detail }))
      .toEqual({ status: "omitted", reason: "native_shape_unavailable" });
  });

  test("result schema strictly rejects invented fields at every exposed boundary", async () => {
    const result = await readOrderFulfillmentReadiness(scope, { verifyNativeReadAuthority: async () => authority, readDetail: async () => fixture() });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Missing native evidence");
    for (const invalid of [{ ...result, eligible: true }, { ...result, operationAuthority: { ...result.operationAuthority, canShip: true } },
      { ...result, lines: [{ ...result.lines[0], color: "green" }] }, { ...result, quantities: { ...result.quantities, eligibleQuantity: 4 } }])
      expect(orderFulfillmentReadinessReadResultSchema.safeParse(invalid).success).toBe(false);
    expect(orderFulfillmentReadinessReadResultSchema.safeParse({ status: "omitted", reason: "native_read_unavailable", navigation: result.navigation }).success).toBe(false);
  });
});
