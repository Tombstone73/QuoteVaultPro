import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShipmentBuilder, groupShipmentAllocations, shipmentQuantityValid } from "./ShipmentBuilder";

assert.equal(shipmentQuantityValid("20", 60), true);
assert.equal(shipmentQuantityValid("61", 60), false, "operator UI does not submit beyond the server-reported available quantity");
assert.equal(shipmentQuantityValid("0", 60), false);
assert.equal(shipmentQuantityValid("1.5", 60), false);
const groups = groupShipmentAllocations([
  { orderId: "order-a", orderLineId: "line-a", quantity: "20" },
  { orderId: "order-a", orderLineId: "line-b", quantity: "5" },
  { orderId: "order-b", orderLineId: "line-c", quantity: "7" },
]);
assert.deepEqual(groups.get("order-a"), [{ orderLineId: "line-a", quantity: 20 }, { orderLineId: "line-b", quantity: 5 }]);
assert.deepEqual(groups.get("order-b"), [{ orderLineId: "line-c", quantity: 7 }]);

const markup = renderToStaticMarkup(<ShipmentBuilder organizationId="org-a" csrfReady canShip refresh={async () => {}} orders={[{ orderId: "order-a", number: "ORD-100", commercialState: "open", customerName: "Titan", customerId: "customer-a", requestedFulfillment: { method: "shipping", destination: { addressLine1: "1 Print Way", city: "Tampa" } }, lines: [{ orderId: "order-a", orderLineId: "line-a", description: "Banner", orderedQuantity: 60, completedPickupQuantity: 0, completedShipmentQuantity: 0, completedFulfillmentQuantity: 0, completedProductionQuantity: 60, availableFulfillmentQuantity: 60, remainingProductionQuantity: 0, remainingFulfillmentQuantity: 60 }], handoffs: [] }]} />);
assert.match(markup, /Create shipment/);
assert.match(markup, /Final compatibility and availability are checked by the server/);
assert.doesNotMatch(markup, /carrier API/i);
console.log("Shipment builder quantity and bounded-selection tests passed.");
