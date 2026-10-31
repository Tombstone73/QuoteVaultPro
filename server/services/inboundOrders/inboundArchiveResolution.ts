import { createHash } from 'node:crypto';
import type { InboundOrderFile } from '@shared/schema';

type ArchiveFile = Pick<InboundOrderFile, 'id' | 'fileRecordId' | 'providerMessageId' | 'providerAttachmentId' | 'sourceFilename' | 'mimeType' | 'sizeBytes' | 'checksum' | 'status' | 'metadataJson'>;

export function isQuarantinedArchive(file: ArchiveFile): boolean {
  return file.status === 'quarantined' && (/\.zip$/i.test(file.sourceFilename ?? '') || /(?:zip|x-zip-compressed)/i.test(file.mimeType ?? ''));
}

export function archiveEvidenceIdentity(file: ArchiveFile): string {
  return createHash('sha256').update(JSON.stringify({
    id: file.id, providerMessageId: file.providerMessageId, providerAttachmentId: file.providerAttachmentId,
    filename: file.sourceFilename, mimeType: file.mimeType, sizeBytes: file.sizeBytes,
    checksum: file.checksum, fileRecordId: file.fileRecordId, status: file.status,
  })).digest('hex');
}

export function archiveResolution(file: ArchiveFile, files: ArchiveFile[]): { fileIds: string[]; actorUserId: string; reviewedAt: string } | null {
  if (!isQuarantinedArchive(file)) return null;
  const metadata = file.metadataJson as Record<string, unknown> | null;
  const resolution = metadata?.inboundArchiveResolution as Record<string, unknown> | undefined;
  if (resolution?.archiveIdentity !== archiveEvidenceIdentity(file) || resolution?.contentsReviewed !== true
    || typeof resolution.actorUserId !== 'string' || typeof resolution.reviewedAt !== 'string'
    || !Array.isArray(resolution.fileIds) || resolution.fileIds.length === 0
    || !resolution.fileIdentities || typeof resolution.fileIdentities !== 'object') return null;
  const fileIds = resolution.fileIds.filter((value): value is string => typeof value === 'string');
  if (fileIds.length !== resolution.fileIds.length || new Set(fileIds).size !== fileIds.length) return null;
  if (!fileIds.every((id) => files.some((candidate) => candidate.id === id && candidate.fileRecordId
    && candidate.status === 'available' && (candidate.metadataJson as Record<string, unknown> | null)?.extractedFromArchiveFileId === file.id
    && (candidate.metadataJson as Record<string, unknown> | null)?.extractedFromArchiveIdentity === archiveEvidenceIdentity(file)
    && (resolution.fileIdentities as Record<string, unknown>)[id] === archiveEvidenceIdentity(candidate)))) return null;
  return { fileIds, actorUserId: resolution.actorUserId, reviewedAt: resolution.reviewedAt };
}
