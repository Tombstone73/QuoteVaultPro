import assert from "node:assert/strict";
import { PostgresAiAssistantStore } from "../../infrastructure/ai/postgresAiAssistantStore.js";

const statements: string[] = [];
const pool = {
  async query(sql: string) {
    statements.push(sql);
    if (sql.startsWith("INSERT INTO v2_ai_conversation_messages")) return { rows: [{ id: "11111111-1111-4111-8111-111111111111", conversation_id: "22222222-2222-4222-8222-222222222222", organization_id: "org-a", user_id: "user-a", role: "user", content: "message", tool_name: null, created_at: new Date() }] };
    if (sql.startsWith("INSERT INTO v2_ai_pending_commands")) return { rows: [{ id: "33333333-3333-4333-8333-333333333333", conversation_id: "22222222-2222-4222-8222-222222222222", organization_id: "org-a", user_id: "user-a", command_name: "inbound.mark_duplicate", capability: "inbound.review", normalized_input: {}, proposal: "proposal", proposal_fingerprint: "sha256:test", business_request_id: "ai:test", state: "pending_confirmation", expires_at: new Date(Date.now() + 60_000), created_at: new Date(), updated_at: new Date() }] };
    return { rows: [] };
  },
} as any;

const store = new PostgresAiAssistantStore(pool);
await store.appendMessage({ conversationId: "22222222-2222-4222-8222-222222222222", organizationId: "org-a", userId: "user-a", role: "user", content: "message" });
await store.createPending({ id: "33333333-3333-4333-8333-333333333333", conversationId: "22222222-2222-4222-8222-222222222222", organizationId: "org-a", userId: "user-a", commandName: "inbound.mark_duplicate", capability: "inbound.review", normalizedInput: {}, proposal: "proposal", proposalFingerprint: "sha256:test", businessRequestId: "ai:test", state: "pending_confirmation", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date() });

const messageInsert = statements.find((sql) => sql.startsWith("INSERT INTO v2_ai_conversation_messages")) ?? "";
const pendingInsert = statements.find((sql) => sql.startsWith("INSERT INTO v2_ai_pending_commands")) ?? "";
assert.match(messageInsert, /\$1::uuid,\$2::uuid,\$3::varchar,\$4::varchar/u, "message INSERT/EXISTS shared parameters have explicit types");
assert.match(messageInsert, /id=\$2::uuid AND organization_id=\$3::varchar AND user_id=\$4::varchar/u, "message ownership check uses the same explicit parameter types");
assert.match(pendingInsert, /\$1::uuid,\$2::uuid,\$3::varchar,\$4::varchar/u, "pending INSERT/EXISTS shared parameters have explicit types");
assert.match(pendingInsert, /\$7::jsonb/u, "pending JSON evidence is explicitly typed");
console.log("AI Postgres assistant-store parameter typing tests passed");
