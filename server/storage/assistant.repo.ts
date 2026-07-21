import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiAuditEvents,
  aiContextSnapshots,
  aiConversations,
  aiMessages,
  aiTurns,
} from "@shared/schema";
import type { AssistantContextEnvelope } from "@shared/assistantContracts";
import type {
  AssistantConversationDetailRecord,
  AssistantConversationRecord,
  AssistantMessageRecord,
  AssistantRepository,
  AssistantScope,
  AssistantTurnResult,
} from "../services/assistant/assistantService";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toConversation(row: typeof aiConversations.$inferSelect): AssistantConversationRecord {
  return {
    id: row.id,
    organizationId: row.orgId,
    userId: row.userId,
    title: row.title,
    status: row.status,
    lastMessagePreview: row.lastMessagePreview,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessage(row: typeof aiMessages.$inferSelect): AssistantMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    turnId: row.turnId,
    role: row.role,
    content: row.content,
    structuredCards: row.structuredCards,
    provider: row.provider,
    model: row.model,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  };
}

function conversationPredicate(scope: AssistantScope, conversationId: string) {
  return and(
    eq(aiConversations.id, conversationId),
    eq(aiConversations.orgId, scope.organizationId),
    eq(aiConversations.userId, scope.userId),
  );
}

export class DrizzleAssistantRepository implements AssistantRepository {
  async listConversations(scope: AssistantScope): Promise<AssistantConversationRecord[]> {
    const rows = await db
      .select()
      .from(aiConversations)
      .where(and(eq(aiConversations.orgId, scope.organizationId), eq(aiConversations.userId, scope.userId)))
      .orderBy(desc(aiConversations.lastActivityAt))
      .limit(100);
    return rows.map(toConversation);
  }

  async createConversation(input: AssistantScope & { title?: string | null }): Promise<AssistantConversationRecord> {
    const [row] = await db
      .insert(aiConversations)
      .values({
        orgId: input.organizationId,
        userId: input.userId,
        ...(input.title ? { title: input.title } : {}),
      })
      .returning();
    if (!row) throw new Error("Failed to create assistant conversation.");
    return toConversation(row);
  }

  async getConversation(scope: AssistantScope & { conversationId: string }): Promise<AssistantConversationDetailRecord | null> {
    const [conversation] = await db
      .select()
      .from(aiConversations)
      .where(conversationPredicate(scope, scope.conversationId))
      .limit(1);
    if (!conversation) return null;

    const messages = await db
      .select()
      .from(aiMessages)
      .where(and(eq(aiMessages.orgId, scope.organizationId), eq(aiMessages.conversationId, conversation.id)))
      .orderBy(asc(aiMessages.sequence))
      .limit(500);

    return { ...toConversation(conversation), messages: messages.map(toMessage) };
  }

  async updateConversation(input: AssistantScope & { conversationId: string; patch: { title?: string; status?: "archived" } }): Promise<AssistantConversationRecord | null> {
    const [row] = await db
      .update(aiConversations)
      .set({
        ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
        ...(input.patch.status === "archived" ? { status: "archived" as const, archivedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(conversationPredicate(input, input.conversationId))
      .returning();
    return row ? toConversation(row) : null;
  }

  async createFoundationTurn(input: AssistantScope & {
    conversationId: string;
    actor: { userId: string; email: string | null; ipAddress: string | null; userAgent: string | null };
    message: string;
    context: AssistantContextEnvelope;
    clientRequestId?: string;
    response: string;
    correlationId: string;
  }): Promise<AssistantTurnResult | null> {
    const created = await db.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(aiConversations)
        .where(and(conversationPredicate(input, input.conversationId), eq(aiConversations.status, "active")))
        .limit(1);
      if (!conversation) return null;

      // Sequences are conversation-local and protected by a transaction-scoped
      // advisory lock, preventing two concurrent turns from claiming the same
      // (conversation_id, sequence) unique key.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${conversation.id}))`);

      const now = new Date();
      const [turn] = await tx
        .insert(aiTurns)
        .values({
          orgId: input.organizationId,
          conversationId: conversation.id,
          userId: input.userId,
          status: "responded",
          clientRequestId: input.clientRequestId,
          correlationId: input.correlationId,
          mode: "stage_1_foundation",
          promptVersion: "assistant-stage-1",
          startedAt: now,
          completedAt: now,
        })
        .returning();
      if (!turn) throw new Error("Failed to create assistant turn.");

      const [sequenceRow] = await tx
        .select({ sequence: sql<number>`coalesce(max(${aiMessages.sequence}), 0)` })
        .from(aiMessages)
        .where(and(eq(aiMessages.orgId, input.organizationId), eq(aiMessages.conversationId, conversation.id)));
      const nextSequence = Number(sequenceRow?.sequence ?? 0) + 1;
      const [userMessage] = await tx
        .insert(aiMessages)
        .values({
          orgId: input.organizationId,
          conversationId: conversation.id,
          turnId: turn.id,
          actorUserId: input.actor.userId,
          role: "user",
          sequence: nextSequence,
          content: input.message,
          correlationId: input.correlationId,
        })
        .returning();
      const [assistantMessage] = await tx
        .insert(aiMessages)
        .values({
          orgId: input.organizationId,
          conversationId: conversation.id,
          turnId: turn.id,
          actorUserId: input.actor.userId,
          role: "assistant",
          sequence: nextSequence + 1,
          content: input.response,
          correlationId: input.correlationId,
        })
        .returning();
      if (!userMessage || !assistantMessage) throw new Error("Failed to create assistant messages.");

      const contextJson = JSON.stringify(input.context);
      await tx.insert(aiContextSnapshots).values({
        orgId: input.organizationId,
        conversationId: conversation.id,
        turnId: turn.id,
        userId: input.userId,
        contextVersion: input.context.contextVersion,
        sanitizedContext: input.context,
        contextHash: hash(contextJson),
        capturedAt: new Date(input.context.capturedAt),
      });

      await tx
        .update(aiConversations)
        .set({
          lastMessagePreview: input.response.slice(0, 240),
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(conversationPredicate(input, conversation.id));

      // The audit row is part of the same transaction as the turn and snapshot,
      // so no successful turn can exist without correlation metadata.
      await tx.insert(aiAuditEvents).values({
        orgId: input.organizationId,
        conversationId: conversation.id,
        turnId: turn.id,
        actorUserId: input.actor.userId,
        eventType: "assistant_turn_created",
        status: "responded",
        inputHash: hash(`${input.message}\n${contextJson}`),
        correlationId: input.correlationId,
        metadata: {
          contextVersion: input.context.contextVersion,
          toolsEnabled: false,
          writeActionsEnabled: false,
        },
      });

      return { turnId: turn.id, correlationId: turn.correlationId, userMessage, assistantMessage };
    });
    if (!created) return null;

    const conversation = await this.getConversation(input);
    if (!conversation) throw new Error("Assistant conversation disappeared after turn creation.");
    return {
      turnId: created.turnId,
      correlationId: created.correlationId,
      conversation,
      userMessage: toMessage(created.userMessage),
      assistantMessage: toMessage(created.assistantMessage),
    };
  }
}
