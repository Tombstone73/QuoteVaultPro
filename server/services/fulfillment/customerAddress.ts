import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { customers, fulfillmentEvents, orders, shipmentOrders, shipments, userOrganizations } from '@shared/schema';
import { customerShippingAddressFromParty, saveShipmentCustomerAddressSchema, type SaveShipmentCustomerAddressInput, type ShipmentCustomerAddressTarget } from '@shared/fulfillmentCustomerAddress';
import { shippingPartyAddressLines, shippingPartyValidationErrors } from '@shared/shippingDocuments';
import { canonicalCustomerContactOperations } from '../customers/canonicalCustomerContactOperations';
import { ShipmentRepo } from './repository';
import { FulfillmentHttpError } from './types';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requireCustomerEditor(executor: Executor, organizationId: string, actorUserId: string) {
  // Customer PATCH uses internal authentication plus tenant membership. Portal
  // identities are denied by the same tenantContext middleware on these routes.
  const [membership] = await executor.select({userId:userOrganizations.userId}).from(userOrganizations).where(and(
    eq(userOrganizations.organizationId,organizationId),eq(userOrganizations.userId,actorUserId),
  )).limit(1);
  if (!membership) throw new FulfillmentHttpError(403,'Customer-edit access in this organization is required.','CUSTOMER_EDIT_FORBIDDEN');
}

async function targetForShipment(executor: Executor, organizationId: string, shipmentId: string, lockOrders = false): Promise<ShipmentCustomerAddressTarget> {
  const [shipment] = await executor.select({status:shipments.status,shippingContext:shipments.shippingContext}).from(shipments).where(and(
    eq(shipments.organizationId,organizationId),eq(shipments.id,shipmentId),
  )).limit(1);
  if (!shipment) throw new FulfillmentHttpError(404,'Shipment not found.','NOT_FOUND');
  if (shipment.status !== 'DRAFT') throw new FulfillmentHttpError(409,'Historical shipment addresses cannot update a customer profile.','INVALID_STATE');
  if (shipment.shippingContext?.blindShipping) throw new FulfillmentHttpError(409,'Blind-shipping destinations stay shipment-only. Edit the customer profile separately if its default address needs changing.','BLIND_DESTINATION');
  const links = await executor.select({orderId:shipmentOrders.orderId}).from(shipmentOrders).where(and(
    eq(shipmentOrders.organizationId,organizationId),eq(shipmentOrders.shipmentId,shipmentId),
  ));
  const ids = links.map(link=>link.orderId);
  if (!ids.length) throw new FulfillmentHttpError(409,'This shipment has no linked customer Order.','CUSTOMER_AMBIGUOUS');
  const query = executor.select({customerId:orders.customerId}).from(orders).where(and(
    eq(orders.organizationId,organizationId),inArray(orders.id,ids),
  ));
  const linked = await (lockOrders ? query.for('share') : query);
  const customerId = linked[0]?.customerId;
  if (!customerId || linked.length !== ids.length || linked.some(order=>order.customerId !== customerId)) {
    throw new FulfillmentHttpError(409,'Linked Orders must identify one customer before updating a default address.','CUSTOMER_AMBIGUOUS');
  }
  const [customer] = await executor.select().from(customers).where(and(
    eq(customers.organizationId,organizationId),eq(customers.id,customerId),
  )).limit(1);
  if (!customer || ['archived','superseded'].includes(customer.status ?? '')) throw new FulfillmentHttpError(409,'The linked customer profile is unavailable.','CUSTOMER_UNAVAILABLE');
  return {customerId,companyName:customer.companyName,updatedAt:customer.updatedAt.toISOString(),legacyAddress:customer.shippingAddress,address:{
    shippingStreet1:customer.shippingStreet1 ?? '',shippingStreet2:customer.shippingStreet2 ?? '',shippingCity:customer.shippingCity ?? '',
    shippingState:customer.shippingState ?? '',shippingPostalCode:customer.shippingPostalCode ?? '',shippingCountry:customer.shippingCountry ?? '',
  }};
}

export async function getShipmentCustomerAddressTarget(organizationId: string, shipmentId: string, actorUserId: string, executor: Executor = db) {
  await requireCustomerEditor(executor,organizationId,actorUserId);
  return targetForShipment(executor,organizationId,shipmentId);
}

/** Copy only a confirmed, saved DRAFT destination through the canonical Customer writer. */
export async function saveShipmentDestinationToCustomer(organizationId: string, shipmentId: string, actorUserId: string, input: SaveShipmentCustomerAddressInput, executor: typeof db = db) {
  const request = saveShipmentCustomerAddressSchema.parse(input);
  return executor.transaction(async tx=>{
    await requireCustomerEditor(tx,organizationId,actorUserId);
    const shipment = await new ShipmentRepo(executor).lockDraftShipment(organizationId,shipmentId,tx);
    if (shipment.updatedAt.toISOString() !== request.expectedShipmentUpdatedAt) {
      throw new FulfillmentHttpError(409,'The shipment changed. Confirm the saved destination before updating the customer profile.','SHIPMENT_STALE');
    }
    const target = await targetForShipment(tx,organizationId,shipmentId,true);
    if (target.customerId !== request.customerId) throw new FulfillmentHttpError(409,'The linked customer changed. Review the customer profile before retrying.','CUSTOMER_CHANGED');
    const destination = shipment.shippingContext?.destination;
    if (!destination || shippingPartyValidationErrors(destination).length) throw new FulfillmentHttpError(409,'Complete and save the shipment destination before updating the customer profile.','DESTINATION_INCOMPLETE');
    const address = customerShippingAddressFromParty(destination);
    await canonicalCustomerContactOperations.updateCustomerInTransaction(tx,{
      organizationId,actorUserId,customerId:target.customerId,expectedUpdatedAt:request.expectedCustomerUpdatedAt,
      patch:{...address,shippingAddress:shippingPartyAddressLines({...destination,name:null,company:null}).join(', ')},
      auditReference:`fulfillment-shipment:${shipmentId}`,
    });
    const readback = await targetForShipment(tx,organizationId,shipmentId);
    if (JSON.stringify(readback.address) !== JSON.stringify(address)) throw new Error('Customer shipping address readback did not match the reviewed destination.');
    await tx.insert(fulfillmentEvents).values({organizationId,actorUserId,entityType:'SHIPMENT',entityId:shipmentId,
      eventType:'CUSTOMER_SHIPPING_ADDRESS_UPDATED',payloadJson:{customerId:target.customerId,shipmentUpdatedAt:request.expectedShipmentUpdatedAt}});
    return readback;
  });
}
