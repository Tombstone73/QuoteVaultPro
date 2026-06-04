import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export class QuotePdfEligibilityError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "QuotePdfEligibilityError";
    this.statusCode = statusCode;
  }
}

type QuotePdfLineItem = {
  id?: string | null;
  productId?: string | null;
  productName?: string | null;
  variantName?: string | null;
  width?: string | number | null;
  height?: string | number | null;
  quantity?: string | number | null;
  linePrice?: string | number | null;
  status?: string | null;
  description?: string | null;
};

type QuotePdfInput = {
  quote: {
    id?: string | null;
    quoteNumber?: number | string | null;
    displayNumber?: string | null;
    label?: string | null;
    status?: string | null;
    customerName?: string | null;
    billToName?: string | null;
    billToCompany?: string | null;
    billToEmail?: string | null;
    requestedDueDate?: string | Date | null;
    validUntil?: string | Date | null;
    subtotal?: string | number | null;
    taxAmount?: string | number | null;
    shippingCents?: number | null;
    totalPrice?: string | number | null;
    lineItems?: QuotePdfLineItem[] | null;
  };
  organization?: {
    name?: string | null;
    settings?: { currency?: string | null } | null;
  } | null;
};

type QuotePdfEligibility = {
  eligible: boolean;
  reason: string | null;
  lineItems: QuotePdfLineItem[];
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toCentsFromDecimal(value: unknown): number {
  return Math.round(Math.max(0, toNumber(value)) * 100);
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function formatDate(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function isValidPdfLineItem(lineItem: QuotePdfLineItem): boolean {
  if (lineItem.status === "canceled" || lineItem.status === "draft") return false;
  return (
    hasText(lineItem.productId) &&
    toNumber(lineItem.width) > 0 &&
    toNumber(lineItem.height) > 0 &&
    toNumber(lineItem.quantity) > 0 &&
    Number.isFinite(toNumber(lineItem.linePrice))
  );
}

export function getQuotePdfEligibility(quote: QuotePdfInput["quote"]): QuotePdfEligibility {
  const lineItems = Array.isArray(quote.lineItems)
    ? quote.lineItems.filter((lineItem) => lineItem.status !== "canceled")
    : [];

  if (!hasText(quote.id)) {
    return { eligible: false, reason: "Saved quote ID is required.", lineItems: [] };
  }
  if (lineItems.length === 0) {
    return { eligible: false, reason: "At least one line item is required to generate a quote PDF.", lineItems };
  }
  if (!lineItems.some(isValidPdfLineItem)) {
    return { eligible: false, reason: "At least one complete saved line item is required to generate a quote PDF.", lineItems };
  }

  return { eligible: true, reason: null, lineItems: lineItems.filter(isValidPdfLineItem) };
}

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const words = String(text || "").replace(/\r/g, "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawText(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = rgb(0.12, 0.16, 0.22)) {
  page.drawText(text, { x, y, size, font, color });
}

function drawRight(page: PDFPage, text: string, rightX: number, y: number, font: PDFFont, size: number) {
  const width = font.widthOfTextAtSize(text, size);
  drawText(page, text, rightX - width, y, font, size);
}

export async function generateQuotePdfBytes(input: QuotePdfInput): Promise<Uint8Array> {
  const eligibility = getQuotePdfEligibility(input.quote);
  if (!eligibility.eligible) {
    throw new QuotePdfEligibilityError(eligibility.reason ?? "Quote is not eligible for PDF generation.");
  }

  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const currency = String(input.organization?.settings?.currency || "USD").toUpperCase();
  const quoteNumber = input.quote.displayNumber || (input.quote.quoteNumber ? String(input.quote.quoteNumber) : input.quote.id || "quote");

  let y = PAGE_HEIGHT - MARGIN;
  drawText(page, input.organization?.name || "Quote", MARGIN, y, bold, 18);
  drawRight(page, `Quote ${quoteNumber}`, PAGE_WIDTH - MARGIN, y, bold, 18);

  y -= 28;
  drawText(page, `Status: ${String(input.quote.status || "draft")}`, MARGIN, y, regular, 10);
  const validUntil = formatDate(input.quote.validUntil);
  if (validUntil) drawRight(page, `Valid until ${validUntil}`, PAGE_WIDTH - MARGIN, y, regular, 10);

  y -= 34;
  drawText(page, "Bill To", MARGIN, y, bold, 11);
  y -= 16;
  const billToLines = [
    input.quote.billToCompany,
    input.quote.billToName,
    input.quote.customerName,
    input.quote.billToEmail,
  ].filter((value): value is string => hasText(value));
  for (const line of billToLines.length ? billToLines : ["Customer"]) {
    drawText(page, line, MARGIN, y, regular, 10);
    y -= 13;
  }

  y -= 22;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.82, 0.86, 0.9) });
  y -= 18;
  drawText(page, "Item", MARGIN, y, bold, 10);
  drawRight(page, "Qty", 390, y, bold, 10);
  drawRight(page, "Size", 462, y, bold, 10);
  drawRight(page, "Total", PAGE_WIDTH - MARGIN, y, bold, 10);
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.82, 0.86, 0.9) });
  y -= 18;

  for (const lineItem of eligibility.lineItems) {
    if (y < 130) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }

    const name = [lineItem.productName, lineItem.variantName].filter((value) => hasText(value)).join(" - ") || "Line item";
    const wrapped = wrapText(name, 270, regular, 10).slice(0, 3);
    for (let index = 0; index < wrapped.length; index += 1) {
      drawText(page, wrapped[index], MARGIN, y - index * 12, index === 0 ? bold : regular, 10);
    }

    drawRight(page, String(toNumber(lineItem.quantity)), 390, y, regular, 10);
    drawRight(page, `${toNumber(lineItem.width)} x ${toNumber(lineItem.height)}`, 462, y, regular, 10);
    drawRight(page, formatMoney(toCentsFromDecimal(lineItem.linePrice), currency), PAGE_WIDTH - MARGIN, y, regular, 10);
    y -= Math.max(26, wrapped.length * 12 + 10);
  }

  y = Math.max(y - 8, 98);
  page.drawLine({ start: { x: 350, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.82, 0.86, 0.9) });
  y -= 18;

  const subtotalCents = toCentsFromDecimal(input.quote.subtotal);
  const taxCents = toCentsFromDecimal(input.quote.taxAmount);
  const shippingCents = Math.max(0, Math.round(Number(input.quote.shippingCents ?? 0)));
  const totalCents = toCentsFromDecimal(input.quote.totalPrice);

  drawText(page, "Subtotal", 370, y, regular, 10);
  drawRight(page, formatMoney(subtotalCents, currency), PAGE_WIDTH - MARGIN, y, regular, 10);
  y -= 16;
  if (shippingCents > 0) {
    drawText(page, "Shipping", 370, y, regular, 10);
    drawRight(page, formatMoney(shippingCents, currency), PAGE_WIDTH - MARGIN, y, regular, 10);
    y -= 16;
  }
  drawText(page, "Tax", 370, y, regular, 10);
  drawRight(page, formatMoney(taxCents, currency), PAGE_WIDTH - MARGIN, y, regular, 10);
  y -= 18;
  drawText(page, "Total", 370, y, bold, 12);
  drawRight(page, formatMoney(totalCents, currency), PAGE_WIDTH - MARGIN, y, bold, 12);

  return pdfDoc.save();
}
