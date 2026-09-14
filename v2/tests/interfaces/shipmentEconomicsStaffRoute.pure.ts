import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createShipmentContainerRouter } from "../../src/interfaces/http/shipmentContainerRoutes.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const staff = (capabilities: readonly string[]): StaffPrincipal => ({ kind:"staff", organizationId:"org-a", userId:"staff-a", authority:{membershipId:"member-a", capabilities:capabilities as any} });
const appFor = (principal: unknown) => express().use("/v2/organizations/:organizationId/fulfillment", createShipmentContainerRouter({
  principals:{ principal:async (_request, organizationId) => { if(organizationId!=="org-a") throw new Error("foreign"); return principal as any; } },
  service:{} as any, workspace:{} as any,
  shipmentEconomics:{ readStaffEconomics:async () => ({ shipmentId:"shipment-a", actualCarrierCostCents:8000, customerShippingPriceCents:2000, absorbedFreightCents:6000, allocations:[] }) },
}));
let response=await request(appFor(staff(["fulfillment.shipping.cost"]))).get("/v2/organizations/org-a/fulfillment/shipments/shipment-a/internal-economics");
assert.equal(response.status,200); assert.equal(response.body.data.actualCarrierCostCents,8000);
response=await request(appFor(staff(["fulfillment.view"]))).get("/v2/organizations/org-a/fulfillment/shipments/shipment-a/internal-economics");
assert.equal(response.status,403);
const portal={kind:"portal",organizationId:"org-a",customerId:"customer-a",contactId:"contact-a",authority:{membershipId:"portal-a",capabilities:["fulfillment.shipping.cost"]}};
response=await request(appFor(portal)).get("/v2/organizations/org-a/fulfillment/shipments/shipment-a/internal-economics");
assert.equal(response.status,403);
console.log("staff-only shipment economics route: OK");
