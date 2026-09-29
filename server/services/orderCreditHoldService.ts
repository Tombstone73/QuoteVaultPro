import { and, desc, eq, inArray } from 'drizzle-orm';
import { auditLogs, customers, orders } from '@shared/schema';
import { deriveOrderCreditHold, isForwardProductionOrder, type OrderCreditHold } from '@shared/orderCreditHold';
import { parseMoneyToCents } from '@shared/customerCreditExposure';
import { db } from '../db';
import { getCustomerCreditExposures } from './customerCreditExposureService';
import { canOverrideCustomerCredit } from './customerCreditPolicyService';

type CreditOrder = { id: string; customerId?: string | null; total?: unknown; state?: string | null; status?: string | null; canceledAt?: unknown };
type OverrideEvidence = { customerId: string; orderTotalCents: number; creditLimitCents: number | null; exposureCents: number };
const OVERRIDE_ACTION = 'order_production_credit_override';

function evidence(order: CreditOrder, hold: OrderCreditHold): OverrideEvidence {
  return { customerId: order.customerId!, orderTotalCents: parseMoneyToCents(order.total), creditLimitCents: hold.creditLimitCents, exposureCents: hold.exposureCents };
}

export function creditOverrideMatches(current: OverrideEvidence, saved: Partial<OverrideEvidence> | null | undefined) {
  return saved?.customerId === current.customerId && saved.orderTotalCents === current.orderTotalCents
    && saved.creditLimitCents === current.creditLimitCents && saved.exposureCents === current.exposureCents;
}

export async function projectOrderCreditHolds<T extends CreditOrder>(organizationId: string, orderRows: T[], runner: any = db): Promise<Array<T & { creditHold: OrderCreditHold }>> {
  const active = orderRows.filter(isForwardProductionOrder);
  const ids = Array.from(new Set(active.map(row => row.customerId).filter((id): id is string => Boolean(id))));
  const customerRows = ids.length ? await runner.select({ id: customers.id, creditLimit: customers.creditLimit, creditLimitConfiguredAt: customers.creditLimitConfiguredAt })
    .from(customers).where(and(eq(customers.organizationId, organizationId), inArray(customers.id, ids))) : [];
  const positions = await getCustomerCreditExposures(organizationId, customerRows, runner);
  const activeIds = active.map(row => row.id);
  const overrides = activeIds.length ? await runner.select({ entityId: auditLogs.entityId, newValues: auditLogs.newValues })
    .from(auditLogs).where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityType, 'order'),
      eq(auditLogs.actionType, OVERRIDE_ACTION), inArray(auditLogs.entityId, activeIds))).orderBy(desc(auditLogs.createdAt)) : [];
  const latest = new Map<string, any>();
  for (const row of overrides) if (!latest.has(row.entityId)) latest.set(row.entityId, row.newValues);
  return orderRows.map(order => {
    if (isForwardProductionOrder(order) && order.customerId && !positions.has(order.customerId)) {
      throw Object.assign(new Error('Customer credit position is unavailable. Review the Order billing customer before production release.'), { statusCode: 409 });
    }
    const hold = deriveOrderCreditHold(order, positions.get(order.customerId ?? ''));
    if (hold.held && creditOverrideMatches(evidence(order, hold), latest.get(order.id))) {
      hold.held = false;
      hold.overrideApplied = true;
    }
    return { ...order, creditHold: hold };
  });
}

export async function getOrderCreditHold(runner: any, input: { organizationId: string; orderId: string }) {
  const [order] = await runner.select({ id: orders.id, customerId: orders.customerId, total: orders.total, state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
    .from(orders).where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId))).limit(1);
  if (!order) throw Object.assign(new Error('Order not found for production release.'), { statusCode: 404 });
  const [projection] = await projectOrderCreditHolds(input.organizationId, [order], runner);
  return projection;
}

export class ProductionCreditHoldError extends Error {
  readonly statusCode = 409;
  readonly code = 'PRODUCTION_CREDIT_HOLD';
  constructor(readonly details: OrderCreditHold) {
    super(`Production release blocked. Payment required: $${(details.requiredPaymentCents / 100).toFixed(2)}. Record payment or use an authorized credit override. Order entry and proofing may continue.`);
  }
}

/** Gate the resolved physical destination. Design/prepress ownership semantics also use stepKey. */
export function isPhysicalProductionDestination(route: { stationKey?: string | null; stepKey?: string | null }) {
  const station = String(route.stationKey ?? '').trim().toLowerCase();
  const step = String(route.stepKey ?? '').trim().toLowerCase();
  // Physical station identity cannot be bypassed with a preparatory step name.
  if (['roll', 'roll_printing', 'flatbed', 'flatbed_printing', 'cnc', 'finishing', 'lamination', 'fabrication'].includes(station)) return true;
  return !['design', 'prepress', 'proofing', 'fulfillment'].includes(station)
    && !['design', 'prepress', 'proofing'].includes(step);
}

export async function assertProductionCredit(runner: any, input: { organizationId: string; orderId: string; stationKey?: string | null; stepKey?: string | null }) {
  if (!isPhysicalProductionDestination(input)) return;
  const { creditHold } = await getOrderCreditHold(runner, input);
  if (creditHold.held) throw new ProductionCreditHoldError(creditHold);
}

export async function overrideOrderProductionCredit(input: { organizationId: string; orderId: string; actorUserId: string; actorOrgRole: unknown; reason: string; confirmed: boolean }) {
  if (!canOverrideCustomerCredit(input.actorOrgRole)) throw Object.assign(new Error('Only an Organization Owner or Admin can override a customer credit limit.'), { statusCode: 403 });
  const reason = String(input.reason ?? '').trim();
  if (!input.confirmed || !reason || reason.length > 2000) throw Object.assign(new Error('Confirm the credit override and provide a reason (up to 2000 characters).'), { statusCode: 400 });
  return db.transaction(async tx => {
    const order = await getOrderCreditHold(tx, input);
    if (!order.creditHold.held) return order.creditHold;
    await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId,
      actionType: OVERRIDE_ACTION, entityType: 'order', entityId: input.orderId,
      description: 'Authorized credit override for physical production release at the reviewed financial position.',
      newValues: { ...evidence(order, order.creditHold), reason, confirmed: true } });
    return { ...order.creditHold, held: false, overrideApplied: true };
  });
}
