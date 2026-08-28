import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createEmailIntegrationCallback } from "../../src/interfaces/http/emailIntegrationRoutes.js";

const organizationId = "org-email-callback";
const principal = {
  kind: "staff" as const,
  organizationId,
  userId: "staff-email-callback",
  authority: { membershipId: "membership-email-callback", capabilities: ["communications.configure" as const] },
};
const state = `${Buffer.from(JSON.stringify({ organizationId })).toString("base64url")}.signature`;

const fixture = (finishConnect: (input: unknown) => Promise<unknown>) => {
  const app = express();
  app.get("/api/email/google/callback", createEmailIntegrationCallback({
    integrations: { finishConnect } as never,
    principals: { principal: async () => principal } as never,
    identities: { authenticatedIdentity: async () => ({ subjectId: principal.userId, sessionId: "session-id", authenticatedAt: new Date(), authenticationMethod: "session" as const }) },
    publicWebOrigin: "https://dev.printershero.com",
  }));
  return app;
};

const calls: unknown[] = [];
const success = fixture(async (input) => {
  calls.push(input);
  return { provider: "gmail", status: "ready" };
});
await request(success).get("/api/email/google/callback").query({ code: "test-code", state }).expect(302).expect("Location", "https://dev.printershero.com/settings?email=connected");
assert.equal(calls.length, 1);

const rejection = fixture(async () => { throw new Error("provider failure"); });
await request(rejection).get("/api/email/google/callback").query({ code: "test-code", state }).expect(302).expect("Location", "https://dev.printershero.com/settings?email=error");
await request(rejection).get("/api/email/google/callback").query({ error: "access_denied" }).expect(302).expect("Location", "https://dev.printershero.com/settings?email=cancelled");
await request(rejection).get("/api/email/google/callback").query({ code: "test-code", state: "invalid" }).expect(302).expect("Location", "https://dev.printershero.com/settings?email=error");

console.log("email integration callback routes passed");
