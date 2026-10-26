import { ASSISTANT_IMAGE_MAX_BYTES, AssistantImageError, assertAssistantImageOwnership, type ImageMime } from "./assistantImageValidation";
export { ASSISTANT_IMAGE_MAX_BYTES, AssistantImageError } from "./assistantImageValidation";
import { ASSISTANT_ATTACHMENT_MAX_BYTES, ASSISTANT_ATTACHMENT_MAX_COUNT, assistantFileModelContext, extractAssistantAttachment, normalizeAssistantAttachmentSource, type AssistantExtractedFile } from "./assistantAttachmentExtraction";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { aiConversations, aiMessageAttachments, fileRecords, storagePlacements } from "@shared/schema";
import type { AssistantImageAttachment } from "@shared/assistantContracts";
import { db } from "../db";
import { storageApplicationService } from "./storage/StorageApplicationService";
import { readArtworkFileForOrganization } from "./artwork/ArtworkFileAccessService";
import { deleteStoredObjectKeysIfUnreferenced } from "./storage/storageReferenceGuard";

export const ASSISTANT_IMAGE_MAX_COUNT = ASSISTANT_ATTACHMENT_MAX_COUNT;
export type AssistantImageScope = { organizationId: string; userId: string; conversationId: string };
export type AssistantProviderImage = { mimeType: ImageMime; dataUrl: string };
export type AssistantProviderAttachmentContext = { images: AssistantProviderImage[]; documents: string[] };

export async function requireAssistantImageConversation(scope: AssistantImageScope, active = false) {
  const [conversation] = await db.select({ id: aiConversations.id }).from(aiConversations).where(and(
    eq(aiConversations.id, scope.conversationId), eq(aiConversations.orgId, scope.organizationId),
    eq(aiConversations.userId, scope.userId),
    active ? eq(aiConversations.status, "active") : undefined,
  )).limit(1);
  if (!conversation) throw new AssistantImageError(404, "Conversation not found.");
}

export function assistantImageDto(row: typeof aiMessageAttachments.$inferSelect): AssistantImageAttachment {
  return { id: row.id, fileName: row.originalFilename, mimeType: row.mimeType as AssistantImageAttachment["mimeType"], sizeBytes: row.sizeBytes };
}

export async function getAssistantImageRows(scope: AssistantImageScope, ids: readonly string[]) {
  if (!ids.length) return [];
  if (ids.length > ASSISTANT_IMAGE_MAX_COUNT || new Set(ids).size !== ids.length) {
    throw new AssistantImageError(400, "Attach at most four different files.");
  }
  await requireAssistantImageConversation(scope);
  const rows = await db.select().from(aiMessageAttachments).where(and(
    eq(aiMessageAttachments.orgId, scope.organizationId),
    eq(aiMessageAttachments.conversationId, scope.conversationId),
    eq(aiMessageAttachments.uploadedByUserId, scope.userId),
    isNull(aiMessageAttachments.removedAt), inArray(aiMessageAttachments.id, [...ids]),
  ));
  return assertAssistantImageOwnership(scope, ids, rows);
}

export async function uploadAssistantImage(scope: AssistantImageScope, source: {
  fileName: string; buffer: Buffer;
}): Promise<AssistantImageAttachment> {
  await requireAssistantImageConversation(scope, true);
  const { buffer, mimeType, fileName } = await normalizeAssistantAttachmentSource(source);
  const result = await storageApplicationService.finalizeUpload({
    organizationId: scope.organizationId, createdByUserId: scope.userId,
    resource: { organizationId: scope.organizationId, resourceType: "organization", resourceId: scope.organizationId },
    source: { kind: "buffer", buffer, originalFilename: fileName, mimeType },
    persistLink: async (tx, stored) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"assistant-attachments:" + scope.conversationId}))`);
      const [conversation] = await tx.select({ id: aiConversations.id }).from(aiConversations).where(and(
        eq(aiConversations.id, scope.conversationId), eq(aiConversations.orgId, scope.organizationId),
        eq(aiConversations.userId, scope.userId), eq(aiConversations.status, "active"),
      )).limit(1);
      if (!conversation) throw new AssistantImageError(404, "Conversation not found.");
      const pending = await tx.select({ id: aiMessageAttachments.id }).from(aiMessageAttachments).where(and(
        eq(aiMessageAttachments.orgId, scope.organizationId),
        eq(aiMessageAttachments.conversationId, scope.conversationId),
        isNull(aiMessageAttachments.messageId), isNull(aiMessageAttachments.removedAt),
      ));
      if (pending.length >= ASSISTANT_IMAGE_MAX_COUNT) throw new AssistantImageError(409, "Remove a file before attaching another.");
      const [row] = await tx.insert(aiMessageAttachments).values({
        orgId: scope.organizationId, conversationId: scope.conversationId,
        uploadedByUserId: scope.userId, fileRecordId: stored.fileRecord.id,
        originalFilename: fileName, mimeType, sizeBytes: buffer.length,
      }).returning();
      return row!;
    },
  });
  return assistantImageDto(result.linkedRecord);
}

export async function readAssistantImage(scope: AssistantImageScope, id: string) {
  const [row] = await getAssistantImageRows(scope, [id]);
  const file = await readArtworkFileForOrganization({
    organizationId: scope.organizationId, fileRecordId: row!.fileRecordId, variant: "original",
  });
  if (!file) throw new AssistantImageError(404, "File is unavailable.");
  return { buffer: file.buffer, mimeType: row!.mimeType, fileName: row!.originalFilename };
}

export async function removeAssistantImage(scope: AssistantImageScope, id: string) {
  await requireAssistantImageConversation(scope, true);
  const [row] = await db.update(aiMessageAttachments).set({ removedAt: new Date() }).where(and(
    eq(aiMessageAttachments.id, id), eq(aiMessageAttachments.orgId, scope.organizationId),
    eq(aiMessageAttachments.conversationId, scope.conversationId),
    eq(aiMessageAttachments.uploadedByUserId, scope.userId),
    isNull(aiMessageAttachments.messageId), isNull(aiMessageAttachments.removedAt),
  )).returning({ id: aiMessageAttachments.id });
  if (!row) throw new AssistantImageError(404, "Pending file not found.");
}

export async function loadAssistantProviderImages(scope: AssistantImageScope, ids: readonly string[]): Promise<AssistantProviderImage[]> {
  const rows = await getAssistantImageRows(scope, ids);
  return Promise.all(rows.filter(row => row.mimeType.startsWith("image/")).map(async row => {
    const file = await readArtworkFileForOrganization({
      organizationId: scope.organizationId, fileRecordId: row.fileRecordId, variant: "original",
    });
    if (!file || file.buffer.length > ASSISTANT_IMAGE_MAX_BYTES) {
      throw new AssistantImageError(409, "An attached image is unavailable. Remove it or retry after storage recovers.");
    }
    return { mimeType: row.mimeType as ImageMime, dataUrl: "data:" + row.mimeType + ";base64," + file.buffer.toString("base64") };
  }));
}

/** File bytes remain in private storage. Extracted context is rebuilt from the
 * authorized original on every turn, so reloads and follow-ups keep access
 * without persisting a second unguarded copy of document content. */
export async function loadAssistantProviderAttachmentContext(scope: AssistantImageScope, ids: readonly string[]): Promise<AssistantProviderAttachmentContext> {
  const rows = await getAssistantImageRows(scope, ids);
  const images: AssistantProviderImage[] = [];
  const documents: string[] = [];
  for (const row of rows) {
    const file = await readArtworkFileForOrganization({ organizationId: scope.organizationId, fileRecordId: row.fileRecordId, variant: "original" });
    if (!file || file.buffer.length > ASSISTANT_ATTACHMENT_MAX_BYTES) throw new AssistantImageError(409, "An attached file is unavailable. Remove it or retry after storage recovers.");
    if (row.mimeType.startsWith("image/")) {
      if (file.buffer.length > ASSISTANT_IMAGE_MAX_BYTES) throw new AssistantImageError(409, "An attached image exceeds its size limit.");
      images.push({ mimeType: row.mimeType as ImageMime, dataUrl: `data:${row.mimeType};base64,${file.buffer.toString("base64")}` });
      continue;
    }
    const extracted = await extractAssistantAttachment(file.buffer, row.originalFilename);
    if (extracted.mimeType !== row.mimeType) throw new AssistantImageError(409, "An attached file no longer matches its recorded type.");
    documents.push(assistantFileModelContext(row.id, row.originalFilename, extracted, 16_000));
    if (extracted.mimeType === "application/pdf" && extracted.scannedPageNumbers.length) {
      const { renderAssistantPdfPages } = await import("./assistantPdfVision");
      const pages = await renderAssistantPdfPages(file.buffer, extracted.scannedPageNumbers);
      images.push(...pages);
    }
  }
  return { images, documents };
}

export async function readAssistantExtractedFile(scope: AssistantImageScope, id: string): Promise<{ attachment: AssistantImageAttachment; extracted: AssistantExtractedFile }> {
  const [row] = await getAssistantImageRows(scope, [id]);
  const file = await readArtworkFileForOrganization({ organizationId: scope.organizationId, fileRecordId: row!.fileRecordId, variant: "original" });
  if (!file || file.buffer.length > ASSISTANT_ATTACHMENT_MAX_BYTES) throw new AssistantImageError(404, "File is unavailable.");
  const extracted = await extractAssistantAttachment(file.buffer, row!.originalFilename);
  if (extracted.mimeType !== row!.mimeType) throw new AssistantImageError(409, "The file no longer matches its recorded type.");
  return { attachment: assistantImageDto(row!), extracted };
}

/** Only unlinked images older than the grace period can be pruned. */
export async function cleanupAssistantPendingImages(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const candidates = await db.select().from(aiMessageAttachments).where(and(
    isNull(aiMessageAttachments.messageId), or(
      lt(aiMessageAttachments.createdAt, cutoff), lt(aiMessageAttachments.removedAt, cutoff),
    ),
  )).limit(25);
  let deleted = 0;
  for (const row of candidates) {
    if (!row.removedAt) {
      const [current] = await db.update(aiMessageAttachments).set({ removedAt: now }).where(and(
        eq(aiMessageAttachments.id, row.id), isNull(aiMessageAttachments.messageId),
        isNull(aiMessageAttachments.removedAt),
      )).returning({ id: aiMessageAttachments.id });
      if (!current) continue;
    }
    const [record] = await db.select({ lifecycleState: fileRecords.lifecycleState }).from(fileRecords).where(and(
      eq(fileRecords.id, row.fileRecordId), eq(fileRecords.organizationId, row.orgId),
    )).limit(1);
    if (!record || record.lifecycleState === "deleted") continue;
    const [placement] = await db.select().from(storagePlacements).where(and(
      eq(storagePlacements.fileRecordId, row.fileRecordId), eq(storagePlacements.placementState, "active"),
    )).limit(1);
    const key = placement?.objectKey ?? placement?.localPathRef;
    if (!placement || !key) continue;
    const result = await deleteStoredObjectKeysIfUnreferenced({
      organizationId: row.orgId, fileRecordId: row.fileRecordId,
      sourcePlacementId: placement.id, keys: [key],
      logContext: { assistantConversationId: row.conversationId },
    });
    if (result.skipped || result.failedKeys.length || result.deletedKeys.length !== 1) continue;
    await db.transaction(async tx => {
      await tx.update(storagePlacements).set({ placementState: "deleted" }).where(eq(storagePlacements.id, placement.id));
      await tx.update(fileRecords).set({ lifecycleState: "deleted", updatedAt: now }).where(and(
        eq(fileRecords.id, row.fileRecordId), eq(fileRecords.organizationId, row.orgId),
      ));
    });
    deleted += 1;
  }
  return deleted;
}
