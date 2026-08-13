import { fulfillmentServiceV2 } from "./service";

/**
 * Named application boundary for fulfillment mutations.  FulfillmentService
 * remains the lifecycle/eligibility/audit owner; UI and Assistant adapters use
 * this façade instead of carrying their own workflow logic.
 */
export class CanonicalFulfillmentOperations {
  listQueue(...args: Parameters<typeof fulfillmentServiceV2.listQueue>) { return fulfillmentServiceV2.listQueue(...args); }
  getOrderDetail(...args: Parameters<typeof fulfillmentServiceV2.getOrderDetail>) { return fulfillmentServiceV2.getOrderDetail(...args); }
  markOrderReady(...args: Parameters<typeof fulfillmentServiceV2.markOrderReady>) { return fulfillmentServiceV2.markOrderReady(...args); }
  markOrderReadyForPickup(...args: Parameters<typeof fulfillmentServiceV2.markOrderReadyForPickup>) { return fulfillmentServiceV2.markOrderReadyForPickup(...args); }
  unreadyOrder(...args: Parameters<typeof fulfillmentServiceV2.unreadyOrder>) { return fulfillmentServiceV2.unreadyOrder(...args); }
  updateChecklistItem(...args: Parameters<typeof fulfillmentServiceV2.updateChecklistItem>) { return fulfillmentServiceV2.updateChecklistItem(...args); }
  addOrderNote(...args: Parameters<typeof fulfillmentServiceV2.addOrderNote>) { return fulfillmentServiceV2.addOrderNote(...args); }
  createShipment(...args: Parameters<typeof fulfillmentServiceV2.createShipment>) { return fulfillmentServiceV2.createShipment(...args); }
  getShipment(...args: Parameters<typeof fulfillmentServiceV2.getShipment>) { return fulfillmentServiceV2.getShipment(...args); }
  patchShipment(...args: Parameters<typeof fulfillmentServiceV2.patchShipment>) { return fulfillmentServiceV2.patchShipment(...args); }
  createShipmentPackage(...args: Parameters<typeof fulfillmentServiceV2.createShipmentPackage>) { return fulfillmentServiceV2.createShipmentPackage(...args); }
  deleteShipmentPackage(...args: Parameters<typeof fulfillmentServiceV2.deleteShipmentPackage>) { return fulfillmentServiceV2.deleteShipmentPackage(...args); }
  markShipmentShipped(...args: Parameters<typeof fulfillmentServiceV2.markShipmentShipped>) { return fulfillmentServiceV2.markShipmentShipped(...args); }
  voidShipment(...args: Parameters<typeof fulfillmentServiceV2.voidShipment>) { return fulfillmentServiceV2.voidShipment(...args); }
  createOrGetPickupTicket(...args: Parameters<typeof fulfillmentServiceV2.createOrGetPickupTicket>) { return fulfillmentServiceV2.createOrGetPickupTicket(...args); }
  markPickupReady(...args: Parameters<typeof fulfillmentServiceV2.markPickupReady>) { return fulfillmentServiceV2.markPickupReady(...args); }
  markPickupPickedUp(...args: Parameters<typeof fulfillmentServiceV2.markPickupPickedUp>) { return fulfillmentServiceV2.markPickupPickedUp(...args); }
}

export const canonicalFulfillmentOperations = new CanonicalFulfillmentOperations();

export function renderCanonicalFulfillmentOperationMigrationMarkdown() {
  return `# Shared canonical Fulfillment operations\n\n| Operation family | Existing state owner | UI / Assistant use |\n|---|---|---|\n| readiness, checklist, shipment, pickup and notes | \`FulfillmentService\` plus fulfillment repositories | Fulfillment routes and existing GO-confirmed Assistant commands share this façade |\n\nEligibility remains production-complete and non-cancelled; terminal shipment and pickup actions retain the service's checklist, quantity, event, and audit behavior. Billing automation remains an existing downstream service, not a new Operator capability.\n`;
}
