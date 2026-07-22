import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiAuditEvents,
  aiContextSnapshots,
  aiConversations,
  aiMessages,
  aiReportEntityResolutions,
  aiToolExecutions,
  aiTurns,
} from "@shared/schema";
import type { AssistantContextEnvelope, AssistantStructuredCard } from "@shared/assistantContracts";
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
  async listConversations(scope: AssistantScope, status: "active" | "archived" = "active"): Promise<AssistantConversationRecord[]> {
    const rows = await db
      .select()
      .from(aiConversations)
      .where(and(
        eq(aiConversations.orgId, scope.organizationId),
        eq(aiConversations.userId, scope.userId),
        eq(aiConversations.status, status),
      ))
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

  async updateConversation(input: AssistantScope & { conversationId: string; patch: { title?: string; status?: "active" | "archived" } }): Promise<AssistantConversationRecord | null> {
    const [row] = await db
      .update(aiConversations)
      .set({
        ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
        ...(input.patch.status !== undefined ? {
          status: input.patch.status,
          archivedAt: input.patch.status === "archived" ? new Date() : null,
        } : {}),
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
    status?: "responded" | "failed";
    structuredCards?: AssistantStructuredCard[];
    initialTitle?: string;
    provider?: string | null;
    model?: string | null;
    mode?: string;
    promptVersion?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    toolExecutions?: Array<{
      toolName: string;
      toolVersion: string;
      status: "succeeded" | "failed" | "disabled";
      errorCode?: string;
      auditStatus: string;
      durationMs: number;
      failureCategory?: string;
      failingStep?: string;
      coreResultSucceeded?: boolean;
    }>;
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
          status: input.status ?? "responded",
          clientRequestId: input.clientRequestId,
          correlationId: input.correlationId,
          provider: input.provider ?? null,
          model: input.model ?? null,
          mode: input.mode ?? "stage_2_read_only",
          promptVersion: input.promptVersion ?? "assistant-stage-2-planner-v1",
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
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
          structuredCards: input.structuredCards ?? [],
          provider: input.provider ?? null,
          model: input.model ?? null,
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
          // The first meaningful turn gives an untouched fallback conversation
          // a useful deterministic title. Once a user has named or used a
          // conversation, this path cannot overwrite it.
          ...(nextSequence === 1 && conversation.title === "New conversation" && input.initialTitle
            ? { title: input.initialTitle }
            : {}),
          lastMessagePreview: input.response.slice(0, 240),
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(conversationPredicate(input, conversation.id));

      for (const execution of input.toolExecutions ?? []) {
        const [toolExecution] = await tx.insert(aiToolExecutions).values({
          orgId: input.organizationId,
          conversationId: conversation.id,
          turnId: turn.id,
          toolName: execution.toolName,
          toolVersion: execution.toolVersion,
          status: execution.status,
          redactedArguments: {},
          redactedResult: {},
          sourceIds: [],
          correlationId: input.correlationId,
          errorCode: execution.errorCode ?? null,
          completedAt: now,
        }).returning();
        await tx.insert(aiAuditEvents).values({
          orgId: input.organizationId,
          conversationId: conversation.id,
          turnId: turn.id,
          toolExecutionId: toolExecution?.id ?? null,
          actorUserId: input.actor.userId,
          eventType: "assistant_tool_executed",
          status: execution.auditStatus,
          correlationId: input.correlationId,
          metadata: {
            toolName: execution.toolName,
            toolVersion: execution.toolVersion,
            durationMs: execution.durationMs,
            errorCode: execution.errorCode ?? null,
            failureCategory: execution.failureCategory ?? null,
            failingStep: execution.failingStep ?? null,
            coreResultSucceeded: execution.coreResultSucceeded ?? false,
          },
        });
      }

      // The audit row is part of the same transaction as the turn and snapshot,
      // so no successful turn can exist without correlation metadata.
      await tx.insert(aiAuditEvents).values({
        orgId: input.organizationId,
        conversationId: conversation.id,
        turnId: turn.id,
        actorUserId: input.actor.userId,
        eventType: "assistant_turn_created",
        status: input.status ?? "responded",
        inputHash: hash(`${input.message}\n${contextJson}`),
        correlationId: input.correlationId,
        metadata: {
          contextVersion: input.context.contextVersion,
          toolsEnabled: true,
          writeActionsEnabled: false,
        },
      });

      return { turnId: turn.id, correlationId: turn.correlationId, status: turn.status === "failed" ? "failed" as const : "responded" as const, userMessage, assistantMessage };
    });
    if (!created) return null;

    const conversation = await this.getConversation(input);
    if (!conversation) throw new Error("Assistant conversation disappeared after turn creation.");
    return {
      turnId: created.turnId,
      correlationId: created.correlationId,
      status: created.status,
      conversation,
      userMessage: toMessage(created.userMessage),
      assistantMessage: toMessage(created.assistantMessage),
    };
  }

  /** Writes the resumed assistant output and marks the already-claimed report
   * resolution complete in the same transaction. It intentionally does not
   * insert another user message. */
  async createReportResolutionContinuation(input: AssistantScope & {
    resolutionId: string;
    actor: { userId: string; email: string | null; ipAddress: string | null; userAgent: string | null };
    plan: unknown; context: AssistantContextEnvelope; response: string; structuredCards: AssistantStructuredCard[];
    correlationId: string; provider: string | null; model: string | null;
    toolExecutions: Array<{ toolName: string; toolVersion: string; status: "succeeded" | "failed" | "disabled"; errorCode?: string; auditStatus: string; durationMs: number; failureCategory?: string; failingStep?: string; coreResultSucceeded?: boolean }>;
  }): Promise<AssistantTurnResult | null> {
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.resolutionId}))`);
      const [resolution] = await tx.select().from(aiReportEntityResolutions).where(and(
        eq(aiReportEntityResolutions.id, input.resolutionId), eq(aiReportEntityResolutions.organizationId, input.organizationId),
        eq(aiReportEntityResolutions.userId, input.userId), eq(aiReportEntityResolutions.status, "resuming"),
      )).limit(1);
      if (!resolution) return null;
      const [conversation] = await tx.select().from(aiConversations).where(and(
        eq(aiConversations.id, resolution.conversationId), eq(aiConversations.orgId, input.organizationId),
        eq(aiConversations.userId, input.userId),
      )).limit(1);
      if (!conversation) return null;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${conversation.id}))`);
      const now = new Date();
      const [turn] = await tx.insert(aiTurns).values({
        orgId: input.organizationId, conversationId: conversation.id, userId: input.userId, status: "responded",
        correlationId: input.correlationId, provider: input.provider, model: input.model,
        mode: "stage_8_2_persisted_analytical_continuation", promptVersion: "assistant-stage-8.2-continuation-v1",
        startedAt: now, completedAt: now,
      }).returning();
      if (!turn) throw new Error("Failed to create report continuation turn.");
      const [sequenceRow] = await tx.select({ sequence: sql<number>`coalesce(max(${aiMessages.sequence}), 0)` })
        .from(aiMessages).where(and(eq(aiMessages.orgId, input.organizationId), eq(aiMessages.conversationId, conversation.id)));
      const [assistantMessage] = await tx.insert(aiMessages).values({
        orgId: input.organizationId, conversationId: conversation.id, turnId: turn.id, actorUserId: input.actor.userId,
        role: "assistant", sequence: Number(sequenceRow?.sequence ?? 0) + 1, content: input.response,
        structuredCards: input.structuredCards, provider: input.provider, model: input.model, correlationId: input.correlationId,
      }).returning();
      if (!assistantMessage) throw new Error("Failed to create report continuation message.");
      const contextJson = JSON.stringify(input.context);
      await tx.insert(aiContextSnapshots).values({
        orgId: input.organizationId, conversationId: conversation.id, turnId: turn.id, userId: input.userId,
        contextVersion: input.context.contextVersion, sanitizedContext: input.context, contextHash: hash(contextJson),
        capturedAt: new Date(input.context.capturedAt),
      });
      const [completed] = await tx.update(aiReportEntityResolutions).set({
        status: "resumed", version: resolution.version + 1, resumedAt: now, updatedAt: now,
        continuationResultReference: turn.id,
        continuationResultJson: { turnId: turn.id, correlationId: turn.correlationId },
      }).where(and(eq(aiReportEntityResolutions.id, resolution.id), eq(aiReportEntityResolutions.status, "resuming"),
        eq(aiReportEntityResolutions.version, resolution.version))).returning();
      if (!completed) throw new Error("Report resolution continuation claim was lost.");
      await tx.update(aiConversations).set({ lastMessagePreview: input.response.slice(0, 240), lastActivityAt: now, updatedAt: now })
        .where(eq(aiConversations.id, conversation.id));
      const [sourceUserMessage] = await tx.select().from(aiMessages).where(and(
        eq(aiMessages.turnId, resolution.sourceTurnId), eq(aiMessages.role, "user"),
      )).orderBy(asc(aiMessages.sequence)).limit(1);
      return { turn, assistantMessage, sourceUserMessage };
    });
    if (!created) return null;
    const conversation = await this.getConversation({ organizationId: input.organizationId, userId: input.userId, conversationId: created.turn.conversationId });
    if (!conversation) return null;
    const assistantMessage = toMessage(created.assistantMessage);
    return {
      turnId: created.turn.id, correlationId: created.turn.correlationId, status: "responded", conversation,
      userMessage: created.sourceUserMessage ? toMessage(created.sourceUserMessage) : assistantMessage,
      assistantMessage,
    };
  }
}
