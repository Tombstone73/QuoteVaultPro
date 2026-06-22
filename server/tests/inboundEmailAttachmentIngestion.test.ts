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
    listEmailIgnoreRules: jest.fn(async () => []),
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
    updateEmailIgnoreRule: jest.fn(async (values: any) => ({
      id: values.id,
      organizationId: values.organizationId,
      enabled: values.enabled ?? false,
      ruleType: "sender_email_exact",
      ruleValue: "buyer@example.com",
      notes: null,
      matchCount: 0,
      lastMatchedAt: null,
      createdByUserId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
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
    findFileByProviderAttachment: jest.fn<(...args: any[]) => Promise<any>>(async () => null),
    getRecord: jest.fn(async () => record),
    getFile: jest.fn(async (_organizationId: string, _inboundRecordId: string, fileId: string) => createdFiles.find((file) => file.id === fileId) ?? null),
    updateFile: jest.fn(async (args: any) => {
      const existingIndex = createdFiles.findIndex((file) => file.id === args.fileId);
      if (existingIndex < 0) return null;
      createdFiles[existingIndex] = { ...createdFiles[existingIndex], ...args.patch, updatedAt: new Date() };
      return createdFiles[existingIndex];
    }),
    updateRecordWithEvent: jest.fn(async (args: any) => ({
      record: {
        ...record,
        ...args.patch,
        updatedAt: new Date(),
      },
      event: {
        id: `event_${events.length + 1}`,
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        createdAt: new Date(),
        ...args.event,
      },
    })),
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

function threadCreateDbHarness(createdRecord: InboundOrderRecord) {
  const insertedRecords: any[] = [];
  const insertedEvents: any[] = [];
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(async () => []),
      })),
    })),
  }));
  const tx = {
    insert: jest.fn(() => ({
      values: jest.fn((values: any) => {
        if (values?.idempotencyKey) insertedRecords.push(values);
        else insertedEvents.push(values);
        return {
          onConflictDoNothing: jest.fn(() => ({
            returning: jest.fn(async () => [createdRecord]),
          })),
          then: (resolve: (value: unknown) => void) => resolve(undefined),
        };
      }),
    })),
  };
  return {
    select,
    transaction: jest.fn(async (callback: any) => callback(tx)),
    insertedRecords,
    insertedEvents,
  };
}

function threadExistingDbHarness(existingRecord: InboundOrderRecord) {
  let selectCount = 0;
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(async () => {
          selectCount += 1;
          return selectCount === 1 ? [{ id: existingRecord.id }] : [existingRecord];
        }),
      })),
    })),
  }));
  return { select };
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
  const insertedRecords: any[] = [];
  const tx = {
    insert: jest.fn(() => ({
      values: jest.fn((values: any) => {
        if (values?.idempotencyKey) insertedRecords.push(values);
        return {
          onConflictDoNothing: jest.fn(() => ({
            returning: jest.fn(async () => [createdRecord]),
          })),
          then: (resolve: (value: unknown) => void) => resolve(undefined),
        };
      }),
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
    insertedRecords,
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

  test("pullLatestEmails creates a TEMP_INBOUND record for no-subject Gmail messages", async () => {
    const { repo, storage } = serviceHarness();
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => [message({
        messageId: "gmail_msg_no_subject",
        threadId: null,
        senderName: "Shawn Fears",
        senderEmail: "shawn@brainstormprint.com",
        subject: null,
        bodyText: "Please see attached purchase order.",
        attachments: [],
      })]),
    };
    const noSubjectRecord = {
      ...record,
      sourceRecordId: "gmail_msg_no_subject",
      sourceMessageId: "gmail_msg_no_subject",
      externalReference: "(no subject) shawn@brainstormprint.com 2026-06-17",
      idempotencyKey: "gmail:gmail_msg_no_subject",
    };
    const dbHarness = pullLatestFreshRecordDbHarness(noSubjectRecord);
    const service = new InboundEmailIngestionService(
      dbHarness as any,
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
    expect(dbHarness.insertedRecords[0]).toEqual(expect.objectContaining({
      sourceRecordId: "gmail_msg_no_subject",
      sourceMessageId: "gmail_msg_no_subject",
      externalReference: "(no subject) shawn@brainstormprint.com 2026-06-17",
      rawPayloadJson: expect.objectContaining({
        subject: null,
        displaySubject: "(no subject)",
      }),
      normalizedPayloadJson: expect.objectContaining({
        subject: null,
        displaySubject: "(no subject)",
      }),
      extractedOrderJson: expect.objectContaining({
        subject: null,
        displaySubject: "(no subject)",
      }),
    }));
  });

  test("pullLatestEmails keeps known customer communications instead of skipping them as newsletters", async () => {
    const { repo, storage } = serviceHarness();
    repo.listEnabledEmailTrustRules.mockResolvedValueOnce([]);
    (repo.senderEmailMatchesCustomerContact as jest.MockedFunction<(
      organizationId: string,
      email: string,
    ) => Promise<boolean>>).mockImplementation(async (_organizationId, email) => email === "shawn@brainstormprint.com");
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => [message({
        messageId: "gmail_brainstorm_weekly_jobs",
        threadId: null,
        senderName: "Shawn Fears",
        senderEmail: "shawn@brainstormprint.com",
        subject: "Brainstorm Jobs Due for the Week of 6/15 thru 6/19",
        bodyText: "Here is the weekly job list, schedule updates, artwork discussion, and delivery coordination.",
        attachments: [],
      })]),
    };
    const brainstormRecord = {
      ...record,
      sourceRecordId: "gmail_brainstorm_weekly_jobs",
      sourceMessageId: "gmail_brainstorm_weekly_jobs",
      externalReference: "Brainstorm Jobs Due for the Week of 6/15 thru 6/19",
      idempotencyKey: "gmail:gmail_brainstorm_weekly_jobs",
    };
    const dbHarness = pullLatestFreshRecordDbHarness(brainstormRecord);
    const service = new InboundEmailIngestionService(
      dbHarness as any,
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
    expect(dbHarness.insertedRecords[0]).toEqual(expect.objectContaining({
      sourceLabel: "TEMP_INBOUND email intake - CUSTOMER_COMMUNICATION",
      reviewRequiredReason: "CUSTOMER_COMMUNICATION email candidate needs staff review.",
      normalizedPayloadJson: expect.objectContaining({
        inboundIntent: "CUSTOMER_COMMUNICATION",
        inboundIntentReason: "Known customer/contact communication needs staff review.",
        inboundIntentCrmInfluence: expect.stringContaining("trusted contact"),
        senderTrustSource: "customer_contact_email",
      }),
      extractedOrderJson: expect.objectContaining({
        inboundIntent: "CUSTOMER_COMMUNICATION",
        inboundIntentCrmInfluence: expect.stringContaining("trusted contact"),
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

  test.each(["yahoo.com", "gmail.com", "outlook.com"])(
    "public domain %s does not auto-download from customer-domain trust",
    async (domain) => {
      const { service, repo, storage, createdFiles } = serviceHarness();
      repo.listEnabledEmailTrustRules.mockResolvedValueOnce([]);
      repo.senderDomainMatchesCustomerDomain.mockResolvedValueOnce(true);

      await (service as any).ingestAttachments({
        organizationId: "org_1",
        actorUserId: "user_1",
        mailbox,
        message: message({
          senderEmail: `orders@${domain}`,
          attachments: [{
            filename: "public-domain-po.pdf",
            mimeType: "application/pdf",
            size: 8,
            attachmentId: `att_${domain.replace(/\W/g, "_")}`,
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
      expect(repo.senderDomainMatchesCustomerDomain).not.toHaveBeenCalled();
      expect(createdFiles[0]).toEqual(expect.objectContaining({
        fileRecordId: null,
        status: "uploaded",
        reviewNotes: "Sender is not trusted. Attachment metadata captured pending staff trust decision.",
      }));
      expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
        senderTrustStatus: "untrusted",
        senderTrustSource: "none",
        attachmentState: "pending_trust",
      }));
    },
  );

  test("public sender domain trust rule is ignored during auto-download evaluation", async () => {
    const { service, repo, storage, createdFiles } = serviceHarness();
    repo.listEnabledEmailTrustRules.mockResolvedValueOnce([{
      id: "trust_yahoo_domain",
      organizationId: "org_1",
      enabled: true,
      ruleType: "sender_domain",
      ruleValue: "yahoo.com",
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
        senderEmail: "orders@yahoo.com",
        attachments: [{
          filename: "public-domain-rule-po.pdf",
          mimeType: "application/pdf",
          size: 8,
          attachmentId: "att_yahoo_rule",
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
    expect(repo.recordEmailTrustRuleMatch).not.toHaveBeenCalled();
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      senderTrustStatus: "untrusted",
      senderTrustSource: "none",
      attachmentState: "pending_trust",
    }));
  });

  test("exact known contact email on a public domain may auto-download", async () => {
    const { service, repo, storage, createdFiles } = serviceHarness();
    repo.listEnabledEmailTrustRules.mockResolvedValueOnce([]);
    repo.senderEmailMatchesCustomerContact.mockResolvedValueOnce(true);

    await (service as any).ingestAttachments({
      organizationId: "org_1",
      actorUserId: "user_1",
      mailbox,
      message: message({
        senderEmail: "known.customer@gmail.com",
        attachments: [{
          filename: "known-contact-po.pdf",
          mimeType: "application/pdf",
          size: 8,
          attachmentId: "att_known_gmail",
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
    expect(repo.senderDomainMatchesCustomerDomain).not.toHaveBeenCalled();
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      providerAttachmentId: "att_known_gmail",
      status: "available",
    }));
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      senderTrustSource: "customer_contact_email",
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

  test("trust domain action rejects public free email domains", async () => {
    const { repo, storage, createdFiles } = serviceHarness();
    const existingRecord = {
      ...record,
      rawPayloadJson: {
        provider: "gmail",
        messageId: "gmail_msg_1",
        mailbox: { id: "mailbox_1", emailAddress: "orders@example.com" },
        sender: { name: "Public Sender", email: "orders@yahoo.com" },
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
      sourceFilename: "public-domain-po.pdf",
      role: "po",
      mimeType: "application/pdf",
      sizeBytes: 8,
      checksum: null,
      status: "uploaded",
      providerAttachmentId: "att_public_domain",
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

    await expect(service.approveAttachmentTrustAction({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      fileId: "file_pending",
      action: "trust_domain_and_download",
    })).rejects.toMatchObject({
      code: "INBOUND_PUBLIC_DOMAIN_TRUST_BLOCKED",
      statusCode: 400,
      message: "Sender domain yahoo.com is a public/free email domain. Trust the exact sender email instead.",
    });

    expect(repo.createEmailTrustRule).not.toHaveBeenCalled();
    expect(storage.finalizeUpload).not.toHaveBeenCalled();
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

  test("record trust domain action rejects public free email domains", async () => {
    const { repo, storage, createdFiles } = serviceHarness();
    repo.getRecord.mockResolvedValue({
      ...record,
      rawPayloadJson: {
        provider: "gmail",
        messageId: "gmail_msg_1",
        mailbox: { id: "mailbox_1", emailAddress: "orders@example.com" },
        sender: { name: "Public Sender", email: "orders@gmail.com" },
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

    await expect(service.approveRecordTrustAction({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "trust_domain_and_download",
    })).rejects.toMatchObject({
      code: "INBOUND_PUBLIC_DOMAIN_TRUST_BLOCKED",
      statusCode: 400,
      message: "Sender domain gmail.com is a public/free email domain. Trust the exact sender email instead.",
    });

    expect(repo.createEmailTrustRule).not.toHaveBeenCalled();
    expect(storage.finalizeUpload).not.toHaveBeenCalled();
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

    expect(outcome).toMatchObject({ status: "skippedDuplicates", processingOutcome: "duplicate" });
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

  test("first Gmail thread message creates one thread container and ingests all thread attachments", async () => {
    const { repo, storage, createdFiles } = serviceHarness();
    const createdThreadRecord = {
      ...record,
      id: "thread_record_1",
      sourceRecordId: "gmail_msg_2",
      sourceMessageId: "gmail_msg_2",
      idempotencyKey: "gmail:thread:thread_1",
      rawPayloadJson: {
        thread: {
          id: "thread_1",
          messageCount: 2,
        },
      },
    };
    const dbHarness = threadCreateDbHarness(createdThreadRecord);
    const service = new InboundEmailIngestionService(dbHarness as any, {}, repo as any, storage as any);
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => []),
      getThreadMessages: jest.fn(async () => [
        message({
          messageId: "gmail_msg_1",
          threadId: "thread_1",
          subject: "Quote request",
          receivedAt: new Date("2026-06-17T12:00:00.000Z"),
          attachments: [{
            filename: "quote-spec.pdf",
            mimeType: "application/pdf",
            size: 4,
            attachmentId: "att_quote",
          }],
        }),
        message({
          messageId: "gmail_msg_2",
          threadId: "thread_1",
          subject: "Re: Quote request - PO",
          receivedAt: new Date("2026-06-18T12:00:00.000Z"),
          attachments: [{
            filename: "po.pdf",
            mimeType: "application/pdf",
            size: 5,
            attachmentId: "att_po",
          }],
        }),
      ]),
      downloadAttachment: jest.fn(async (_mailbox: any, _message: any, attachment: any) => ({
        buffer: Buffer.from("%PDF"),
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
      })),
    };

    const outcome = await (service as any).processMessage(
      "org_1",
      "user_1",
      mailbox,
      { id: "source_1" },
      message({ messageId: "gmail_msg_1", threadId: "thread_1", subject: "Quote request" }),
      adapter,
    );

    expect(outcome).toMatchObject({ status: "created", recordId: "thread_record_1", processingOutcome: "created_record" });
    expect(adapter.getThreadMessages).toHaveBeenCalledWith(mailbox, "thread_1");
    expect(dbHarness.insertedRecords[0]).toEqual(expect.objectContaining({
      idempotencyKey: "gmail:thread:thread_1",
      sourceRecordId: "gmail_msg_2",
      sourceMessageId: "gmail_msg_2",
      externalReference: "Re: Quote request - PO",
    }));
    expect(dbHarness.insertedRecords[0].rawPayloadJson).toEqual(expect.objectContaining({
      threadId: "thread_1",
      thread: expect.objectContaining({
        id: "thread_1",
        messageCount: 2,
        firstMessageId: "gmail_msg_1",
        latestMessageId: "gmail_msg_2",
        latestActivityAt: "2026-06-18T12:00:00.000Z",
      }),
    }));
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(2);
    expect(createdFiles.map((file) => [file.providerMessageId, file.providerAttachmentId])).toEqual([
      ["gmail_msg_1", "att_quote"],
      ["gmail_msg_2", "att_po"],
    ]);
  });

  test("second Gmail message in same thread refreshes existing container without creating another record", async () => {
    const { repo, storage, createdFiles } = serviceHarness();
    repo.listFiles.mockResolvedValue([]);
    const existingThreadRecord = {
      ...record,
      id: "thread_record_1",
      idempotencyKey: "gmail:thread:thread_1",
      rawPayloadJson: {
        messageId: "gmail_msg_1",
        threadId: "thread_1",
        sender: { email: "buyer@example.com" },
        thread: { id: "thread_1", messageCount: 1 },
      },
      normalizedPayloadJson: {
        source: { messageId: "gmail_msg_1", threadId: "thread_1" },
      },
    };
    repo.updateRecordWithEvent.mockResolvedValueOnce({
      record: {
        ...existingThreadRecord,
        rawPayloadJson: {
          ...existingThreadRecord.rawPayloadJson,
          thread: {
            id: "thread_1",
            messageCount: 2,
            latestMessageId: "gmail_msg_2",
            latestActivityAt: "2026-06-18T12:00:00.000Z",
          },
        },
      },
      event: { id: "event_thread_refresh" },
    });
    const dbHarness = threadExistingDbHarness(existingThreadRecord);
    const service = new InboundEmailIngestionService(dbHarness as any, {}, repo as any, storage as any);
    const adapter: InboundEmailProviderAdapter = {
      listRecentMessages: jest.fn(async () => []),
      getThreadMessages: jest.fn(async () => [
        message({
          messageId: "gmail_msg_1",
          threadId: "thread_1",
          receivedAt: new Date("2026-06-17T12:00:00.000Z"),
          attachments: [],
        }),
        message({
          messageId: "gmail_msg_2",
          threadId: "thread_1",
          subject: "Re: Quote request - artwork",
          receivedAt: new Date("2026-06-18T12:00:00.000Z"),
          attachments: [{
            filename: "art.png",
            mimeType: "image/png",
            size: 8,
            attachmentId: "att_art",
          }],
        }),
      ]),
      downloadAttachment: jest.fn(async (_mailbox: any, _message: any, attachment: any) => ({
        buffer: Buffer.from("PNG"),
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
      })),
    };

    const outcome = await (service as any).processMessage(
      "org_1",
      "user_1",
      mailbox,
      { id: "source_1" },
      message({ messageId: "gmail_msg_2", threadId: "thread_1", subject: "Re: Quote request - artwork" }),
      adapter,
    );

    expect(outcome).toMatchObject({ status: "skippedDuplicates", processingOutcome: "updated_thread_container" });
    expect(repo.updateRecordWithEvent).toHaveBeenCalledWith(expect.objectContaining({
      inboundRecordId: "thread_record_1",
      patch: expect.objectContaining({
        rawPayloadJson: expect.objectContaining({
          thread: expect.objectContaining({
            messageCount: 2,
            latestMessageId: "gmail_msg_2",
            latestActivityAt: "2026-06-18T12:00:00.000Z",
          }),
        }),
      }),
      event: expect.objectContaining({
        eventType: "email.thread_source_refreshed",
        metadataJson: expect.objectContaining({
          action: "thread_message_appended",
          threadMessagesInspected: 2,
          attachmentCandidatesAcrossThread: 1,
        }),
      }),
    }));
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(createdFiles[0]).toEqual(expect.objectContaining({
      inboundRecordId: "thread_record_1",
      providerMessageId: "gmail_msg_2",
      providerAttachmentId: "att_art",
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

    expect(outcome).toMatchObject({ status: "skippedDuplicates", processingOutcome: "duplicate" });
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

    expect(outcome).toMatchObject({ status: "skippedDuplicates", processingOutcome: "duplicate" });
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

    expect(outcome).toMatchObject({ status: "skippedDuplicates", processingOutcome: "duplicate" });
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

    expect(outcome).toMatchObject({ status: "skippedDuplicates", processingOutcome: "duplicate" });
    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(repo.createFile).not.toHaveBeenCalled();
    expect(events[0]).toEqual(expect.objectContaining({
      eventType: "email.attachment_ingestion_diagnostics",
      metadataJson: expect.objectContaining({
        skippedReason: "duplicate_message_existing_files_cover_provider_attachments",
      }),
    }));
  });

  test("manual backfill existing email record with zero files creates stored attachment rows", async () => {
    const { service, repo, storage, events } = serviceHarness();
    (service as any).resolveMailboxForRecord = jest.fn(async () => mailbox);
    const adapter = {
      listRecentMessages: jest.fn(async () => []),
      getMessage: jest.fn(async () => message({
        attachments: [{
          filename: "po-151753.pdf",
          mimeType: "application/pdf",
          size: 4,
          attachmentId: "att_manual",
        }],
      })),
      downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
    };
    (service as any).adapterByProvider.gmail = adapter;

    const result = await service.manuallyReprocessInboundEmailRecord({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "backfill_attachments",
    });

    expect(result).toEqual(expect.objectContaining({
      candidatesFound: 1,
      attempted: 1,
      stored: 1,
      metadataOnly: 0,
    }));
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(repo.createFile).toHaveBeenCalledWith(expect.objectContaining({
      inboundRecordId: "inbound_1",
      providerAttachmentId: "att_manual",
      providerMessageId: "gmail_msg_1",
    }), expect.anything());
    expect(events.some((event) => event.eventType === "email.manual_reprocess_completed")).toBe(true);
  });

  test("manual backfill with existing provider files does not duplicate rows", async () => {
    const { service, repo, storage } = serviceHarness();
    (service as any).resolveMailboxForRecord = jest.fn(async () => mailbox);
    repo.findFileByProviderAttachment.mockImplementationOnce(async () => ({
      id: "file_existing",
      inboundRecordId: "inbound_1",
      fileRecordId: "file_record_existing",
      providerAttachmentId: "att_existing",
      providerMessageId: "gmail_msg_1",
      metadataJson: { attachmentState: "downloaded" },
      status: "available",
    }));
    (service as any).adapterByProvider.gmail = {
      listRecentMessages: jest.fn(async () => []),
      getMessage: jest.fn(async () => message({
        attachments: [{
          filename: "po.pdf",
          mimeType: "application/pdf",
          size: 4,
          attachmentId: "att_existing",
        }],
      })),
      downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
    };

    const result = await service.manuallyReprocessInboundEmailRecord({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "backfill_attachments",
    });

    expect(result.skipped).toBe(1);
    expect(result.stored).toBe(0);
    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(repo.createFile).not.toHaveBeenCalledWith(expect.objectContaining({
      providerAttachmentId: "att_existing",
    }));
  });

  test("manual reprocess refreshes source evidence but does not touch review draft fields", async () => {
    const { service, repo } = serviceHarness();
    (service as any).resolveMailboxForRecord = jest.fn(async () => mailbox);
    (service as any).adapterByProvider.gmail = {
      listRecentMessages: jest.fn(async () => []),
      getMessage: jest.fn(async () => message({
        subject: "Updated subject",
        bodyText: "Updated thread body",
        attachments: [],
      })),
    };

    await service.manuallyReprocessInboundEmailRecord({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "reprocess_email",
    });

    expect(repo.updateRecordWithEvent).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        rawPayloadJson: expect.objectContaining({
          subject: "Updated subject",
          bodyText: "Updated thread body",
        }),
        normalizedPayloadJson: expect.objectContaining({
          subject: "Updated subject",
          bodyText: "Updated thread body",
        }),
      }),
    }));
    const patch = repo.updateRecordWithEvent.mock.calls[0][0].patch;
    expect(Object.keys(patch)).toEqual(expect.arrayContaining(["rawPayloadJson", "normalizedPayloadJson", "extractedOrderJson"]));
    expect(JSON.stringify(patch)).not.toContain("reviewedCustomerJson");
    expect(JSON.stringify(patch)).not.toContain("staff_selected");
  });

  test("manual backfill for untrusted sender creates pending trust metadata-only row", async () => {
    const { service, repo, storage, createdFiles } = serviceHarness();
    (service as any).resolveMailboxForRecord = jest.fn(async () => mailbox);
    repo.listEnabledEmailTrustRules.mockResolvedValue([]);
    (service as any).adapterByProvider.gmail = {
      listRecentMessages: jest.fn(async () => []),
      getMessage: jest.fn(async () => message({
        senderEmail: "unknown@example.com",
        attachments: [{
          filename: "po.pdf",
          mimeType: "application/pdf",
          size: 4,
          attachmentId: "att_pending",
        }],
      })),
      downloadAttachment: jest.fn(async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf", sizeBytes: 4 })),
    };

    const result = await service.manuallyReprocessInboundEmailRecord({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "backfill_attachments",
    });

    expect(result.metadataOnly).toBe(1);
    expect(result.stored).toBe(0);
    expect(storage.finalizeUpload).not.toHaveBeenCalled();
    expect(createdFiles[0].metadataJson).toEqual(expect.objectContaining({
      attachmentState: "pending_trust",
      senderTrustStatus: "untrusted",
    }));
  });

  test("manual backfill inspects Gmail thread messages and preserves attachment message provenance", async () => {
    const { service, repo, storage, createdFiles } = serviceHarness();
    (service as any).resolveMailboxForRecord = jest.fn(async () => mailbox);
    const adapter = {
      listRecentMessages: jest.fn(async () => []),
      getThreadMessages: jest.fn(async () => [
        message({
          messageId: "gmail_msg_1",
          threadId: "thread_1",
          receivedAt: new Date("2026-06-17T12:00:00.000Z"),
          attachments: [{
            filename: "po.pdf",
            mimeType: "application/pdf",
            size: 4,
            attachmentId: "att_thread_1",
          }],
        }),
        message({
          messageId: "gmail_msg_2",
          threadId: "thread_1",
          receivedAt: new Date("2026-06-18T12:00:00.000Z"),
          attachments: [{
            filename: "art.png",
            mimeType: "image/png",
            size: 8,
            attachmentId: "att_thread_2",
          }],
        }),
      ]),
      downloadAttachment: jest.fn(async (_mailbox: any, _message: any, attachment: any) => ({
        buffer: Buffer.from(attachment.filename === "art.png" ? "PNG" : "%PDF"),
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
      })),
    };
    (service as any).adapterByProvider.gmail = adapter;
    repo.getRecord.mockResolvedValue({
      ...record,
      rawPayloadJson: { messageId: "gmail_msg_1", threadId: "thread_1", sender: { email: "buyer@example.com" } },
      normalizedPayloadJson: { source: { messageId: "gmail_msg_1", threadId: "thread_1" } },
    });

    const result = await service.manuallyReprocessInboundEmailRecord({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "backfill_attachments",
    });

    expect(adapter.getThreadMessages).toHaveBeenCalledWith(mailbox, "thread_1");
    expect(result.threadMessagesInspected).toBe(2);
    expect(result.providerThreadId).toBe("thread_1");
    expect(result.stored).toBe(2);
    expect(storage.finalizeUpload).toHaveBeenCalledTimes(2);
    expect(createdFiles.map((file) => file.providerMessageId)).toEqual(["gmail_msg_1", "gmail_msg_2"]);
    expect(repo.updateRecordWithEvent).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        rawPayloadJson: expect.objectContaining({
          thread: expect.objectContaining({
            messageCount: 2,
            latestActivityAt: "2026-06-18T12:00:00.000Z",
          }),
        }),
      }),
    }));
  });

  test("manual reprocess fails softly when provider message id is missing", async () => {
    const { service } = serviceHarness();
    (service as any).resolveMailboxForRecord = jest.fn(async () => mailbox);
    (service as any).adapterByProvider.gmail = {
      listRecentMessages: jest.fn(async () => []),
    };
    (service as any).inboundRepository.getRecord.mockResolvedValue({
      ...record,
      sourceRecordId: null,
      sourceMessageId: null,
      rawPayloadJson: {},
      normalizedPayloadJson: {},
    });

    await expect(service.manuallyReprocessInboundEmailRecord({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "backfill_attachments",
    })).rejects.toMatchObject({
      code: "INBOUND_EMAIL_PROVIDER_MESSAGE_ID_MISSING",
      statusCode: 400,
    });
  });
});
