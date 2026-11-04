import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { aiOperatorTasks, organizations, users, orders } from "@shared/schema";
import { assistantContextEnvelopeSchema, assistantTurnRequestSchema, ASSISTANT_MESSAGE_MAX_CONTENT_CHARS } from "@shared/assistantContracts";
import { DrizzleAssistantRepository } from "../storage/assistant.repo";
import { DrizzleAssistantOperatorTaskStore } from "../services/assistant/operatorTaskContext";
import { AssistantService } from "../services/assistant/assistantService";
import type { AssistantOperatorDecisionProvider } from "../services/assistant/operatorRuntime";
import { syntheticLongOrder } from "./helpers/assistantLongOrderFixture";

const org = `long-input-${randomUUID()}`, userId = randomUUID();
const scope = { organizationId: org, userId };
const actor = { userId, email: "qa@example.invalid", ipAddress: null, userAgent: null, permissions: ["assistant.internal_staff", "assistant.orders.create"] };
const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/orders", pageTitle: "Orders", selectedRecordIds: [], activeFilters: [], capturedAt: new Date().toISOString(), unsavedChanges: false });
const repo = new DrizzleAssistantRepository(), tasks = new DrizzleAssistantOperatorTaskStore();
function fixture() {
  const decide = jest.fn<AssistantOperatorDecisionProvider["decide"]>(async () => ({ kind: "ask_user", question: "Please confirm the customer.", missingInformation: ["customer"] }));
  const service = new AssistantService(repo, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, undefined,
    () => ({ decide }), tasks, undefined, () => ({ catalog: () => [], execute: async () => { throw new Error("No business execution permitted in this input fixture"); } }),
    { resolveProvider: async () => ({ enabled: true, mode: "legacy_env", feature: "assistant", source: "legacy_env", settings: null, provider: "openai_compatible", endpoint: "https://provider.invalid", apiKey: "synthetic-only", model: "fixture" }) });
  return { service, decide };
}
beforeAll(async () => {
  await db.insert(organizations).values({ id: org, name: "Synthetic input QA", slug: org });
  await db.insert(users).values({ id: userId, email: `${userId}@example.invalid`, role: "owner" });
});
afterAll(async () => { await pool.end(); });

test("reproduces PostgreSQL 22001 at the old task column before any provider call; safe error retains no SQL/input", async () => {
  const message = syntheticLongOrder(13);
  expect(message.length).toBeGreaterThan(2000); expect(message.length).toBeLessThan(8000);
  const conversation = await repo.createConversation(scope), { service, decide } = fixture();
  await db.execute(sql.raw("ALTER TABLE public.ai_operator_tasks ALTER COLUMN goal TYPE varchar(2000)"));
  try {
    let postgresCode: unknown;
    try { await db.insert(aiOperatorTasks).values({ orgId: org, userId, conversationId: conversation.id, goal: message }); }
    catch (error) { postgresCode = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code; }
    expect(postgresCode).toBe("22001");
    const failure = await service.createTurn(scope, conversation.id, actor, assistantTurnRequestSchema.parse({ message, context })).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "ASSISTANT_TASK_PERSISTENCE_FAILED", statusCode: 503 });
    expect(String(failure)).toContain("retained");
    expect(String(failure)).not.toContain("rider_001");
    expect(JSON.stringify(failure)).not.toContain("insert into");
    expect(decide).not.toHaveBeenCalled();
    expect((await repo.getConversation({ ...scope, conversationId: conversation.id }))?.messages).toHaveLength(0);
    expect(await tasks.getActive({ ...scope, conversationId: conversation.id })).toBeNull();
  } finally {
    await db.execute(sql.raw(readFileSync("server/db/migrations_v2/0251_assistant_order_message_capacity.sql", "utf8")));
  }
});

test.each([1, 13, 100])("%i-line Order reaches provider intact and persists exact complete message and task goal", async lineCount => {
  const message = syntheticLongOrder(lineCount), body = { message, context, attachmentIds: [], clientRequestId: randomUUID() };
  expect(message.length).toBeLessThanOrEqual(ASSISTANT_MESSAGE_MAX_CONTENT_CHARS);
  const conversation = await repo.createConversation(scope), { service, decide } = fixture();
  const result = await service.createTurn(scope, conversation.id, actor, assistantTurnRequestSchema.parse(body));
  expect(decide).toHaveBeenCalledTimes(1);
  expect(decide.mock.calls[0]![0].goal).toBe(message);
  const readback = await repo.getConversation({ ...scope, conversationId: conversation.id });
  expect(result.userMessage.content).toBe(message);
  expect(readback?.messages.find(item => item.role === "user")?.content).toBe(message);
  const [task] = await db.select().from(aiOperatorTasks).where(eq(aiOperatorTasks.conversationId, conversation.id));
  expect(task?.goal).toBe(message);
  expect(await repo.getConversation({ ...scope, organizationId: "another-tenant", conversationId: conversation.id })).toBeNull();
  expect(await tasks.getActive({ ...scope, organizationId: "another-tenant", conversationId: conversation.id })).toBeNull();
  const retried = await service.createTurn(scope, conversation.id, actor, assistantTurnRequestSchema.parse(body));
  expect(retried.turnId).toBe(result.turnId); expect(decide).toHaveBeenCalledTimes(1);
  expect((await repo.getConversation({ ...scope, conversationId: conversation.id }))?.messages).toHaveLength(2);
  console.info("[Synthetic Order input size]", { lineCount, characters: message.length, serializedBodyBytes: Buffer.byteLength(JSON.stringify(body), "utf8"), provider: "deterministic fixture", persistence: "actual isolated PostgreSQL" });
});

test("32,000-character boundary survives provider, task/message storage and readback; oversize fails before provider", async () => {
  const message = syntheticLongOrder(13).padEnd(ASSISTANT_MESSAGE_MAX_CONTENT_CHARS, "x");
  const conversation = await repo.createConversation(scope), { service, decide } = fixture();
  await service.createTurn(scope, conversation.id, actor, assistantTurnRequestSchema.parse({ message, context }));
  expect((await repo.getConversation({ ...scope, conversationId: conversation.id }))?.messages[0]?.content).toBe(message);
  expect(decide.mock.calls[0]![0].goal).toBe(message);
  expect(assistantTurnRequestSchema.safeParse({ message: message + "x", context }).success).toBe(false);
  await expect(tasks.create({ ...scope, conversationId: conversation.id, goal: message + "x" })).rejects.toMatchObject({ category: "capacity_mismatch" });
  await expect(service.createTurn(scope, conversation.id, actor, { message: message + "x", context, attachmentIds: [] })).rejects.toMatchObject({ name: "ZodError" });
  expect(decide).toHaveBeenCalledTimes(1);
  const column = await db.execute(sql`select character_maximum_length from information_schema.columns where table_schema = 'public' and table_name = 'ai_operator_tasks' and column_name = 'goal'`);
  expect(column.rows[0]?.character_maximum_length).toBe(ASSISTANT_MESSAGE_MAX_CONTENT_CHARS);
  expect(await db.select().from(orders).where(eq(orders.organizationId, org))).toHaveLength(0);
});
