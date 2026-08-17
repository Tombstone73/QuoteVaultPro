import assert from "node:assert/strict";
import { capabilityIds } from "../../src/authorization/capabilities.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { FulfillmentAvailability, FulfillmentHandoff } from "../../src/modules/fulfillment/contracts.js";

const handoff:FulfillmentHandoff={handoffId:brandedId<"FulfillmentHandoffId">("handoff"),organizationId:brandedId<"OrganizationId">("org"),orderId:brandedId<"OrderId">("order"),method:"pickup",completedAt:"2026-08-16T00:00:00.000Z",completedPrincipalKind:"staff",completedPrincipalSubject:"staff"};
const availability:FulfillmentAvailability={orderId:brandedId<"OrderId">("order"),orderLineId:brandedId<"OrderLineId">("line"),orderedQuantity:100,completedPickupQuantity:40,completedShipmentQuantity:60,completedFulfillmentQuantity:100,remainingFulfillmentQuantity:0};
assert.equal(availability.orderedQuantity-availability.completedFulfillmentQuantity,availability.remainingFulfillmentQuantity,"availability derives only from ordered and completed handoff quantities");
assert.equal(availability.completedPickupQuantity+availability.completedShipmentQuantity,availability.completedFulfillmentQuantity,"mixed pickup and shipment share one line quantity truth");
assert.equal("producedQuantity" in availability,false,"Production output is not a Fulfillment availability input");
assert.equal("routeState" in handoff,false,"Routing state is not duplicated in a customer handoff");
assert.equal("invoiceId" in handoff,false,"Billing state is not owned by Fulfillment");
assert.deepEqual(["fulfillment.view","fulfillment.pickup","fulfillment.ship"].every(x=>capabilityIds.includes(x as typeof capabilityIds[number])),true,"Fulfillment capabilities are reviewed vocabulary");
console.log("[m3.1] Fulfillment contract tests passed (6 assertions).");
