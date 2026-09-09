import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createInboundRouter, type InboundHttpDependencies } from "../../src/interfaces/http/inboundRoutes.js";

const qa = "b6f969b2-dda3-4133-9d75-c417dabb8f3a";
const environmentKeys = ["NODE_ENV", "APP_ENV", "RAILWAY_PROJECT_NAME", "RAILWAY_ENVIRONMENT_NAME", "DATABASE_URL"] as const;
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
const serviceCalls: unknown[] = [];
const app = () => express().use(express.json()).use("/v2/organizations/:organizationId/inbound-orders", createInboundRouter({
  principals: { principal: async () => ({ organizationId: qa, userId: "qa-user", authority: { capabilities: ["inbound.manage"] } }) },
  service: {
    ingest: async (_context, input) => { serviceCalls.push(input); return { ok: true as const, value: { id: "intake-a", sourceMessageId: input.sourceMessageId } }; },
    list: async () => ({ ok: true as const, value: { items: [], nextCursor: undefined } }), detail: async () => ({ ok: true as const, value: {} }), review: async () => ({ ok: true as const, value: {} }), convert: async () => ({ ok: true as const, value: {} }), markTerminal: async () => ({ ok: true as const, value: {} }), retry: async () => ({ ok: true as const, value: {} }),
  },
} as unknown as InboundHttpDependencies));
const payload = { businessRequestId: "m77f-test-request", sourceMessageId: "message-1", receivedAt: "2026-09-09T17:00:00.000Z", senderEmail: "qa@example.test", recipientEmail: "inbound@example.test", subject: "QA intake", body: "test" };

async function run() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    APP_ENV: "development",
    RAILWAY_PROJECT_NAME: "PrintersHero-DEV",
    RAILWAY_ENVIRONMENT_NAME: "Development",
    DATABASE_URL: "postgres://safe@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/neondb",
  });
  let result = await request(app()).post(`/v2/organizations/${qa}/inbound-orders/dev-qa-synthetic`).send(payload);
  assert.equal(result.status, 200); assert.equal(serviceCalls.length, 1); assert.equal((serviceCalls[0] as any).sourceMessageId, "m77f:message-1");
  result = await request(app()).post(`/v2/organizations/not-qa/inbound-orders/dev-qa-synthetic`).send(payload);
  assert.equal(result.status, 403); assert.equal(serviceCalls.length, 1);
  process.env.DATABASE_URL = "postgres://safe@prod.example/neondb";
  result = await request(app()).post(`/v2/organizations/${qa}/inbound-orders/dev-qa-synthetic`).send(payload);
  assert.equal(result.status, 403); assert.equal(serviceCalls.length, 1);
  process.env.DATABASE_URL = "postgres://safe@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/neondb";
  process.env.APP_ENV = "production";
  result = await request(app()).post(`/v2/organizations/${qa}/inbound-orders/dev-qa-synthetic`).send(payload);
  assert.equal(result.status, 403); assert.equal(serviceCalls.length, 1);
  process.env.APP_ENV = "development";
  result = await request(app()).post(`/v2/organizations/${qa}/inbound-orders/dev-qa-synthetic`).send({ ...payload, businessRequestId: "invalid-date", receivedAt: "not-a-date" });
  assert.equal(result.status, 400); assert.equal(serviceCalls.length, 1);
  console.log("M7.7F V2 synthetic inbound route tests passed.");
}
run().finally(() => { for (const key of environmentKeys) { const value = originalEnvironment[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
