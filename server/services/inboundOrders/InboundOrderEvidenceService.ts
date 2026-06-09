import { promises as fsPromises } from "fs";

import type { InboundOrderFile, InboundOrderRecord } from "@shared/schema";
import {
  getManualInboundEvidence,
  type InboundOrderEvidenceItem,
  type InboundOrderParseWarning,
} from "@shared/inboundOrdersApi";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";
import { canonicalFileReadResolver } from "../storage/CanonicalFileReadResolver";
import { storageRegistry } from "../storage/StorageRegistry";
import { inferInboundRequestedDate } from "./inboundOrderDateInference";

export type InboundOrderEvidenceBundle = {
  items: InboundOrderEvidenceItem[];
  conflicts: InboundOrderParseWarning[];
};

type PurchaseOrderSummary = NonNullable<InboundOrderEvidenceItem["poSummary"]>;

const MAX_ATTACHMENT_TEXT_CHARS = 50000;

function warning(code: string, message: string, severity: InboundOrderParseWarning["severity"] = "warning", fieldPath?: string): InboundOrderParseWarning {
  return { code, message, severity, fieldPath: fieldPath ?? null };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function numberValue(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function extractQuantity(text: string): number | null {
  return numberValue(firstMatch(text, [
    /\bqty\.?\s*[:#]?\s*(\d+(?:,\d{3})*)\b/i,
    /\bquantity\s*[:#]?\s*(\d+(?:,\d{3})*)\b/i,
    /^\s*(\d+(?:,\d{3})*)\s+(?:[A-Z0-9.]+\s+){0,4}(?:signs?|banners?|posters?|decals?|stickers?|prints?)\b/im,
    /\b(\d+(?:,\d{3})*)\s+(?:[A-Z0-9.]+\s+){0,4}(?:signs?|banners?|posters?|decals?|stickers?|prints?)\b/i,
  ]));
}

function extractDimensions(text: string): string | null {
  return firstMatch(text, [
    /\b(\d+(?:\.\d+)?\s*(?:in|inch|inches|ft|feet|mm|cm)?\s*[xX×]\s*\d+(?:\.\d+)?\s*(?:in|inch|inches|ft|feet|mm|cm)?)\b/i,
    /\bsize\s*[:#]?\s*(\d+(?:\.\d+)?\s*[xX×]\s*\d+(?:\.\d+)?)\b/i,
  ]);
}

function parseDimensions(value: string | null): { width: number | null; height: number | null; unit: string | null } {
  if (!value) return { width: null, height: null, unit: null };
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|ft|feet|mm|cm)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(in|inch|inches|ft|feet|mm|cm)?/i);
  if (!match) return { width: null, height: null, unit: null };
  const unit = match[3]?.toLowerCase().replace(/^inch(?:es)?$/, "in").replace(/^feet$/, "ft") ?? null;
  return { width: Number(match[1]), height: Number(match[2]), unit };
}

export function detectAttachmentDocument(text: string, fileName?: string | null): Pick<InboundOrderEvidenceItem, "documentType" | "documentConfidence"> {
  const source = `${fileName ?? ""}\n${text}`.toLowerCase();
  const poSignals = [
    /\bpurchase\s+order\b/,
    /\bpo\s*(?:number|#|:)?\b/,
    /\bsupplier\b/,
    /\bquantity\b|\bqty\b/,
    /\bdue\s+date\b|\barrival\s+due\b/,
    /\bstock\b/,
    /\bitem\s+description\b/,
  ].filter((pattern) => pattern.test(source)).length;
  if (poSignals >= 3) {
    return { documentType: "purchase_order", documentConfidence: Math.min(98, 55 + poSignals * 8) };
  }
  if (/\bartwork\b|\bproof\b|\blogo\b|\bvector\b|\b.ai\b|\b.eps\b/i.test(source)) {
    return { documentType: "artwork_reference", documentConfidence: 72 };
  }
  return { documentType: "unknown", documentConfidence: 20 };
}

export function extractPurchaseOrderFields(args: {
  text: string;
  receivedAt?: Date | string | null;
}): PurchaseOrderSummary {
  const text = normalizeWhitespace(args.text);
  const dueLine = text.split("\n").find((line) => /due|arrival|in hand|needed by|must eod/i.test(line)) ?? text;
  const inferredDate = inferInboundRequestedDate({ text: dueLine, receivedAt: args.receivedAt }) ?? inferInboundRequestedDate({ text, receivedAt: args.receivedAt });
  const dimensions = extractDimensions(text);
  const material = firstMatch(text, [
    /\b(\d+(?:\.\d+)?\s*mm\s+(?:white\s+)?PVC)\b/i,
    /\b(\d+(?:\.\d+)?\s*mm\s+coroplast)\b/i,
    /\b(\.?\d+\s*magnetic)\b/i,
    /\b(one[-\s]?way vision vinyl|window perf(?:orated)? vinyl)\b/i,
    /\b((?:white\s+)?PVC)\b/i,
    /\b(coroplast)\b/i,
  ]);
  const productDescription = firstMatch(text, [
    /^\s*\d+(?:,\d{3})*\s+(.{3,120}?(?:signs?|banners?|posters?|decals?|stickers?|prints?))\b/im,
    /\bitem\s+description\s*[:#]?\s*(.{3,120})/i,
    /\bproduct\s*[:#]?\s*(.{3,120})/i,
  ]);

  return {
    poNumber: firstMatch(text, [
      /\bpurchase\s+order\s*#?\s*([A-Z0-9-]+)/i,
      /\bpo\s*(?:number|no\.?|#|:)?\s*[:#]?\s*([A-Z0-9-]{3,})/i,
    ]),
    customer: firstMatch(text, [
      /\bcustomer\s*[:#]?\s*(.{3,120})/i,
      /\bbill\s+to\s*[:#]?\s*(.{3,120})/i,
    ]),
    contact: firstMatch(text, [/\bcontact\s*[:#]?\s*(.{3,120})/i]),
    dueDate: inferredDate?.parsedDate ?? null,
    quantity: extractQuantity(text),
    productDescription,
    material,
    dimensions,
    printSpecs: [
      /\bfull\s+color\b/i.test(text) ? "Full color" : null,
      /\bsingle\s+sided\b/i.test(text) ? "Single sided" : null,
      /\bdouble\s+sided\b/i.test(text) ? "Double sided" : null,
    ].filter((item): item is string => Boolean(item)),
    shippingNotes: firstMatch(text, [
      /\bship(?:ping)?\s*(?:notes?)?\s*[:#]?\s*(.{3,200})/i,
      /\bdeliver(?:y)?\s*[:#]?\s*(.{3,200})/i,
    ]),
    price: firstMatch(text, [/(\$\s*\d+(?:,\d{3})*(?:\.\d{2})?)/]),
    versionCount: numberValue(firstMatch(text, [/\b(\d+)\s+versions?\b/i])),
  };
}

export function detectEvidenceConflicts(items: InboundOrderEvidenceItem[]): InboundOrderParseWarning[] {
  const po = items.find((item) => item.documentType === "purchase_order" && item.poSummary);
  const email = items.find((item) => item.type === "EMAIL_BODY");
  const poQuantity = po?.poSummary?.quantity ?? null;
  const emailQuantity = email?.rawText ? extractQuantity(email.rawText) : null;
  if (poQuantity && emailQuantity && poQuantity !== emailQuantity) {
    return [warning(
      "evidence_quantity_conflict",
      `Quantity mismatch between email (${emailQuantity}) and purchase order (${poQuantity}).`,
      "warning",
      "lineItems.0.quantity",
    )];
  }
  return [];
}

export async function extractMachineReadablePdfText(buffer: Buffer | Uint8Array): Promise<{ text: string; pageCount: number }> {
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = (mod as any).default ?? mod;
  const data = buffer instanceof Buffer
    ? new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
    : buffer;
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => String(item.str ?? "")).join(" "));
  }
  await document.destroy?.();
  return {
    text: normalizeWhitespace(pages.join("\n\n")).slice(0, MAX_ATTACHMENT_TEXT_CHARS),
    pageCount: document.numPages,
  };
}

export class InboundOrderEvidenceService {
  async buildEvidenceBundle(args: {
    organizationId: string;
    record: InboundOrderRecord;
    files: InboundOrderFile[];
  }): Promise<InboundOrderEvidenceBundle> {
    const evidence = getManualInboundEvidence(args.record);
    const items: InboundOrderEvidenceItem[] = [];

    if (evidence.subject) {
      items.push({ type: "EMAIL_SUBJECT", label: "Email Subject", rawText: evidence.subject, documentType: "unknown", documentConfidence: 0, warnings: [] });
    }
    if (evidence.bodyText) {
      items.push({ type: "EMAIL_BODY", label: "Email Body", rawText: evidence.bodyText, documentType: "unknown", documentConfidence: 0, warnings: [] });
    }
    if (evidence.notes) {
      items.push({ type: "MANUAL_NOTES", label: "Manual Notes", rawText: evidence.notes, documentType: "unknown", documentConfidence: 0, warnings: [] });
    }

    for (const file of args.files) {
      const attachment = await this.buildAttachmentEvidence(args.record, file);
      if (attachment) items.push(attachment);
    }

    return {
      items,
      conflicts: detectEvidenceConflicts(items),
    };
  }

  private async buildAttachmentEvidence(record: InboundOrderRecord, file: InboundOrderFile): Promise<InboundOrderEvidenceItem | null> {
    const mimeType = file.mimeType ?? "";
    const fileName = file.sourceFilename ?? null;
    const base = {
      sourceId: file.id,
      fileName,
      mimeType: file.mimeType ?? null,
      label: fileName ?? "Attachment",
    };

    if (/pdf/i.test(mimeType) || /\.pdf$/i.test(fileName ?? "")) {
      try {
        const buffer = file.fileRecordId ? await this.readCanonicalFile(file.fileRecordId) : null;
        if (!buffer) {
          return {
            ...base,
            type: "PDF_ATTACHMENT",
            rawText: null,
            pageCount: null,
            documentType: "unknown",
            documentConfidence: 0,
            poSummary: null,
            warnings: [warning("attachment_unreadable", "PDF attachment could not be read for parsing.", "warning")],
          };
        }
        const extracted = await extractMachineReadablePdfText(buffer);
        const detected = detectAttachmentDocument(extracted.text, fileName);
        const poSummary = detected.documentType === "purchase_order"
          ? extractPurchaseOrderFields({ text: extracted.text, receivedAt: record.receivedAt })
          : null;
        return {
          ...base,
          type: "PDF_ATTACHMENT",
          rawText: extracted.text,
          pageCount: extracted.pageCount,
          ...detected,
          poSummary,
          warnings: [],
        };
      } catch (error: any) {
        return {
          ...base,
          type: "PDF_ATTACHMENT",
          rawText: null,
          pageCount: null,
          documentType: "unknown",
          documentConfidence: 0,
          poSummary: null,
          warnings: [warning("pdf_text_extraction_failed", error?.message ?? "PDF text extraction failed.", "warning")],
        };
      }
    }

    if (/^text\//i.test(mimeType) && file.fileRecordId) {
      const buffer = await this.readCanonicalFile(file.fileRecordId);
      const rawText = buffer?.toString("utf8").slice(0, MAX_ATTACHMENT_TEXT_CHARS) ?? null;
      if (!rawText) return null;
      const detected = detectAttachmentDocument(rawText, fileName);
      return {
        ...base,
        type: "TEXT_ATTACHMENT",
        rawText,
        pageCount: null,
        ...detected,
        poSummary: detected.documentType === "purchase_order"
          ? extractPurchaseOrderFields({ text: rawText, receivedAt: record.receivedAt })
          : null,
        warnings: [],
      };
    }

    return {
      ...base,
      type: "TEXT_ATTACHMENT",
      rawText: file.reviewNotes ?? null,
      pageCount: null,
      documentType: "unknown",
      documentConfidence: 0,
      poSummary: null,
      warnings: [],
    };
  }

  private async readCanonicalFile(fileRecordId: string): Promise<Buffer | null> {
    const resolved = await canonicalFileReadResolver.resolveOriginal(fileRecordId);
    if (resolved.status !== "available" || !resolved.providerConfigId) return null;
    const providerConfig = await storageProviderConfigRepository.getById(resolved.providerConfigId);
    if (!providerConfig) return null;
    const adapter = storageRegistry.getAdapter(providerConfig.providerType);
    const handle = await adapter.getDownloadHandle({
      providerConfig,
      objectKey: resolved.objectKey,
      localPathRef: resolved.localPathRef,
    });
    if (handle.kind === "signed_url") {
      const response = await fetch(handle.value);
      if (!response.ok) throw new Error(`Attachment download failed (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    }
    return fsPromises.readFile(handle.value);
  }
}

export const inboundOrderEvidenceService = new InboundOrderEvidenceService();
