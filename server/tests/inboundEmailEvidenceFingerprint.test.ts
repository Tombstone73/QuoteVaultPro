import { describe, expect, test } from "@jest/globals";
import { fingerprintInboundEmailEvidence } from "../services/inboundOrders/inboundEmailEvidenceFingerprint";

describe("inbound email evidence fingerprint", () => {
  const record = { sourceMessageId: "m1", rawPayloadJson: { subject: "Order", bodyText: "Please print", thread: { messages: [
    { messageId: "m1", bodyText: "Please print" }, { messageId: "m2", bodyText: "Revised quantity" },
  ] } } };
  const files = [{ providerMessageId: "m1", providerAttachmentId: "a1", sourceFilename: "PO.pdf", checksum: "abc" }];

  test("is stable across message ordering and bookkeeping changes", () => {
    const reordered = { ...record, rawPayloadJson: { ...record.rawPayloadJson, lastManualReprocess: { at: "later" }, thread: { messages: [...record.rawPayloadJson.thread.messages].reverse() } } };
    expect(fingerprintInboundEmailEvidence(reordered, files)).toBe(fingerprintInboundEmailEvidence(record, files));
  });

  test("changes for a revised message or attachment content", () => {
    const first = fingerprintInboundEmailEvidence(record, files);
    expect(fingerprintInboundEmailEvidence({ ...record, rawPayloadJson: { ...record.rawPayloadJson, bodyText: "Please print 2" } }, files)).not.toBe(first);
    expect(fingerprintInboundEmailEvidence(record, [{ ...files[0], checksum: "def" }])).not.toBe(first);
    expect(fingerprintInboundEmailEvidence({ ...record, rawPayloadJson: { ...record.rawPayloadJson, attachments: [{ attachmentId: "new", filename: "revision.pdf" }] } }, files)).not.toBe(first);
  });

  test("ignores generated storage identity, attachment ordering and retrieval bookkeeping", () => {
    const second = { ...files[0], providerAttachmentId: "a2", sourceFilename: "art.pdf", fileRecordId: "stored-2" };
    const original = [{ ...files[0], fileRecordId: "stored-1" }, second];
    const equivalent = [{ ...second, fileRecordId: "different-2", metadataJson: { retrievedAt: "later" } }, { ...original[0], fileRecordId: "different-1" }];
    expect(fingerprintInboundEmailEvidence(record, equivalent)).toBe(fingerprintInboundEmailEvidence(record, original));
  });

  test.each([
    { sourceFilename: "revised.pdf" }, { sizeBytes: 20 }, { mimeType: "text/plain" },
    { providerAttachmentId: "new-id" }, { fileRecordId: "downloaded" },
    { metadataJson: { attachmentState: "quarantined" } },
  ])("invalidates changed attachment evidence %j", (patch) => {
    expect(fingerprintInboundEmailEvidence(record, [{ ...files[0], ...patch }]))
      .not.toBe(fingerprintInboundEmailEvidence(record, files));
  });

  test("combined email source text participates without imported timestamps", () => {
    const combined = { ...record, normalizedPayloadJson: { combinedSources: [{ recordId: "local-1", receivedAt: "yesterday", evidence: { subject: "Order", bodyText: "Print ten" } }] } };
    const equivalent = { ...combined, normalizedPayloadJson: { combinedSources: [{ recordId: "local-2", receivedAt: "today", evidence: { bodyText: "Print ten", subject: "Order" } }] } };
    expect(fingerprintInboundEmailEvidence(combined, files)).toBe(fingerprintInboundEmailEvidence(equivalent, files));
    equivalent.normalizedPayloadJson.combinedSources[0].evidence.bodyText = "Print twenty";
    expect(fingerprintInboundEmailEvidence(combined, files)).not.toBe(fingerprintInboundEmailEvidence(equivalent, files));
  });

  test("uses the parser's canonical normalized fallback and source notes", () => {
    const fallback = { rawPayloadJson: {}, normalizedPayloadJson: { subject: "Order", bodyText: "Print ten", notes: "Arrive Friday" } };
    const rawEquivalent = { rawPayloadJson: { ...fallback.normalizedPayloadJson } };
    expect(fingerprintInboundEmailEvidence(fallback, [])).toBe(fingerprintInboundEmailEvidence(rawEquivalent, []));
    expect(fingerprintInboundEmailEvidence({ ...fallback, normalizedPayloadJson: { ...fallback.normalizedPayloadJson, notes: "Arrive Thursday" } }, []))
      .not.toBe(fingerprintInboundEmailEvidence(fallback, []));
  });
});
