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

const longGmailAttachmentId = `ANGjdJ8${"x".repeat(280)}_gmail_attachment_identifier_tail`;

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
    listEnabledEmailTrustRules: jest.fn(async () => [{
      id: "trust_1",
      organizationId: "org_1",
      enabled: true,
      ruleType: "sender_email_exact",
      ruleValue: "buyer@example.com",
      notes: null,
      matchCount: 0,
      lastMatchedAt: null,
      createdByUserId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]),
    recordEmailTrustRuleMatch: jest.fn(async () => undefined),
    createEmailTrustRule: jest.fn(async (values: any) => ({
      id: "trust_created",
      matchCount: 0,
      lastMatchedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...values,
    })),
    senderEmailMatchesCustomerContact: jest.fn(async () => false),
    senderDomainMatchesCustomerDomain: jest.fn(async () => false),
    findFileByProviderAttachment: jest.fn(async () => null),
    getRecord: jest.fn(async () => record),
    getFile: jest.fn(async (_organizationId: string, _inboundRecordId: string, fileId: string) => createdFiles.find((file) => file.id === fileId) ?? null),
    updateFile: jest.fn(async (args: any) => {
      const existingIndex = createdFiles.findIndex((file) => file.id === args.fileId);
      if (existingIndex < 0) return null;
      createdFiles[existingIndex] = { ...createdFiles[existingIndex], ...args.patch, updatedAt: new Date() };
      return createdFiles[existingIndex];
    }),
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

function mailboxDbHarness() {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(async () => [mailbox]),
      })),
    })),
  };
}

function pullLatestFreshRecordDbHarness(createdRecord: InboundOrderRecord) {
  const source = {
    id: "source_1",
    organizationId: "org_1",
    sourceType: "email",
    name: "Inbound Email: orders@example.com",
    status: "active",
    sourceTrustLevel: "semi_trusted_email",
  };
  let selectCount = 0;
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => {
        selectCount += 1;
        const rows = selectCount === 1
          ? [mailbox]
          : selectCount === 2
            ? [source]
            : [];
        return {
          limit: jest.fn(async () => rows),
          then: (resolve: (value: unknown) => void) => resolve(rows),
        };
      }),
    })),
  }));
  const tx = {
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoNothing: jest.fn(() => ({
          returning: jest.fn(async () => [createdRecord]),
        })),
        then: (resolve: (value: unknown) => void) => resolve(undefined),
      })),
    })),
  };
  return {
    select,
    transaction: jest.fn(async (callback: any) => callback(tx)),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(async () => undefined),
      })),
    })),
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

  test("pullLatestEmails reaches attachment ingestion for a fresh Gmail message with candidates", async () => {
    const { repo, storage, createdFiles, events } = serviceHarness();
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => [message({
        subject: "654898 new po",
        bodyText: "Please see attached PO.",
        attachments: [{
          filename: "654898 new po.pdf",
          mimeType: "application/pdf",
          size: 8,
          attachmentId: "att_pull_latest",
          contentDisposition: "attachment",
        }],
      })]),
      downloadAttachment: jest.fn(async () => ({
        buffer: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        sizeBytes: 4,
      })),
    };
    const service = new InboundEmailIngestionService(
      pullLatestFreshRecordDbHarness(record) as any,
      { gmail: adapter },
      repo as any,
      storage as any,
    );
    const ingestSpy = jest.spyOn(service as any, "ingestAttachments");

    const result = await service.pullLatestEmails({
      organizationId: "org_1",
      actorUserId: "user_1",
      limit: 1,
    });

    expect(result.summary).toEqual({ created: 1, skippedDuplicates: 0, ignored: 0, failed: 0 });
    expect(adapter.listRecentMessages).toHaveBeenCalledWith(mailbox, 1);
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    expect(adapter.downloadAttachment).toHaveBeenCalledWith(
      mailbox,
      expect.objectContaining({
        subject: "654898 new po",
        attachments: [expect.objectContaining({ attachmentId: "att_pull_latest" })],
      }),
      expect.objectContaining({ attachmentId: "att_pull_latest" }),
    );
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      inboundRecordId: "inbound_1",
      providerAttachmentId: "att_pull_latest",
      status: "available",
    }));
    expect(events.find((event) => event.eventType === "attachment_ingestion_call_started")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        organizationId: "org_1",
        inboundRecordId: "inbound_1",
        providerMessageId: "gmail_msg_1",
        subject: "654898 new po",
        candidateCount: 1,
        trustStatus: "trusted_sender",
        attachmentPolicy: "auto_download_allowed",
      }),
    }));
    expect(events.find((event) => event.eventType === "attachment_ingestion_call_completed")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        organizationId: "org_1",
        inboundRecordId: "inbound_1",
        providerMessageId: "gmail_msg_1",
        subject: "654898 new po",
        candidateCount: 1,
        diagnostics: expect.objectContaining({
          attachmentPartsAttempted: 1,
          downloadAttempts: 1,
          storedRowsCreated: 1,
          metadataOnlyRowsCreated: 0,
        }),
      }),
    }));
    expect(events.find((event) => event.eventType === "email.attachment_ingestion_diagnostics")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        attachmentCandidatesDiscovered: 1,
        attachmentPartsAttempted: 1,
        downloadAttempts: 1,
        storedRowsCreated: 1,
        metadataOnlyRowsCreated: 0,
      }),
    }));
  });

  test("pullLatestEmails records failed audit when attachment ingestion throws", async () => {
    const { repo, storage, events } = serviceHarness();
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => [message({
        subject: "654898 new po",
        bodyText: "Please see attached PO.",
        attachments: [{
          filename: "654898 new po.pdf",
          mimeType: "application/pdf",
          size: 8,
          attachmentId: "att_pull_latest",
          contentDisposition: "attachment",
        }],
      })]),
      downloadAttachment: jest.fn(async () => ({
        buffer: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        sizeBytes: 4,
      })),
    };
    const service = new InboundEmailIngestionService(
      pullLatestFreshRecordDbHarness(record) as any,
      { gmail: adapter },
      repo as any,
      storage as any,
    );
    jest.spyOn(service as any, "ingestAttachments").mockRejectedValueOnce(new Error("Injected ingestion failure"));

    const result = await service.pullLatestEmails({
      organizationId: "org_1",
      actorUserId: "user_1",
      limit: 1,
    });

    expect(result.summary).toEqual({ created: 0, skippedDuplicates: 0, ignored: 0, failed: 1 });
    expect(events.find((event) => event.eventType === "attachment_ingestion_call_started")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        candidateCount: 1,
        providerMessageId: "gmail_msg_1",
      }),
    }));
    expect(events.find((event) => event.eventType === "attachment_ingestion_call_failed")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        candidateCount: 1,
        providerMessageId: "gmail_msg_1",
        errorMessage: "Injected ingestion failure",
      }),
    }));
    expect(events.find((event) => event.eventType === "attachment_ingestion_call_completed")).toBeUndefined();
  });

  test("preserves long Gmail attachment identifiers and reports provider ID column lengths", async () => {
    const { repo, storage, createdFiles, events } = serviceHarness();
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => [message({
        subject: "654898 new po",
        bodyText: "Please see attached PO.",
        attachments: [{
          filename: "654898 new po.pdf",
          mimeType: "application/pdf",
          size: 8,
          attachmentId: longGmailAttachmentId,
          contentDisposition: "attachment",
        }],
      })]),
      downloadAttachment: jest.fn(async () => ({
        buffer: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        sizeBytes: 4,
      })),
    };
    const service = new InboundEmailIngestionService(
      pullLatestFreshRecordDbHarness(record) as any,
      { gmail: adapter },
      repo as any,
      storage as any,
    );

    const result = await service.pullLatestEmails({
      organizationId: "org_1",
      actorUserId: "user_1",
      limit: 1,
    });

    expect(result.summary).toEqual({ created: 1, skippedDuplicates: 0, ignored: 0, failed: 0 });
    expect(longGmailAttachmentId.length).toBeGreaterThan(255);
    expect(adapter.downloadAttachment).toHaveBeenCalledWith(
      mailbox,
      expect.objectContaining({
        attachments: [expect.objectContaining({ attachmentId: longGmailAttachmentId })],
      }),
      expect.objectContaining({ attachmentId: longGmailAttachmentId }),
    );
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      providerAttachmentId: longGmailAttachmentId,
      providerMessageId: "gmail_msg_1",
      status: "available",
    }));
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(events.find((event) => event.eventType === "attachment_ingestion_call_started")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        providerIdentifierColumnDiagnostics: expect.arrayContaining([
          expect.objectContaining({
            table: "inbound_order_files",
            column: "provider_attachment_id",
            previousType: "varchar(255)",
            currentType: "text",
            actualStringLength: longGmailAttachmentId.length,
            originatingGmailField: "payload.parts[].body.attachmentId",
            exceedsPreviousLimit: true,
          }),
        ]),
      }),
    }));
  });

  test("unknown sender creates metadata-only pending_trust attachment", async () => {
    const { service, repo, storage, createdFiles, events } = serviceHarness();
    repo.listEnabledEmailTrustRules.mockResolvedValueOnce([]);

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        senderEmail: "unknown@example.net",
        attachments: [{
          filename: "654898 new po.pdf",
          mimeType: "application/pdf",
          size: 8,
          attachmentId: "att_pending",
        }],
      }),
      record,
      adapter: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
      },
      skippedReason: null,
    });

    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      providerAttachmentId: "att_pending",
      fileRecordId: null,
      status: "uploaded",
      reviewNotes: "Sender is not trusted. Attachment metadata captured pending staff trust decision.",
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      senderTrustStatus: "untrusted",
      attachmentState: "pending_trust",
    }));
    expect(events.find((event) => event.eventType === "email.attachment_ingestion_diagnostics")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        attachmentPartsAttempted: 1,
        downloadAttempts: 0,
        metadataOnlyRowsCreated: 1,
        safetyDecisions: [expect.objectContaining({
          trusted: false,
          attachmentState: "pending_trust",
        })],
      }),
    }));
  });

  test("trusted domain auto-downloads allowed PDF", async () => {
    const { service, repo, storage, createdFiles } = serviceHarness();
    repo.listEnabledEmailTrustRules.mockResolvedValueOnce([{
      id: "trust_domain",
      organizationId: "org_1",
      enabled: true,
      ruleType: "sender_domain",
      ruleValue: "example.com",
      notes: null,
      matchCount: 0,
      lastMatchedAt: null,
      createdByUserId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        senderEmail: "orders@example.com",
        attachments: [{
          filename: "domain-po.pdf",
          mimeType: "application/pdf",
          size: 8,
          attachmentId: "att_domain",
        }],
      }),
      record,
      adapter: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
      },
      skippedReason: null,
    });

    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      providerAttachmentId: "att_domain",
      status: "available",
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      senderTrustSource: "sender_domain",
      attachmentState: "downloaded",
    }));
  });

  test("blocked exe never auto-downloads even from trusted sender", async () => {
    const { service, storage, createdFiles } = serviceHarness();

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        attachments: [{
          filename: "proof-viewer.exe",
          mimeType: "application/octet-stream",
          size: 8,
          attachmentId: "att_exe",
        }],
      }),
      record,
      adapter: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("MZ"), mimeType: "application/octet-stream", sizeBytes: 2 })),
      },
      skippedReason: null,
    });

    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      providerAttachmentId: "att_exe",
      status: "quarantined",
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      attachmentState: "blocked_file_type",
      blockedFileType: true,
    }));
  });

  test("zip from trusted sender is stored as scan_pending quarantined", async () => {
    const { service, storage, createdFiles } = serviceHarness();

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        attachments: [{
          filename: "artwork.zip",
          mimeType: "application/zip",
          size: 8,
          attachmentId: "att_zip",
        }],
      }),
      record,
      adapter: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("PK"), mimeType: "application/zip", sizeBytes: 2 })),
      },
      skippedReason: null,
    });

    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      providerAttachmentId: "att_zip",
      status: "quarantined",
      fileRecordId: "file_record_1",
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      attachmentState: "scan_pending",
    }));
  });

  test("download once does not create a trust rule", async () => {
    const { repo, storage, createdFiles } = serviceHarness();
    const existingRecord = {
      ...record,
      rawPayloadJson: {
        provider: "gmail",
        messageId: "gmail_msg_1",
        mailbox: { id: "mailbox_1", emailAddress: "orders@example.com" },
        sender: { name: "Unknown", email: "unknown@example.net" },
        subject: "PO attached",
      },
    };
    repo.getRecord.mockResolvedValue(existingRecord);
    createdFiles.push({
      ...record,
      id: "file_pending",
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      inboundLineItemId: null,
      fileRecordId: null,
      sourceFilename: "one-time-po.pdf",
      role: "po",
      mimeType: "application/pdf",
      sizeBytes: 8,
      checksum: null,
      status: "uploaded",
      providerAttachmentId: "att_once",
      providerMessageId: "gmail_msg_1",
      contentDisposition: "attachment",
      metadataJson: { attachmentState: "pending_trust" },
      reviewNotes: "Pending trust",
      createdQuoteAttachmentId: null,
      createdOrderAttachmentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new InboundEmailIngestionService(mailboxDbHarness() as any, {
      gmail: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
      },
    }, repo as any, storage as any);

    const updated = await service.approveAttachmentTrustAction({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      fileId: "file_pending",
      action: "download_once",
    });

    expect(repo.createEmailTrustRule).not.toHaveBeenCalled();
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(updated).toEqual(expect.objectContaining({
      fileRecordId: "file_record_1",
      status: "available",
    }));
  });

  test("trust sender action creates future auto-download permission", async () => {
    const { repo, storage, createdFiles } = serviceHarness();
    const existingRecord = {
      ...record,
      rawPayloadJson: {
        provider: "gmail",
        messageId: "gmail_msg_1",
        mailbox: { id: "mailbox_1", emailAddress: "orders@example.com" },
        sender: { name: "Buyer", email: "buyer@example.com" },
        subject: "PO attached",
      },
    };
    repo.getRecord.mockResolvedValue(existingRecord);
    createdFiles.push({
      ...record,
      id: "file_pending",
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      inboundLineItemId: null,
      fileRecordId: null,
      sourceFilename: "trusted-po.pdf",
      role: "po",
      mimeType: "application/pdf",
      sizeBytes: 8,
      checksum: null,
      status: "uploaded",
      providerAttachmentId: "att_trust",
      providerMessageId: "gmail_msg_1",
      contentDisposition: "attachment",
      metadataJson: { attachmentState: "pending_trust" },
      reviewNotes: "Pending trust",
      createdQuoteAttachmentId: null,
      createdOrderAttachmentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new InboundEmailIngestionService(mailboxDbHarness() as any, {
      gmail: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
      },
    }, repo as any, storage as any);

    await service.approveAttachmentTrustAction({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      fileId: "file_pending",
      action: "trust_sender_and_download",
    });

    expect(repo.createEmailTrustRule).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      ruleType: "sender_email_exact",
      ruleValue: "buyer@example.com",
      createdByUserId: "user_1",
      enabled: true,
    }));
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
  });

  test("record trust sender and download processes pending attachments", async () => {
    const { repo, storage, createdFiles } = serviceHarness();
    repo.getRecord.mockResolvedValue({
      ...record,
      rawPayloadJson: {
        provider: "gmail",
        messageId: "gmail_msg_1",
        mailbox: { id: "mailbox_1", emailAddress: "orders@example.com" },
        sender: { name: "Buyer", email: "buyer@example.com" },
        subject: "PO attached",
      },
    });
    createdFiles.push({
      ...record,
      id: "file_pending",
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      inboundLineItemId: null,
      fileRecordId: null,
      sourceFilename: "pending-po.pdf",
      role: "po",
      mimeType: "application/pdf",
      sizeBytes: 8,
      checksum: null,
      status: "uploaded",
      providerAttachmentId: "att_pending",
      providerMessageId: "gmail_msg_1",
      contentDisposition: "attachment",
      metadataJson: { attachmentState: "pending_trust" },
      reviewNotes: "Pending trust",
      createdQuoteAttachmentId: null,
      createdOrderAttachmentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new InboundEmailIngestionService(mailboxDbHarness() as any, {
      gmail: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
      },
    }, repo as any, storage as any);

    const result = await service.approveRecordTrustAction({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "trust_sender_and_download",
    });

    expect(repo.createEmailTrustRule).toHaveBeenCalledWith(expect.objectContaining({
      ruleType: "sender_email_exact",
      ruleValue: "buyer@example.com",
      enabled: true,
    }));
    expect(result).toEqual(expect.objectContaining({
      attempted: 1,
      downloaded: 1,
      metadataOnly: 0,
    }));
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
  });

  test("record trust and download keeps blocked file types blocked", async () => {
    const { repo, storage, createdFiles } = serviceHarness();
    repo.getRecord.mockResolvedValue({
      ...record,
      rawPayloadJson: {
        provider: "gmail",
        messageId: "gmail_msg_1",
        mailbox: { id: "mailbox_1", emailAddress: "orders@example.com" },
        sender: { name: "Buyer", email: "buyer@example.com" },
        subject: "PO attached",
      },
    });
    createdFiles.push({
      ...record,
      id: "file_blocked",
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      inboundLineItemId: null,
      fileRecordId: null,
      sourceFilename: "payload.exe",
      role: "other",
      mimeType: "application/x-msdownload",
      sizeBytes: 8,
      checksum: null,
      status: "uploaded",
      providerAttachmentId: "att_exe",
      providerMessageId: "gmail_msg_1",
      contentDisposition: "attachment",
      metadataJson: { attachmentState: "pending_trust" },
      reviewNotes: "Pending trust",
      createdQuoteAttachmentId: null,
      createdOrderAttachmentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new InboundEmailIngestionService(mailboxDbHarness() as any, {
      gmail: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("MZ"), mimeType: "application/x-msdownload", sizeBytes: 2 })),
      },
    }, repo as any, storage as any);

    const result = await service.approveRecordTrustAction({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "trust_sender_and_download",
    });

    expect(result).toEqual(expect.objectContaining({
      attempted: 1,
      downloaded: 0,
      metadataOnly: 1,
      blocked: 1,
    }));
    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(createdFiles[0]).toEqual(expect.objectContaining({ status: "quarantined" }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      attachmentState: "blocked_file_type",
      blockedFileType: true,
    }));
  });

  test("does not duplicate provider attachments already linked to the TEMP record", async () => {
    const { service, repo, storage } = serviceHarness();
    repo.findFileByProviderAttachment.mockResolvedValueOnce({ id: "existing_file", fileRecordId: "file_record_existing" } as any);

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
      reviewNotes: "Attachment type .invite is not allowed for automatic download.",
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      detectedBy: ["filename", "content-disposition:attachment", "mimeType"],
      safeToDownload: false,
      unsupportedMimeReason: "Attachment type .invite is not allowed for automatic download.",
      failureReason: "Attachment type .invite is not allowed for automatic download.",
      attachmentState: "metadata_only",
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

  test("backfills attachments from stored payload when normalized message candidates are missing", async () => {
    const { repo, storage, createdFiles, events } = serviceHarness();
    repo.listFiles.mockResolvedValueOnce([]);
    const existingRecord = {
      ...record,
      rawPayloadJson: {
        attachments: [{
          filename: "151753 Titan Compass ACM Sign.pdf",
          mimeType: "application/pdf",
          size: 12,
          attachmentId: "att_151753",
          contentDisposition: "attachment",
          partId: "2",
          detectedBy: ["attachmentId", "content-disposition:attachment"],
        }],
      },
    };
    const service = new InboundEmailIngestionService(duplicateDbHarness(existingRecord) as any, {}, repo as any, storage as any);
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
        subject: "151753 Titan Compass",
        attachments: [],
      }),
      adapter,
    );

    expect(outcome).toEqual({ status: "skippedDuplicates" });
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(adapter.downloadAttachment).toHaveBeenCalledWith(
      mailbox,
      expect.objectContaining({ subject: "151753 Titan Compass" }),
      expect.objectContaining({ attachmentId: "att_151753" }),
    );
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      inboundRecordId: "inbound_1",
      providerAttachmentId: "att_151753",
      status: "available",
    }));
    expect(events.find((event) => event.eventType === "email.attachment_ingestion_diagnostics")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        attachmentCandidatesDiscovered: 1,
        attachmentPartsAttempted: 1,
        downloadAttempts: 1,
        downloadSuccesses: 1,
        storedRowsCreated: 1,
      }),
    }));
  });

  test("creates metadata-only rows from stored payload candidates without Gmail attachment ids", async () => {
    const { service, storage, createdFiles, events } = serviceHarness();
    const recordWithStoredAttachment = {
      ...record,
      rawPayloadJson: {
        attachments: [{
          filename: "spec-link.url",
          mimeType: "application/octet-stream",
          sizeBytes: 42,
          contentDisposition: "attachment; filename=\"spec-link.url\"",
        }],
      },
    };

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        subject: "Order for Back Lit Signs for Family Church please. 2 different sizes",
        attachments: [],
      }),
      record: recordWithStoredAttachment,
      adapter: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("x"), mimeType: "application/octet-stream", sizeBytes: 1 })),
      },
      skippedReason: null,
    });

    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      sourceFilename: "spec-link.url",
      providerAttachmentId: null,
      status: "uploaded",
      fileRecordId: null,
    }));
    expect(events.find((event) => event.eventType === "email.attachment_ingestion_diagnostics")).toEqual(expect.objectContaining({
      metadataJson: expect.objectContaining({
        attachmentCandidatesDiscovered: 1,
        attachmentPartsAttempted: 1,
        downloadAttempts: 0,
        metadataOnlyRowsCreated: 1,
      }),
    }));
  });

  test("processes candidates recovered from normalizedPayloadJson", async () => {
    const { service, storage, createdFiles, events } = serviceHarness();
    const recordWithNormalizedAttachment = {
      ...record,
      normalizedPayloadJson: {
        attachments: [{
          filename: "654898 new po.pdf",
          mimeType: "application/pdf",
          size: 6,
          attachmentId: "att_654898_normalized",
        }],
      },
    };

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({ subject: "654898 new po", attachments: [] }),
      record: recordWithNormalizedAttachment,
      adapter: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
      },
      skippedReason: null,
    });

    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      providerAttachmentId: "att_654898_normalized",
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

  test("processes candidates recovered from extractedOrderJson", async () => {
    const { service, storage, createdFiles, events } = serviceHarness();
    const recordWithExtractedAttachment = {
      ...record,
      extractedOrderJson: {
        attachments: [{
          sourceFilename: "654898 artwork.tiff",
          mimeType: "image/tiff",
          sizeBytes: 9,
          providerAttachmentId: "att_654898_extracted",
        }],
      },
    };

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({ subject: "654898 new po", attachments: [] }),
      record: recordWithExtractedAttachment,
      adapter: {
        listRecentMessages: jest.fn(async () => []),
        downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("TIFF"), mimeType: "image/tiff", sizeBytes: 4 })),
      },
      skippedReason: null,
    });

    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      providerAttachmentId: "att_654898_extracted",
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

  test("recovers Gmail payload candidates before duplicate backfill processing", async () => {
    const { repo, storage, createdFiles, events } = serviceHarness();
    repo.listFiles.mockResolvedValueOnce([]);
    const service = new InboundEmailIngestionService(duplicateDbHarness(record) as any, {}, repo as any, storage as any);
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => []),
      getMessagePayloadDiagnostics: jest.fn(async () => ({
        messageId: "gmail_msg_1",
        payloadTree: null,
        extractedAttachmentCount: 1,
        extractedAttachments: [{
          filename: "654898 new po.pdf",
          mimeType: "application/pdf",
          size: 8,
          attachmentId: "att_654898",
        }],
      })),
      downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
    };

    const outcome = await (service as any).processMessage(
      "org_1",
      "user_1",
      mailbox,
      { id: "source_1" },
      message({ subject: "654898 new po", attachments: [] }),
      adapter,
    );

    expect(outcome).toEqual({ status: "skippedDuplicates" });
    expect(adapter.getMessagePayloadDiagnostics).toHaveBeenCalledWith(mailbox, "gmail_msg_1");
    expect(adapter.downloadAttachment).toHaveBeenCalledWith(
      mailbox,
      expect.objectContaining({
        subject: "654898 new po",
        attachments: [expect.objectContaining({ attachmentId: "att_654898" })],
      }),
      expect.objectContaining({ attachmentId: "att_654898" }),
    );
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      providerAttachmentId: "att_654898",
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
