import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { isCommerciallyRemovedLine } from "../services/lineItemBundles";
import { projectDocumentLineGroups } from "@shared/documentLinePresentation";

export class OrderPdfEligibilityError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "OrderPdfEligibilityError";
    this.statusCode = statusCode;
  }
}

type OrderPdfLineItem = {
  id?: string | null;
  productId?: string | null;
  product?: { name?: string | null } | null;
  productName?: string | null;
  productVariant?: { name?: string | null } | null;
  variantName?: string | null;
  description?: string | null;
  width?: string | number | null;
  height?: string | number | null;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  totalPrice?: string | number | null;
  status?: string | null;
  selectedOptions?: Array<{ optionName?: string | null; value?: unknown; note?: string | null }> | null;
  optionSelectionsJson?: unknown;
  specsJson?: Record<string, unknown> | null;
  materialUsageJson?: Array<{ materialName?: string | null }> | null;
  materialUsages?: Array<{ materialName?: string | null; materialLabel?: string | null; name?: string | null }> | null;
  parentLineItemId?: string | null;
  lineItemRole?: "standalone" | "parent" | "child" | null;
  childDisplayMode?: "hidden" | "visible_summary" | "visible_detail" | null;
  sortOrder?: number | null;
  pbv2SnapshotJson?: unknown;
  productionNotes?: string | null;
};

type OrderPdfInput = {
  order: {
    id?: string | null;
    orderNumber?: string | number | null;
    displayNumber?: string | null;
    poNumber?: string | null;
    label?: string | null;
    createdAt?: string | Date | null;
    dueDate?: string | Date | null;
    promisedDate?: string | Date | null;
    requestedDueDate?: string | Date | null;
    shippingMethod?: string | null;
    fulfillmentMethod?: string | null;
    subtotal?: string | number | null;
    tax?: string | number | null;
    taxAmount?: string | number | null;
    shippingCents?: number | null;
    total?: string | number | null;
    customer?: { companyName?: string | null; name?: string | null; email?: string | null } | null;
    contact?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
    billToName?: string | null;
    billToCompany?: string | null;
    billToEmail?: string | null;
    lineItems?: OrderPdfLineItem[] | null;
  };
  artworkRefs?: Array<{ orderLineItemId?: string | null; filename: string; role?: string | null }>;
  organization?: {
    name?: string | null;
    settings?: { currency?: string | null } | null;
  } | null;
};

type OrderPdfEligibility = {
  eligible: boolean;
  reason: string | null;
  lineItems: OrderPdfLineItem[];
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

function displayOrderNumber(order: OrderPdfInput["order"]): string {
  return String(order.displayNumber || order.orderNumber || order.id || "order");
}

function normalizeFulfillmentMethod(order: OrderPdfInput["order"]): string {
  const value = String(order.fulfillmentMethod || order.shippingMethod || "").trim();
  if (!value) return "Not specified";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function isValidPdfLineItem(lineItem: OrderPdfLineItem): boolean {
  if (lineItem.status === "canceled" || lineItem.status === "draft") return false;
  return (
    hasText(lineItem.id) &&
    hasText(lineItem.productId) &&
    toNumber(lineItem.quantity) > 0 &&
    Number.isFinite(toNumber(lineItem.totalPrice))
  );
}

export function getOrderPdfEligibility(order: OrderPdfInput["order"]): OrderPdfEligibility {
  const lineItems = Array.isArray(order.lineItems)
    ? order.lineItems.filter((lineItem) => !isCommerciallyRemovedLine(lineItem))
    : [];

  if (!hasText(order.id)) {
    return { eligible: false, reason: "Saved order ID is required.", lineItems: [] };
  }
  if (lineItems.length === 0) {
    return { eligible: false, reason: "At least one line item is required to generate an order PDF.", lineItems };
  }
  if (!lineItems.some(isValidPdfLineItem)) {
    return { eligible: false, reason: "At least one complete saved line item is required to generate an order PDF.", lineItems };
  }

  return { eligible: true, reason: null, lineItems: lineItems.filter(isValidPdfLineItem) };
}

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const words = String(text || "").replace(/\r/g, "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
      if (current) { lines.push(current); current = ""; }
      let piece = "";
      for (const char of word) {
        if (piece && font.widthOfTextAtSize(piece + char, fontSize) > maxWidth) { lines.push(piece); piece = char; }
        else piece += char;
      }
      current = piece;
      continue;
    }
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

export async function generateOrderPdfBytes(input: OrderPdfInput): Promise<Uint8Array> {
  const eligibility = getOrderPdfEligibility(input.order);
  if (!eligibility.eligible) {
    throw new OrderPdfEligibilityError(eligibility.reason ?? "Order is not eligible for PDF generation.");
  }

  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const currency = String(input.organization?.settings?.currency || "USD").toUpperCase();
  const orderNumber = displayOrderNumber(input.order);
  const groups = projectDocumentLineGroups(eligibility.lineItems, "order");

  let y = PAGE_HEIGHT - MARGIN;
  drawText(page, input.organization?.name || "Order", MARGIN, y, bold, 18);
  drawRight(page, `Order ${orderNumber}`, PAGE_WIDTH - MARGIN, y, bold, 18);

  y -= 28;
  const orderDate = formatDate(input.order.createdAt);
  if (orderDate) drawText(page, `Order date: ${orderDate}`, MARGIN, y, regular, 10);
  const dueDate = formatDate(input.order.dueDate || input.order.promisedDate || input.order.requestedDueDate);
  if (dueDate) drawRight(page, `Due: ${dueDate}`, PAGE_WIDTH - MARGIN, y, regular, 10);

  y -= 16;
  if (hasText(input.order.label)) {
    drawText(page, `Job: ${input.order.label}`, MARGIN, y, regular, 10);
    y -= 15;
  }
  if (hasText(input.order.poNumber)) {
    drawText(page, `PO: ${input.order.poNumber}`, MARGIN, y, regular, 10);
  }
  drawRight(page, `Fulfillment: ${normalizeFulfillmentMethod(input.order)}`, PAGE_WIDTH - MARGIN, y, regular, 10);

  y -= 34;
  drawText(page, "Customer", MARGIN, y, bold, 11);
  y -= 16;
  const contactName = `${input.order.contact?.firstName ?? ""} ${input.order.contact?.lastName ?? ""}`.trim();
  const customerLines = [
    input.order.billToCompany,
    input.order.customer?.companyName,
    input.order.billToName,
    input.order.customer?.name,
    contactName,
    input.order.billToEmail,
    input.order.contact?.email,
    input.order.customer?.email,
  ].filter((value): value is string => hasText(value));
  for (const line of Array.from(new Set(customerLines)).slice(0, 5)) {
    drawText(page, line, MARGIN, y, regular, 10);
    y -= 13;
  }

  y -= 22;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.82, 0.86, 0.9) });
  y -= 18;
  drawText(page, "Item", MARGIN, y, bold, 10);
  drawRight(page, "Qty", 380, y, bold, 10);
  drawRight(page, "Size", 452, y, bold, 10);
  drawRight(page, "Total", PAGE_WIDTH - MARGIN, y, bold, 10);
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.82, 0.86, 0.9) });
  y -= 18;

  const newItemPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    drawText(page, `Order ${orderNumber} - continued`, MARGIN, y, bold, 11);
    y -= 28;
  };
  const artworkByLine = new Map<string, string[]>();
  for (const artwork of input.artworkRefs ?? []) {
    if (!artwork.orderLineItemId || !hasText(artwork.filename)) continue;
    const prior = artworkByLine.get(artwork.orderLineItemId) ?? [];
    const reference = `${artwork.role === "artwork" ? "Artwork" : "File"}: ${artwork.filename}`;
    if (!prior.includes(reference)) artworkByLine.set(artwork.orderLineItemId, [...prior, reference]);
  }
  const detailText = (row: (typeof groups)[number]["rows"][number]) => [
    row.description ? `Description: ${row.description}` : null,
    row.material ? `Material: ${row.material}` : null,
    ...row.productionOptions,
    row.productionNotes ? `Production instructions: ${row.productionNotes}` : null,
    ...(row.line.id ? artworkByLine.get(row.line.id) ?? [] : []),
  ].filter((value): value is string => !!value);
  const rowHeight = (row: (typeof groups)[number]["rows"][number]) => {
    const titleHeight = wrapText(row.name, row.depth ? 245 : 260, bold, 10).length * 12;
    const detailHeight = detailText(row).flatMap((part) => wrapText(part, 480 - Math.min(row.depth, 2) * 12, regular, 8)).length * 10;
    return Math.max(34, titleHeight + detailHeight + 14);
  };
  for (const group of groups) {
    const groupHeight = group.rows.reduce((sum, row) => sum + rowHeight(row), 0);
    if (groupHeight <= PAGE_HEIGHT - 2 * MARGIN - 55 && y - groupHeight < 118) newItemPage();
    for (const row of group.rows) {
      const indent = Math.min(row.depth, 2) * 12;
      const titleLines = wrapText(row.name, 260 - indent, bold, 10);
      if (y - titleLines.length * 12 - (row.depth ? 11 : 0) < 105) newItemPage();
      if (row.depth) drawText(page, "Child item - runs with above", MARGIN + indent, y, regular, 8, rgb(0.32, 0.36, 0.42));
      const titleY = row.depth ? y - 11 : y;
      titleLines.forEach((title, index) => {
        drawText(page, title, MARGIN + indent, titleY - index * 12, bold, 10);
      });
      drawRight(page, String(toNumber(row.line.quantity)), 380, titleY, regular, 10);
      if (row.dimensions) drawRight(page, row.dimensions, 475, titleY, regular, 9);
      drawRight(page, formatMoney(toCentsFromDecimal(row.line.totalPrice), currency), PAGE_WIDTH - MARGIN, titleY, regular, 10);
      y = titleY - titleLines.length * 12;
      for (const detail of detailText(row)) {
        for (const wrapped of wrapText(detail, 480 - indent, regular, 8)) {
          if (y < 105) newItemPage();
          drawText(page, wrapped, MARGIN + indent, y, regular, 8, rgb(0.32, 0.36, 0.42));
          y -= 10;
        }
      }
      y -= 14;
    }
  }

  if (y < 152) newItemPage();
  y -= 8;
  page.drawLine({ start: { x: 350, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.82, 0.86, 0.9) });
  y -= 18;

  const subtotalCents = toCentsFromDecimal(input.order.subtotal);
  const taxCents = toCentsFromDecimal(input.order.taxAmount ?? input.order.tax);
  const shippingCents = Math.max(0, Math.round(Number(input.order.shippingCents ?? 0)));
  const totalCents = toCentsFromDecimal(input.order.total);

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

export function orderPdfFilename(order: { id?: string | null; orderNumber?: string | number | null; displayNumber?: string | null }): string {
  const safe = displayOrderNumber(order).replace(/[^a-z0-9._-]+/gi, "-");
  return `Order_${safe}.pdf`;
}
