import { z } from "zod";
import { normalizeOrganizationRole } from "@shared/organizationRoleAuthority";
import { fulfillmentOrderIdSchema, fulfillmentReadyQuantityAdjustmentReasonSchema } from "../fulfillment/schemas";
import type { canonicalFulfillmentOperations } from "../fulfillment/canonicalFulfillmentOperations";
import {
  orderFulfillmentReadinessReadResultSchema, readOrderFulfillmentReadiness, verifyNativeReadAuthority,
  type OrderFulfillmentNativeReadAuthority, type OrderFulfillmentNativeReadDetail,
  type OrderFulfillmentReadinessReadDependencies,
} from "./orderFulfillmentReadinessRead";

const scopeSchema = z.object({
  organizationId: z.string().min(1), userId: z.string().min(1), orderId: fulfillmentOrderIdSchema,
}).strict();
export type PhysicalReadinessAdjustmentScope = z.infer<typeof scopeSchema>;

/** Exactly one native physical delta. No actor, tenant, retry key or production
 * completion request is inferred from conversational text. The optional native
 * production guard is preserved, never enabled or disabled implicitly. */
export const physicalReadinessAdjustmentInputSchema = z.object({
  orderLineItemId: z.string().min(1),
  quantityDelta: z.number().finite().int().refine(value => value !== 0, "Quantity adjustment cannot be zero"),
  reason: fulfillmentReadyQuantityAdjustmentReasonSchema,
  requireProductionComplete: z.boolean().optional(),
}).strict();
export type PhysicalReadinessAdjustmentInput = z.infer<typeof physicalReadinessAdjustmentInputSchema>;

const limitation = "Physical quantity confirmation/correction only. Production jobs stay open; this does not complete production, ship, hand off pickup, notify customers, or invoice." as const;
export const physicalReadinessAdjustmentPreviewSchema = z.object({
  scope: scopeSchema,
  input: physicalReadinessAdjustmentInputSchema,
  organizationRole: z.string().min(1),
  expectedReadyQuantity: z.number().finite().nonnegative(),
  nativeStatus: z.string(),
  productionCompleteQuantity: z.number().finite().nonnegative(),
  limitation: z.literal(limitation),
}).strict();
export type PhysicalReadinessAdjustmentPreview = z.infer<typeof physicalReadinessAdjustmentPreviewSchema>;

const receiptSchema = z.object({
  id: z.string().min(1),
  payload: z.object({
    clientRequestId: z.string(), reason: z.string(), operatorUserId: z.string().nullable(),
    adjustments: z.array(z.object({
      orderLineItemId: z.string(), quantityDelta: z.number(), previousReadyQuantity: z.number(), nextReadyQuantity: z.number(),
    }).passthrough()),
  }).passthrough(),
}).strict();
export type PhysicalReadinessAdjustmentReceipt = z.infer<typeof receiptSchema>;

export const physicalReadinessAdjustmentResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("applied"), clientRequestId: z.string(), receiptId: z.string().nullable(),
    readiness: orderFulfillmentReadinessReadResultSchema }).strict(),
  z.object({ status: z.literal("applied_read_unavailable"), clientRequestId: z.string(), receiptId: z.string().nullable() }).strict(),
  z.object({ status: z.literal("outcome_unknown"), clientRequestId: z.string(), receiptId: z.null() }).strict(),
]);
export type PhysicalReadinessAdjustmentResult = z.infer<typeof physicalReadinessAdjustmentResultSchema>;
export type PhysicalReadinessAdjustmentDependencies = OrderFulfillmentReadinessReadDependencies & {
  /** Canonical arguments, deliberately untrusted return: always reread rather
   * than treating service hydration as fresh authorized evidence. */
  adjustReadyQuantities?: (...args: Parameters<typeof canonicalFulfillmentOperations.adjustReadyQuantities>) => Promise<unknown>;
  readReceipt?: (organizationId: string, orderId: string, clientRequestId: string) => Promise<PhysicalReadinessAdjustmentReceipt | null>;
};

export class PhysicalReadinessAdjustmentError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "PhysicalReadinessAdjustmentError"; }
}
function fail(code: string, message: string): never { throw new PhysicalReadinessAdjustmentError(code, message); }

const readDetail: NonNullable<PhysicalReadinessAdjustmentDependencies["readDetail"]> = async (org, id, role) =>
  (await import("../fulfillment/canonicalFulfillmentOperations")).canonicalFulfillmentOperations.getOrderDetail(org, id, role);
const adjust: NonNullable<PhysicalReadinessAdjustmentDependencies["adjustReadyQuantities"]> = async (...args) =>
  (await import("../fulfillment/canonicalFulfillmentOperations")).canonicalFulfillmentOperations.adjustReadyQuantities(...args);

/** Read the existing native durable audit/idempotency record; never manufacture
 * an assistant receipt or write a parallel ledger. Native keys are order scoped.
 * The confirmation owner must mint/persist a key once and bind it to this exact
 * preview. Native events do not record requireProductionComplete. */
const readReceipt: NonNullable<PhysicalReadinessAdjustmentDependencies["readReceipt"]> = async (org, orderId, key) => {
  const [{ db }, { fulfillmentEvents }, { and, eq, sql }] = await Promise.all([
    import("../../db"), import("@shared/schema"), import("drizzle-orm"),
  ]);
  const [event] = await db.select({ id: fulfillmentEvents.id, payload: fulfillmentEvents.payloadJson })
    .from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, org), eq(fulfillmentEvents.entityId, orderId),
      eq(fulfillmentEvents.eventType, "FULFILLMENT_READY"), sql`${fulfillmentEvents.payloadJson}->>'clientRequestId' = ${key}`)).limit(1);
  return event ? receiptSchema.parse(event) : null;
};

async function authority(scope: PhysicalReadinessAdjustmentScope, deps: PhysicalReadinessAdjustmentDependencies) {
  let value: OrderFulfillmentNativeReadAuthority | null;
  try { value = await (deps.verifyNativeReadAuthority ?? verifyNativeReadAuthority)(scope); }
  catch { return fail("NATIVE_AUTHORITY_UNVERIFIED", "Current native membership could not be verified."); }
  if (!value || value.organizationId !== scope.organizationId || value.userId !== scope.userId
    || !normalizeOrganizationRole(value.organizationRole)) fail("NATIVE_AUTHORITY_UNVERIFIED", "Current native membership is unavailable.");
  return value;
}

async function current(scope: PhysicalReadinessAdjustmentScope, input: PhysicalReadinessAdjustmentInput,
  deps: PhysicalReadinessAdjustmentDependencies) {
  const actor = await authority(scope, deps);
  const detail: OrderFulfillmentNativeReadDetail = await (deps.readDetail ?? readDetail)(scope.organizationId, scope.orderId, actor.organizationRole);
  const after = await authority(scope, deps);
  if (after.organizationRole !== actor.organizationRole) fail("NATIVE_AUTHORITY_CHANGED", "Native membership changed. Review again.");
  if (detail.orderId !== scope.orderId) fail("NATIVE_TARGET_MISMATCH", "Native order target did not match.");
  if (detail.permissions?.canConfirmPhysicalReadiness !== true) fail("READY_PERMISSION_DENIED", "Native physical-readiness permission is required.");
  const line = detail.lineItems.find(item => item.id === input.orderLineItemId);
  if (!line) fail("LINE_ITEM_NOT_FOUND", "Readiness line item does not belong to this order.");
  return { actor, detail, line };
}

/** Read-only preview. The native operation owns quantity limits, reservations,
 * cancellation and all transaction validation. Preview is not authorization to
 * execute; the coordinator persists/binds this artifact to a protected GO. */
export async function previewPhysicalReadinessAdjustment(scope: PhysicalReadinessAdjustmentScope,
  input: PhysicalReadinessAdjustmentInput, deps: PhysicalReadinessAdjustmentDependencies = {}): Promise<PhysicalReadinessAdjustmentPreview> {
  const trusted = scopeSchema.parse(scope), normalized = physicalReadinessAdjustmentInputSchema.parse(input);
  const { actor, detail, line } = await current(trusted, normalized, deps);
  return physicalReadinessAdjustmentPreviewSchema.parse({ scope: trusted, input: normalized, organizationRole: actor.organizationRole,
    expectedReadyQuantity: line.production.readyWaitingQuantity, nativeStatus: detail.status,
    productionCompleteQuantity: line.production.productionCompleteQuantity, limitation });
}

function matchesReceipt(receipt: PhysicalReadinessAdjustmentReceipt, preview: PhysicalReadinessAdjustmentPreview, key: string) {
  const payload = receipt.payload, item = payload.adjustments[0];
  return payload.clientRequestId === key && payload.operatorUserId === preview.scope.userId && payload.reason === preview.input.reason
    && payload.adjustments.length === 1 && item.orderLineItemId === preview.input.orderLineItemId
    && item.quantityDelta === preview.input.quantityDelta && item.previousReadyQuantity === preview.expectedReadyQuantity
    && item.nextReadyQuantity === preview.expectedReadyQuantity + preview.input.quantityDelta;
}

/** Execute only a stored, confirmed server preview, with its ORIGINAL persisted
 * server retry key. Never accept this artifact/key directly from model args.
 *
 * Native shipment UI explicitly says "Physically ready despite outstanding
 * tracking? ... Production jobs stay open" (fulfillment-shipment-detail.tsx).
 * Therefore this is physical confirmation, NOT the separate production override;
 * no "AI Override" reason is substituted and the user's native reason survives.
 * expectedReadyByLine is always forwarded for the native locked CAS. No local
 * read/compare is represented as transactional CAS or used to block retries.
 */
export async function executePhysicalReadinessAdjustment(scope: PhysicalReadinessAdjustmentScope,
  preview: PhysicalReadinessAdjustmentPreview, context: { clientRequestId: string },
  deps: PhysicalReadinessAdjustmentDependencies = {}): Promise<PhysicalReadinessAdjustmentResult> {
  const trusted = scopeSchema.parse(scope), reviewed = physicalReadinessAdjustmentPreviewSchema.parse(preview);
  const { clientRequestId } = z.object({ clientRequestId: z.string().trim().min(1).max(128) }).strict().parse(context);
  if (trusted.organizationId !== reviewed.scope.organizationId || trusted.userId !== reviewed.scope.userId || trusted.orderId !== reviewed.scope.orderId)
    fail("NATIVE_TARGET_MISMATCH", "Reviewed actor, tenant or order no longer matches.");
  const actor = await authority(trusted, deps);
  if (actor.organizationRole !== reviewed.organizationRole) fail("NATIVE_AUTHORITY_CHANGED", "Native membership changed. Review again.");
  const receiptReader = deps.readReceipt ?? readReceipt;
  // Fail closed before writing if durable replay evidence cannot be checked.
  let receipt = await receiptReader(trusted.organizationId, trusted.orderId, clientRequestId);
  if (receipt && !matchesReceipt(receiptSchema.parse(receipt), reviewed, clientRequestId))
    fail("READY_REQUEST_CONFLICT", "Native retry key belongs to a different physical adjustment.");
  if (!receipt) {
    const fresh = await current(trusted, reviewed.input, deps);
    if (fresh.actor.organizationRole !== actor.organizationRole) fail("NATIVE_AUTHORITY_CHANGED", "Native membership changed. Review again.");
    // Authority is reread after receipt I/O immediately before the native call.
    const beforeWrite = await authority(trusted, deps);
    if (beforeWrite.organizationRole !== actor.organizationRole) fail("NATIVE_AUTHORITY_CHANGED", "Native membership changed. Review again.");
    try {
      await (deps.adjustReadyQuantities ?? adjust)(trusted.organizationId, trusted.orderId, {
        items: [{ orderLineItemId: reviewed.input.orderLineItemId, quantityDelta: reviewed.input.quantityDelta }],
        reason: reviewed.input.reason, clientRequestId,
        ...(reviewed.input.requireProductionComplete === undefined ? {} : { requireProductionComplete: reviewed.input.requireProductionComplete }),
        expectedReadyByLine: { [reviewed.input.orderLineItemId]: reviewed.expectedReadyQuantity },
      }, trusted.userId, beforeWrite.organizationRole);
    } catch (error) {
      // Native service commits its transaction BEFORE detail hydration. Even a
      // rejected service promise can mean a successful, durable physical write.
      try { receipt = await receiptReader(trusted.organizationId, trusted.orderId, clientRequestId); }
      catch { return { status: "outcome_unknown", clientRequestId, receiptId: null }; }
      if (receipt && matchesReceipt(receiptSchema.parse(receipt), reviewed, clientRequestId))
        return { status: "applied_read_unavailable", clientRequestId, receiptId: receipt.id };
      if (receipt) fail("READY_REQUEST_CONFLICT", "Native retry key belongs to a different physical adjustment.");
      const native = error as { code?: unknown; status?: unknown; message?: unknown };
      if (typeof native?.code === "string" && typeof native?.status === "number")
        fail(native.code, typeof native.message === "string" ? native.message : "Native adjustment was rejected.");
      return { status: "outcome_unknown", clientRequestId, receiptId: null };
    }
  }
  // Canonical success (or an exact durable receipt) proves applied, even when a
  // subsequent workspace read or membership verification cannot release facts.
  try {
    receipt ??= await receiptReader(trusted.organizationId, trusted.orderId, clientRequestId);
    if (receipt && !matchesReceipt(receiptSchema.parse(receipt), reviewed, clientRequestId))
      return { status: "outcome_unknown", clientRequestId, receiptId: null };
    const readiness = await readOrderFulfillmentReadiness(trusted, deps);
    if (readiness.status === "available") return { status: "applied", clientRequestId, receiptId: receipt?.id ?? null, readiness };
  } catch { /* The write is applied; do not relabel as safe-to-retry failure. */ }
  return { status: "applied_read_unavailable", clientRequestId, receiptId: receipt?.id ?? null };
}
