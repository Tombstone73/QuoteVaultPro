import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/modules/shared/commercialValues.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { PreparedQuoteDeliveryEvidence } from "../../src/modules/sales/contracts.js";

type EvidenceRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is EvidenceRecord => !!value && typeof value === "object" && !Array.isArray(value);
const validEmail = (value: unknown): value is string => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);

export const parsePreparedQuoteDeliveryEvidence = (value: unknown): PreparedQuoteDeliveryEvidence | null => {
  try {
    const evidence = typeof value === "string" ? JSON.parse(value) as unknown : value;
    if (!isRecord(evidence) || evidence.schemaVersion !== 1
      || typeof evidence.organizationId !== "string" || !evidence.organizationId
      || typeof evidence.quoteId !== "string" || !evidence.quoteId
      || typeof evidence.expectedRevision !== "string" || !evidence.expectedRevision
      || !isRecord(evidence.customerContact) || evidence.customerContact.organizationId !== evidence.organizationId
      || !(typeof evidence.customerContact.customerId === "string" || typeof evidence.customerContact.contactId === "string")
      || !isRecord(evidence.commercial) || typeof evidence.commercial.currency !== "string"
      || !isRecord(evidence.commercial.terms) || !Array.isArray(evidence.commercial.lines)
      || !isRecord(evidence.customerPresentation)
      || typeof evidence.customerPresentation.customerDisplayName !== "string"
      || !isRecord(evidence.organizationPresentation) || typeof evidence.organizationPresentation.name !== "string"
      || !validEmail(evidence.recipientEmail)
      || typeof evidence.documentSha256 !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(evidence.documentSha256)
      || typeof evidence.documentNumber !== "string" || !evidence.documentNumber
      || typeof evidence.documentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(evidence.documentDate)) return null;
    if (evidence.documentPdfBase64 !== undefined) {
      if (typeof evidence.documentPdfBase64 !== "string") return null;
      const pdf = Buffer.from(evidence.documentPdfBase64, "base64");
      if (pdf.toString("base64") !== evidence.documentPdfBase64 || pdf.subarray(0, 5).toString() !== "%PDF-"
        || `sha256:${createHash("sha256").update(pdf).digest("hex")}` !== evidence.documentSha256) return null;
    }
    return JSON.parse(canonicalJson(evidence)) as PreparedQuoteDeliveryEvidence;
  } catch {
    return null;
  }
};

export const serializePreparedQuoteDeliveryEvidence = (value: PreparedQuoteDeliveryEvidence): string => {
  const parsed = parsePreparedQuoteDeliveryEvidence(value);
  if (!parsed) throw new V2ApplicationError("VALIDATION_ERROR", "Prepared Quote delivery evidence is invalid.");
  return canonicalJson(parsed);
};
