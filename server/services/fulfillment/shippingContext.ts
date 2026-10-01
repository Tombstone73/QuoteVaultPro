import { and, eq, inArray } from 'drizzle-orm';
import { customers, orders } from '@shared/schema';
import { shipmentShippingContextSchema, shippingPartyValidationErrors, type ShipmentShippingContext, type ShippingParty } from '@shared/shippingDocuments';
import { db } from '../../db';
import { FulfillmentHttpError } from './types';

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Select one address snapshot, never combine fields from different addresses. */
export function orderShippingContext(order: {
  id: string; shipToName?: unknown; shipToCompany?: unknown; shipToAddress1?: unknown; shipToAddress2?: unknown;
  shipToCity?: unknown; shipToState?: unknown; shipToPostalCode?: unknown; shipToCountry?: unknown;
  shipToPhone?: unknown; shipToEmail?: unknown; shippingAddress?: unknown; blindShipping?: boolean | null;
}): ShipmentShippingContext {
  const flat = [order.shipToAddress1, order.shipToAddress2, order.shipToCity, order.shipToState, order.shipToPostalCode, order.shipToCountry].some(value => text(value));
  const legacy = order.shippingAddress && typeof order.shippingAddress === 'object' ? order.shippingAddress as Record<string, unknown> : {};
  const destination: ShippingParty = flat ? {
    name: text(order.shipToName), company: text(order.shipToCompany), address1: text(order.shipToAddress1), address2: text(order.shipToAddress2),
    city: text(order.shipToCity), state: text(order.shipToState), postalCode: text(order.shipToPostalCode), country: text(order.shipToCountry),
    phone: text(order.shipToPhone), email: text(order.shipToEmail),
  } : {
    name: text(legacy.name), company: text(legacy.company), address1: text(legacy.address1), address2: text(legacy.address2),
    city: text(legacy.city), state: text(legacy.state), postalCode: text(legacy.postalCode ?? legacy.zip), country: text(legacy.country),
    phone: text(legacy.phone), email: text(legacy.email),
  };
  return { version: 1, source: flat ? 'order' : 'legacy_order', sourceOrderId: order.id, destination,
    blindShipping: order.blindShipping === true, blindSender: null };
}

export function commonShipmentShippingContext(contexts: ShipmentShippingContext[]): ShipmentShippingContext {
  const first = contexts[0];
  if (!first) throw new FulfillmentHttpError(400, 'At least one linked Order is required to resolve Ship To.', 'EMPTY_ORDER_IDS');
  if (contexts.some(context => JSON.stringify(context.destination) !== JSON.stringify(first.destination))) {
    throw new FulfillmentHttpError(409, 'Combined Orders have different Ship To details. Correct the Order destinations or create separate shipments.', 'ADDRESS_MISMATCH');
  }
  if (contexts.some(context => context.blindShipping !== first.blindShipping)) {
    throw new FulfillmentHttpError(409, 'Combined Orders have conflicting blind-shipping defaults. Confirm matching customer preferences or create separate shipments.', 'BLIND_SHIPPING_CONFLICT');
  }
  return first;
}

export async function resolveShipmentShippingContext(orgId: string, orderIds: string[], executor: typeof db = db): Promise<ShipmentShippingContext> {
  const ids = Array.from(new Set(orderIds));
  if (!ids.length) return commonShipmentShippingContext([]);
  const rows = await executor.select({
    id: orders.id, shipToName: orders.shipToName, shipToCompany: orders.shipToCompany,
    shipToAddress1: orders.shipToAddress1, shipToAddress2: orders.shipToAddress2, shipToCity: orders.shipToCity,
    shipToState: orders.shipToState, shipToPostalCode: orders.shipToPostalCode, shipToCountry: orders.shipToCountry,
    shipToPhone: orders.shipToPhone, shipToEmail: orders.shipToEmail, shippingAddress: orders.shippingAddress,
    blindShipping: customers.blindShipping,
  }).from(orders).leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, orgId)))
    .where(and(eq(orders.organizationId, orgId), inArray(orders.id, ids)));
  if (rows.length !== ids.length) throw new FulfillmentHttpError(404, 'One or more linked Orders were not found.', 'ORDER_NOT_FOUND');
  const byId = new Map(rows.map(row => [row.id, row]));
  return commonShipmentShippingContext(ids.map(id => orderShippingContext(byId.get(id)!)));
}

export function validateShipmentShippingContext(value: unknown, orderIds: string[], complete = false): ShipmentShippingContext {
  const context = shipmentShippingContextSchema.parse(value);
  if ((context.source !== 'staff' && !context.sourceOrderId) || (context.sourceOrderId && !orderIds.includes(context.sourceOrderId))) {
    throw new FulfillmentHttpError(400, 'Shipping context source must identify an Order linked to this shipment.', 'INVALID_SHIPPING_CONTEXT_SOURCE');
  }
  if (complete) {
    const missing = shippingPartyValidationErrors(context.destination);
    if (missing.length) throw new FulfillmentHttpError(409, `Complete Ship To before shipping: ${missing.join(', ')}.`, 'SHIPPING_DESTINATION_INCOMPLETE');
    if (context.blindShipping && (!context.blindSender || shippingPartyValidationErrors(context.blindSender).length)) {
      throw new FulfillmentHttpError(409, 'Blind shipping requires explicit confirmation of a complete alternate sender. Enter the sender identity and address before shipping.', 'BLIND_SENDER_REQUIRED');
    }
  }
  return context;
}
