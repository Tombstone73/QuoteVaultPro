import { describe, expect, jest, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";

const select = jest.fn();
jest.unstable_mockModule("../db", () => ({ db: { select } }));
const { DrizzleAssistantRepository } = await import("../storage/assistant.repo");
const dialect = new PgDialect();

describe("persisted Assistant conversation history", () => {
  test("selects the newest 500 messages in tenant/actor scope and returns chronological roles", async () => {
    const conversation = { id: "conversation_1", orgId: "org_1", userId: "user_1" };
    const messages = Array.from({ length: 510 }, (_, index) => ({
      id: `message_${index}`, sequence: index, orgId: "org_1", conversationId: conversation.id,
      role: index % 2 ? "assistant" : "user", content: `Persisted message ${index}`,
    }));
    const conversationWhere = jest.fn();
    const messageWhere = jest.fn();
    const messageOrder = jest.fn();
    select.mockReturnValueOnce({ from: () => ({ where: (condition: any) => {
      conversationWhere(condition);
      return { limit: async () => [conversation] };
    } }) }).mockReturnValueOnce({ from: () => ({ where: (condition: any) => {
      messageWhere(condition);
      return { orderBy: (order: any) => {
        messageOrder(order);
        return { limit: async (limit: number) => [...messages].reverse().slice(0, limit) };
      } };
    } }) });
    const result = await new DrizzleAssistantRepository().getConversation({ organizationId: "org_1", userId: "user_1", conversationId: conversation.id });
    expect(dialect.sqlToQuery(conversationWhere.mock.calls[0][0] as any).params).toEqual(["conversation_1", "org_1", "user_1"]);
    expect(dialect.sqlToQuery(messageWhere.mock.calls[0][0] as any).params).toEqual(["org_1", "conversation_1"]);
    expect(dialect.sqlToQuery(messageOrder.mock.calls[0][0] as any).sql).toContain('"ai_messages"."sequence" desc');
    expect(result?.messages).toHaveLength(500);
    expect(result?.messages[0]).toMatchObject({ id: "message_10", role: "user", content: "Persisted message 10" });
    expect(result?.messages.slice(-2)).toMatchObject([
      { id: "message_508", role: "user", content: "Persisted message 508" },
      { id: "message_509", role: "assistant", content: "Persisted message 509" },
    ]);
  });

  test("cannot read history when the scoped conversation lookup fails", async () => {
    select.mockReset();
    select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    expect(await new DrizzleAssistantRepository().getConversation({ organizationId: "other_org", userId: "other_user", conversationId: "conversation_1" })).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });
});
