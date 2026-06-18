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
        attachments: [{
          filename: "Purchase Order 151661.pdf",
          mimeType: "application/pdf",
          size: 11,
          attachmentId: "att_1",
          contentDisposition: "attachment",
        }],
      }),
      record,
      adapter,
    });

    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      role: "po",
      status: "available",
      providerAttachmentId: "att_1",
      providerMessageId: "gmail_msg_1",
      fileRecordId: "file_record_1",
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
    });

    expect(createdFiles[0]).toEqual(expect.objectContaining({
      role: "po",
      status: "quarantined",
      fileRecordId: null,
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      downloadFailed: true,
      downloadError: "Gmail attachment unavailable",
    }));
    expect(events[0]).toEqual(expect.objectContaining({ eventType: "email.attachment_failed" }));
  });
});
