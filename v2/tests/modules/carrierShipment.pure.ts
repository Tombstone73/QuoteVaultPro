import assert from "node:assert/strict";
import { manualCarrierShipment, type CarrierProviderPort } from "../../src/modules/fulfillment/carrierShipment.js";

const prepared = manualCarrierShipment({ status: "prepared", carrierName: "  UPS ", trackingNumber: "  1Z-TEST  ", packageCount: 2 });
assert.deepEqual(prepared, { status: "prepared", carrierName: "UPS", trackingNumber: "1Z-TEST", packageCount: 2 });
assert.throws(() => manualCarrierShipment({ status: "shipped" }), /shipped timestamp/);
assert.throws(() => manualCarrierShipment({ status: "prepared", packageCount: 0 }), /at least one/);

const provider: CarrierProviderPort = {};
assert.deepEqual(provider, {});
console.log("Carrier shipment launch-scope contract tests passed.");
