import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getCustomerVisibleBundleLines } from "../services/lineItemBundles";

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
};

type OrderPdfInput = {
  order: {
    id?: string | null;
    orderNumber?: string | number | null;
    displayNumber?: string | null;
    poNumber?: string | null;
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
    ? getCustomerVisibleBundleLines(order.lineItems).filter((lineItem) => lineItem.status !== "canceled")
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

function lineItemName(lineItem: OrderPdfLineItem): string {
  const productName = lineItem.product?.name || lineItem.productName || null;
  const variantName = lineItem.productVariant?.name || lineItem.variantName || null;
  return [productName, variantName].filter((value) => hasText(value)).join(" - ") || lineItem.description || "Line item";
}

function lineItemMaterials(lineItem: OrderPdfLineItem): string | null {
  const materialUsages = Array.isArray(lineItem.materialUsages) ? lineItem.materialUsages : [];
  const legacyUsages = Array.isArray(lineItem.materialUsageJson) ? lineItem.materialUsageJson : [];
  const names = [...materialUsages, ...legacyUsages]
    .map((usage: any) => usage.materialName || usage.materialLabel || usage.name)
    .filter((value: unknown): value is string => hasText(value));
  return names.length ? Array.from(new Set(names)).join(", ") : null;
}

function lineItemOptionNotes(lineItem: OrderPdfLineItem): string[] {
  const selected = Array.isArray(lineItem.selectedOptions) ? lineItem.selectedOptions : [];
  return selected
    .map((option) => {
      const name = String(option.optionName || "").trim();
      const value = option.value == null ? "" : String(option.value).trim();
      const note = String(option.note || "").trim();
      return [name && value ? `${name}: ${value}` : name || value, note].filter(Boolean).join(" - ");
    })
    .filter(Boolean)
    .slice(0, 4);
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

  let y = PAGE_HEIGHT - MARGIN;
  drawText(page, input.organization?.name || "Order", MARGIN, y, bold, 18);
  drawRight(page, `Order ${orderNumber}`, PAGE_WIDTH - MARGIN, y, bold, 18);

  y -= 28;
  const orderDate = formatDate(input.order.createdAt);
  if (orderDate) drawText(page, `Order date: ${orderDate}`, MARGIN, y, regular, 10);
  const dueDate = formatDate(input.order.dueDate || input.order.promisedDate || input.order.requestedDueDate);
  if (dueDate) drawRight(page, `Due: ${dueDate}`, PAGE_WIDTH - MARGIN, y, regular, 10);

  y -= 16;
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

  for (const lineItem of eligibility.lineItems) {
    if (y < 150) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }

    const nameLines = wrapText(lineItemName(lineItem), 265, regular, 10).slice(0, 2);
    for (let index = 0; index < nameLines.length; index += 1) {
      drawText(page, nameLines[index], MARGIN, y - index * 12, index === 0 ? bold : regular, 10);
    }

    const detailLines = [
      lineItemMaterials(lineItem) ? `Material: ${lineItemMaterials(lineItem)}` : null,
      ...lineItemOptionNotes(lineItem),
    ].filter((value): value is string => hasText(value));

    let detailY = y - nameLines.length * 12;
    for (const detail of detailLines.slice(0, 4)) {
      for (const wrapped of wrapText(detail, 275, regular, 8).slice(0, 2)) {
        drawText(page, wrapped, MARGIN, detailY, regular, 8, rgb(0.32, 0.36, 0.42));
        detailY -= 10;
      }
    }

    drawRight(page, String(toNumber(lineItem.quantity)), 380, y, regular, 10);
    const size = toNumber(lineItem.width) > 0 && toNumber(lineItem.height) > 0
      ? `${toNumber(lineItem.width)} x ${toNumber(lineItem.height)}`
      : "";
    drawRight(page, size, 452, y, regular, 10);
    drawRight(page, formatMoney(toCentsFromDecimal(lineItem.totalPrice), currency), PAGE_WIDTH - MARGIN, y, regular, 10);
    y -= Math.max(34, nameLines.length * 12 + detailLines.length * 10 + 14);
  }

  y = Math.max(y - 8, 98);
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
