import { describe, expect, test } from "@jest/globals";
import { canCancelEmailQueueJob, invoiceEmailSupersessionEvidence, type EmailQueueIdentity } from "../emailQueueLifecycle";

const old: EmailQueueIdentity = { id: "old", organizationId: "org", campaignId: "request", invoiceId: "invoice", invoiceVersion: 2,
  deliveryType: "invoice", recipientKey: "billing@example.test", status: "retrying", createdAt: "2026-09-20T23:19:00Z",
  metadata: { subject: "Invoice", message: "Frozen message", attachment: { snapshotId: "original" } } };
const sent: EmailQueueIdentity = { ...old, id: "later", status: "sent", createdAt: "2026-09-21T00:00:00Z", sentAt: "2026-09-21T00:01:00Z", providerMessageId: "provider-1" };

describe("email queue terminal lifecycle", () => {
  test.each(["queued", "retrying", "needs_review"])("%s is cancelable", status => expect(canCancelEmailQueueJob(status)).toBe(true));
  test.each(["processing", "sent", "failed", "canceled", "superseded"])("%s is not cancelable", status => expect(canCancelEmailQueueJob(status)).toBe(false));
  test("same request, recipient, version and frozen message proves supersession", () => {
    expect(invoiceEmailSupersessionEvidence(old, sent)).toContain("Same canonical request");
  });
  test("explicit review replacement can span campaigns", () => {
    expect(invoiceEmailSupersessionEvidence(old, { ...sent, campaignId: "retry-request", metadata: { ...sent.metadata, retryOfNeedsReviewJobId: old.id } })).toContain("Explicit review replacement");
  });
  test.each([
    { recipientKey: "owner@example.test" }, { invoiceVersion: 3 }, { campaignId: "unrelated-resend" },
    { organizationId: "another-org" }, { invoiceId: "another-invoice" }, { deliveryType: "customer_statement" },
    { providerMessageId: null }, { sentAt: null }, { createdAt: old.createdAt }, { metadata: { subject: "Edited", message: "Frozen message" } },
  ])("does not infer equivalence from Invoice alone: %j", difference => {
    expect(invoiceEmailSupersessionEvidence(old, { ...sent, ...difference })).toBeNull();
  });
  test("legacy null content and revision changes remain ambiguous even with a replacement link", () => {
    expect(invoiceEmailSupersessionEvidence({ ...old, metadata: {} }, { ...sent, metadata: {} })).toBeNull();
    expect(invoiceEmailSupersessionEvidence(old, { ...sent, invoiceVersion: 3, metadata: { ...sent.metadata, retryOfNeedsReviewJobId: old.id } })).toBeNull();
  });
  test("Invoice 20395 read-only UI evidence does not prove equivalence", () => {
    // Verified MAIN: queued Sep 20 7:19 PM; later send Sep 21 8:46 PM to the
    // same recipient; intervening commercial revision. IDs/content/version
    // are deliberately unknown here, not fabricated as verified evidence.
    const stale = { ...old, invoiceId: "a3c902e4-1c12-4194-919c-31274837aa4d", recipientKey: "pkpromos@gmail.com", metadata: {} };
    expect(invoiceEmailSupersessionEvidence(stale, { ...sent, invoiceId: stale.invoiceId, recipientKey: stale.recipientKey,
      campaignId: "unknown-later-request", createdAt: "2026-09-22T00:46:00Z", sentAt: "2026-09-22T00:46:01Z", metadata: {} })).toBeNull();
  });
});
