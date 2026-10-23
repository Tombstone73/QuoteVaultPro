import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiAuditEvents,
  aiContextSnapshots,
  aiConversations,
  aiMessages,
  aiMessageAttachments,
  aiOperatorTasks,
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
import { assistantImageDto } from "../services/assistantImageAttachments";
import { hasCanonicalProposalCard, replaceCanonicalProposalCards } from "../services/assistant/canonicalProductIntentCardPersistence";
import { MATERIAL_REVIEW_KEY } from "../services/assistant/materialPendingReview";
import type { MaterialTaskTransition } from "../services/assistant/operatorTaskContext";

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

function toMessage(row: typeof aiMessages.$inferSelect, attachments: AssistantMessageRecord["attachments"] = []): AssistantMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    turnId: row.turnId,
    role: row.role,
    content: row.content,
    attachments,
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
  async getTurnByClientRequestId(input: AssistantScope & { conversationId: string; clientRequestId: string }): Promise<AssistantTurnResult | null> {
    const [row] = await db.select({ turn: aiTurns }).from(aiTurns)
      .innerJoin(aiConversations, eq(aiTurns.conversationId, aiConversations.id))
      .where(and(conversationPredicate(input, input.conversationId), eq(aiTurns.orgId, input.organizationId),
        eq(aiTurns.userId, input.userId), eq(aiTurns.clientRequestId, input.clientRequestId)))
      .limit(1);
    if (!row) return null;
    const messages = await db.select().from(aiMessages).where(and(eq(aiMessages.orgId, input.organizationId),
      eq(aiMessages.conversationId, input.conversationId), eq(aiMessages.turnId, row.turn.id)));
    const userMessage = messages.find(message => message.role === "user");
    const assistantMessage = messages.find(message => message.role === "assistant");
    const conversation = await this.getConversation(input);
    if (!userMessage || !assistantMessage || !conversation) return null;
    return { turnId: row.turn.id, correlationId: row.turn.correlationId,
      status: row.turn.status === "failed" ? "failed" : "responded", conversation,
      userMessage: conversation.messages.find(message => message.id === userMessage.id) ?? toMessage(userMessage), assistantMessage: toMessage(assistantMessage) };
  }

  async recordTurnPersistenceFailure(input: AssistantScope & { conversationId: string; correlationId: string;
    stage: string; databaseCode: string | null; constraint: string | null; table: string | null }): Promise<void> {
    await db.insert(aiAuditEvents).values({ orgId: input.organizationId, actorUserId: input.userId,
      eventType: "assistant_turn_persistence_failed", status: "failed", correlationId: input.correlationId,
      metadata: { stage: input.stage, databaseCode: input.databaseCode, constraint: input.constraint, table: input.table,
        conversationId: input.conversationId },
    });
  }

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
      .orderBy(desc(aiMessages.sequence))
      .limit(500);

    const attachments = messages.length ? await db.select().from(aiMessageAttachments).where(and(
      eq(aiMessageAttachments.orgId, scope.organizationId), eq(aiMessageAttachments.conversationId, conversation.id),
      isNull(aiMessageAttachments.removedAt), inArray(aiMessageAttachments.messageId, messages.map(message => message.id)),
    )) : [];
    const byMessage = new Map<string, AssistantMessageRecord["attachments"]>();
    for (const row of attachments) {
      if (!row.messageId) continue;
      byMessage.set(row.messageId, [...(byMessage.get(row.messageId) ?? []), assistantImageDto(row)]);
    }
    return { ...toConversation(conversation), messages: messages.reverse().map(row => toMessage(row, byMessage.get(row.id) ?? [])) };
  }

  async getLatestAssistantMessage(scope: AssistantScope & { conversationId: string }): Promise<AssistantMessageRecord | null> {
    const [row] = await db.select({ message: aiMessages }).from(aiMessages)
      .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
      .where(and(conversationPredicate(scope, scope.conversationId), eq(aiMessages.orgId, scope.organizationId), eq(aiMessages.role, "assistant")))
      .orderBy(desc(aiMessages.sequence)).limit(1);
    return row ? toMessage(row.message) : null;
  }

  async replaceCanonicalProductIntentCards(input: AssistantScope & { conversationId: string; proposalId: string; cards: AssistantStructuredCard[] }): Promise<AssistantMessageRecord | null> {
    const conversation = await this.getConversation(input);
    if (!conversation) return null;
    const owner = [...conversation.messages].reverse().find((message) => message.role === "assistant"
      && Array.isArray(message.structuredCards)
      && hasCanonicalProposalCard(message.structuredCards, input.proposalId));
    if (!owner) return null;
    const [updated] = await db.update(aiMessages).set({
      structuredCards: replaceCanonicalProposalCards(owner.structuredCards, input.proposalId, input.cards),
    }).where(and(
      eq(aiMessages.id, owner.id),
      eq(aiMessages.orgId, input.organizationId),
      eq(aiMessages.conversationId, input.conversationId),
      eq(aiMessages.role, "assistant"),
    )).returning();
    return updated ? toMessage(updated) : null;
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

  async archiveConversations(input: AssistantScope & { conversationIds: string[] }): Promise<AssistantConversationRecord[]> {
    if (!input.conversationIds.length) return [];
    const rows = await db
      .update(aiConversations)
      .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(aiConversations.orgId, input.organizationId),
        eq(aiConversations.userId, input.userId),
        eq(aiConversations.status, "active"),
        inArray(aiConversations.id, input.conversationIds),
      ))
      .returning();
    return rows.map(toConversation);
  }

  async createFoundationTurn(input: AssistantScope & {
    conversationId: string;
    actor: { userId: string; email: string | null; ipAddress: string | null; userAgent: string | null };
    message: string;
    attachmentIds?: string[];
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
      operationalMetadata?: { resourceTypes: readonly string[]; resultCount: number; depth?: number; truncated?: boolean };
    }>;
    materialTaskTransition?: MaterialTaskTransition;
  }): Promise<AssistantTurnResult | null> {
    let persistenceStage = "load_conversation";
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
      persistenceStage = "lock_conversation_sequence";
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${conversation.id}))`);
      if (input.clientRequestId) {
        const [existing] = await tx.select({ id: aiTurns.id }).from(aiTurns).where(and(
          eq(aiTurns.orgId, input.organizationId), eq(aiTurns.conversationId, conversation.id),
          eq(aiTurns.userId, input.userId), eq(aiTurns.clientRequestId, input.clientRequestId),
        )).limit(1);
        if (existing) return { existingTurnId: existing.id };
      }

      if (input.materialTaskTransition) {
        persistenceStage = "material_task_transition";
        const { taskId, expectedQuestion, patch } = input.materialTaskTransition;
        if (expectedQuestion) {
          const [latest] = await tx.select({ content: aiMessages.content, correlationId: aiMessages.correlationId })
            .from(aiMessages).where(and(
              eq(aiMessages.orgId, input.organizationId), eq(aiMessages.conversationId, conversation.id), eq(aiMessages.role, "assistant"),
            )).orderBy(desc(aiMessages.sequence)).limit(1);
          if (latest?.content !== expectedQuestion.content || latest.correlationId !== expectedQuestion.correlationId) {
            throw Object.assign(new Error("Material question changed before the turn was saved."), { code: "MATERIAL_TASK_TRANSITION_STALE" });
          }
        }
        const expected = expectedQuestion
          ? and(
              sql`${aiOperatorTasks.semanticChanges} -> ${MATERIAL_REVIEW_KEY} ->> 'questionId' = ${expectedQuestion.questionId}`,
              sql`${aiOperatorTasks.semanticChanges} -> ${MATERIAL_REVIEW_KEY} ->> 'version' = ${String(expectedQuestion.version)}`,
            )
          : sql`(${aiOperatorTasks.semanticChanges} -> ${MATERIAL_REVIEW_KEY} IS NULL OR ${aiOperatorTasks.semanticChanges} -> ${MATERIAL_REVIEW_KEY} = 'null'::jsonb)`;
        const [updated] = await tx.update(aiOperatorTasks).set({
          ...patch,
          ...(patch.status === "completed" || patch.status === "abandoned" ? { completedAt: new Date() } : {}),
          updatedAt: new Date(),
        }).where(and(
          eq(aiOperatorTasks.id, taskId), eq(aiOperatorTasks.orgId, input.organizationId),
          eq(aiOperatorTasks.userId, input.userId), eq(aiOperatorTasks.conversationId, conversation.id),
          eq(aiOperatorTasks.status, "active"), expected,
        )).returning({ id: aiOperatorTasks.id });
        if (!updated) throw Object.assign(new Error("Material question changed before the turn was saved."), { code: "MATERIAL_TASK_TRANSITION_STALE" });
      }

      const now = new Date();
      persistenceStage = "insert_turn";
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

      persistenceStage = "read_message_sequence";
      const [sequenceRow] = await tx
        .select({ sequence: sql<number>`coalesce(max(${aiMessages.sequence}), 0)` })
        .from(aiMessages)
        .where(and(eq(aiMessages.orgId, input.organizationId), eq(aiMessages.conversationId, conversation.id)));
      const nextSequence = Number(sequenceRow?.sequence ?? 0) + 1;
      persistenceStage = "insert_user_message";
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
      persistenceStage = "insert_assistant_message";
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
      if (input.attachmentIds?.length) {
        persistenceStage = "bind_image_attachments";
        const bound = await tx.update(aiMessageAttachments).set({ messageId: userMessage.id }).where(and(
          eq(aiMessageAttachments.orgId, input.organizationId), eq(aiMessageAttachments.conversationId, conversation.id),
          eq(aiMessageAttachments.uploadedByUserId, input.userId), isNull(aiMessageAttachments.messageId),
          isNull(aiMessageAttachments.removedAt), inArray(aiMessageAttachments.id, input.attachmentIds),
        )).returning({ id: aiMessageAttachments.id });
        if (bound.length !== input.attachmentIds.length) throw new Error("An image changed before the turn was saved.");
      }

      const contextJson = JSON.stringify(input.context);
      persistenceStage = "insert_context_snapshot";
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

      persistenceStage = "update_conversation";
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
        persistenceStage = "insert_tool_execution";
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
        persistenceStage = "insert_tool_audit";
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
            operationalMetadata: execution.operationalMetadata ?? null,
          },
        });
      }

      // The audit row is part of the same transaction as the turn and snapshot,
      // so no successful turn can exist without correlation metadata.
      persistenceStage = "insert_turn_audit";
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
    }).catch((error: unknown) => {
      if (error && typeof error === "object") {
        try { Object.defineProperty(error, "assistantPersistenceStage", { value: persistenceStage }); } catch { /* Preserve the original database error. */ }
      }
      throw error;
    });
    if (!created) return null;
    if ("existingTurnId" in created) {
      const existing = await this.getTurnByClientRequestId({ ...input, clientRequestId: input.clientRequestId! });
      if (!existing) throw new Error("Previously saved assistant turn could not be reloaded.");
      if (existing.userMessage.content !== input.message) throw new Error("Assistant request ID was reused for another message.");
      return existing;
    }

    const conversation = await this.getConversation(input);
    if (!conversation) throw new Error("Assistant conversation disappeared after turn creation.");
    return {
      turnId: created.turnId,
      correlationId: created.correlationId,
      status: created.status,
      conversation,
      userMessage: conversation.messages.find(message => message.id === created.userMessage.id) ?? toMessage(created.userMessage),
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
    toolExecutions: Array<{ toolName: string; toolVersion: string; status: "succeeded" | "failed" | "disabled"; errorCode?: string; auditStatus: string; durationMs: number; failureCategory?: string; failingStep?: string; coreResultSucceeded?: boolean; operationalMetadata?: { resourceTypes: readonly string[]; resultCount: number; depth?: number; truncated?: boolean } }>;
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
