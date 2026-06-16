import { describe, expect, test } from "@jest/globals";

import {
  classifyInboundEmailForReview,
  type InboundEmailProviderMessage,
} from "../services/inboundEmailIngestionService";

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
