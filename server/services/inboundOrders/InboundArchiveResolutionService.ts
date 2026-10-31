import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { inboundEmailImportJobs, inboundOrderEvents, inboundOrderFiles, inboundOrderRecords, type InboundOrderFile } from '@shared/schema';
import { storageApplicationService } from '../storage/StorageApplicationService';
import { InboundOrdersRepository } from '../../storage/inboundOrders.repo';
import { InboundEvidenceConflictError } from './inboundEmailEvidenceFingerprint';
import { archiveEvidenceIdentity, archiveResolution, isQuarantinedArchive } from './inboundArchiveResolution';
import { unavailableInboundImportFiles } from './inboundEmailImportContext';

const supportedExtensions = new Set(['pdf', 'ai', 'eps', 'svg', 'tif', 'tiff', 'jpg', 'jpeg', 'png', 'doc', 'docx']);
const roleClassification = { artwork: 'ARTWORK', po: 'PO', reference: 'REFERENCE', other: 'OTHER' } as const;
export type ExtractedFileRole = keyof typeof roleClassification;

function archiveOrThrow(files: InboundOrderFile[], archiveFileId: string): InboundOrderFile {
  const archive = files.find((file) => file.id === archiveFileId);
  if (!archive || !isQuarantinedArchive(archive) || !archive.fileRecordId) {
    throw new InboundEvidenceConflictError('Stored quarantined archive was not found for this inbound request.');
  }
  return archive;
}

export class InboundArchiveResolutionService {
  async uploadExtractedFile(input: {
    organizationId: string; inboundRecordId: string; archiveFileId: string; actorUserId: string;
    expectedEvidenceFingerprint: string; filename: string; mimeType: string; role: ExtractedFileRole; buffer: Buffer;
  }) {
    const extension = input.filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
    if (!supportedExtensions.has(extension)) throw new InboundEvidenceConflictError('Upload a supported extracted document or artwork file. Archives and executable files cannot be used.');
    if (!input.buffer.length || input.buffer.length > 25 * 1024 * 1024) throw new InboundEvidenceConflictError('Extracted file must be between 1 byte and 25 MB.');
    const initial = await new InboundOrdersRepository().getEvidenceState(input.organizationId, input.inboundRecordId);
    if (initial.fingerprint !== input.expectedEvidenceFingerprint || initial.record.createdOrderId || initial.record.createdQuoteId) throw new InboundEvidenceConflictError();
    const archive = archiveOrThrow(initial.files, input.archiveFileId);
    const archiveIdentity = archiveEvidenceIdentity(archive);
    const stored = await storageApplicationService.finalizeUpload({
      organizationId: input.organizationId, createdByUserId: input.actorUserId,
      resource: { organizationId: input.organizationId, resourceType: 'inbound_order', resourceId: input.inboundRecordId },
      source: { kind: 'buffer', buffer: input.buffer, originalFilename: input.filename, mimeType: input.mimeType },
      persistLink: async (tx, result) => {
        const repository = new InboundOrdersRepository(tx);
        const state = await repository.lockForEvidenceHandling(input.organizationId, input.inboundRecordId, input.expectedEvidenceFingerprint);
        const currentArchive = archiveOrThrow(state.files, input.archiveFileId);
        if (archiveEvidenceIdentity(currentArchive) !== archiveIdentity || state.record.createdOrderId || state.record.createdQuoteId) throw new InboundEvidenceConflictError();
        const [file] = await tx.insert(inboundOrderFiles).values({
          organizationId: input.organizationId, inboundRecordId: input.inboundRecordId,
          fileRecordId: result.fileRecord.id, sourceFilename: input.filename, role: input.role,
          mimeType: result.storedObject.mimeType, sizeBytes: result.storedObject.sizeBytes,
          checksum: result.fileRecord.checksum ?? null, status: 'available',
          metadataJson: {
            extractedFromArchiveFileId: input.archiveFileId, extractedFromArchiveIdentity: archiveIdentity,
            attachmentState: 'staff_uploaded_for_archive_review',
            attachmentClassification: { classification: roleClassification[input.role], source: 'manual_override', confidence: 100,
              reasons: ['Staff classified extracted file during archive review.'] },
          },
          reviewNotes: 'Staff supplied an extracted file for inbound archive review. Production artwork approval remains separate.',
        }).returning();
        if ((currentArchive.metadataJson as Record<string, unknown> | null)?.inboundArchiveResolution) {
          await tx.update(inboundOrderFiles).set({ metadataJson: {
            ...(currentArchive.metadataJson ?? {}), inboundArchiveResolution: null,
          }, updatedAt: new Date() }).where(and(eq(inboundOrderFiles.organizationId, input.organizationId),
            eq(inboundOrderFiles.inboundRecordId, input.inboundRecordId), eq(inboundOrderFiles.id, currentArchive.id)));
        }
        await tx.insert(inboundOrderEvents).values({ organizationId: input.organizationId, inboundRecordId: input.inboundRecordId,
          actorUserId: input.actorUserId, actorType: 'user', eventType: 'archive.extracted_file_uploaded',
          message: 'Staff uploaded a supported extracted file. Archive remains quarantined and unresolved.',
          metadataJson: { archiveFileId: input.archiveFileId, archiveIdentity, fileId: file.id, role: input.role } });
        return file;
      },
    });
    const current = await new InboundOrdersRepository().getEvidenceState(input.organizationId, input.inboundRecordId);
    return { file: stored.linkedRecord, evidenceFingerprint: current.fingerprint };
  }

  async resolveArchive(input: {
    organizationId: string; inboundRecordId: string; archiveFileId: string; actorUserId: string;
    expectedEvidenceFingerprint: string; fileIds: string[]; contentsReviewed: true;
  }) {
    return db.transaction(async (tx) => {
      const repository = new InboundOrdersRepository(tx as unknown as typeof db);
      const state = await repository.lockForEvidenceHandling(input.organizationId, input.inboundRecordId, input.expectedEvidenceFingerprint);
      if (state.record.createdOrderId || state.record.createdQuoteId) throw new InboundEvidenceConflictError('Archive review must be completed before conversion.');
      const archive = archiveOrThrow(state.files, input.archiveFileId);
      if (!input.contentsReviewed || input.fileIds.length === 0 || new Set(input.fileIds).size !== input.fileIds.length) {
        throw new InboundEvidenceConflictError('Review the full archive and select the extracted files that account for its required evidence.');
      }
      const selected = input.fileIds.map((id) => state.files.find((file) => file.id === id));
      if (selected.some((file) => !file?.fileRecordId || file.status !== 'available'
        || (file.metadataJson as Record<string, unknown> | null)?.extractedFromArchiveFileId !== archive.id
        || (file.metadataJson as Record<string, unknown> | null)?.extractedFromArchiveIdentity !== archiveEvidenceIdentity(archive))) {
        throw new InboundEvidenceConflictError('Selected extracted files must be available and linked to the current archive.');
      }
      const prior = archiveResolution(archive, state.files);
      if (prior && input.fileIds.length === prior.fileIds.length && input.fileIds.every((id) => prior.fileIds.includes(id))) return { archive, evidenceFingerprint: state.fingerprint };
      const now = new Date();
      const [updated] = await tx.update(inboundOrderFiles).set({ metadataJson: {
        ...(archive.metadataJson ?? {}), inboundArchiveResolution: {
          archiveIdentity: archiveEvidenceIdentity(archive), fileIds: input.fileIds,
          fileIdentities: Object.fromEntries(selected.map((file) => [file!.id, archiveEvidenceIdentity(file!)])),
          contentsReviewed: true, actorUserId: input.actorUserId, reviewedAt: now.toISOString(),
        },
      }, updatedAt: now }).where(and(eq(inboundOrderFiles.organizationId, input.organizationId),
        eq(inboundOrderFiles.inboundRecordId, input.inboundRecordId), eq(inboundOrderFiles.id, archive.id))).returning();
      const files = state.files.map((file) => file.id === archive.id ? updated : file);
      const remaining = unavailableInboundImportFiles(files);
      if (remaining.length === 0) {
        await tx.update(inboundEmailImportJobs).set({ status: 'complete', errorCode: null, message: 'Staff accounted for quarantined archive evidence.', updatedAt: now })
          .where(and(eq(inboundEmailImportJobs.organizationId, input.organizationId), eq(inboundEmailImportJobs.inboundRecordId, input.inboundRecordId),
            eq(inboundEmailImportJobs.status, 'needs_attention'), eq(inboundEmailImportJobs.errorCode, 'IMPORT_EVIDENCE_UNAVAILABLE')));
        const [pending] = await tx.select({ id: inboundEmailImportJobs.id }).from(inboundEmailImportJobs).where(and(
          eq(inboundEmailImportJobs.organizationId, input.organizationId),
          sql`${inboundEmailImportJobs.status} not in ('complete','skipped')`,
          sql`(${inboundEmailImportJobs.inboundRecordId} = ${input.inboundRecordId} or (${inboundEmailImportJobs.mailboxId} = ${(state.record.rawPayloadJson as any)?.mailbox?.id ?? ''} and ${inboundEmailImportJobs.providerMessageId} = ${state.record.sourceMessageId ?? ''}))`,
        )).limit(1);
        if (!pending) await tx.update(inboundOrderRecords).set({ normalizedPayloadJson: {
          ...(state.record.normalizedPayloadJson ?? {}), importIncomplete: false, partialDraftEligible: false,
        }, updatedAt: now }).where(and(eq(inboundOrderRecords.organizationId, input.organizationId), eq(inboundOrderRecords.id, input.inboundRecordId)));
      }
      await tx.insert(inboundOrderEvents).values({ organizationId: input.organizationId, inboundRecordId: input.inboundRecordId,
        actorUserId: input.actorUserId, actorType: 'user', eventType: 'archive.evidence_reviewed',
        message: 'Staff accounted for extracted archive evidence. Original archive remains quarantined; draft reconciliation and production artwork review remain separate.',
        metadataJson: { archiveFileId: archive.id, archiveIdentity: archiveEvidenceIdentity(archive), fileIds: input.fileIds,
          remainingUnresolvedFileIds: remaining.map((file) => file.id) } });
      const refreshed = await repository.lockForEvidenceHandling(input.organizationId, input.inboundRecordId);
      return { archive: updated, evidenceFingerprint: refreshed.fingerprint, remainingUnresolvedFileIds: remaining.map((file) => file.id) };
    });
  }
}

export const inboundArchiveResolutionService = new InboundArchiveResolutionService();
