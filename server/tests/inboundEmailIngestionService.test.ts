import { describe, expect, jest, test } from "@jest/globals";

import {
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

    expect(result).toMatchObject({ ignored: true, intent: "UNKNOWN" });
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

    const messages = await adapter.listRecentMessages({
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
    }, 10);

    expect(get).toHaveBeenCalledWith({ userId: "me", id: "gmail_msg_1", format: "full" });
    expect(messages[0].attachments).toEqual([
      expect.objectContaining({ filename: "nested-po.pdf", attachmentId: "att_1" }),
    ]);
  });
});
