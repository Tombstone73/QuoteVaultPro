import { describe, expect, jest, test } from "@jest/globals";

import {
  classifyInboundEmailAttachment,
  matchInboundEmailIgnoreRule,
  type InboundEmailProviderMessage,
} from "../services/inboundEmailIngestionService";

jest.mock("../services/pricing/PricingService", () => ({
  priceLineItem: jest.fn(),
}));

import {
  InboundOrderService,
  InboundOrderTransitionError,
} from "../services/inboundOrders/InboundOrderService";

const baseMessage: InboundEmailProviderMessage = {
  provider: "gmail",
  messageId: "msg_1",
  threadId: "thread_1",
  senderName: "Processor Notifications",
  senderEmail: "notifications@payments.example.com",
  subject: "Payment Received",
  receivedAt: new Date("2026-06-17T12:00:00.000Z"),
  bodyText: "A payment was received.",
  bodyHtml: null,
  attachments: [],
};

describe("inbound email ignore rule matching", () => {
  test("matches exact sender email case-insensitively", () => {
    expect(matchInboundEmailIgnoreRule({
      ruleType: "sender_email_exact",
      ruleValue: "NOTIFICATIONS@PAYMENTS.EXAMPLE.COM",
    }, baseMessage)).toBe(true);
  });

  test("matches sender domain only against the email domain", () => {
    expect(matchInboundEmailIgnoreRule({
      ruleType: "sender_domain",
      ruleValue: "payments.example.com",
    }, baseMessage)).toBe(true);
    expect(matchInboundEmailIgnoreRule({
      ruleType: "sender_domain",
      ruleValue: "example.com",
    }, baseMessage)).toBe(false);
  });

  test("matches exact subject and subject contains rules", () => {
    expect(matchInboundEmailIgnoreRule({
      ruleType: "subject_exact",
      ruleValue: "payment received",
    }, baseMessage)).toBe(true);
    expect(matchInboundEmailIgnoreRule({
      ruleType: "subject_contains",
      ruleValue: "received",
    }, baseMessage)).toBe(true);
  });

  test("does not match unrelated sender or subject values", () => {
    expect(matchInboundEmailIgnoreRule({
      ruleType: "sender_email_exact",
      ruleValue: "orders@example.com",
    }, baseMessage)).toBe(false);
    expect(matchInboundEmailIgnoreRule({
      ruleType: "subject_contains",
      ruleValue: "new submission from",
    }, baseMessage)).toBe(false);
  });
});

function ignoreRule(overrides: Record<string, any> = {}) {
  return {
    id: "rule_1",
    organizationId: "org_1",
    enabled: true,
    ruleType: "sender_email_exact",
    ruleValue: "notifications@example.com",
    notes: null,
    matchCount: 0,
    lastMatchedAt: null,
    createdByUserId: "user_1",
    createdAt: new Date("2026-06-17T12:00:00.000Z"),
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}

function makeIgnoreRuleRepo(overrides: Record<string, any> = {}) {
  return {
    listEmailIgnoreRules: jest.fn(async () => []),
    getEmailIgnoreRuleByTypeValue: jest.fn(async () => null),
    createEmailIgnoreRule: jest.fn(async (values: Record<string, any>) => ignoreRule(values)),
    updateEmailIgnoreRule: jest.fn(async (values: Record<string, any>) => ignoreRule(values)),
    deleteEmailIgnoreRule: jest.fn(),
    ...overrides,
  };
}

describe("inbound email ignore rule management", () => {
  test("normalizes sender email values when creating manual rules", async () => {
    const repo = makeIgnoreRuleRepo();
    const service = new InboundOrderService(repo as any);

    const created = await service.createEmailIgnoreRule({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_email_exact",
      ruleValue: "  Notifications@Example.COM  ",
      notes: "Processor notification",
      enabled: true,
    });

    expect(created.ruleValue).toBe("notifications@example.com");
    expect(repo.createEmailIgnoreRule).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      ruleType: "sender_email_exact",
      ruleValue: "notifications@example.com",
      notes: "Processor notification",
      enabled: true,
    }));
  });

  test("normalizes sender domains and rejects blank manual rule values", async () => {
    const repo = makeIgnoreRuleRepo();
    const service = new InboundOrderService(repo as any);

    await service.createEmailIgnoreRule({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_domain",
      ruleValue: "  Payments.Example.COM  ",
      enabled: false,
    });

    expect(repo.createEmailIgnoreRule).toHaveBeenCalledWith(expect.objectContaining({
      ruleValue: "payments.example.com",
      enabled: false,
    }));

    await expect(service.createEmailIgnoreRule({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "subject_contains",
      ruleValue: "   ",
    })).rejects.toMatchObject({
      statusCode: 400,
      message: "Rule value is required.",
    });
  });

  test("rejects duplicate manual rules for the same organization, type, and value", async () => {
    const repo = makeIgnoreRuleRepo({
      getEmailIgnoreRuleByTypeValue: jest.fn(async () => ignoreRule()),
    });
    const service = new InboundOrderService(repo as any);

    await expect(service.createEmailIgnoreRule({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_email_exact",
      ruleValue: "notifications@example.com",
    })).rejects.toBeInstanceOf(InboundOrderTransitionError);
    await expect(service.createEmailIgnoreRule({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_email_exact",
      ruleValue: "notifications@example.com",
    })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(repo.createEmailIgnoreRule).not.toHaveBeenCalled();
  });

  test("updates rule type, normalized value, notes, and enabled state", async () => {
    const current = ignoreRule({
      id: "rule_1",
      ruleType: "subject_contains",
      ruleValue: "payment received",
      enabled: true,
    });
    const repo = makeIgnoreRuleRepo({
      listEmailIgnoreRules: jest.fn(async () => [current]),
      updateEmailIgnoreRule: jest.fn(async (values: Record<string, any>) => ignoreRule({
        ...current,
        ...values,
      })),
    });
    const service = new InboundOrderService(repo as any);

    await service.updateEmailIgnoreRule({
      organizationId: "org_1",
      id: "rule_1",
      ruleType: "sender_domain",
      ruleValue: "  Payments.Example.COM  ",
      notes: "Disable processor notices",
      enabled: false,
    });

    expect(repo.updateEmailIgnoreRule).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      id: "rule_1",
      ruleType: "sender_domain",
      ruleValue: "payments.example.com",
      notes: "Disable processor notices",
      enabled: false,
    }));
  });
});

describe("inbound email attachment classification", () => {
  test("classifies obvious PO PDFs as safe PO candidates", () => {
    expect(classifyInboundEmailAttachment({
      filename: "Purchase Order 151661.pdf",
      mimeType: "application/pdf",
    })).toEqual(expect.objectContaining({
      role: "po",
      poCandidate: true,
      safeToDownload: true,
    }));
  });

  test("classifies artwork PDFs as safe artwork candidates", () => {
    expect(classifyInboundEmailAttachment({
      filename: "storefront artwork.pdf",
      mimeType: "application/pdf",
    })).toEqual(expect.objectContaining({
      role: "artwork",
      artworkCandidate: true,
      safeToDownload: true,
    }));
  });

  test("classifies unsupported files as metadata-only attachments", () => {
    expect(classifyInboundEmailAttachment({
      filename: "calendar.invite",
      mimeType: "application/octet-stream",
    })).toEqual(expect.objectContaining({
      role: "other",
      poCandidate: false,
      safeToDownload: false,
    }));
  });
});

describe("inbound email pull diagnostics service", () => {
  test("reports zero-file email records with raw attachment indicators and body hints", async () => {
    const service = new InboundOrderService({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [],
        ignoreRules: [],
        recentCreatedRecords: [{
          id: "inbound_email_1",
          status: "needs_review",
          reviewOutcome: null,
          subject: "***RUSH*** Robert - Personal Golf Outing Materials",
          senderName: "Audrey Powell",
          senderEmail: "prepress@offsethouse.example",
          sourceMessageId: "gmail_msg_1",
          sourceThreadId: "thread_1",
          receivedAt: new Date("2026-06-18T12:00:00.000Z"),
          attachmentCount: 0,
          rawAttachmentCount: 2,
          normalizedAttachmentCount: 2,
          rawAttachmentMetadata: [{ filename: "visual-po.pdf", attachmentId: "att_1" }],
          bodyText: "Artwork & Visual PO: attached via Google Drive https://drive.google.com/file/d/example",
          bodyHtml: null,
        }],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [],
        recentIgnoredDiagnostics: [],
        subjectRecords: [{
          id: "inbound_email_1",
          status: "needs_review",
          reviewOutcome: null,
          subject: "***RUSH*** Robert - Personal Golf Outing Materials",
          sourceMessageId: "gmail_msg_1",
          sourceThreadId: "thread_1",
          attachmentCount: 0,
          rawAttachmentCount: 2,
          normalizedAttachmentCount: 2,
          rawAttachmentMetadata: [{ filename: "visual-po.pdf", attachmentId: "att_1" }],
          bodyText: "Artwork & Visual PO: attached via Google Drive https://drive.google.com/file/d/example",
          bodyHtml: null,
        }],
        subjectFiles: [],
      })),
    } as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: "***RUSH*** Robert",
    });

    expect(result.recentCreatedInboundRecords[0]).toEqual(expect.objectContaining({
      attachmentCount: 0,
      rawGmailPayloadAttachmentIndicators: expect.objectContaining({
        rawAttachmentCount: 2,
        normalizedAttachmentCount: 2,
      }),
      attachmentHints: expect.objectContaining({
        mentionsAttached: true,
        mentionsPo: true,
        mentionsArtwork: true,
        hasGoogleDriveLinks: true,
      }),
      attachmentPipelineDiagnostics: expect.objectContaining({
        gmailPartsDiscovered: 2,
        attachmentCandidatesDiscovered: 2,
        attachmentIdsDiscovered: ["att_1"],
        downloadAttempts: 0,
        storedFileRowsCreated: 0,
        metadataOnlyRowsCreated: 0,
      }),
    }));
    expect(result.subjectSearch.found).toBe(true);
    expect(result.subjectSearch.matchingRecords[0].attachmentCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain("Artwork & Visual PO: attached via Google Drive");
  });
});
