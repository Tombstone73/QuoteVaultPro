import { randomUUID } from "node:crypto";
import https from "node:https";
import { afterAll, afterEach, beforeAll, beforeEach, expect, jest, test } from "@jest/globals";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db, pool } from "../db";
import { registerAssistantRoutes } from "../routes/assistant.routes";
import { registerAssistantExecutionRoutes } from "../routes/assistantExecution.routes";
import { quoteInternalNotesService } from "../services/quoteInternalNotesService";

type Mode = "enabled" | "missing" | "master-off" | "feature-off";
const app = express();
app.use(express.json());
let publicTables: string[];
let nextQuote = 975000;
let assertAndRestoreNetwork = () => {};

// These headers are synthetic authentication ONLY inside this test app. Actor
// existence and membership/role still come from the disposable PostgreSQL DB.
const isAuthenticated: RequestHandler = async (req, res, next) => {
  const id = req.get("x-fixture-actor");
  const [actor] = id ? await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1) : [];
  if (!actor) { res.status(401).json({ message: "Unauthorized" }); return; }
  req.user = { id: actor.id } as Express.User;
  next();
};
const tenantContext: RequestHandler = async (req, res, next) => {
  const organizationId = req.get("x-fixture-org");
  const userId = (req.user as { id: string }).id;
  const [membership] = organizationId ? await db.select().from(schema.userOrganizations)
    .where(and(eq(schema.userOrganizations.organizationId, organizationId), eq(schema.userOrganizations.userId, userId))).limit(1) : [];
  if (!membership) { res.status(403).json({ message: "Forbidden" }); return; }
  req.organizationId = membership.organizationId;
  req.orgRole = membership.role;
  next();
};

beforeAll(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || !/^printershero_assistant_enablement.*_test$/.test(url.pathname.slice(1))) {
    throw new Error("Assistant enablement acceptance requires its own synthetic loopback test database");
  }
  const { rows: identity } = await pool.query("SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port");
  if (identity[0].database !== url.pathname.slice(1) || identity[0].address !== "127.0.0.1" || identity[0].port !== Number(url.port)) {
    throw new Error("Actual PostgreSQL connection does not match the private enablement target");
  }
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  publicTables = tables.rows.map(row => row.tablename);
  // No injected planners, repositories, capability resolvers or command registry.
  // These are the default production route registrations, with synthetic auth.
  registerAssistantRoutes(app, { isAuthenticated, tenantContext });
  registerAssistantExecutionRoutes(app, { isAuthenticated, tenantContext });
});
beforeEach(() => {
  const fetchGuard = jest.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("External fetch forbidden in enablement acceptance"); });
  const httpsGuard = jest.spyOn(https, "request").mockImplementation((() => { throw new Error("External HTTPS forbidden in enablement acceptance"); }) as typeof https.request);
  assertAndRestoreNetwork = () => {
    try {
      expect(fetchGuard).not.toHaveBeenCalled();
      expect(httpsGuard).not.toHaveBeenCalled();
    } finally { fetchGuard.mockRestore(); httpsGuard.mockRestore(); }
  };
});
afterEach(() => assertAndRestoreNetwork());
afterAll(async () => { await pool.end(); });

async function snapshot(filter: (table: string) => boolean = () => true) {
  const state: Record<string, unknown[]> = {};
  for (const table of publicTables.filter(filter)) {
    const quoted = `"${table.replaceAll('"', '""')}"`;
    const result = await pool.query(`SELECT to_jsonb(t) AS value FROM public.${quoted} t ORDER BY to_jsonb(t)::text`);
    state[table] = result.rows.map(row => row.value);
  }
  return state;
}

async function fixture(mode: Mode) {
  const [organization] = await db.insert(schema.organizations).values({ name: `Synthetic assistant ${mode}`, slug: randomUUID() }).returning();
  const [actor] = await db.insert(schema.users).values({ email: `${randomUUID()}@example.invalid`, role: "employee", accountType: "INTERNAL_USER" }).returning();
  await db.insert(schema.userOrganizations).values({ organizationId: organization.id, userId: actor.id, role: "owner" });
  if (mode !== "missing") await db.insert(schema.organizationAiSettings).values({
    orgId: organization.id, mode: "printershero_managed", isEnabled: mode !== "master-off", assistantEnabled: mode !== "feature-off",
    // No API key, provider endpoint, model or external configuration is supplied.
  });
  const [quote] = await db.insert(schema.quotes).values({ organizationId: organization.id, userId: actor.id, quoteNumber: ++nextQuote,
    displayNumber: `QA-${nextQuote}`, status: "draft", customerName: "Synthetic enablement QA" }).returning();
  const [conversation] = await db.insert(schema.aiConversations).values({ orgId: organization.id, userId: actor.id, title: "Synthetic reviewed note" }).returning();
  const [turn] = await db.insert(schema.aiTurns).values({ orgId: organization.id, userId: actor.id, conversationId: conversation.id,
    correlationId: randomUUID(), status: "responded" }).returning();
  await db.insert(schema.aiMessages).values([
    { orgId: organization.id, actorUserId: actor.id, conversationId: conversation.id, turnId: turn.id, role: "user", sequence: 1,
      content: "Add an internal note to this quote: Synthetic QA reviewed the artwork." },
    { orgId: organization.id, actorUserId: actor.id, conversationId: conversation.id, turnId: turn.id, role: "assistant", sequence: 2,
      content: "Review the internal-only note before confirming." },
  ]);
  const context = { contextVersion: "v1", route: `/quotes/${quote.id}`, pageTitle: "Quote", entityType: "quote", entityId: quote.id,
    unsavedChanges: false, capturedAt: new Date().toISOString() };
  return { organization, actor, quote, conversation, turn, context,
    headers: { "x-fixture-actor": actor.id, "x-fixture-org": organization.id } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const disabledResponse = { success: false, error: { code: "assistant_disabled", message: "The assistant is disabled for this organization.", retryable: false } };
async function preview(f: Fixture) {
  const business = await snapshot(table => !table.startsWith("ai_"));
  const response = await request(app).post(`/api/assistant/conversations/${f.conversation.id}/plans`).set(f.headers)
    .send({ turnId: f.turn.id, context: f.context }).expect(201);
  expect(response.body.data.plan).toMatchObject({ status: "awaiting_confirmation", executable: true });
  expect(response.body.data.confirmationToken).toEqual(expect.any(String));
  expect(response.body.data.confirmationToken.length).toBeGreaterThanOrEqual(32);
  expect(await snapshot(table => !table.startsWith("ai_"))).toEqual(business);
  return response.body.data as { plan: { id: string; planVersion: number }; confirmationToken: string };
}

test.each<Mode>(["missing", "master-off", "feature-off"])("real %s settings deny both production registrars and GO aliases without any persisted mutation", async mode => {
  const f = await fixture(mode), before = await snapshot();
  const input = { turnId: f.turn.id, context: f.context, confirmationToken: "x".repeat(64), expectedPlanVersion: 2,
    organizationId: "untrusted-enabled-organization", assistantEnabled: true, isEnabled: true };
  const paths = ["/api/assistant/conversations", `/api/assistant/conversations/${f.conversation.id}/plans`,
    `/api/assistant/plans/${randomUUID()}/confirmation`, `/api/assistant/plans/${randomUUID()}/confirmations`,
    `/api/assistant/conversations/${f.conversation.id}/turns`];
  for (const path of paths) {
    const response = await request(app).post(path).set(f.headers).send(input).expect(503);
    expect(response.body).toEqual(disabledResponse);
  }
  const listed = await request(app).get("/api/assistant/conversations").set(f.headers).expect(503);
  expect(listed.body).toEqual(disabledResponse);
  const capabilities = await request(app).get("/api/assistant/capabilities").set(f.headers).expect(200);
  expect(capabilities.body.data).toMatchObject({ enabled: false, conversationsEnabled: false, toolsEnabled: false });
  expect(await snapshot()).toEqual(before);
});

test("enabled QA and disabled tenant settings stay isolated on the same default production app", async () => {
  const enabled = await fixture("enabled"), disabled = await fixture("master-off");
  await preview(enabled);
  const before = await snapshot();
  await request(app).post(`/api/assistant/conversations/${disabled.conversation.id}/plans`).set(disabled.headers)
    .send({ turnId: disabled.turn.id, context: disabled.context }).expect(503);
  expect(await snapshot()).toEqual(before);
  const created = await request(app).post("/api/assistant/conversations").set(enabled.headers).send({ title: "Enabled synthetic QA" }).expect(201);
  expect(created.body.data).toMatchObject({ title: "Enabled synthetic QA" });
});

test.each(["isEnabled", "assistantEnabled"] as const)("preview then fresh %s disable denies both GO aliases; reenable uses original token and durable replay exactly once", async flag => {
  const f = await fixture("enabled"), issued = await preview(f);
  const confirmation = { expectedPlanVersion: issued.plan.planVersion, confirmationToken: issued.confirmationToken, context: f.context };
  await db.update(schema.organizationAiSettings).set({ [flag]: false }).where(eq(schema.organizationAiSettings.orgId, f.organization.id));
  const disabled = await snapshot();
  for (const alias of ["confirmation", "confirmations"]) {
    const denied = await request(app).post(`/api/assistant/plans/${issued.plan.id}/${alias}`).set(f.headers).send(confirmation).expect(503);
    expect(denied.body).toEqual(disabledResponse);
    expect(await snapshot()).toEqual(disabled); // Includes plan, token, ledger and ALL business tables.
  }
  await request(app).post(`/api/assistant/conversations/${f.conversation.id}/plans`).set(f.headers)
    .send({ turnId: f.turn.id, context: f.context }).expect(503);
  expect(await snapshot()).toEqual(disabled);
  await db.update(schema.organizationAiSettings).set({ [flag]: true }).where(eq(schema.organizationAiSettings.orgId, f.organization.id));
  const firstAlias = flag === "isEnabled" ? "confirmations" : "confirmation";
  const otherAlias = firstAlias === "confirmation" ? "confirmations" : "confirmation";
  const completed = await request(app).post(`/api/assistant/plans/${issued.plan.id}/${firstAlias}`).set(f.headers).send(confirmation).expect(200);
  expect(completed.body.data).toMatchObject({ accepted: true, plan: { status: "succeeded" }, result: { status: "succeeded" } });
  const notes = await db.select().from(schema.quoteInternalNotes).where(eq(schema.quoteInternalNotes.quoteId, f.quote.id));
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ source: "assistant", assistantPlanId: issued.plan.id });
  const committed = await snapshot();
  const replay = await request(app).post(`/api/assistant/plans/${issued.plan.id}/${otherAlias}`).set(f.headers).send(confirmation).expect(200);
  expect(replay.body.data.result).toEqual(completed.body.data.result);
  expect(await snapshot()).toEqual(committed);
  // Even an already-completed durable replay is subject to the fresh switch.
  await db.update(schema.organizationAiSettings).set({ [flag]: false }).where(eq(schema.organizationAiSettings.orgId, f.organization.id));
  const disabledReplay = await snapshot();
  for (const alias of ["confirmation", "confirmations"]) {
    await request(app).post(`/api/assistant/plans/${issued.plan.id}/${alias}`).set(f.headers).send(confirmation).expect(503);
  }
  expect(await snapshot()).toEqual(disabledReplay);
});

test("synthetic authentication and persisted membership still precede organization enablement", async () => {
  const f = await fixture("enabled"), before = await snapshot();
  await request(app).post("/api/assistant/conversations").send({ title: "Anonymous" }).expect(401);
  await request(app).post("/api/assistant/conversations").set(f.headers).set("x-fixture-org", randomUUID()).send({ title: "Foreign" }).expect(403);
  expect(await snapshot()).toEqual(before);
});

test("disabled Assistant does not block the existing native internal-note operation or create Assistant execution records", async () => {
  const f = await fixture("master-off"), aiBefore = await snapshot(table => table.startsWith("ai_"));
  const native = await quoteInternalNotesService.append({ organizationId: f.organization.id, quoteId: f.quote.id,
    userId: f.actor.id, values: { noteText: "Native staff operation remains independent of Assistant availability." } });
  expect(native).toMatchObject({ organizationId: f.organization.id, quoteId: f.quote.id, source: "manual", assistantPlanId: null });
  expect(await snapshot(table => table.startsWith("ai_"))).toEqual(aiBefore);
});
