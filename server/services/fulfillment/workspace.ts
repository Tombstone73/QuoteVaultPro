import type { QueueRowDto } from './types';
import { isCanceledOrder } from '@shared/operationalState';

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as any);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * Project an order into its fulfillment workspace summary. This intentionally
 * does not use the fulfillment queue predicate: queue visibility and the
 * existence of an Order-owned workspace are separate concerns.
 */
export function buildFulfillmentWorkspaceQueueRow(input: {
  order: {
    id: string;
    orderNumber: string;
    shippingMethod: string | null;
    state: string | null;
    status: string | null;
    canceledAt: string | Date | null;
    routingTarget: string | null;
    fulfillmentStatus: string | null;
    productionCompletedAt: unknown;
    updatedAt: unknown;
    shipToCity: string | null;
    shipToState: string | null;
    customerName: string | null;
  };
  orderedQty: number;
  shippedQty: number;
  fulfilledQty?: number;
  pickedUpQty?: number;
  readyWaitingQty?: number;
  notReadyQty?: number;
  productionCompleteQty?: number;
  eligibleQty?: number;
  blockedQty?: number;
  physicalLineCount?: number;
  pickupTicket: { id: string; status: string | null } | null;
  shipmentId: string | null;
  deriveShipStatus: (fulfillmentStatus: string | null, orderedQty: number, shippedQty: number) => string;
}): QueueRowDto {
  const { order, orderedQty, shippedQty, pickupTicket, shipmentId, deriveShipStatus } = input;
  const fulfilledQty = input.fulfilledQty ?? shippedQty;
  const pickedUpQty = input.pickedUpQty ?? 0;
  const isPickup = order.shippingMethod === 'pickup';
  const isEligible = !isCanceledOrder(order);
  const remaining = Math.max(orderedQty - fulfilledQty, 0);
  const pickupStatus = cleanText(pickupTicket?.status).toUpperCase();
  const status = isPickup
    ? (pickupStatus || (isEligible ? 'DRAFT' : 'CANCELLED'))
    : (!isEligible ? 'CANCELLED' : deriveShipStatus(order.fulfillmentStatus, orderedQty, shippedQty));

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName || 'Unknown Customer',
    fulfillmentType: isPickup ? 'PICKUP' : 'SHIP',
    status,
    itemsRemaining: `${remaining} item(s)`,
    physicalLineCount: input.physicalLineCount ?? 0,
    orderedQuantity: orderedQty,
    productionCompleteQuantity: input.productionCompleteQty ?? 0,
    fulfilledQuantity: fulfilledQty,
    eligibleQuantity: input.eligibleQty ?? 0,
    blockedQuantity: input.blockedQty ?? remaining,
    shippedQuantity: shippedQty,
    pickedUpQuantity: pickedUpQty,
    readyWaitingQuantity: input.readyWaitingQty ?? input.eligibleQty ?? 0,
    notReadyQuantity: input.notReadyQty ?? input.blockedQty ?? remaining,
    remainingQuantity: remaining,
    readySince: isEligible ? toIso(order.productionCompletedAt ?? order.updatedAt) : null,
    shipTo: isPickup ? 'In-Store' : [order.shipToCity, order.shipToState].filter(Boolean).join(', ') || 'Unknown',
    overdue: false,
    pickupTicketId: pickupTicket?.id ?? null,
    shipmentId,
    isArchived: false,
    archivedReason: null,
    productionJobs: [],
  };
}
