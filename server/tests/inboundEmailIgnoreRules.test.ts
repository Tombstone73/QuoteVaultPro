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

function trustRule(overrides: Record<string, any> = {}) {
  return {
    id: "trust_1",
    organizationId: "org_1",
    enabled: true,
    ruleType: "sender_domain",
    ruleValue: "titan-graphics.com",
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
    listEmailTrustRules: jest.fn(async () => []),
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

function diagnosticRepository(overrides: Record<string, any>) {
  return {
    listEnabledEmailIgnoreRules: jest.fn(async () => []),
    listEnabledEmailTrustRules: jest.fn(async () => []),
    listEmailIgnoreRules: jest.fn(async () => []),
    listEmailTrustRules: jest.fn(async () => []),
    updateEmailIgnoreRule: jest.fn(async (args: Record<string, any>) => ignoreRule(args)),
    updateEmailTrustRule: jest.fn(async (args: Record<string, any>) => trustRule(args)),
    senderEmailMatchesCustomerContact: jest.fn(async () => false),
    senderDomainMatchesCustomerDomain: jest.fn(async () => false),
    ...overrides,
  };
}

function inboundEmailRecord(overrides: Record<string, any> = {}) {
  return {
    id: "inbound_email_1",
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
    reviewRequiredReason: null,
    externalReference: "Public domain order",
    idempotencyKey: "gmail:gmail_msg_1",
    payloadHash: null,
    rawPayloadJson: {
      sender: { name: "Public Sender", email: "orders@yahoo.com" },
      subject: "Public domain order",
    },
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
    ...overrides,
  };
}

describe("inbound sender trust classification", () => {
  test.each(["yahoo.com", "gmail.com", "outlook.com"])(
    "does not trust public customer domain %s in queue records",
    async (domain) => {
      const repo = diagnosticRepository({
        listRecords: jest.fn(async () => [inboundEmailRecord({
          rawPayloadJson: { sender: { email: `orders@${domain}` } },
        })]),
        getQueueSummary: jest.fn(async () => ({ total: 1 })),
        listFiles: jest.fn(async () => []),
        senderDomainMatchesCustomerDomain: jest.fn(async () => true),
      });
      const service = new InboundOrderService(repo as any);

      const result = await service.listInboundOrders({
        organizationId: "org_1",
        filters: { statusGroup: "active", limit: 20, offset: 0 },
      });

      expect(repo.senderDomainMatchesCustomerDomain).not.toHaveBeenCalled();
      expect(result.records[0]).toMatchObject({
        senderTrustStatus: "untrusted",
        trustRuleType: null,
        canAutoDownloadAttachments: false,
      });
    },
  );

  test("trusts an exact known contact email on a public domain", async () => {
    const repo: any = diagnosticRepository({
      listRecords: jest.fn(async () => [inboundEmailRecord({
        rawPayloadJson: { sender: { email: "known.customer@gmail.com" } },
      })]),
      getQueueSummary: jest.fn(async () => ({ total: 1 })),
      listFiles: jest.fn(async () => []),
      senderEmailMatchesCustomerContact: jest.fn(async () => true),
      senderDomainMatchesCustomerDomain: jest.fn(async () => true),
    });
    const service = new InboundOrderService(repo as any);

    const result = await service.listInboundOrders({
      organizationId: "org_1",
      filters: { statusGroup: "active", limit: 20, offset: 0 },
    });

    expect(repo.senderDomainMatchesCustomerDomain).not.toHaveBeenCalled();
    expect(result.records[0]).toMatchObject({
      senderTrustStatus: "trusted_contact",
      trustRuleType: "customer_contact_email",
      canAutoDownloadAttachments: true,
    });
  });

  test("ignore rules override exact known contact email trust", async () => {
    const repo: any = diagnosticRepository({
      listRecords: jest.fn(async () => [inboundEmailRecord({
        rawPayloadJson: { sender: { email: "known.customer@gmail.com" } },
      })]),
      getQueueSummary: jest.fn(async () => ({ total: 1 })),
      listFiles: jest.fn(async () => []),
      listEnabledEmailIgnoreRules: jest.fn(async () => [ignoreRule({
        ruleType: "sender_email_exact",
        ruleValue: "known.customer@gmail.com",
      })]),
      senderEmailMatchesCustomerContact: jest.fn(async () => true),
    });
    const service = new InboundOrderService(repo as any);

    const result = await service.listInboundOrders({
      organizationId: "org_1",
      filters: { statusGroup: "active", limit: 20, offset: 0 },
    });

    expect(repo.senderEmailMatchesCustomerContact).not.toHaveBeenCalled();
    expect(result.records[0]).toMatchObject({
      senderTrustStatus: "ignored",
      trustRuleType: null,
      canAutoDownloadAttachments: false,
    });
  });

  test("blocks public sender domain trust rules", async () => {
    const repo: any = diagnosticRepository({
      createEmailTrustRule: jest.fn(async (values: Record<string, any>) => values),
      listEmailTrustRules: jest.fn(async () => [{
        id: "trust_1",
        ruleType: "sender_domain",
        ruleValue: "example.com",
      }]),
      updateEmailTrustRule: jest.fn(async (values: Record<string, any>) => values),
    });
    const service = new InboundOrderService(repo as any);

    await expect(service.createEmailTrustRule({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_domain",
      ruleValue: "gmail.com",
    })).rejects.toMatchObject({
      statusCode: 400,
      message: "Sender domain gmail.com is a public/free email domain. Trust the exact sender email instead.",
    });

    await expect(service.updateEmailTrustRule({
      organizationId: "org_1",
      id: "trust_1",
      ruleValue: "outlook.com",
    })).rejects.toMatchObject({
      statusCode: 400,
      message: "Sender domain outlook.com is a public/free email domain. Trust the exact sender email instead.",
    });

    expect(repo.createEmailTrustRule).not.toHaveBeenCalled();
    expect(repo.updateEmailTrustRule).not.toHaveBeenCalled();
  });

  test("cannot silently trust an ignored domain", async () => {
    const repo: any = diagnosticRepository({
      listEmailIgnoreRules: jest.fn(async () => [ignoreRule({
        id: "ignore_titan",
        ruleType: "sender_domain",
        ruleValue: "titan-graphics.com",
      })]),
      listEmailTrustRules: jest.fn(async () => []),
      createEmailTrustRule: jest.fn(async (values: Record<string, any>) => trustRule(values)),
    });
    const service = new InboundOrderService(repo as any);

    await expect(service.createEmailTrustRule({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_domain",
      ruleValue: "titan-graphics.com",
    })).rejects.toMatchObject({
      statusCode: 409,
      conflict: expect.objectContaining({
        conflictType: "trust_conflicted_with_ignore",
        currentRuleLocation: "Inbound Ignore Rules",
        conflictingValue: "titan-graphics.com",
      }),
    });
    expect(repo.createEmailTrustRule).not.toHaveBeenCalled();
  });

  test("trusting an ignored domain can intentionally disable the ignore rule", async () => {
    const repo: any = diagnosticRepository({
      listEmailIgnoreRules: jest.fn(async () => [ignoreRule({
        id: "ignore_titan",
        ruleType: "sender_domain",
        ruleValue: "titan-graphics.com",
      })]),
      listEmailTrustRules: jest.fn(async () => []),
      createEmailTrustRule: jest.fn(async (values: Record<string, any>) => trustRule(values)),
    });
    const service = new InboundOrderService(repo as any);

    await service.createEmailTrustRule({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_domain",
      ruleValue: "titan-graphics.com",
      resolveConflict: "disable_conflicting_rule",
    });

    expect(repo.updateEmailIgnoreRule).toHaveBeenCalledWith(expect.objectContaining({
      id: "ignore_titan",
      enabled: false,
    }));
    expect(repo.createEmailTrustRule).toHaveBeenCalledWith(expect.objectContaining({
      ruleType: "sender_domain",
      ruleValue: "titan-graphics.com",
    }));
  });

  test("cannot silently ignore a trusted domain", async () => {
    const repo: any = diagnosticRepository({
      listEmailTrustRules: jest.fn(async () => [trustRule({
        id: "trust_titan",
        ruleType: "sender_domain",
        ruleValue: "titan-graphics.com",
      })]),
      listEmailIgnoreRules: jest.fn(async () => []),
      createEmailIgnoreRule: jest.fn(async (values: Record<string, any>) => ignoreRule(values)),
      getEmailIgnoreRuleByTypeValue: jest.fn(async () => null),
    });
    const service = new InboundOrderService(repo as any);

    await expect(service.createEmailIgnoreRule({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_domain",
      ruleValue: "titan-graphics.com",
    })).rejects.toMatchObject({
      statusCode: 409,
      conflict: expect.objectContaining({
        conflictType: "ignore_conflicted_with_trust",
        currentRuleLocation: "Trusted Inbound Senders",
        conflictingValue: "titan-graphics.com",
      }),
    });
    expect(repo.createEmailIgnoreRule).not.toHaveBeenCalled();
  });

  test("runtime ignore overrides conflicting trust rule and reports suppression", async () => {
    const repo = diagnosticRepository({
      listRecords: jest.fn(async () => [inboundEmailRecord({
        rawPayloadJson: { sender: { email: "orders@titan-graphics.com" } },
      })]),
      getQueueSummary: jest.fn(async () => ({ total: 1 })),
      listFiles: jest.fn(async () => []),
      listEnabledEmailIgnoreRules: jest.fn(async () => [ignoreRule({
        id: "ignore_titan",
        ruleType: "sender_domain",
        ruleValue: "titan-graphics.com",
      })]),
      listEnabledEmailTrustRules: jest.fn(async () => [trustRule({
        id: "trust_titan",
        ruleType: "sender_domain",
        ruleValue: "titan-graphics.com",
      })]),
    });
    const service = new InboundOrderService(repo as any);

    const result = await service.listInboundOrders({
      organizationId: "org_1",
      filters: { statusGroup: "active", limit: 20, offset: 0 },
    });

    expect(result.records[0]).toMatchObject({
      senderTrustStatus: "ignored",
      matchedTrustRuleId: "trust_titan",
      canAutoDownloadAttachments: false,
    });
    expect(result.records[0].trustReason).toContain("trust_suppressed_by_ignore");
  });

  test("legacy conflict detector finds enabled trust and ignore rule conflicts", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      listEmailIgnoreRules: jest.fn(async () => [ignoreRule({
        id: "ignore_titan",
        ruleType: "sender_domain",
        ruleValue: "titan-graphics.com",
      })]),
      listEmailTrustRules: jest.fn(async () => [trustRule({
        id: "trust_titan",
        ruleType: "sender_domain",
        ruleValue: "titan-graphics.com",
      })]),
    }) as any);

    await expect(service.listEmailRuleConflicts({ organizationId: "org_1" })).resolves.toEqual([
      expect.objectContaining({
        ignoreRule: expect.objectContaining({ id: "ignore_titan" }),
        trustRule: expect.objectContaining({ id: "trust_titan" }),
      }),
    ]);
  });
});

describe("inbound email pull diagnostics service", () => {
  test("reports no-subject Gmail messages with explicit processing outcomes", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [{
          id: "mailbox_1",
          provider: "gmail",
          name: "Inbound Gmail",
          emailAddress: "orders@example.com",
          enabled: true,
          isDefault: true,
          lastPulledAt: new Date("2026-06-22T12:00:00.000Z"),
          lastPullStatus: "success",
          lastPullError: null,
          settingsJson: {
            latestPullSummary: {
              gmailList: {
                query: "newer_than:14d",
                labelIds: ["INBOX"],
                maxResults: 50,
                pageCount: 1,
                totalMessageIdsReturned: 1,
                listedMessages: [{
                  providerMessageId: "gmail_no_subject",
                  threadId: "thread_no_subject",
                  subject: null,
                  displaySubject: "(no subject)",
                  senderName: "Shawn Fears",
                  senderEmail: "shawn@brainstormprint.com",
                  receivedAt: "2026-06-22T11:00:00.000Z",
                }],
              },
              processedMessages: [{
                providerMessageId: "gmail_no_subject",
                threadId: "thread_no_subject",
                subject: null,
                displaySubject: "(no subject)",
                senderName: "Shawn Fears",
                senderEmail: "shawn@brainstormprint.com",
                senderDomain: "brainstormprint.com",
                receivedAt: "2026-06-22T11:00:00.000Z",
                processingOutcome: "no_subject_ingested",
                reason: "Created TEMP_INBOUND candidate with safe no-subject fallback.",
                inboundRecordId: "inbound_no_subject",
              }],
              skippedMessages: [],
              ignoredMessages: [],
              failedMessages: [],
            },
          },
        }],
        ignoreRules: [],
        recentCreatedRecords: [],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [],
        recentIgnoredDiagnostics: [],
        subjectRecords: [],
        subjectFiles: [],
        subjectPullDiagnostics: [],
      })),
    }) as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: "no subject",
    });

    expect(result.recentGmailListedMessages[0]).toMatchObject({
      providerMessageId: "gmail_no_subject",
      displaySubject: "(no subject)",
      processingOutcome: "no_subject_ingested",
      reason: "Created TEMP_INBOUND candidate with safe no-subject fallback.",
    });
    expect(result.recentGmailProcessedMessages?.[0]).toMatchObject({
      processingOutcome: "no_subject_ingested",
      inboundRecordId: "inbound_no_subject",
    });
    expect(result.subjectSearch.found).toBe(true);
    expect(result.subjectSearch.matchingGmailListedMessages[0]).toMatchObject({
      displaySubject: "(no subject)",
      processingOutcome: "no_subject_ingested",
    });
    expect(result.subjectSearch.matchingProcessedMessages?.[0]).toMatchObject({
      processingOutcome: "no_subject_ingested",
    });
  });

  test("reports listed Gmail messages that were skipped before entering the queue", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [{
          id: "mailbox_1",
          provider: "gmail",
          name: "Inbound Gmail",
          emailAddress: "orders@example.com",
          enabled: true,
          isDefault: true,
          lastPulledAt: new Date("2026-06-22T12:00:00.000Z"),
          lastPullStatus: "success",
          lastPullError: null,
          settingsJson: {
            latestPullSummary: {
              gmailList: {
                query: "newer_than:14d",
                labelIds: ["INBOX"],
                maxResults: 50,
                pageCount: 1,
                totalMessageIdsReturned: 1,
                listedMessages: [{
                  providerMessageId: "gmail_newsletter",
                  threadId: "thread_newsletter",
                  subject: "Weekly newsletter",
                  displaySubject: "Weekly newsletter",
                  senderName: "Marketing",
                  senderEmail: "marketing@example.com",
                  receivedAt: "2026-06-22T11:00:00.000Z",
                }],
              },
              processedMessages: [{
                providerMessageId: "gmail_newsletter",
                threadId: "thread_newsletter",
                subject: "Weekly newsletter",
                displaySubject: "Weekly newsletter",
                senderName: "Marketing",
                senderEmail: "marketing@example.com",
                senderDomain: "example.com",
                receivedAt: "2026-06-22T11:00:00.000Z",
                processingOutcome: "classification_skipped",
                reason: "Ignored obvious marketing/newsletter email.",
                inboundRecordId: null,
              }],
              skippedMessages: [{
                providerMessageId: "gmail_newsletter",
                threadId: "thread_newsletter",
                subject: "Weekly newsletter",
                displaySubject: "Weekly newsletter",
                senderEmail: "marketing@example.com",
                processingOutcome: "classification_skipped",
                reason: "Ignored obvious marketing/newsletter email.",
                inboundRecordId: null,
              }],
              ignoredMessages: [],
              failedMessages: [],
            },
          },
        }],
        ignoreRules: [],
        recentCreatedRecords: [],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [],
        recentIgnoredDiagnostics: [],
        subjectRecords: [],
        subjectFiles: [],
        subjectPullDiagnostics: [],
      })),
    }) as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: "gmail_newsletter",
    });

    expect(result.subjectSearch.found).toBe(true);
    expect(result.subjectSearch.matchingGmailListedMessages[0]).toMatchObject({
      processingOutcome: "classification_skipped",
      reason: "Ignored obvious marketing/newsletter email.",
    });
    expect(result.subjectSearch.matchingSkippedMessages?.[0]).toMatchObject({
      processingOutcome: "classification_skipped",
    });
  });

  test("reports zero-file email records with raw attachment indicators and body hints", async () => {
    const service = new InboundOrderService(diagnosticRepository({
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
        subjectPullDiagnostics: [],
      })),
    }) as any);

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
        attachmentPartsAttempted: 0,
        downloadAttempts: 0,
        storedFileRowsCreated: 0,
        metadataOnlyRowsCreated: 0,
        skippedReason: "ingestion_not_called",
        ingestionCallStatus: "not_called",
      }),
    }));
    expect(result.subjectSearch.found).toBe(true);
    expect(result.subjectSearch.matchingRecords[0].attachmentCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain("Artwork & Visual PO: attached via Google Drive");
  });

  test("uses only attachment ingestion diagnostics events for pipeline attempt counters", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [],
        ignoreRules: [],
        recentCreatedRecords: [{
          id: "inbound_email_1",
          status: "needs_review",
          reviewOutcome: null,
          subject: "testing the process of an order coming in",
          sourceMessageId: "gmail_msg_1",
          attachmentCount: 0,
          rawAttachmentCount: 3,
          rawAttachmentMetadata: [
            { filename: "a.pdf", attachmentId: "att_a" },
            { filename: "b.pdf", attachmentId: "att_b" },
            { filename: "c.pdf", attachmentId: "att_c" },
          ],
          bodyText: "Attached PO and artwork.",
          bodyHtml: null,
        }],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [{
          inboundRecordId: "inbound_email_1",
          eventType: "email.attachment_stored",
          metadataJson: {
            providerAttachmentId: "att_a",
          },
        }],
        recentIgnoredDiagnostics: [],
        subjectRecords: [],
        subjectFiles: [],
        subjectPullDiagnostics: [],
      })),
    }) as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: null,
    });

    expect(result.recentCreatedInboundRecords[0].attachmentPipelineDiagnostics).toEqual(expect.objectContaining({
      attachmentCandidatesDiscovered: 3,
      attachmentIdsDiscovered: ["att_a", "att_b", "att_c"],
      attachmentPartsAttempted: 0,
      downloadAttempts: 0,
      storedFileRowsCreated: 0,
      metadataOnlyRowsCreated: 0,
      skippedReason: "ingestion_not_called",
      ingestionCallStatus: "not_called",
    }));
  });

  test("includes recent Gmail listed messages in subject diagnostics before app filtering", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [{
          id: "mailbox_1",
          provider: "gmail",
          name: "Orders Inbox",
          emailAddress: "orders@example.com",
          enabled: true,
          isDefault: true,
          lastPulledAt: new Date("2026-06-19T14:00:00.000Z"),
          lastPullStatus: "success",
          lastPullError: null,
          settingsJson: {
            latestPullSummary: {
              gmailList: {
                query: "from:brainstormprint.com newer_than:30d",
                labelIds: ["INBOX"],
                maxResults: 50,
                pageCount: 2,
                totalMessageIdsReturned: 31,
                listedMessages: [{
                  providerMessageId: "gmail_msg_151534",
                  threadId: "thread_151534",
                  subject: "Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
                  senderName: "Shawn Fears",
                  senderEmail: "shawn@brainstormprint.com",
                  receivedAt: "2026-06-19T13:45:00.000Z",
                }],
              },
            },
          },
        }],
        ignoreRules: [],
        recentCreatedRecords: [],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [],
        recentIgnoredDiagnostics: [],
        subjectRecords: [],
        subjectFiles: [],
        subjectPullDiagnostics: [],
      })),
    }) as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: "151534 Titan IYSA",
    });

    expect(result.recentGmailListedMessages).toEqual([
      expect.objectContaining({
        providerMessageId: "gmail_msg_151534",
        subject: "Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
        mailboxEmail: "orders@example.com",
        query: "from:brainstormprint.com newer_than:30d",
        pageCount: 2,
      }),
    ]);
    expect(result.subjectSearch.found).toBe(true);
    expect(result.subjectSearch.matchingGmailListedMessages).toHaveLength(1);
    expect(result.subjectSearch.notReturnedByGmailListQuery).toBe(false);
  });

  test("reports when searched subject was not returned by the latest Gmail list query", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [{
          id: "mailbox_1",
          provider: "gmail",
          name: "Orders Inbox",
          emailAddress: "orders@example.com",
          enabled: true,
          isDefault: true,
          lastPulledAt: new Date("2026-06-19T14:00:00.000Z"),
          lastPullStatus: "success",
          lastPullError: null,
          settingsJson: {
            latestPullSummary: {
              gmailList: {
                query: "newer_than:14d",
                labelIds: ["INBOX"],
                maxResults: 25,
                pageCount: 1,
                totalMessageIdsReturned: 25,
                listedMessages: [{
                  providerMessageId: "gmail_msg_other",
                  threadId: "thread_other",
                  subject: "Some other order",
                  senderName: "Other Sender",
                  senderEmail: "other@example.com",
                  receivedAt: "2026-06-19T13:45:00.000Z",
                }],
              },
            },
          },
        }],
        ignoreRules: [],
        recentCreatedRecords: [],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [],
        recentIgnoredDiagnostics: [],
        subjectRecords: [],
        subjectFiles: [],
        subjectPullDiagnostics: [],
      })),
    }) as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: "Brainstorm Jobs Due for the Week of 6/15 thru 6/19",
    });

    expect(result.subjectSearch.found).toBe(false);
    expect(result.subjectSearch.matchingGmailListedMessages).toEqual([]);
    expect(result.subjectSearch.notReturnedByGmailListQuery).toBe(true);
    expect(result.subjectSearch.gmailListMessage).toBe("Not returned by Gmail list query for latest pull.");
  });

  test("reports an explicit reason when candidates exist without processing attempts", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [],
        ignoreRules: [],
        recentCreatedRecords: [{
          id: "inbound_email_1",
          status: "needs_review",
          reviewOutcome: null,
          subject: "654898 new po",
          sourceMessageId: "gmail_msg_654898",
          attachmentCount: 0,
          rawAttachmentCount: 2,
          rawAttachmentMetadata: [
            { filename: "654898 new po.pdf", attachmentId: "att_654898_po" },
            { filename: "654898 artwork.pdf", attachmentId: "att_654898_art" },
          ],
          bodyText: "Attached PO.",
          bodyHtml: null,
        }],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [{
          inboundRecordId: "inbound_email_1",
          eventType: "attachment_ingestion_call_started",
          metadataJson: {
            providerMessageId: "gmail_msg_654898",
            subject: "654898 new po",
            candidateCount: 2,
            trustStatus: "untrusted",
            attachmentPolicy: "pending_trust",
          },
        }, {
          inboundRecordId: "inbound_email_1",
          eventType: "attachment_ingestion_call_completed",
          metadataJson: {
            providerMessageId: "gmail_msg_654898",
            subject: "654898 new po",
            candidateCount: 2,
            trustStatus: "untrusted",
            attachmentPolicy: "pending_trust",
          },
        }, {
          inboundRecordId: "inbound_email_1",
          eventType: "email.attachment_ingestion_diagnostics",
          metadataJson: {
            attachmentPartsDiscovered: 2,
            attachmentCandidatesDiscovered: 2,
            attachmentIdsDiscovered: ["att_654898_po", "att_654898_art"],
            attachmentPartsAttempted: 0,
            downloadAttempts: 0,
            storedRowsCreated: 0,
            metadataOnlyRowsCreated: 0,
            safetyDecisions: [{
              filename: "654898 new po.pdf",
              attachmentState: "pending_trust",
              downloadAllowed: false,
              reason: "Sender is not trusted. Attachment metadata captured pending staff trust decision.",
            }],
          },
        }],
        recentIgnoredDiagnostics: [],
        subjectRecords: [],
        subjectFiles: [],
        subjectPullDiagnostics: [],
      })),
    }) as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: "654898 new po",
    });

    expect(result.recentCreatedInboundRecords[0].attachmentPipelineDiagnostics).toEqual(expect.objectContaining({
      attachmentCandidatesDiscovered: 2,
      attachmentPartsAttempted: 0,
      skippedReason: "pending_trust",
      ingestionCallStatus: "completed",
    }));
  });

  test("reports failed attachment ingestion calls with safe error text", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [],
        ignoreRules: [],
        recentCreatedRecords: [{
          id: "inbound_email_1",
          status: "needs_review",
          reviewOutcome: null,
          subject: "654898 new po",
          sourceMessageId: "gmail_msg_654898",
          attachmentCount: 0,
          rawAttachmentCount: 1,
          rawAttachmentMetadata: [{ filename: "654898 new po.pdf", attachmentId: "att_654898_po" }],
          bodyText: "Attached PO.",
          bodyHtml: null,
        }],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [{
          inboundRecordId: "inbound_email_1",
          eventType: "attachment_ingestion_call_started",
          metadataJson: {
            providerMessageId: "gmail_msg_654898",
            subject: "654898 new po",
            candidateCount: 1,
            trustStatus: "trusted_sender",
            attachmentPolicy: "auto_download_allowed",
          },
        }, {
          inboundRecordId: "inbound_email_1",
          eventType: "attachment_ingestion_call_failed",
          metadataJson: {
            providerMessageId: "gmail_msg_654898",
            subject: "654898 new po",
            candidateCount: 1,
            trustStatus: "trusted_sender",
            attachmentPolicy: "auto_download_allowed",
            errorMessage: "Injected ingestion failure",
          },
        }],
        recentIgnoredDiagnostics: [],
        subjectRecords: [],
        subjectFiles: [],
        subjectPullDiagnostics: [],
      })),
    }) as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: "654898 new po",
    });

    expect(result.recentCreatedInboundRecords[0].attachmentPipelineDiagnostics).toEqual(expect.objectContaining({
      attachmentCandidatesDiscovered: 1,
      skippedReason: "attachment_ingestion_call_failed",
      ingestionCallStatus: "failed",
      ingestionCallError: "Injected ingestion failure",
      ingestionCallEvents: expect.arrayContaining([
        expect.objectContaining({ eventType: "attachment_ingestion_call_started" }),
        expect.objectContaining({ eventType: "attachment_ingestion_call_failed" }),
      ]),
    }));
  });

  test("reports completed attachment ingestion call audits", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [],
        ignoreRules: [],
        recentCreatedRecords: [{
          id: "inbound_email_1",
          status: "needs_review",
          reviewOutcome: null,
          subject: "654898 new po",
          sourceMessageId: "gmail_msg_654898",
          attachmentCount: 1,
          rawAttachmentCount: 1,
          rawAttachmentMetadata: [{ filename: "654898 new po.pdf", attachmentId: "att_654898_po" }],
          bodyText: "Attached PO.",
          bodyHtml: null,
        }],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [{
          inboundRecordId: "inbound_email_1",
          eventType: "attachment_ingestion_call_started",
          metadataJson: {
            providerMessageId: "gmail_msg_654898",
            subject: "654898 new po",
            candidateCount: 1,
            trustStatus: "trusted_sender",
            attachmentPolicy: "auto_download_allowed",
          },
        }, {
          inboundRecordId: "inbound_email_1",
          eventType: "attachment_ingestion_call_completed",
          metadataJson: {
            providerMessageId: "gmail_msg_654898",
            subject: "654898 new po",
            candidateCount: 1,
            trustStatus: "trusted_sender",
            attachmentPolicy: "auto_download_allowed",
            diagnostics: {
              attachmentPartsAttempted: 1,
              attachmentRowsCreated: 1,
              storedRowsCreated: 1,
              metadataOnlyRowsCreated: 0,
              downloadAttempts: 1,
              downloadSuccesses: 1,
              downloadFailures: 0,
            },
          },
        }],
        recentIgnoredDiagnostics: [],
        subjectRecords: [],
        subjectFiles: [],
        subjectPullDiagnostics: [],
      })),
    }) as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: "654898 new po",
    });

    expect(result.recentCreatedInboundRecords[0].attachmentPipelineDiagnostics).toEqual(expect.objectContaining({
      attachmentCandidatesDiscovered: 1,
      attachmentPartsAttempted: 1,
      downloadAttempts: 1,
      storedFileRowsCreated: 1,
      ingestionCallStatus: "completed",
      skippedReason: null,
    }));
  });

  test("uses subject-specific attachment diagnostics events for searched records", async () => {
    const service = new InboundOrderService(diagnosticRepository({
      getEmailPullDiagnostics: jest.fn(async () => ({
        mailboxes: [],
        ignoreRules: [],
        recentCreatedRecords: [],
        recentFiles: [],
        recentFailedDiagnostics: [],
        recentPullDiagnostics: [],
        recentIgnoredDiagnostics: [],
        subjectRecords: [{
          id: "inbound_email_1",
          status: "needs_review",
          reviewOutcome: null,
          subject: "Order for Back Lit Signs for Family Church please. 2 different sizes",
          sourceMessageId: "gmail_msg_1",
          attachmentCount: 0,
          rawAttachmentCount: 3,
          rawAttachmentMetadata: [
            { filename: "backlit-a.pdf", attachmentId: "att_a" },
            { filename: "backlit-b.pdf", attachmentId: "att_b" },
            { filename: "po.pdf", attachmentId: "att_po" },
          ],
          bodyText: "Attached artwork and PO.",
          bodyHtml: null,
        }],
        subjectFiles: [],
        subjectPullDiagnostics: [{
          inboundRecordId: "inbound_email_1",
          eventType: "email.attachment_ingestion_diagnostics",
          metadataJson: {
            attachmentPartsDiscovered: 3,
            attachmentCandidatesDiscovered: 3,
            attachmentIdsDiscovered: ["att_a", "att_b", "att_po"],
            attachmentPartsAttempted: 3,
            downloadAttempts: 2,
            downloadSuccesses: 2,
            downloadFailures: 0,
            storedRowsCreated: 2,
            metadataOnlyRowsCreated: 1,
          },
        }],
      })),
    }) as any);

    const result = await service.getEmailPullDiagnostics({
      organizationId: "org_1",
      subject: "Order for Back Lit Signs for Family Church please. 2 different sizes",
    });

    expect(result.subjectSearch.matchingRecords[0].attachmentPipelineDiagnostics).toEqual(expect.objectContaining({
      attachmentCandidatesDiscovered: 3,
      attachmentPartsAttempted: 3,
      downloadAttempts: 2,
      storedFileRowsCreated: 2,
      metadataOnlyRowsCreated: 1,
    }));
  });
});
