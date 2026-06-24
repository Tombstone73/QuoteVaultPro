import { describe, expect, jest, test } from "@jest/globals";

import {
  classifyInboundEmailAttachment,
  classifyInboundEmailAttachmentForMessage,
  classifyInboundEmailForReview,
  extractGmailBodyAndAttachments,
  GmailInboundEmailAdapter,
  type InboundEmailProviderMessage,
} from "../services/inboundEmailIngestionService";

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function message(overrides: Partial<InboundEmailProviderMessage>): InboundEmailProviderMessage {
  return {
    provider: "gmail",
    messageId: "msg_1",
    threadId: "thread_1",
    senderName: "Ada Lovelace",
    senderEmail: "ada@example.com",
    subject: null,
    receivedAt: new Date("2026-06-16T12:00:00.000Z"),
    bodyText: null,
    bodyHtml: null,
    attachments: [],
    ...overrides,
  };
}

function mailbox(overrides: Record<string, unknown> = {}) {
  return {
    id: "mailbox_1",
    organizationId: "org_1",
    sourceId: null,
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
    createdByUserId: null,
    createdAt: new Date("2026-06-18T12:00:00.000Z"),
    updatedAt: new Date("2026-06-18T12:00:00.000Z"),
    ...overrides,
  } as any;
}

describe("inbound email ingestion classifier", () => {
  test("classifies quote request wording", () => {
    const result = classifyInboundEmailForReview(message({
      subject: "Can you quote this?",
      bodyText: "How much for 3 PVC signs? Can you price these?",
    }));

    expect(result).toMatchObject({ ignored: false, intent: "QUOTE_REQUEST" });
  });

  test("classifies order request wording and PO attachments", () => {
    const result = classifyInboundEmailForReview(message({
      subject: "PO attached",
      bodyText: "Please proceed with this run.",
      attachments: [{ filename: "PO-123.pdf", mimeType: "application/pdf", size: 1200 }],
    }));

    expect(result).toMatchObject({ ignored: false, intent: "ORDER_REQUEST" });
  });

  test("does not classify tiny inline signature GIFs as artwork", () => {
    const classification = classifyInboundEmailAttachmentForMessage({
      filename: "image001.gif",
      mimeType: "image/gif",
      size: 2345,
      contentDisposition: "inline",
      contentId: "<logo-signature>",
    } as any, message({ subject: "PO attached" }));

    expect(classification).toMatchObject({
      role: "other",
      poCandidate: false,
      artworkCandidate: false,
    });
  });

  test("classifies PO PDFs by filename", () => {
    const classification = classifyInboundEmailAttachment({
      filename: "PO_151661.pdf",
      mimeType: "application/pdf",
    });

    expect(classification).toMatchObject({
      role: "po",
      poCandidate: true,
      artworkCandidate: false,
      safeToDownload: true,
      classification: expect.objectContaining({
        classification: "PO",
      }),
    });
  });

  test("classifies PO PDFs by extracted text", () => {
    const classification = classifyInboundEmailAttachment({
      filename: "customer-document.pdf",
      mimeType: "application/pdf",
      extractedText: "Purchase Order PO # 151661 Bill To Titan Graphics Ship To Main Office",
    });

    expect(classification).toMatchObject({
      role: "po",
      poCandidate: true,
      classification: expect.objectContaining({
        classification: "PO",
        reasons: expect.arrayContaining([
          expect.stringContaining("PDF text contains purchase-order language"),
        ]),
      }),
    });
  });

  test("classifies artwork by filename and production extensions", () => {
    expect(classifyInboundEmailAttachment({
      filename: "final-banner-art.pdf",
      mimeType: "application/pdf",
    })).toMatchObject({
      role: "artwork",
      artworkCandidate: true,
      classification: expect.objectContaining({ classification: "ARTWORK" }),
    });

    for (const filename of ["logo.ai", "press-file.eps", "decal.svg"]) {
      expect(classifyInboundEmailAttachment({
        filename,
        mimeType: "application/octet-stream",
      })).toMatchObject({
        role: "artwork",
        poCandidate: false,
        artworkCandidate: true,
        classification: expect.objectContaining({ classification: "ARTWORK" }),
      });
    }
  });

  test("classifies JPG and PNG artwork unless they are inline signature-sized images", () => {
    expect(classifyInboundEmailAttachment({
      filename: "customer-logo.png",
      mimeType: "image/png",
      size: 250_000,
    })).toMatchObject({
      role: "artwork",
      artworkCandidate: true,
      classification: expect.objectContaining({ classification: "ARTWORK" }),
    });

    expect(classifyInboundEmailAttachmentForMessage({
      filename: "signature-logo.png",
      mimeType: "image/png",
      size: 12_000,
      contentDisposition: "inline",
      contentId: "<image001>",
    } as any, message({ subject: "New order" }))).toMatchObject({
      role: "other",
      poCandidate: false,
      artworkCandidate: false,
      classification: expect.objectContaining({ classification: "IGNORE_INLINE" }),
    });
  });

  test("classifies weak mixed-signal PDFs as reference", () => {
    const classification = classifyInboundEmailAttachment({
      filename: "final-banner-art.pdf",
      mimeType: "application/pdf",
      sourceHint: "Email body references PO near artwork.",
    });

    expect(classification).toMatchObject({
      role: "reference",
      poCandidate: false,
      artworkCandidate: false,
      classification: expect.objectContaining({ classification: "REFERENCE" }),
    });
  });

  test("does not assign PO PDFs as artwork or artwork files as PO by default", () => {
    expect(classifyInboundEmailAttachment({
      filename: "Purchase Order 151661.pdf",
      mimeType: "application/pdf",
    })).toMatchObject({
      role: "po",
      artworkCandidate: false,
    });

    expect(classifyInboundEmailAttachment({
      filename: "PO-export.ai",
      mimeType: "application/postscript",
    })).toMatchObject({
      role: "artwork",
      poCandidate: false,
      classification: expect.objectContaining({ classification: "ARTWORK" }),
    });
  });

  test("classifies empty-body single PDF decal/job emails as artwork", () => {
    const attachment = {
      filename: "2027 football senior decals.pdf",
      mimeType: "application/pdf",
      size: 540_000,
    };
    const classification = classifyInboundEmailAttachmentForMessage(attachment, message({
      subject: "PSV Decals with premask",
      bodyText: null,
      bodyHtml: null,
      attachments: [attachment],
    }));

    expect(classification).toMatchObject({
      role: "artwork",
      poCandidate: false,
      artworkCandidate: true,
      classification: expect.objectContaining({
        classification: "ARTWORK",
        reasons: expect.arrayContaining([
          "subject contains product or job terms",
          "filename contains artwork or production terms",
          "single customer attachment with empty body",
        ]),
      }),
    });
  });

  test("keeps empty-body single PDF PO filenames classified as PO", () => {
    const attachment = {
      filename: "PO_12345.pdf",
      mimeType: "application/pdf",
      size: 120_000,
    };
    const classification = classifyInboundEmailAttachmentForMessage(attachment, message({
      subject: "PSV Decals with premask",
      bodyText: "",
      bodyHtml: "",
      attachments: [attachment],
    }));

    expect(classification).toMatchObject({
      role: "po",
      poCandidate: true,
      artworkCandidate: false,
      classification: expect.objectContaining({ classification: "PO" }),
    });
  });

  test("keeps empty-body single PDF purchase-order text classified as PO", () => {
    const classification = classifyInboundEmailAttachment({
      filename: "2027 football senior decals.pdf",
      mimeType: "application/pdf",
      size: 120_000,
      subject: "PSV Decals with premask",
      bodyText: "",
      bodyHtml: "",
      customerAttachmentCount: 1,
      extractedText: "Purchase Order PO # 12345 Bill To Graphic Solutions Ship To Titan Graphics",
    });

    expect(classification).toMatchObject({
      role: "po",
      poCandidate: true,
      artworkCandidate: false,
      classification: expect.objectContaining({ classification: "PO" }),
    });
  });

  test("classifies empty-body single ambiguous PDFs as reference", () => {
    const attachment = {
      filename: "customer-details.pdf",
      mimeType: "application/pdf",
      size: 84_000,
    };
    const classification = classifyInboundEmailAttachmentForMessage(attachment, message({
      subject: "Files attached",
      bodyText: "",
      bodyHtml: "",
      attachments: [attachment],
    }));

    expect(classification).toMatchObject({
      role: "reference",
      poCandidate: false,
      artworkCandidate: false,
      classification: expect.objectContaining({ classification: "REFERENCE" }),
    });
  });

  test("keeps ambiguous request candidates as unknown", () => {
    const result = classifyInboundEmailForReview(message({
      subject: "Sign question",
      bodyText: "We may need some signs for a booth next month.",
    }));

    expect(result).toMatchObject({ ignored: false, intent: "UNKNOWN" });
  });

  test("ignores obvious newsletter or marketing email", () => {
    const result = classifyInboundEmailForReview(message({
      subject: "Weekly newsletter",
      bodyText: "Unsubscribe from this limited time offer at any time.",
    }));

    expect(result).toMatchObject({ ignored: true, intent: "NEWSLETTER_SPAM" });
  });

  test("keeps known customer non-order communications in the inbound queue", () => {
    const result = classifyInboundEmailForReview(message({
      senderName: "Shawn Fears",
      senderEmail: "shawn@brainstormprint.com",
      subject: "Brainstorm Jobs Due for the Week of 6/15 thru 6/19",
      bodyText: "Here is the weekly job list and schedule updates for the jobs due this week.",
    }), {
      senderTrusted: true,
      trustSource: "customer_contact_email",
      trustReason: "Sender email matches an active customer contact.",
    });

    expect(result).toMatchObject({
      ignored: false,
      intent: "CUSTOMER_COMMUNICATION",
      reason: "Known customer/contact communication needs staff review.",
      crmInfluence: expect.stringContaining("trusted contact"),
    });
  });

  test("keeps weak newsletter wording from a known customer as customer communication", () => {
    const result = classifyInboundEmailForReview(message({
      senderName: "Shawn Fears",
      senderEmail: "shawn@brainstormprint.com",
      subject: "Weekly newsletter",
      bodyText: "Weekly production coordination and delivery schedule updates.",
    }), {
      senderTrusted: true,
      trustSource: "customer_contact_email",
      trustReason: "Sender email matches an active customer contact.",
    });

    expect(result).toMatchObject({
      ignored: false,
      intent: "CUSTOMER_COMMUNICATION",
      reason: "Known customer/contact communication contained weak newsletter wording, so it remains available for staff review.",
    });
  });

  test("classifies known customer order and quote emails by request intent", () => {
    const trustContext = {
      senderTrusted: true,
      trustSource: "customer_contact_email" as const,
      trustReason: "Sender email matches an active customer contact.",
    };

    expect(classifyInboundEmailForReview(message({
      senderEmail: "shawn@brainstormprint.com",
      subject: "Purchase order",
      bodyText: "Please proceed. Purchase order attached.",
    }), trustContext)).toMatchObject({ ignored: false, intent: "ORDER_REQUEST" });

    expect(classifyInboundEmailForReview(message({
      senderEmail: "shawn@brainstormprint.com",
      subject: "Can you quote yard signs?",
      bodyText: "Can you price this job for us?",
    }), trustContext)).toMatchObject({ ignored: false, intent: "QUOTE_REQUEST" });
  });

  test("classifies explicit New Order feather flag email as order request", () => {
    const result = classifyInboundEmailForReview(message({
      subject: "New Order - Feather Flags",
      bodyText: "Can you send us an invoice for 2 Feather Flags that are 14' Double Sided with Ground spike base. Attached are the files.",
      attachments: [{ filename: "feather-flag-art.pdf", mimeType: "application/pdf", size: 120_000 }],
    }));

    expect(result).toMatchObject({
      ignored: false,
      intent: "ORDER_REQUEST",
      reasons: expect.arrayContaining([
        "subject contains \"New Order\"",
        "body asks to send an invoice for a product",
        "quantity detected",
        "product phrase detected",
        "specs detected",
        "attachments present",
      ]),
    });
  });

  test("classifies explicit New Order banner email with quantity and specs as order request", () => {
    const result = classifyInboundEmailForReview(message({
      subject: "New Order - Banners",
      bodyText: "Please print 3 vinyl banners 24x36 double sided with grommets. Attached are the files.",
      attachments: [{ filename: "banner-art.pdf", mimeType: "application/pdf", size: 90_000 }],
    }));

    expect(result).toMatchObject({
      ignored: false,
      intent: "ORDER_REQUEST",
      reasons: expect.arrayContaining([
        "subject contains \"New Order\"",
        "quantity detected",
        "specs detected",
      ]),
    });
  });

  test("classifies reorder subject as order request using existing intent enum", () => {
    const result = classifyInboundEmailForReview(message({
      subject: "Reorder - Yard Signs",
      bodyText: "Same as last time, 25 yard signs 18x24 with stakes.",
    }));

    expect(result).toMatchObject({
      ignored: false,
      intent: "ORDER_REQUEST",
      reasons: expect.arrayContaining(["subject contains reorder"]),
    });
  });

  test("keeps order status and support subjects as customer communication", () => {
    expect(classifyInboundEmailForReview(message({
      subject: "Order Status",
      bodyText: "Can you send a status update?",
    }))).toMatchObject({
      ignored: false,
      intent: "CUSTOMER_COMMUNICATION",
      reasons: expect.arrayContaining(["status request detected"]),
    });

    expect(classifyInboundEmailForReview(message({
      subject: "Where is my order?",
      bodyText: "Has this shipped yet?",
    }))).toMatchObject({
      ignored: false,
      intent: "CUSTOMER_COMMUNICATION",
      reasons: expect.arrayContaining(["order status request detected"]),
    });

    expect(classifyInboundEmailForReview(message({
      subject: "Cancel order",
      bodyText: "Please cancel this order.",
    }))).toMatchObject({
      ignored: false,
      intent: "CUSTOMER_COMMUNICATION",
      reasons: expect.arrayContaining(["cancellation request detected"]),
    });
  });

  test("keeps invoice resend email as customer communication", () => {
    const result = classifyInboundEmailForReview(message({
      subject: "Invoice #12345",
      bodyText: "Can you resend the invoice for our records?",
    }));

    expect(result).toMatchObject({
      ignored: false,
      intent: "CUSTOMER_COMMUNICATION",
      reasons: expect.arrayContaining(["invoice resend request detected"]),
    });
  });

  test("treats invoice-for-product language as order intent", () => {
    const result = classifyInboundEmailForReview(message({
      subject: "Feather Flags",
      bodyText: "Can you send us an invoice for 2 Feather Flags that are 14' Double Sided with Ground spike base. Attached are the files.",
    }));

    expect(result).toMatchObject({
      ignored: false,
      intent: "ORDER_REQUEST",
      reasons: expect.arrayContaining([
        "body asks to send an invoice for a product",
        "quantity detected",
        "product phrase detected",
        "specs detected",
        "attachments present",
      ]),
    });
  });

  test("known customer marketing edge case still requires strong spam evidence", () => {
    const result = classifyInboundEmailForReview(message({
      senderEmail: "shawn@brainstormprint.com",
      subject: "Newsletter",
      bodyText: "Unsubscribe from this limited time offer. Sponsored marketing webinar inside.",
    }), {
      senderTrusted: true,
      trustSource: "customer_contact_email",
      trustReason: "Sender email matches an active customer contact.",
    });

    expect(result).toMatchObject({
      ignored: true,
      intent: "NEWSLETTER_SPAM",
      reason: "Strong marketing/newsletter indicators detected despite known customer relationship.",
    });
  });
});

describe("Gmail MIME attachment extraction", () => {
  test("captures a top-level Gmail attachment part", () => {
    const result = extractGmailBodyAndAttachments({
      mimeType: "multipart/mixed",
      parts: [
        {
          partId: "0",
          mimeType: "text/plain",
          body: { data: base64Url("Please see attached PO.") },
        },
        {
          partId: "1",
          filename: "Purchase Order 151753.pdf",
          mimeType: "application/pdf",
          headers: [{ name: "Content-Disposition", value: "attachment; filename=\"Purchase Order 151753.pdf\"" }],
          body: { attachmentId: "att_po", size: 1200 },
        },
      ],
    });

    expect(result.text).toBe("Please see attached PO.");
    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: "Purchase Order 151753.pdf",
        mimeType: "application/pdf",
        attachmentId: "att_po",
        contentDisposition: "attachment; filename=\"Purchase Order 151753.pdf\"",
        detectedBy: expect.arrayContaining(["filename", "attachmentId", "content-disposition:attachment", "mimeType"]),
      }),
    ]);
  });

  test("recursively captures nested multipart attachments", () => {
    const result = extractGmailBodyAndAttachments({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: base64Url("Artwork & Visual PO: attached") } },
            { mimeType: "text/html", body: { data: base64Url("<p>Artwork & Visual PO: attached</p>") } },
            {
              partId: "0.2",
              filename: "visual-po.pdf",
              mimeType: "application/pdf",
              headers: [{ name: "Content-Disposition", value: "attachment; filename=\"visual-po.pdf\"" }],
              body: { attachmentId: "nested_att", size: 9800 },
            },
          ],
        },
      ],
    });

    expect(result.text).toBe("Artwork & Visual PO: attached");
    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: "visual-po.pdf",
        attachmentId: "nested_att",
        partId: "0.2",
      }),
    ]);
  });

  test("captures inline attachment parts with filenames and attachment ids", () => {
    const result = extractGmailBodyAndAttachments({
      mimeType: "multipart/related",
      parts: [
        { mimeType: "text/html", body: { data: base64Url("<img src=\"cid:proof-1\">") } },
        {
          partId: "1",
          filename: "proof.png",
          mimeType: "image/png",
          headers: [
            { name: "Content-Disposition", value: "inline; filename=\"proof.png\"" },
            { name: "Content-ID", value: "<proof-1>" },
          ],
          body: { attachmentId: "inline_att", size: 2048 },
        },
      ],
    });

    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: "proof.png",
        mimeType: "image/png",
        attachmentId: "inline_att",
        contentId: "<proof-1>",
        detectedBy: expect.arrayContaining(["content-disposition:inline", "content-id"]),
      }),
    ]);
  });

  test("recursively captures attachment parts inside forwarded message payloads", () => {
    const result = extractGmailBodyAndAttachments({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: base64Url("Forwarded order below.") } },
        {
          mimeType: "message/rfc822",
          parts: [
            {
              mimeType: "multipart/mixed",
              parts: [
                {
                  partId: "forwarded-1",
                  mimeType: "application/pdf",
                  headers: [
                    { name: "Content-Type", value: "application/pdf; name=\"forwarded-po.pdf\"" },
                    { name: "Content-Disposition", value: "attachment" },
                  ],
                  body: { attachmentId: "forwarded_att", size: 4096 },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: "forwarded-po.pdf",
        attachmentId: "forwarded_att",
        partId: "forwarded-1",
      }),
    ]);
  });

  test("creates fallback filenames for attachment ids with no Gmail filename", () => {
    const result = extractGmailBodyAndAttachments({
      partId: "root",
      mimeType: "application/pdf",
      headers: [{ name: "Content-Disposition", value: "inline" }],
      body: { attachmentId: "nameless_att", size: 128 },
    });

    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: "attachment-root.pdf",
        attachmentId: "nameless_att",
        detectedBy: expect.arrayContaining(["attachmentId", "content-disposition:inline", "mimeType"]),
      }),
    ]);
  });

  test("captures nested attachment ids with blank Gmail filenames", () => {
    const result = extractGmailBodyAndAttachments({
      mimeType: "multipart/mixed",
      parts: [{
        partId: "0",
        mimeType: "multipart/related",
        parts: [{
          partId: "0.1",
          filename: "",
          mimeType: "application/pdf",
          body: { attachmentId: "blank_filename_att", size: 333 },
        }],
      }],
    });

    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: "attachment-0.1.pdf",
        attachmentId: "blank_filename_att",
      }),
    ]);
  });

  test("captures nested attachments with filename only in Content-Disposition", () => {
    const result = extractGmailBodyAndAttachments({
      mimeType: "multipart/mixed",
      parts: [{
        partId: "1",
        mimeType: "application/pdf",
        headers: [{ name: "Content-Disposition", value: "attachment; filename=\"disposition-po.pdf\"" }],
        body: { attachmentId: "disposition_att", size: 444 },
      }],
    });

    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: "disposition-po.pdf",
        attachmentId: "disposition_att",
      }),
    ]);
  });

  test("walks embedded payload containers in forwarded Gmail parts", () => {
    const result = extractGmailBodyAndAttachments({
      mimeType: "multipart/mixed",
      parts: [{
        partId: "forwarded",
        mimeType: "message/rfc822",
        payload: {
          mimeType: "multipart/mixed",
          parts: [{
            partId: "forwarded-payload-1",
            filename: "forwarded-art.pdf",
            mimeType: "application/pdf",
            body: { attachmentId: "forwarded_payload_att", size: 555 },
          }],
        },
      }],
    });

    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: "forwarded-art.pdf",
        attachmentId: "forwarded_payload_att",
      }),
    ]);
  });

  test("fetches Gmail message details with full payload format for attachment traversal", async () => {
    const list = jest.fn(async () => ({
      data: { messages: [{ id: "gmail_msg_1" }] },
    }));
    const get = jest.fn(async () => ({
      data: {
        id: "gmail_msg_1",
        threadId: "thread_1",
        internalDate: String(new Date("2026-06-18T12:00:00.000Z").getTime()),
        payload: {
          headers: [
            { name: "From", value: "Audrey <audrey@example.com>" },
            { name: "Subject", value: "PO with art" },
          ],
          mimeType: "multipart/mixed",
          parts: [{
            filename: "nested-po.pdf",
            mimeType: "application/pdf",
            body: { attachmentId: "att_1", size: 1024 },
          }],
        },
      },
    }));
    const adapter = new GmailInboundEmailAdapter();
    (adapter as any).buildGmailClient = () => ({
      users: { messages: { list, get } },
    });

    const messages = await adapter.listRecentMessages(mailbox(), 10);

    expect(get).toHaveBeenCalledWith({ userId: "me", id: "gmail_msg_1", format: "full" });
    expect(messages[0].attachments).toEqual([
      expect.objectContaining({ filename: "nested-po.pdf", attachmentId: "att_1" }),
    ]);
  });

  test("paginates Gmail list results up to the configured max and records safe listed-message diagnostics", async () => {
    const list = jest.fn(async (args: any) => {
      if (!args.pageToken) {
        return { data: { messages: [{ id: "gmail_msg_page_1" }], nextPageToken: "page_2" } };
      }
      return { data: { messages: [{ id: "gmail_msg_target" }] } };
    });
    const get = jest.fn(async ({ id }: any) => ({
      data: {
        id,
        threadId: `${id}_thread`,
        internalDate: String(new Date("2026-06-19T12:00:00.000Z").getTime()),
        payload: {
          headers: [
            { name: "From", value: "Shawn Fears <shawn@brainstormprint.com>" },
            {
              name: "Subject",
              value: id === "gmail_msg_target"
                ? "Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26"
                : "Earlier visible inbox message",
            },
          ],
          mimeType: "text/plain",
          body: { data: base64Url("Please see attached.") },
        },
      },
    }));
    const adapter = new GmailInboundEmailAdapter();
    (adapter as any).buildGmailClient = () => ({
      users: { messages: { list, get } },
    });

    const messages = await adapter.listRecentMessages(mailbox({
      settingsJson: {
        lookbackDays: 30,
        maxMessages: 50,
        gmailQuery: "from:brainstormprint.com newer_than:30d",
        labelIds: ["INBOX"],
      },
    }), 50);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: "me",
      maxResults: 25,
      q: "from:brainstormprint.com newer_than:30d",
      labelIds: ["INBOX"],
    }));
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageToken: "page_2" }));
    expect(messages.map((item) => item.subject)).toContain("Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26");
    expect(adapter.getLastListDiagnostics()).toEqual(expect.objectContaining({
      query: "from:brainstormprint.com newer_than:30d",
      labelIds: ["INBOX"],
      maxResults: 50,
      pageCount: 2,
      totalMessageIdsReturned: 2,
      listedMessages: expect.arrayContaining([
        expect.objectContaining({
          providerMessageId: "gmail_msg_target",
          subject: "Purchase Order No 151534 Titan IYSA Yard Signs 6_19_26",
          senderEmail: "shawn@brainstormprint.com",
        }),
      ]),
    }));
  });
});
