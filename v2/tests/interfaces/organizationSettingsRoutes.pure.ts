import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createOrganizationSettingsRouter, type OrganizationSettingsHttpDependencies } from "../../src/interfaces/http/organizationSettingsRoutes.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const value = { businessProfile: { displayName: "Tenant Print", businessAddress: {}, pickupAddressSource: "business_address" as const }, documentsBranding: { logo: { status: "not_configured" as const } }, readiness: { status: "needs_attention" as const, missing: ["business_address"] as const }, revision: "revision-a" };
const actor = (organizationId = "org-a", capabilities = ["organization.configure" as const]): StaffPrincipal => ({ kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities } });
const calls: unknown[] = [];
const app = (principal: StaffPrincipal) => express().use(express.json()).use("/v2/organizations/:organizationId/settings/organization", createOrganizationSettingsRouter({ logger: { log: () => undefined }, principals: { principal: async () => principal }, settings: { read: async () => value, saveBusinessProfile: async (organizationId, input, _principal, requestId) => { calls.push({ organizationId, input, requestId }); return value; }, saveDocumentsBranding: async () => value }, logoAdoption: { adopt: async (organizationId, _principal, input) => { calls.push({ logoOrganizationId: organizationId, input }); return value; } } as any } satisfies OrganizationSettingsHttpDependencies));

await request(app(actor())).get("/v2/organizations/org-a/settings/organization").expect(200, { ok: true, data: value });
await request(app(actor())).put("/v2/organizations/org-a/settings/organization/business-profile").send({ businessRequestId: "save-a", expectedRevision: "revision-a", displayName: "Tenant Print", businessAddress: { country: "US" }, organizationId: "org-b" }).expect(200, { ok: true, data: value });
assert.deepEqual(calls, [{ organizationId: "org-a", input: { expectedRevision: "revision-a", displayName: "Tenant Print", businessAddress: { country: "US" } }, requestId: "save-a" }]);
await request(app(actor("org-a", []))).get("/v2/organizations/org-a/settings/organization").expect(403);
await request(app(actor("org-b"))).put("/v2/organizations/org-a/settings/organization/documents-branding").send({ businessRequestId: "foreign", expectedRevision: "revision-a" }).expect(403);
await request(app(actor())).put("/v2/organizations/org-a/settings/organization/business-profile").send({ expectedRevision: "revision-a", displayName: "Tenant Print", businessAddress: {} }).expect(400);
await request(app(actor())).post("/v2/organizations/org-a/settings/organization/documents-branding/logo").field("businessRequestId", "logo-a").field("expectedRevision", "revision-a").attach("file", Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), { filename: "tenant-logo.png", contentType: "image/png" }).expect(200, { ok: true, data: value });
assert.deepEqual(calls.at(-1), { logoOrganizationId: "org-a", input: { businessRequestId: "logo-a", expectedRevision: "revision-a", filename: "tenant-logo.png", contentType: "image/png", bytes: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]) } });
await request(app(actor())).post("/v2/organizations/org-a/settings/organization/documents-branding/logo").field("businessRequestId", "logo-b").field("expectedRevision", "revision-a").attach("file", Buffer.from("not-a-logo"), { filename: "bad.txt", contentType: "text/plain" }).expect(400);
await request(app(actor("org-a", []))).post("/v2/organizations/org-a/settings/organization/documents-branding/logo").field("businessRequestId", "logo-c").field("expectedRevision", "revision-a").attach("file", Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), { filename: "tenant-logo.png", contentType: "image/png" }).expect(403);
assert.equal(JSON.stringify(value).includes("invoice_logo_asset_id"), false);
assert.equal(JSON.stringify(value).includes("invoice_logo_url"), false);
console.log("Organization settings HTTP authorization, tenant scope, and request identity tests passed.");
