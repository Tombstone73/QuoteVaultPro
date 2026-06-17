import { describe, expect, test } from "@jest/globals";

import {
  matchInboundEmailIgnoreRule,
  type InboundEmailProviderMessage,
} from "../services/inboundEmailIngestionService";

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
