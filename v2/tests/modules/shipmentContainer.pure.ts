import assert from "node:assert/strict";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import { canAttachShipmentHandoff, markShipmentShipped, preparedShipment } from "../../src/modules/fulfillment/shipmentContainer.js";

const prepared = preparedShipment({ shipmentId: "shipment-1", organizationId: brandedId<"OrganizationId">("org-1"), createdAt: "2026-09-07T00:00:00.000Z", createdPrincipalKind: "staff", createdPrincipalSubject: "operator", carrier: { carrierName: "Manual carrier" } });
assert.equal(canAttachShipmentHandoff(prepared), false);
const shipped = markShipmentShipped(prepared, { shippedAt: "2026-09-07T01:00:00.000Z", principalKind: "staff", principalSubject: "operator", carrier: { trackingNumber: "TRACK-1" } });
assert.equal(shipped.status, "shipped");
assert.equal(shipped.carrier.trackingNumber, "TRACK-1");
assert.equal(canAttachShipmentHandoff(shipped), true);
assert.equal(markShipmentShipped(shipped, { shippedAt: "later", principalKind: "staff", principalSubject: "other" }), shipped);
console.log("Shipment container launch-scope transition tests passed.");
