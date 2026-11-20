import { z } from "zod";
import { normalizeOrganizationRole } from "@shared/organizationRoleAuthority";
import { fulfillmentOrderIdSchema } from "../fulfillment/schemas";
import type { FulfillmentDetailDto } from "../fulfillment/types";

const quantity = z.number().finite().nonnegative();
const quantitiesSchema = z.object({
  orderedQuantity: quantity,
  productionCompleteQuantity: quantity,
  fulfilledQuantity: quantity,
  shippedQuantity: quantity,
  pickedUpQuantity: quantity,
  readyWaitingQuantity: quantity,
  notReadyQuantity: quantity,
  remainingQuantity: quantity,
}).strict();
const nativeAuthoritySchema = z.object({
  canConfirmPhysicalReadiness: z.boolean().optional(),
  canCompleteProductionOverride: z.boolean().optional(),
  canEditHistoryNotes: z.boolean().optional(),
  canEditPickupDate: z.boolean().optional(),
  canRevertStatus: z.boolean().optional(),
  revertPermission: z.string().optional(),
  canReverseTerminalFulfillment: z.boolean().optional(),
}).strict();

/** Native workspace evidence, NOT a fulfillment eligibility or action schema.
 * In particular production completion, physical readiness, allocation and
 * physical/admin completion are distinct facts. No green/ready aggregate is
 * manufactured from them. Reasons are the native service's status and label.
 */
export const orderFulfillmentReadinessReadResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    source: z.literal("canonical_fulfillment_order_detail"),
    capturedAt: z.string().datetime(),
    orderId: z.string().min(1),
    nativeStatus: z.string(),
    fulfillmentType: z.enum(["SHIP", "PICKUP"]),
    fulfillmentMethod: z.enum(["pickup", "ship", "deliver"]).optional(),
    quantities: quantitiesSchema,
    lines: z.array(z.object({
      id: z.string().min(1),
      productName: z.string().nullable(),
      nativeStatus: z.string().nullable(),
      nativeLabel: z.string(),
      productionRequired: z.boolean(),
      quantities: quantitiesSchema.extend({
        administrativelyReconciledQuantity: quantity.optional(),
        availableForAllocationQuantity: quantity,
      }).strict(),
      stationKey: z.string().nullable(),
      stationLabel: z.string().nullable(),
      checklist: z.object({ checked: z.boolean(), fulfilledQuantity: quantity }).strict(),
    }).strict()).max(25),
    omittedLineCount: z.number().int().nonnegative(),
    checklist: z.object({
      complete: z.boolean(), total: quantity, checked: quantity, unchecked: quantity,
    }).strict(),
    pickupStatus: z.string().nullable(),
    administrativeMode: z.enum(["administrative", "legacy"]).nullable().optional(),
    administrativeBlockedReason: z.string().nullable().optional(),
    operationAuthority: nativeAuthoritySchema,
    navigation: z.object({ order: z.string(), fulfillment: z.string() }).strict(),
    limitation: z.literal("Native UI evidence and permission metadata only; not shipment, pickup, override, or billing eligibility. Production reports are informational only. Native operations revalidate current authority and state."),
  }).strict(),
  z.object({
    status: z.literal("omitted"),
    reason: z.enum(["native_authority_unverified", "native_read_unavailable", "native_target_mismatch", "native_shape_unavailable"]),
  }).strict(),
]);

export type OrderFulfillmentReadinessReadResult = z.infer<typeof orderFulfillmentReadinessReadResultSchema>;
export type OrderFulfillmentReadinessReadScope = {
  organizationId: string;
  userId: string;
  orderId: string;
};
export type OrderFulfillmentNativeReadAuthority = {
  organizationId: string;
  userId: string;
  /** Persisted membership role, passed unchanged to the native service. */
  organizationRole: string;
};
type NativePermissions = NonNullable<FulfillmentDetailDto["permissions"]> & {
  canConfirmPhysicalReadiness?: boolean;
  canCompleteProductionOverride?: boolean;
};
export type OrderFulfillmentNativeReadDetail = Omit<FulfillmentDetailDto, "permissions"> & {
  permissions?: NativePermissions;
};
export type OrderFulfillmentReadinessReadDependencies = {
  /** Server-only seams; never populate from provider/tool arguments. The
   * verifier must perform a fresh persisted native actor/tenant check. */
  verifyNativeReadAuthority?: (scope: OrderFulfillmentReadinessReadScope) => Promise<OrderFulfillmentNativeReadAuthority | null>;
  readDetail?: (organizationId: string, orderId: string, organizationRole: string) => Promise<OrderFulfillmentNativeReadDetail>;
};

const scopeSchema = z.object({
  organizationId: z.string().min(1), userId: z.string().min(1), orderId: fulfillmentOrderIdSchema,
}).strict();

/** Same persisted membership and organization visibility used by tenantContext.
 * No default org, provisioning, role fallback, platform-admin elevation, or
 * assistant mutation grants. Import lazily so importing the result schema does
 * not initialize a database, providers, or the fulfillment service.
 */
export async function verifyNativeReadAuthority(scope: OrderFulfillmentReadinessReadScope): Promise<OrderFulfillmentNativeReadAuthority | null> {
  const [{ db }, { userOrganizations, organizations, users }, { and, eq }, { isPortalCustomerIdentity }] = await Promise.all([
    import("../../db"), import("@shared/schema"), import("drizzle-orm"), import("../customerPortalAccessService"),
  ]);
  const [row] = await db.select({
    organizationRole: userOrganizations.role,
    deleteState: organizations.deleteState,
    isArchived: organizations.isArchived,
    accountType: users.accountType,
    role: users.role,
  }).from(userOrganizations)
    .innerJoin(organizations, eq(organizations.id, userOrganizations.organizationId))
    .innerJoin(users, eq(users.id, userOrganizations.userId))
    .where(and(eq(userOrganizations.organizationId, scope.organizationId), eq(userOrganizations.userId, scope.userId)))
    .limit(1);
  if (!row || row.deleteState !== "active" || row.isArchived || isPortalCustomerIdentity(row)
    || !normalizeOrganizationRole(row.organizationRole)) return null;
  return { organizationId: scope.organizationId, userId: scope.userId, organizationRole: row.organizationRole };
}

const readDetail: NonNullable<OrderFulfillmentReadinessReadDependencies["readDetail"]> = async (org, id, role) =>
  (await import("../fulfillment/canonicalFulfillmentOperations")).canonicalFulfillmentOperations.getOrderDetail(org, id, role);

function quantities(source: FulfillmentDetailDto | FulfillmentDetailDto["lineItems"][number]["production"]) {
  return {
    orderedQuantity: source.orderedQuantity,
    productionCompleteQuantity: source.productionCompleteQuantity,
    fulfilledQuantity: source.fulfilledQuantity,
    shippedQuantity: source.shippedQuantity,
    pickedUpQuantity: source.pickedUpQuantity,
    readyWaitingQuantity: source.readyWaitingQuantity,
    notReadyQuantity: source.notReadyQuantity,
    remainingQuantity: source.remainingQuantity,
  };
}

/** Call only after the coordinator has verified the current Order with its
 * authorized native read. Scope comes from the authenticated request, NOT AI
 * arguments. The registry still owns internal_staff authorization and audit.
 * Each invocation rereads membership and native detail; nothing is cached or
 * written. An unverified/failed read omits all facts and all navigation.
 */
export async function readOrderFulfillmentReadiness(
  scope: OrderFulfillmentReadinessReadScope,
  dependencies: OrderFulfillmentReadinessReadDependencies = {},
): Promise<OrderFulfillmentReadinessReadResult> {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) return { status: "omitted", reason: "native_authority_unverified" };
  const trustedScope = parsed.data;
  const verify = dependencies.verifyNativeReadAuthority ?? verifyNativeReadAuthority;
  const matchesScope = (authority: OrderFulfillmentNativeReadAuthority | null): authority is OrderFulfillmentNativeReadAuthority =>
    !!authority && authority.organizationId === trustedScope.organizationId && authority.userId === trustedScope.userId
    && normalizeOrganizationRole(authority.organizationRole) !== null;
  let authority: OrderFulfillmentNativeReadAuthority | null;
  try { authority = await verify(trustedScope); }
  catch { return { status: "omitted", reason: "native_authority_unverified" }; }
  if (!matchesScope(authority)) return { status: "omitted", reason: "native_authority_unverified" };
  let detail: OrderFulfillmentNativeReadDetail;
  try { detail = await (dependencies.readDetail ?? readDetail)(trustedScope.organizationId, trustedScope.orderId, authority.organizationRole); }
  catch { return { status: "omitted", reason: "native_read_unavailable" }; }
  // Don't release permissions read before a membership revocation/role change.
  try {
    const current = await verify(trustedScope);
    if (!matchesScope(current) || current.organizationRole !== authority.organizationRole)
      return { status: "omitted", reason: "native_authority_unverified" };
  } catch { return { status: "omitted", reason: "native_authority_unverified" }; }
  if (detail?.orderId !== trustedScope.orderId) return { status: "omitted", reason: "native_target_mismatch" };
  try {
    const permissions = detail.permissions;
    const result = orderFulfillmentReadinessReadResultSchema.safeParse({
      status: "available", source: "canonical_fulfillment_order_detail", capturedAt: new Date().toISOString(),
      orderId: detail.orderId, nativeStatus: detail.status, fulfillmentType: detail.fulfillmentType,
      fulfillmentMethod: detail.fulfillmentMethod, quantities: quantities(detail),
      lines: detail.lineItems.slice(0, 25).map((line) => ({
        id: line.id, productName: line.productName,
        nativeStatus: line.production.status, nativeLabel: line.production.label,
        productionRequired: line.production.productionRequired,
        quantities: {
          ...quantities(line.production),
          administrativelyReconciledQuantity: line.production.administrativelyReconciledQuantity,
          availableForAllocationQuantity: line.production.availableForAllocationQuantity,
        },
        stationKey: line.production.stationKey, stationLabel: line.production.stationLabel,
        checklist: { checked: line.checklist.checked, fulfilledQuantity: line.checklist.fulfilledQuantity },
      })),
      omittedLineCount: Math.max(0, detail.lineItems.length - 25),
      checklist: { complete: detail.checklistComplete, ...detail.checklistSummary },
      pickupStatus: detail.pickupTicket?.status ?? null,
      administrativeMode: detail.administrativeCorrection?.mode,
      administrativeBlockedReason: detail.administrativeCorrection?.blockedReason,
      operationAuthority: {
        canConfirmPhysicalReadiness: permissions?.canConfirmPhysicalReadiness,
        canCompleteProductionOverride: permissions?.canCompleteProductionOverride,
        canEditHistoryNotes: permissions?.canEditHistoryNotes,
        canEditPickupDate: permissions?.canEditPickupDate,
        canRevertStatus: permissions?.canRevertStatus,
        revertPermission: permissions?.revertPermission,
        canReverseTerminalFulfillment: permissions?.canReverseTerminalFulfillment,
      },
      navigation: { order: `/orders/${encodeURIComponent(detail.orderId)}`, fulfillment: `/fulfillment/orders/${encodeURIComponent(detail.orderId)}` },
      limitation: "Native UI evidence and permission metadata only; not shipment, pickup, override, or billing eligibility. Production reports are informational only. Native operations revalidate current authority and state.",
    });
    return result.success ? result.data : { status: "omitted", reason: "native_shape_unavailable" };
  } catch { return { status: "omitted", reason: "native_shape_unavailable" }; }
}
