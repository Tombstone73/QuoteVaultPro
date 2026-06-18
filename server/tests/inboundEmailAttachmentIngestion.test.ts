import { describe, expect, jest, test } from "@jest/globals";

import {
  InboundEmailIngestionService,
  type InboundEmailProviderAdapter,
  type InboundEmailProviderMessage,
} from "../services/inboundEmailIngestionService";
import type { InboundEmailMailbox, InboundOrderRecord } from "@shared/schema";

const mailbox = {
  id: "mailbox_1",
  organizationId: "org_1",
  sourceId: "source_1",
  provider: "gmail",
  name: "Inbound Gmail",
  emailAddress: "orders@example.com",
  enabled: true,
  isDefault: true,
  authJson: {},
  settingsJson: {},
  lastPulledAt: null,
  lastPullStatus: null,
  lastPullError: null,
  createdByUserId: "user_1",
  createdAt: new Date("2026-06-17T12:00:00.000Z"),
  updatedAt: new Date("2026-06-17T12:00:00.000Z"),
} satisfies InboundEmailMailbox;

const record = {
  id: "inbound_1",
  organizationId: "org_1",
  sourceId: "source_1",
  sourceType: "email",
  sourceLabel: "TEMP_INBOUND email intake",
  sourceTrustLevel: "semi_trusted_email",
  sourceRecordId: "gmail_msg_1",
  sourceMessageId: "gmail_msg_1",
  status: "needs_review",
  reviewOutcome: null,
  requiresHumanDecision: true,
  reviewRequiredReason: "Email candidate needs staff review.",
  externalReference: "PO attached",
  idempotencyKey: "gmail:gmail_msg_1",
  payloadHash: null,
  rawPayloadJson: {},
  normalizedPayloadJson: {},
  extractedCustomerJson: {},
  extractedOrderJson: {},
  extractedShippingJson: {},
  confidenceScore: null,
  duplicateScore: null,
  matchedCustomerId: null,
  matchedContactId: null,
  matchedQuoteId: null,
  matchedOrderId: null,
  createdQuoteId: null,
  createdOrderId: null,
  assignedToUserId: null,
  submittedByUserId: null,
  rejectedByUserId: null,
  rejectionReason: null,
  receivedAt: new Date("2026-06-17T12:00:00.000Z"),
  parsedAt: null,
  reviewStartedAt: null,
  approvedAt: null,
  submittedAt: null,
  rejectedAt: null,
  archivedAt: null,
  createdAt: new Date("2026-06-17T12:00:00.000Z"),
  updatedAt: new Date("2026-06-17T12:00:00.000Z"),
} satisfies InboundOrderRecord;

function message(overrides: Partial<InboundEmailProviderMessage> = {}): InboundEmailProviderMessage {
  return {
    provider: "gmail",
    messageId: "gmail_msg_1",
    threadId: "thread_1",
    senderName: "Buyer",
    senderEmail: "buyer@example.com",
    subject: "PO attached",
    receivedAt: new Date("2026-06-17T12:00:00.000Z"),
    bodyText: "Please see attached PO.",
    bodyHtml: null,
    attachments: [],
    ...overrides,
  };
}

function serviceHarness() {
  const createdFiles: any[] = [];
  const events: any[] = [];
  const repo = {
    listFiles: jest.fn(async () => createdFiles),
    listEnabledEmailIgnoreRules: jest.fn(async () => []),
    findFileByProviderAttachment: jest.fn(async () => null),
    createFile: jest.fn(async (values: any) => {
      const file = { id: `file_${createdFiles.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...values };
      createdFiles.push(file);
      return file;
    }),
    createEvent: jest.fn(async (values: any) => {
      const event = { id: `event_${events.length + 1}`, createdAt: new Date(), ...values };
      events.push(event);
      return event;
    }),
  };
  const storage = {
    finalizeUpload: jest.fn(async (input: any) => {
      const fileRecord = { id: "file_record_1", checksum: "checksum_1" };
      const linkedRecord = await input.persistLink({}, {
        fileRecord,
        placement: { id: "placement_1" },
        storedObject: { storageTarget: "local_dev" },
        legacyStorageProvider: "local",
        legacyFileUrl: "uploads/inbound/po.pdf",
        legacyRelativePath: "uploads/inbound/po.pdf",
      });
      return {
        fileRecord,
        placement: { id: "placement_1" },
        linkedRecord,
        storedObject: { storageTarget: "local_dev" },
        storageJob: { id: "job_1" },
      };
    }),
  };
  const service = new InboundEmailIngestionService({} as any, {}, repo as any, storage as any);
  return { service, repo, storage, createdFiles, events };
}

function duplicateDbHarness(existingRecord: InboundOrderRecord) {
  let selectCount = 0;
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => {
            selectCount += 1;
            return selectCount === 1 ? [{ id: existingRecord.id }] : [existingRecord];
          }),
        })),
      })),
    })),
  };
}

function insertConflictDbHarness(existingRecord: InboundOrderRecord) {
  let selectCount = 0;
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(async () => {
          selectCount += 1;
          return selectCount === 1 ? [] : [existingRecord];
        }),
      })),
    })),
  }));
  const tx = {
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoNothing: jest.fn(() => ({
          returning: jest.fn(async () => []),
        })),
      })),
    })),
  };
  return {
    select,
    transaction: jest.fn(async (callback: any) => callback(tx)),
  };
}

describe("InboundEmailIngestionService attachment ingestion", () => {
  test("does nothing for Gmail messages with no attachments", async () => {
    const { service, repo } = serviceHarness();
    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message(),
      record,
      adapter: {},
      skippedReason: null,
    });

    expect(repo.createFile).not.toHaveBeenCalled();
  });

  test("stores one PO PDF attachment through canonical storage", async () => {
    const { service, storage, createdFiles, events } = serviceHarness();
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => []),
      downloadAttachment: jest.fn(async () => ({
        buffer: Buffer.from("%PDF sample"),
        mimeType: "application/pdf",
        sizeBytes: 11,
      })),
    };

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        bodyText: "Artwork & Visual PO:",
        attachments: [{
          filename: "visual-proof.pdf",
          mimeType: "application/pdf",
          size: 11,
          attachmentId: "att_1",
          contentDisposition: "attachment",
          contentId: "<visual-proof>",
          partId: "1.2",
          detectedBy: ["filename", "attachmentId", "content-disposition:attachment"],
        }],
      }),
      record,
      adapter,
      skippedReason: null,
    });

    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      role: "po",
      status: "available",
      providerAttachmentId: "att_1",
      providerMessageId: "gmail_msg_1",
      fileRecordId: "file_record_1",
      contentDisposition: "attachment",
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      providerAttachmentId: "att_1",
      providerMessageId: "gmail_msg_1",
      contentDisposition: "attachment",
      contentId: "<visual-proof>",
      gmailPartId: "1.2",
      detectedBy: ["filename", "attachmentId", "content-disposition:attachment"],
      sourceHint: "Artwork & Visual PO",
      poCandidate: true,
      artworkCandidate: true,
    }));
    expect(events[0]).toEqual(expect.objectContaining({ eventType: "email.attachment_stored" }));
  });

  test("does not duplicate provider attachments already linked to the TEMP record", async () => {
    const { service, repo, storage } = serviceHarness();
    repo.findFileByProviderAttachment.mockResolvedValueOnce({ id: "existing_file" } as any);

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        attachments: [{
          filename: "Purchase Order 151661.pdf",
          mimeType: "application/pdf",
          size: 11,
          attachmentId: "att_1",
        }],
      }),
      record,
      adapter: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("x"), mimeType: "application/pdf", sizeBytes: 1 })),
      },
      skippedReason: null,
    });

    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(repo.createFile).not.toHaveBeenCalled();
  });

  test("stores attachment failure metadata without failing record ingestion", async () => {
    const { service, createdFiles, events } = serviceHarness();
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => []),
      downloadAttachment: jest.fn(async () => {
        throw new Error("Gmail attachment unavailable");
      }),
    };

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        attachments: [{
          filename: "Purchase Order 151661.pdf",
          mimeType: "application/pdf",
          size: 11,
          attachmentId: "att_1",
        }],
      }),
      record,
      adapter,
      skippedReason: null,
    });

    expect(createdFiles[0]).toEqual(expect.objectContaining({
      role: "po",
      status: "quarantined",
      fileRecordId: null,
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      downloadFailed: true,
      downloadError: "Gmail attachment unavailable",
      failureStage: "gmail_api",
      gmailApiError: "Gmail attachment unavailable",
      storageError: null,
    }));
    expect(events[0]).toEqual(expect.objectContaining({ eventType: "email.attachment_failed" }));
    expect(events.find((event) => event.eventType === "email.attachment_ingestion_diagnostics")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        attachmentCandidatesDiscovered: 1,
        attachmentIdsDiscovered: ["att_1"],
        downloadAttempts: 1,
        downloadSuccesses: 0,
        downloadFailures: 1,
        metadataOnlyRowsCreated: 1,
        storedRowsCreated: 0,
        failures: [expect.objectContaining({
          filename: "Purchase Order 151661.pdf",
          gmailApiError: "Gmail attachment unavailable",
        })],
      }),
    }));
  });

  test("stores metadata-only row when Gmail exposes an attachment part without a download id", async () => {
    const { service, storage, createdFiles } = serviceHarness();

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        attachments: [{
          filename: "calendar.invite",
          mimeType: "application/octet-stream",
          size: 512,
          attachmentId: null,
          contentDisposition: "attachment; filename=\"calendar.invite\"",
          detectedBy: ["filename", "content-disposition:attachment", "mimeType"],
        }],
      }),
      record,
      adapter: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("x"), mimeType: "application/octet-stream", sizeBytes: 1 })),
      },
      skippedReason: null,
    });

    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      role: "email_attachment",
      status: "uploaded",
      fileRecordId: null,
      providerAttachmentId: null,
      contentDisposition: "attachment; filename=\"calendar.invite\"",
      reviewNotes: "Attachment type is not supported for automatic download.",
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      detectedBy: ["filename", "content-disposition:attachment", "mimeType"],
      safeToDownload: false,
      unsupportedMimeReason: "Attachment type is not supported for automatic download.",
      failureReason: "Attachment type is not supported for automatic download.",
    }));
  });

  test("backfills attachments for duplicate Gmail records with zero files", async () => {
    const { repo, storage, createdFiles, events } = serviceHarness();
    repo.listFiles.mockResolvedValueOnce([]);
    const service = new InboundEmailIngestionService(duplicateDbHarness(record) as any, {}, repo as any, storage as any);
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => []),
      downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
    };

    const outcome = await (service as any).processMessage(
      "org_1",
      "user_1",
      mailbox,
      { id: "source_1" },
      message({
        attachments: [{
          filename: "Purchase Order 151753.pdf",
          mimeType: "application/pdf",
          size: 4,
          attachmentId: "att_backfill",
        }],
      }),
      adapter,
    );

    expect(outcome).toEqual({ status: "skippedDuplicates" });
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      inboundRecordId: "inbound_1",
      providerAttachmentId: "att_backfill",
      status: "available",
    }));
    expect(events.find((event) => event.eventType === "email.attachment_ingestion_diagnostics")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        attachmentCandidatesDiscovered: 1,
        attachmentIdsDiscovered: ["att_backfill"],
        downloadAttempts: 1,
        downloadSuccesses: 1,
        downloadFailures: 0,
        storedRowsCreated: 1,
        metadataOnlyRowsCreated: 0,
      }),
    }));
  });

  test("backfills attachments when insert conflict returns no created record", async () => {
    const { repo, storage, createdFiles, events } = serviceHarness();
    repo.listFiles.mockResolvedValueOnce([]);
    const service = new InboundEmailIngestionService(insertConflictDbHarness(record) as any, {}, repo as any, storage as any);
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => []),
      downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
    };

    const outcome = await (service as any).processMessage(
      "org_1",
      "user_1",
      mailbox,
      { id: "source_1" },
      message({
        subject: "Order for Back Lit Signs for Family Church please. 2 different sizes",
        attachments: [{
          filename: "Back Lit Sign Artwork.pdf",
          mimeType: "application/pdf",
          size: 4,
          attachmentId: "att_backlit",
        }],
      }),
      adapter,
    );

    expect(outcome).toEqual({ status: "skippedDuplicates" });
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      inboundRecordId: "inbound_1",
      providerAttachmentId: "att_backlit",
      status: "available",
    }));
    expect(events.find((event) => event.eventType === "email.attachment_ingestion_diagnostics")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        attachmentCandidatesDiscovered: 1,
        attachmentPartsAttempted: 1,
        downloadAttempts: 1,
        storedRowsCreated: 1,
      }),
    }));
  });

  test("does not duplicate attachments for duplicate Gmail records that already have provider files", async () => {
    const { repo, storage, events } = serviceHarness();
    repo.listFiles.mockResolvedValueOnce([{
      id: "file_existing",
      providerAttachmentId: "att_existing",
    }]);
    const service = new InboundEmailIngestionService(duplicateDbHarness(record) as any, {}, repo as any, storage as any);

    const outcome = await (service as any).processMessage(
      "org_1",
      "user_1",
      mailbox,
      { id: "source_1" },
      message({
        attachments: [{
          filename: "Purchase Order 151753.pdf",
          mimeType: "application/pdf",
          size: 4,
          attachmentId: "att_existing",
        }],
      }),
      {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
      },
    );

    expect(outcome).toEqual({ status: "skippedDuplicates" });
    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(repo.createFile).not.toHaveBeenCalled();
    expect(events[0]).toEqual(expect.objectContaining({
      eventType: "email.attachment_ingestion_diagnostics",
      metadataJson: expect.objectContaining({
        skippedReason: "duplicate_message_existing_files_cover_provider_attachments",
      }),
    }));
  });
});
