import { promises as fsPromises } from "fs";

import type { InboundOrderFile, InboundOrderRecord } from "@shared/schema";
import { inflateSync } from "zlib";
import {
  getManualInboundEvidence,
  type InboundOrderEvidenceItem,
  type InboundOrderParseWarning,
} from "@shared/inboundOrdersApi";
import type { InboundAttachmentClassification } from "@shared/inboundAttachmentClassification";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";
import { canonicalFileReadResolver } from "../storage/CanonicalFileReadResolver";
import { storageRegistry } from "../storage/StorageRegistry";
import { inferInboundRequestedDate } from "./inboundOrderDateInference";

export type InboundOrderEvidenceBundle = {
  items: InboundOrderEvidenceItem[];
  conflicts: InboundOrderParseWarning[];
};

export type ManualAttachmentClassificationEvidence = {
  classification: InboundAttachmentClassification;
  automaticClassification?: InboundAttachmentClassification | null;
  automaticConfidence?: number | null;
  automaticReasons?: string[];
  learningEvidence?: Record<string, unknown> | null;
};

type PurchaseOrderSummary = NonNullable<InboundOrderEvidenceItem["poSummary"]>;
type FieldSource = PurchaseOrderSummary["fieldSources"][string];
type DateCandidate = PurchaseOrderSummary["dateCandidates"][number];
type DateClassification = DateCandidate["classification"];

const MAX_ATTACHMENT_TEXT_CHARS = 50000;
const DATE_CLASSIFICATION_PRIORITY: DateClassification[] = [
  "ARRIVAL_DATE",
  "DUE_DATE",
  "SHIP_DATE",
  "EVENT_DATE",
  "PO_DATE",
  "ORDER_DATE",
  "UNKNOWN",
];
const DATE_LABEL_PATTERN = /\b(?:arrival\s+due\s+date|arrival\s+due|due\s+date|need(?:ed)?\s+by|in\s+hands?(?:\s+by)?|ship\s+date|event\s+date|purchase\s+order\s+date|po\s+date|order\s+date)\b/gi;
const NON_DATE_PO_SECTION_PATTERN = /\s+\b(?:qty|quantity|item\s+description|stock|material|customer|contact|attn|attention|ship\s+to|bill\s+to)\b/i;

function warning(code: string, message: string, severity: InboundOrderParseWarning["severity"] = "warning", fieldPath?: string): InboundOrderParseWarning {
  return { code, message, severity, fieldPath: fieldPath ?? null };
}

function attachmentDocumentFallback(file: InboundOrderFile): Pick<InboundOrderEvidenceItem, "documentType" | "documentConfidence"> {
  if (file.role === "po") return { documentType: "purchase_order", documentConfidence: 70 };
  if (file.role === "artwork") return { documentType: "artwork_reference", documentConfidence: 70 };
  return { documentType: "unknown", documentConfidence: 0 };
}

function manualClassificationInfluence(classification: InboundAttachmentClassification): string {
  if (classification === "PO") return "Manual PO classification used as authoritative purchase-order evidence.";
  if (classification === "ARTWORK") return "Manual Artwork classification used as authoritative artwork evidence.";
  if (classification === "REFERENCE") return "Manual Reference classification used as supporting evidence only.";
  if (classification === "IGNORE_INLINE") return "Manual Junk / Signature classification ignored for parsing.";
  return "Manual attachment classification used.";
}

function applyManualClassificationToEvidence(
  item: InboundOrderEvidenceItem,
  manual: ManualAttachmentClassificationEvidence | null | undefined,
  record: InboundOrderRecord,
): InboundOrderEvidenceItem | null {
  if (!manual) return item;
  if (manual.classification === "IGNORE_INLINE" || manual.classification === "OTHER") return null;
  const documentType = manual.classification === "PO"
    ? "purchase_order"
    : manual.classification === "ARTWORK"
      ? "artwork_reference"
      : "unknown";
  const poSummary = manual.classification === "PO" && item.rawText
    ? item.poSummary ?? extractPurchaseOrderFields({ text: item.rawText, receivedAt: record.receivedAt, sourceDocument: item.fileName ?? item.label })
    : null;
  const influence = manualClassificationInfluence(manual.classification);
  return {
    ...item,
    documentType,
    documentConfidence: 100,
    poSummary,
    manualClassificationUsed: true,
    automaticClassification: manual.automaticClassification ?? undefined,
    manualClassification: manual.classification,
    finalClassification: manual.classification,
    classificationInfluence: influence,
    learningEvidence: manual.learningEvidence ?? undefined,
    warnings: [
      warning("manual_attachment_classification_used", influence, "info"),
      ...item.warnings,
    ],
  };
}

function evidenceItemPriority(item: InboundOrderEvidenceItem): number {
  if (item.manualClassificationUsed && item.finalClassification === "PO") return 0;
  if (item.documentType === "purchase_order") return 1;
  if (item.manualClassificationUsed && item.finalClassification === "ARTWORK") return 2;
  if (item.manualClassificationUsed && item.finalClassification === "REFERENCE") return 3;
  if (item.type === "PDF_ATTACHMENT" || item.type === "TEXT_ATTACHMENT") return 4;
  if (item.type === "EMAIL_BODY") return 5;
  if (item.type === "EMAIL_SUBJECT") return 6;
  return 7;
}

function prioritizeEvidenceItems(items: InboundOrderEvidenceItem[]): InboundOrderEvidenceItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => evidenceItemPriority(a.item) - evidenceItemPriority(b.item) || a.index - b.index)
    .map(({ item }) => item);
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

function firstMatchWithSource(text: string, patterns: RegExp[]): { value: string; sourceText: string } | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return { value: match[1].trim(), sourceText: (match[0] ?? match[1]).trim() };
  }
  return null;
}

function extractDateSourceSegments(text: string): string[] {
  const lines = normalizeWhitespace(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const segments: string[] = [];
  for (const line of lines) {
    const matches = Array.from(line.matchAll(DATE_LABEL_PATTERN));
    if (matches.length === 0) {
      segments.push(line);
      continue;
    }
    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index].index ?? 0;
      const end = matches[index + 1]?.index ?? line.length;
      const rawSegment = line.slice(start, end).trim();
      const sectionMatch = rawSegment.match(NON_DATE_PO_SECTION_PATTERN);
      const segment = (sectionMatch?.index ? rawSegment.slice(0, sectionMatch.index) : rawSegment).trim();
      if (segment) segments.push(segment);
    }
  }
  return segments;
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

function extractQuantityWithSource(text: string): { value: number; sourceText: string } | null {
  const matched = firstMatchWithSource(text, [
    /\bqty\.?\s*[:#]?\s*(\d+(?:,\d{3})*)\b/i,
    /\bquantity\s*[:#]?\s*(\d+(?:,\d{3})*)\b/i,
    /^\s*(\d+(?:,\d{3})*)\s+(?:[A-Z0-9.]+\s+){0,4}(?:signs?|banners?|posters?|decals?|stickers?|prints?)\b/im,
    /\b(\d+(?:,\d{3})*)\s+(?:[A-Z0-9.]+\s+){0,4}(?:signs?|banners?|posters?|decals?|stickers?|prints?)\b/i,
  ]);
  const value = numberValue(matched?.value ?? null);
  return matched && value ? { value, sourceText: matched.sourceText } : null;
}

function extractDimensions(text: string): string | null {
  return firstMatch(text, [
    /\b(\d+(?:\.\d+)?\s*(?:in|inch|inches|ft|feet|mm|cm)?\s*[xX×]\s*\d+(?:\.\d+)?\s*(?:in|inch|inches|ft|feet|mm|cm)?)\b/i,
    /\bsize\s*[:#]?\s*(\d+(?:\.\d+)?\s*[xX×]\s*\d+(?:\.\d+)?)\b/i,
  ]);
}

function extractDimensionsWithSource(text: string): { value: string; sourceText: string } | null {
  return firstMatchWithSource(text, [
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

function source(value: string | number | boolean | null, sourceText: string | null, confidence: number, sourceDocument?: string | null): FieldSource {
  return {
    value,
    sourceType: "PDF_ATTACHMENT",
    sourceDocument: sourceDocument ?? null,
    sourceText,
    confidence,
  };
}

export function classifyDateSourceText(sourceText: string): DateClassification {
  const normalized = sourceText.toLowerCase();
  if (/arrival\s+due|need(?:ed)?\s+by|due\s+date|\bdue\b|in\s+hands?|in\s+hand|must\s+eod/.test(normalized)) return "DUE_DATE";
  if (/arrival|must\s+arrive/.test(normalized)) return "ARRIVAL_DATE";
  if (/ship\s+date|\bship\b/.test(normalized)) return "SHIP_DATE";
  if (/event\s+date|\bevent\b/.test(normalized)) return "EVENT_DATE";
  if (/(?:purchase\s+order|po)\s+date/.test(normalized)) return "PO_DATE";
  if (/\border\s+date\b/.test(normalized)) return "ORDER_DATE";
  return "UNKNOWN";
}

export function extractClassifiedDates(args: {
  text: string;
  receivedAt?: Date | string | null;
}): DateCandidate[] {
  const candidates: DateCandidate[] = [];
  const seen = new Set<string>();
  for (const segment of extractDateSourceSegments(args.text)) {
    if (!/(?:\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|must\s+eod)/i.test(segment)) {
      continue;
    }
    const inferred = inferInboundRequestedDate({ text: segment, receivedAt: args.receivedAt });
    if (!inferred) continue;
    const classification = classifyDateSourceText(segment);
    const key = `${inferred.parsedDate}:${classification}:${segment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      parsedDate: inferred.parsedDate,
      sourceText: segment,
      classification,
      confidence: Math.min(99, inferred.confidence + (classification === "ARRIVAL_DATE" || classification === "DUE_DATE" ? 14 : 0)),
    });
  }
  return candidates.sort((left, right) => {
    const priorityDelta = DATE_CLASSIFICATION_PRIORITY.indexOf(left.classification) - DATE_CLASSIFICATION_PRIORITY.indexOf(right.classification);
    return priorityDelta || right.confidence - left.confidence;
  });
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
  sourceDocument?: string | null;
}): PurchaseOrderSummary {
  const text = normalizeWhitespace(args.text);
  const dateCandidates = extractClassifiedDates({ text, receivedAt: args.receivedAt });
  const selectedDate = dateCandidates[0] ?? null;
  const dimensions = extractDimensionsWithSource(text);
  const quantity = extractQuantityWithSource(text);
  const poNumber = firstMatchWithSource(text, [
    /\bpurchase\s+order\s*(?:number|no\.?|#|:)?\s*[:#]?\s*(?!date\b)([A-Z0-9-]{3,})/i,
    /\bpo\s*(?:number|no\.?|#|:)?\s*[:#]?\s*(?!date\b)([A-Z0-9-]{3,})/i,
  ]);
  const sourceDocument = poNumber?.value ? `Purchase Order ${poNumber.value}` : args.sourceDocument;
  const material = firstMatchWithSource(text, [
    /\b(\d+(?:\.\d+)?\s*mm\s+(?:white\s+)?PVC)\b/i,
    /\b(\d+(?:\.\d+)?\s*mm\s+coroplast)\b/i,
    /\b(\.?\d+\s*magnetic)\b/i,
    /\b(one[-\s]?way vision vinyl|window perf(?:orated)? vinyl)\b/i,
    /\b((?:white\s+)?PVC)\b/i,
    /\b(coroplast)\b/i,
  ]);
  const productFromQuantity = quantity
    ? { match: quantity.sourceText.match(/^\s*\d+(?:,\d{3})*\s+(.{3,120})$/i), sourceText: quantity.sourceText }
    : null;
  const productDescription = productFromQuantity?.match?.[1]
    ? { value: productFromQuantity.match[1].trim(), sourceText: productFromQuantity.sourceText }
    : firstMatchWithSource(text, [
    /^\s*\d+(?:,\d{3})*\s+(.{3,120}?(?:signs?|banners?|posters?|decals?|stickers?|prints?))\b/im,
    /\bitem\s+description\s*[:#]?\s*(.{3,120})/i,
    /\bproduct\s*[:#]?\s*(.{3,120})/i,
  ]);
  const customer = firstMatchWithSource(text, [
    /\bcustomer\s+name\s*[:#]?\s*(.{3,120}?)(?=\s+(?:contact|attn|attention|purchase\s+order|po|arrival\s+due|qty|item\s+description)\b|$)/i,
    /\bcustomer\s*[:#]?\s*(.{3,120}?)(?=\s+(?:contact|attn|attention|purchase\s+order|po|arrival\s+due|qty|item\s+description)\b|$)/i,
    /\bcustomer\s+name\s*[:#]?\s*(.{3,120})/i,
    /\bcustomer\s*[:#]?\s*(.{3,120})/i,
    /\bbill\s+to\s*[:#]?\s*(.{3,120})/i,
    /\bship\s+to\s*[:#]?\s*(.{3,120})/i,
  ]);
  const contact = firstMatchWithSource(text, [
    /\bcontact\s+name\s*[:#]?\s*(.{3,120}?)(?=\s+(?:purchase\s+order|po|arrival\s+due|qty|item\s+description|customer)\b|$)/i,
    /\bcontact\s*[:#]?\s*(.{3,120}?)(?=\s+(?:purchase\s+order|po|arrival\s+due|qty|item\s+description|customer)\b|$)/i,
    /\battn\.?\s*[:#]?\s*(.{3,120}?)(?=\s+(?:purchase\s+order|po|arrival\s+due|qty|item\s+description|customer)\b|$)/i,
    /\battention\s*[:#]?\s*(.{3,120}?)(?=\s+(?:purchase\s+order|po|arrival\s+due|qty|item\s+description|customer)\b|$)/i,
    /\bordered\s+by\s*[:#]?\s*(.{3,120}?)(?=\s+(?:purchase\s+order|po|arrival\s+due|qty|item\s+description|customer)\b|$)/i,
    /\bcontact\s+name\s*[:#]?\s*(.{3,120})/i,
    /\bcontact\s*[:#]?\s*(.{3,120})/i,
    /\battn\.?\s*[:#]?\s*(.{3,120})/i,
    /\battention\s*[:#]?\s*(.{3,120})/i,
    /\bordered\s+by\s*[:#]?\s*(.{3,120})/i,
  ]);
  const shippingNotes = firstMatchWithSource(text, [
    /\bship(?:ping)?\s*(?:notes?)?\s*[:#]?\s*(.{3,200})/i,
    /\bdeliver(?:y)?\s*[:#]?\s*(.{3,200})/i,
  ]);
  const price = firstMatchWithSource(text, [/(\$\s*\d+(?:,\d{3})*(?:\.\d{2})?)/]);
  const versionCount = firstMatchWithSource(text, [/\b(\d+)\s+versions?\b/i]);
  const fieldSources: PurchaseOrderSummary["fieldSources"] = {};
  if (poNumber) fieldSources.poNumber = source(poNumber.value, poNumber.sourceText, 98, sourceDocument);
  if (selectedDate) fieldSources.dueDate = source(selectedDate.parsedDate, selectedDate.sourceText, selectedDate.confidence, sourceDocument);
  if (quantity) fieldSources.quantity = source(quantity.value, quantity.sourceText, 98, sourceDocument);
  if (productDescription) fieldSources.productDescription = source(productDescription.value, productDescription.sourceText, 90, sourceDocument);
  if (material) fieldSources.material = source(material.value, material.sourceText, 92, sourceDocument);
  if (dimensions) fieldSources.dimensions = source(dimensions.value, dimensions.sourceText, 95, sourceDocument);
  if (customer) fieldSources.customer = source(customer.value, customer.sourceText, 80, sourceDocument);
  if (contact) fieldSources.contact = source(contact.value, contact.sourceText, 80, sourceDocument);
  if (shippingNotes) fieldSources.shippingNotes = source(shippingNotes.value, shippingNotes.sourceText, 78, sourceDocument);
  if (price) fieldSources.price = source(price.value, price.sourceText, 76, sourceDocument);
  if (versionCount) {
    const value = numberValue(versionCount.value);
    if (value) fieldSources.versionCount = source(value, versionCount.sourceText, 78, sourceDocument);
  }

  return {
    poNumber: poNumber?.value ?? null,
    customer: customer?.value ?? null,
    contact: contact?.value ?? null,
    dueDate: selectedDate?.parsedDate ?? null,
    quantity: quantity?.value ?? null,
    productDescription: productDescription?.value ?? null,
    material: material?.value ?? null,
    dimensions: dimensions?.value ?? null,
    printSpecs: [
      /\bfull\s+color\b/i.test(text) ? "Full color" : null,
      /\bsingle\s+sided\b/i.test(text) ? "Single sided" : null,
      /\bdouble\s+sided\b/i.test(text) ? "Double sided" : null,
    ].filter((item): item is string => Boolean(item)),
    shippingNotes: shippingNotes?.value ?? null,
    price: price?.value ?? null,
    versionCount: numberValue(versionCount?.value ?? null),
    dateCandidates,
    fieldSources,
  };
}

export function detectEvidenceConflicts(items: InboundOrderEvidenceItem[]): InboundOrderParseWarning[] {
  const po = items.find((item) => item.documentType === "purchase_order" && item.poSummary);
  const email = items.find((item) => item.type === "EMAIL_BODY");
  const conflicts: InboundOrderParseWarning[] = [];
  const poQuantity = po?.poSummary?.quantity ?? null;
  const emailText = email?.rawText ?? "";
  const emailQuantity = emailText ? extractQuantity(emailText) : null;
  if (poQuantity && emailQuantity && poQuantity !== emailQuantity) {
    conflicts.push(warning(
      "evidence_quantity_conflict",
      `Quantity mismatch between email (${emailQuantity}) and purchase order (${poQuantity}).`,
      "warning",
      "lineItems.0.quantity",
    ));
  }

  const poDimensions = normalizeWhitespace(po?.poSummary?.dimensions ?? "").toLowerCase();
  const emailDimensions = normalizeWhitespace(extractDimensions(emailText) ?? "").toLowerCase();
  if (poDimensions && emailDimensions && poDimensions !== emailDimensions) {
    conflicts.push(warning(
      "evidence_dimensions_conflict",
      `Dimensions mismatch between email (${emailDimensions}) and purchase order (${poDimensions}).`,
      "warning",
      "lineItems.0.dimensions",
    ));
  }

  const poMaterial = normalizeWhitespace(po?.poSummary?.material ?? "").toLowerCase();
  const emailMaterial = normalizeWhitespace(firstMatch(emailText, [
    /\b(\d+(?:\.\d+)?\s*mm\s+(?:white\s+)?PVC)\b/i,
    /\b(\d+(?:\.\d+)?\s*mm\s+coroplast)\b/i,
    /\b(\.?\d+\s*magnetic)\b/i,
    /\b(one[-\s]?way vision vinyl|window perf(?:orated)? vinyl)\b/i,
  ]) ?? "").toLowerCase();
  if (poMaterial && emailMaterial && poMaterial !== emailMaterial) {
    conflicts.push(warning(
      "evidence_material_conflict",
      `Material mismatch between email (${emailMaterial}) and purchase order (${poMaterial}).`,
      "warning",
      "lineItems.0.materialText",
    ));
  }

  const poDate = po?.poSummary?.dueDate ?? null;
  const emailDate = emailText ? inferInboundRequestedDate({ text: emailText })?.parsedDate ?? null : null;
  if (poDate && emailDate && poDate !== emailDate) {
    conflicts.push(warning(
      "evidence_due_date_conflict",
      `Due date mismatch between email (${emailDate}) and purchase order (${poDate}).`,
      "warning",
      "order.requestedDueDate",
    ));
  }

  const poProduct = normalizeWhitespace(po?.poSummary?.productDescription ?? "").toLowerCase();
  const emailProduct = normalizeWhitespace(firstMatch(emailText, [
    /\b(\d+(?:,\d{3})*\s+.{3,120}?(?:signs?|banners?|posters?|decals?|stickers?|prints?))\b/i,
    /\b(?:need|print|order)\s+(.{3,120}?(?:signs?|banners?|posters?|decals?|stickers?|prints?))\b/i,
  ]) ?? "").toLowerCase();
  if (poProduct && emailProduct && !emailProduct.includes(poProduct) && !poProduct.includes(emailProduct.replace(/^\d+\s+/, ""))) {
    conflicts.push(warning(
      "evidence_product_conflict",
      `Product description mismatch between email (${emailProduct}) and purchase order (${poProduct}).`,
      "warning",
      "lineItems.0.productName",
    ));
  }

  return conflicts;
}

export async function extractMachineReadablePdfText(buffer: Buffer | Uint8Array): Promise<{ text: string; pageCount: number }> {
  try {
    const nativeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const mod = await nativeImport("pdfjs-dist/legacy/build/pdf.mjs");
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
  } catch {
    return extractPdfTextFromCompressedStreams(buffer);
  }
}

function extractPdfTextFromCompressedStreams(buffer: Buffer | Uint8Array): { text: string; pageCount: number } {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const binary = bytes.toString("latin1");
  const pageCount = Math.max(1, (binary.match(/\/Type\s*\/Page\b/g) ?? []).length);
  const texts: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(binary)) !== null) {
    const raw = Buffer.from(match[1], "latin1");
    let decoded: string | null = null;
    try {
      decoded = inflateSync(raw).toString("latin1");
    } catch {
      decoded = raw.toString("latin1");
    }
    for (const hex of Array.from(decoded.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g))) {
      const compact = hex[1].replace(/\s+/g, "");
      if (compact.length % 2 === 0) texts.push(Buffer.from(compact, "hex").toString("utf8"));
    }
    for (const literal of Array.from(decoded.matchAll(/\(([^()]*)\)\s*Tj/g))) {
      texts.push(literal[1].replace(/\\([()\\])/g, "$1"));
    }
  }
  return {
    text: normalizeWhitespace(texts.join("\n")).slice(0, MAX_ATTACHMENT_TEXT_CHARS),
    pageCount,
  };
}

export class InboundOrderEvidenceService {
  async buildEvidenceBundle(args: {
    organizationId: string;
    record: InboundOrderRecord;
    files: InboundOrderFile[];
    manualClassifications?: Map<string, ManualAttachmentClassificationEvidence>;
  }): Promise<InboundOrderEvidenceBundle> {
    const evidence = getManualInboundEvidence(args.record);
    const items: InboundOrderEvidenceItem[] = [];

    if (evidence.subject) {
      items.push({ type: "EMAIL_SUBJECT", label: "Email Subject", rawText: evidence.subject, documentType: "unknown", documentConfidence: 0, extractionStatus: "not_attempted", warnings: [] });
    }
    if (evidence.bodyText) {
      items.push({ type: "EMAIL_BODY", label: "Email Body", rawText: evidence.bodyText, documentType: "unknown", documentConfidence: 0, extractionStatus: "not_attempted", warnings: [] });
    }
    if (evidence.notes) {
      items.push({ type: "MANUAL_NOTES", label: "Manual Notes", rawText: evidence.notes, documentType: "unknown", documentConfidence: 0, extractionStatus: "not_attempted", warnings: [] });
    }

    for (const file of args.files) {
      const manual = args.manualClassifications?.get(`file:${file.id}`)
        ?? (file.fileRecordId ? args.manualClassifications?.get(`record:${file.fileRecordId}`) : undefined);
      const attachment = await this.buildAttachmentEvidence(args.record, file, manual);
      if (attachment) items.push(attachment);
    }

    const prioritizedItems = prioritizeEvidenceItems(items);
    return {
      items: prioritizedItems,
      conflicts: detectEvidenceConflicts(prioritizedItems),
    };
  }

  private async buildAttachmentEvidence(
    record: InboundOrderRecord,
    file: InboundOrderFile,
    manual?: ManualAttachmentClassificationEvidence,
  ): Promise<InboundOrderEvidenceItem | null> {
    if (manual?.classification === "IGNORE_INLINE" || manual?.classification === "OTHER") return null;
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
          return applyManualClassificationToEvidence({
            ...base,
            type: "PDF_ATTACHMENT",
            rawText: null,
            pageCount: null,
            ...attachmentDocumentFallback(file),
            extractionStatus: "failed",
            poSummary: null,
            warnings: [warning(
              "attachment_unreadable",
              file.role === "po"
                ? "PO candidate PDF was stored, but text was not extracted."
                : "PDF attachment could not be read for parsing.",
              "warning",
            )],
          }, manual, record);
        }
        const extracted = await extractMachineReadablePdfText(buffer);
        const detected = detectAttachmentDocument(extracted.text, fileName);
        const poSummary = detected.documentType === "purchase_order"
          ? extractPurchaseOrderFields({ text: extracted.text, receivedAt: record.receivedAt, sourceDocument: fileName })
          : null;
        return applyManualClassificationToEvidence({
          ...base,
          type: "PDF_ATTACHMENT",
          rawText: extracted.text,
          pageCount: extracted.pageCount,
          ...detected,
          extractionStatus: "successful",
          poSummary,
          warnings: [],
        }, manual, record);
      } catch (error: any) {
        return applyManualClassificationToEvidence({
          ...base,
          type: "PDF_ATTACHMENT",
          rawText: null,
          pageCount: null,
          ...attachmentDocumentFallback(file),
          extractionStatus: "failed",
          poSummary: null,
          warnings: [warning("pdf_text_extraction_failed", error?.message ?? "PDF text extraction failed.", "warning")],
        }, manual, record);
      }
    }

    if (/^text\//i.test(mimeType) && file.fileRecordId) {
      const buffer = await this.readCanonicalFile(file.fileRecordId);
      const rawText = buffer?.toString("utf8").slice(0, MAX_ATTACHMENT_TEXT_CHARS) ?? null;
      if (!rawText) return null;
      const detected = detectAttachmentDocument(rawText, fileName);
      return applyManualClassificationToEvidence({
        ...base,
        type: "TEXT_ATTACHMENT",
        rawText,
        pageCount: null,
        ...detected,
        extractionStatus: "successful",
        poSummary: detected.documentType === "purchase_order"
          ? extractPurchaseOrderFields({ text: rawText, receivedAt: record.receivedAt, sourceDocument: fileName })
          : null,
        warnings: [],
      }, manual, record);
    }

    return applyManualClassificationToEvidence({
      ...base,
      type: "TEXT_ATTACHMENT",
      rawText: file.reviewNotes ?? null,
      pageCount: null,
      ...attachmentDocumentFallback(file),
      extractionStatus: "not_attempted",
      poSummary: null,
      warnings: [],
    }, manual, record);
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
