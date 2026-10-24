import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { AssistantContextEnvelope } from "@shared/assistantContracts";
import { requireSafeTestDatabaseUrl } from "./helpers/safeTestDatabase";

const url = requireSafeTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
const pool = new Pool({ connectionString: url });
const db = drizzle({ client: pool, schema });
jest.unstable_mockModule("../db", () => ({
  db, pool, hasPageCountStatusColumn: () => true,
  hasQuoteAttachmentPagesTable: () => true, probeDatabaseSchema: async () => {},
}));

let repository: import("../storage/assistant.repo").DrizzleAssistantRepository;
let images: typeof import("../services/assistantImageAttachments");
const orgId = randomUUID();
const otherOrgId = randomUUID();
const userId = randomUUID();
const otherUserId = randomUUID();
const conversationId = randomUUID();
const sameTenantConversationId = randomUUID();
const otherConversationId = randomUUID();
const fileId = randomUUID();
const attachmentId = randomUUID();
const scope = { organizationId: orgId, userId, conversationId };
const context: AssistantContextEnvelope = {
  contextVersion: "v1", route: "/dashboard", pageTitle: "Dashboard",
  selectedRecordIds: [], activeFilters: [], capturedAt: new Date().toISOString(), unsavedChanges: false,
};
const actor = { userId, email: null, ipAddress: null, userAgent: null };

beforeAll(async () => {
  const target = new URL(url);
  const identity = await pool.query("select current_database() as name, host(inet_server_addr()) as host, to_regclass('public.ai_message_attachments')::text as attachments");
  expect(identity.rows[0]).toEqual({ name: target.pathname.slice(1), host: "127.0.0.1", attachments: "ai_message_attachments" });
  const { DrizzleAssistantRepository } = await import("../storage/assistant.repo");
  repository = new DrizzleAssistantRepository();
  images = await import("../services/assistantImageAttachments");
  await pool.query("insert into organizations (id, name, slug) values ($1, 'Assistant image QA', $2), ($3, 'Other QA tenant', $4)",
    [orgId, "assistant-images-" + orgId, otherOrgId, "assistant-images-" + otherOrgId]);
  await pool.query("insert into users (id) values ($1), ($2)", [userId, otherUserId]);
  await pool.query("insert into ai_conversations (id, org_id, user_id) values ($1, $2, $3), ($4, $2, $3), ($5, $6, $7)",
    [conversationId, orgId, userId, sameTenantConversationId, otherConversationId, otherOrgId, otherUserId]);
  await pool.query("insert into file_records (id, organization_id, original_filename, mime_type, size_bytes) values ($1, $2, 'neutral.png', 'image/png', 9)",
    [fileId, orgId]);
  await pool.query("insert into ai_message_attachments (id, org_id, conversation_id, uploaded_by_user_id, file_record_id, original_filename, mime_type, size_bytes) values ($1, $2, $3, $4, $5, 'neutral.png', 'image/png', 9)",
    [attachmentId, orgId, conversationId, userId, fileId]);
});

afterAll(async () => {
  await pool.query("delete from ai_message_attachments where org_id in ($1, $2)", [orgId, otherOrgId]);
  await pool.query("delete from ai_audit_events where org_id in ($1, $2)", [orgId, otherOrgId]);
  await pool.query("delete from ai_context_snapshots where org_id in ($1, $2)", [orgId, otherOrgId]);
  await pool.query("delete from ai_messages where org_id in ($1, $2)", [orgId, otherOrgId]);
  await pool.query("delete from ai_turns where org_id in ($1, $2)", [orgId, otherOrgId]);
  await pool.query("delete from ai_conversations where org_id in ($1, $2)", [orgId, otherOrgId]);
  await pool.query("delete from file_records where organization_id in ($1, $2)", [orgId, otherOrgId]);
  await pool.query("delete from users where id in ($1, $2)", [userId, otherUserId]);
  await pool.query("delete from organizations where id in ($1, $2)", [orgId, otherOrgId]);
  await pool.end();
});

async function counts() {
  const result = await pool.query("select (select count(*)::int from ai_turns where org_id=$1) as turns, (select count(*)::int from ai_messages where org_id=$1) as messages, (select count(*)::int from ai_audit_events where org_id=$1 and event_type='assistant_turn_created') as audits", [orgId]);
  return result.rows[0] as { turns: number; messages: number; audits: number };
}

test("saved attachments reload, rejected sends roll back, and stable retries bind once", async () => {
  const clientRequestId = randomUUID();
  const base = { ...scope, actor, message: "Describe the attached image", context,
    clientRequestId, response: "Test response", correlationId: randomUUID(), attachmentIds: [attachmentId] };
  await expect(repository.createFoundationTurn({ ...base, attachmentIds: [randomUUID()] }))
    .rejects.toThrow("An image changed before the turn was saved.");
  expect(await counts()).toEqual({ turns: 0, messages: 0, audits: 0 });
  expect((await pool.query("select message_id from ai_message_attachments where id=$1", [attachmentId])).rows[0].message_id).toBeNull();
  const [first, concurrent] = await Promise.all([
    repository.createFoundationTurn(base), repository.createFoundationTurn(base),
  ]);
  expect(first?.turnId).toBeTruthy();
  expect(concurrent?.turnId).toBe(first?.turnId);
  const retry = await repository.createFoundationTurn({ ...base, correlationId: randomUUID() });
  expect(retry?.turnId).toBe(first?.turnId);
  expect(await counts()).toEqual({ turns: 1, messages: 2, audits: 1 });
  const linked = await pool.query("select message_id from ai_message_attachments where id=$1", [attachmentId]);
  expect(linked.rows[0].message_id).toBe(first?.userMessage.id);
  const reload = await repository.getConversation(scope);
  expect(reload?.messages.find(message => message.role === "user")?.attachments).toEqual([
    expect.objectContaining({ id: attachmentId, fileName: "neutral.png" }),
  ]);
  await pool.query("update ai_message_attachments set created_at=now()-interval '31 days' where id=$1", [attachmentId]);
  expect(await images.cleanupAssistantPendingImages()).toBe(0);
  expect((await pool.query("select count(*)::int as count from ai_message_attachments where id=$1", [attachmentId])).rows[0].count).toBe(1);
});

test("attachment access is scoped to its tenant, conversation, and uploader", async () => {
  expect((await images.getAssistantImageRows(scope, [attachmentId])).map(row => row.id)).toEqual([attachmentId]);
  await expect(images.getAssistantImageRows({ ...scope, userId: otherUserId }, [attachmentId])).rejects.toThrow("Conversation not found.");
  await expect(images.getAssistantImageRows({ ...scope, conversationId: sameTenantConversationId }, [attachmentId])).rejects.toThrow("unavailable");
  await expect(images.getAssistantImageRows({ organizationId: otherOrgId, userId: otherUserId, conversationId: otherConversationId }, [attachmentId]))
    .rejects.toThrow("unavailable");
});
