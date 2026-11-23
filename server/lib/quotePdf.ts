import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import {
  buildDocumentAddressBlock,
  joinNonEmptyDocumentValues,
  resolveCompanyDocumentBranding,
  type CompanyDocumentBranding,
  type CompanyDocumentBrandingInput,
} from "./documentCompanyBranding";
import { hydrateLineItemEditPricingState } from "@shared/lineItemPriceOverrides";
import { isCommerciallyRemovedLine } from "../services/lineItemBundles";
import { projectCommercialDocumentLines } from "@shared/commercialDocumentLines";
import { presentDocumentLine } from "@shared/documentLinePresentation";
import { quoteDisplayUnitPriceCents, quoteFulfillmentLabel, quoteShippingChargeLabel } from "@shared/quoteDocumentPresentation";
import { tryDecodeDataUrl, wrapText } from "./commercialPdfDrawing";
import { DEFAULT_INVOICE_PDF_THEME, type Rgb } from "./invoicePdfTheme";

export class QuotePdfEligibilityError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "QuotePdfEligibilityError";
    this.statusCode = statusCode;
  }
}

type QuotePdfLineItem = {
  displayOrder?: number | null;
  id?: string | null;
  productId?: string | null;
  productName?: string | null;
  variantName?: string | null;
  width?: string | number | null;
  height?: string | number | null;
  quantity?: string | number | null;
  linePrice?: string | number | null;
  specsJson?: unknown;
  pbv2SnapshotJson?: unknown;
  optionSelectionsJson?: unknown;
  selectedOptions?: unknown;
  overridePriceCents?: string | number | null;
  effectiveTotalCents?: string | number | null;
  status?: string | null;
  description?: string | null;
  parentLineItemId?: string | null;
  lineItemRole?: "standalone" | "parent" | "child" | null;
  childDisplayMode?: "hidden" | "visible_summary" | "visible_detail" | null;
};

type QuotePdfInput = {
  quote: {
    id?: string | null;
    quoteNumber?: number | string | null;
    displayNumber?: string | null;
    label?: string | null;
    customerNotes?: string | null;
    status?: string | null;
    customerName?: string | null;
    billToName?: string | null;
    billToCompany?: string | null;
    billToAddress1?: string | null;
    billToAddress2?: string | null;
    billToCity?: string | null;
    billToState?: string | null;
    billToPostalCode?: string | null;
    billToCountry?: string | null;
    billToPhone?: string | null;
    billToEmail?: string | null;
    requestedDueDate?: string | Date | null;
    createdAt?: string | Date | null;
    validUntil?: string | Date | null;
    subtotal?: string | number | null;
    discountAmount?: string | number | null;
    taxAmount?: string | number | null;
    shippingCents?: number | null;
    shippingMethod?: string | null;
    totalPrice?: string | number | null;
    lineItems?: QuotePdfLineItem[] | null;
  };
  organization?: {
    id?: string | null;
    name?: string | null;
    settings?: { currency?: string | null } | null;
  } | null;
  companySettings?: CompanyDocumentBrandingInput;
  artworkThumbnails?: ReadonlyMap<string, string>;
};

type QuotePdfEligibility = {
  eligible: boolean;
  reason: string | null;
  lineItems: QuotePdfLineItem[];
};

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sameText(a: unknown, b: unknown): boolean {
  const left = cleanText(a).toLowerCase();
  const right = cleanText(b).toLowerCase();
  return !!left && left === right;
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
    toNumber(lineItem.quantity) > 0 &&
    Number.isFinite(hydrateLineItemEditPricingState(lineItem).effectiveTotalCents)
  );
}

function getPdfLineItemTotalCents(lineItem: QuotePdfLineItem): number {
  return hydrateLineItemEditPricingState(lineItem).effectiveTotalCents;
}

export function getQuotePdfEligibility(quote: QuotePdfInput["quote"]): QuotePdfEligibility {
  const lineItems = Array.isArray(quote.lineItems)
    ? quote.lineItems.filter((lineItem) => !isCommerciallyRemovedLine(lineItem))
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

function pushUnique(lines: string[], value: unknown) {
  const text = cleanText(value);
  if (!text) return;
  if (lines.some((line) => sameText(line, text))) return;
  lines.push(text);
}

export function buildQuotePdfBillToLines(quote: QuotePdfInput["quote"]): string[] {
  const lines: string[] = [];
  const company = cleanText(quote.billToCompany) || cleanText(quote.customerName);
  const contactName = cleanText(quote.billToName);

  pushUnique(lines, company || contactName || "Customer");
  if (contactName && !sameText(contactName, company)) {
    pushUnique(lines, contactName);
  }

  const nameValues = [company, contactName, quote.customerName].filter(Boolean);
  const addressCandidates = buildDocumentAddressBlock({
    line1: quote.billToAddress1,
    line2: quote.billToAddress2,
    city: quote.billToCity,
    state: quote.billToState,
    postalCode: quote.billToPostalCode,
    country: quote.billToCountry,
  }).split("\n");

  for (const addressLine of addressCandidates) {
    if (!addressLine) continue;
    if (nameValues.some((name) => sameText(addressLine, name))) continue;
    pushUnique(lines, addressLine);
  }

  pushUnique(lines, quote.billToPhone);
  pushUnique(lines, quote.billToEmail);

  return lines;
}

export async function resolveQuotePdfCompanyBranding(input: QuotePdfInput): Promise<CompanyDocumentBranding> {
  const companySettings = input.companySettings
    ? input.companySettings
    : {
        organizationId: input.organization?.id ?? null,
        companyDisplayName: input.organization?.name ?? null,
        companyName: input.organization?.name ?? null,
      };
  const branding = await resolveCompanyDocumentBranding(companySettings);
  return {
    ...branding,
    companyDisplayName: branding.companyDisplayName || input.organization?.name || "Quote",
  };
}

export async function generateQuotePdfBytes(input: QuotePdfInput): Promise<Uint8Array> {
  const { quote } = input;
  const eligibility = getQuotePdfEligibility(quote);
  if (!eligibility.eligible) {
    throw new QuotePdfEligibilityError(eligibility.reason ?? "Quote is not eligible for PDF generation.");
  }

  const theme = DEFAULT_INVOICE_PDF_THEME;
  const { width, height, margin } = theme.page;
  const rightX = width - margin;
  const contentWidth = rightX - margin;
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts[theme.fonts.regular]);
  const bold = await pdfDoc.embedFont(StandardFonts[theme.fonts.bold]);
  const supported = new Set(regular.getCharacterSet());
  const printable = (text: string) => Array.from(text, char => {
    if (char === "\n" || char === "\r" || supported.has(char.codePointAt(0)!)) return char;
    return /\s/.test(char) ? " " : "?";
  }).join("");
  const currency = String(input.organization?.settings?.currency || "USD").toUpperCase();
  const quoteNumber = quote.displayNumber || quote.quoteNumber;
  const title = quoteNumber ? `QUOTE #${quoteNumber}` : "QUOTE";
  const branding = await resolveQuotePdfCompanyBranding(input);
  let page = pdfDoc.addPage([width, height]);
  let y = height - margin;

  const draw = (text: string, x: number, atY: number, size = theme.fontSizes.body, weight: PDFFont = regular, color: Rgb = theme.colors.text) =>
    page.drawText(printable(text), { x, y: atY, size, font: weight, color: rgb(...color) });
  const drawRight = (text: string, x: number, atY: number, size = theme.fontSizes.body, weight: PDFFont = regular, color: Rgb = theme.colors.text) =>
    draw(text, x - weight.widthOfTextAtSize(printable(text), size), atY, size, weight, color);
  const wrap = (text: string, maxWidth: number, fontSize: number, font = regular, maxLines?: number) =>
    wrapText({ text: printable(text), maxWidth, font, fontSize, maxLines });

  function newPage() {
    page = pdfDoc.addPage([width, height]);
    y = height - margin;
    drawRight(title, rightX, y, theme.fontSizes.h2, bold, theme.colors.mutedText);
    y -= 24;
  }

  async function embedDataImage(dataUrl?: string | null) {
    const decoded = dataUrl ? tryDecodeDataUrl(dataUrl) : null;
    if (!decoded) return null;
    try {
      return await (decoded.mime === "png" ? pdfDoc.embedPng(decoded.bytes) : pdfDoc.embedJpg(decoded.bytes));
    } catch {
      return null;
    }
  }

  const top = y;
  let logoWidth = 0;
  let logoHeight = 0;
  const logo = await embedDataImage(branding.logoDataUrl);
  if (logo) {
    const scale = Math.min(88 / logo.width, 44 / logo.height, 1);
    logoWidth = logo.width * scale;
    logoHeight = logo.height * scale;
    page.drawImage(logo, { x: margin, y: top + 2 - logoHeight, width: logoWidth, height: logoHeight });
  }
  const brandGap = logoWidth > 0 ? 14 : 0;
  const brandWidth = Math.max(190, contentWidth - logoWidth - brandGap - 220);
  const brandLines = [
    branding.companyDisplayName,
    branding.showLegalCompanyName ? branding.legalCompanyName : null,
    branding.physicalAddress,
    joinNonEmptyDocumentValues([branding.phone || null, branding.email || null], " | "),
    branding.website,
  ].filter((line): line is string => hasText(line)).flatMap((line, index) => {
    const font = index === 0 ? bold : regular;
    return wrap(line, brandWidth, theme.fontSizes.small, font, index === 0 ? 2 : 3).map(text => ({ text, font }));
  });
  const brandTextHeight = Math.max(10, brandLines.length * 10);
  const brandHeight = Math.max(logoHeight, brandTextHeight);
  const brandY = top - (brandHeight - brandTextHeight) / 2;
  brandLines.forEach(({ text, font }, index) =>
    draw(text, margin + logoWidth + brandGap, brandY - index * 10, theme.fontSizes.small, font, theme.colors.mutedText));
  drawRight(title, rightX, top - theme.header.titleOffsetY, theme.fontSizes.title, bold);

  let metaY = top - theme.header.metaStartOffsetY;
  for (const [label, value] of [["Quote date", quote.createdAt], ["Valid until", quote.validUntil], ["Requested due", quote.requestedDueDate]] as const) {
    const date = formatDate(value);
    if (!date) continue;
    drawRight(`${label} ${date}`, rightX, metaY, theme.fontSizes.small, regular, theme.colors.mutedText);
    metaY -= theme.header.metaLineHeight;
  }

  y = Math.min(top - brandHeight - 16, metaY - 8);
  draw("BILL TO", margin, y, theme.fontSizes.h2, bold);
  y -= 14;
  for (const line of buildQuotePdfBillToLines(quote).flatMap(value => wrap(value, contentWidth, theme.fontSizes.body))) {
    if (y < margin + 13) newPage();
    draw(line, margin, y);
    y -= 13;
  }

  y -= 14;
  const job = cleanText(quote.label);
  const contextLines = [
    ...(job ? wrap(`Job Description: ${job}`, contentWidth - 20, theme.fontSizes.small, bold) : []),
    `Fulfillment: ${quoteFulfillmentLabel(quote.shippingMethod)}`,
  ];
  // Split unusually long job descriptions without drawing below the page margin.
  let contextIndex = 0;
  while (contextIndex < contextLines.length) {
    if (y < margin + 44) newPage();
    const lines = contextLines.slice(contextIndex, contextIndex + Math.floor((y - margin - 20) / 12));
    const barHeight = 10 + lines.length * 12;
    page.drawRectangle({ x: margin, y: y - barHeight + 4, width: contentWidth, height: barHeight, color: rgb(...theme.colors.jobBarBg) });
    lines.forEach((line, i) => draw(line, margin + 10, y - 12 - i * 12, theme.fontSizes.small, bold));
    y -= barHeight + 10;
    contextIndex += lines.length;
  }

  const descriptionX = margin + theme.columns.thumb + theme.columns.gap;
  const quantityRight = rightX - theme.columns.price;
  const descriptionWidth = quantityRight - theme.columns.qty - theme.columns.gap - descriptionX;
  function tableHeader() {
    page.drawRectangle({ x: margin, y: y - 16, width: contentWidth, height: 20, color: rgb(...theme.colors.tableHeaderBg) });
    draw("DESCRIPTION", descriptionX, y - 11, theme.fontSizes.small, bold, theme.colors.mutedText);
    drawRight("QTY", quantityRight, y - 11, theme.fontSizes.small, bold, theme.colors.mutedText);
    drawRight("PRICE", rightX, y - 11, theme.fontSizes.small, bold, theme.colors.mutedText);
    y -= 28;
  }
  function newTablePage() {
    newPage();
    tableHeader();
  }
  if (y < margin + 80) newPage();
  tableHeader();

  for (const { line, totalCents } of projectCommercialDocumentLines(eligibility.lineItems, getPdfLineItemTotalCents)) {
    const row = presentDocumentLine(line, 0, { hideUnresolvedKeys: true });
    const variant = cleanText(line.variantName);
    const title = variant && !sameText(row.name, variant) ? `${row.name} - ${variant}` : row.name;
    const textRows = [
      ...wrap(title, descriptionWidth, theme.fontSizes.body, bold).map(text => ({ text, name: true })),
      ...[row.description, row.dimensions, ...row.customerOptions].flatMap(text =>
        text ? wrap(text, descriptionWidth, theme.fontSizes.small).map(text => ({ text, name: false })) : []),
    ];
    const rowHeight = Math.max(44, textRows.length * 13 + 12);
    if (y < margin + 52 || (rowHeight <= height - margin * 2 - 70 && y - rowHeight < margin + 10)) newTablePage();
    let rowTop = y;

    const thumbnail = line.id ? await embedDataImage(input.artworkThumbnails?.get(line.id)) : null;
    if (thumbnail) {
      const box = 36;
      const scale = Math.min(box / thumbnail.width, box / thumbnail.height);
      const imageWidth = thumbnail.width * scale;
      const imageHeight = thumbnail.height * scale;
      const boxY = rowTop - box;
      page.drawRectangle({ x: margin, y: boxY, width: box, height: box, color: rgb(...theme.colors.thumbPlaceholderBg), borderColor: rgb(...theme.colors.thumbPlaceholderBorder), borderWidth: 1 });
      page.drawImage(thumbnail, { x: margin + (box - imageWidth) / 2, y: boxY + (box - imageHeight) / 2, width: imageWidth, height: imageHeight });
    }
    drawRight(String(toNumber(line.quantity)), quantityRight, y - 11);
    drawRight(formatMoney(totalCents, currency), rightX, y - 11, theme.fontSizes.body, bold);
    drawRight(`Unit: ${formatMoney(quoteDisplayUnitPriceCents(totalCents, line.quantity), currency)}`, rightX, y - 23, theme.fontSizes.small, regular, theme.colors.mutedText);
    for (const part of textRows) {
      if (y < margin + 25) {
        newTablePage();
        rowTop = y;
        const continued = wrap(`${row.name} (continued)`, descriptionWidth, theme.fontSizes.small, bold, 2);
        for (const text of continued) {
          draw(text, descriptionX, y - 11, theme.fontSizes.small, bold);
          y -= 13;
        }
      }
      draw(part.text, descriptionX, y - 11, part.name ? theme.fontSizes.body : theme.fontSizes.small,
        part.name ? bold : regular, part.name ? theme.colors.text : theme.colors.mutedText);
      y -= 13;
    }
    y = Math.min(y - 6, rowTop - 44);
    page.drawLine({ start: { x: margin, y }, end: { x: rightX, y }, thickness: 1, color: rgb(...theme.colors.border) });
    y -= 6;
  }

  // Saved commercial totals are authoritative; rendering never reprices a Quote.
  const discountCents = toCentsFromDecimal(quote.discountAmount);
  const shippingCents = Math.max(0, Math.round(Number(quote.shippingCents ?? 0)));
  const totals = [
    ["Subtotal", formatMoney(toCentsFromDecimal(quote.subtotal), currency)],
    ...(discountCents > 0 ? [["Discount", `-${formatMoney(discountCents, currency)}`]] : []),
    ...(shippingCents > 0 ? [[quoteShippingChargeLabel(quote.shippingMethod), formatMoney(shippingCents, currency)]] : []),
    ["Tax", formatMoney(toCentsFromDecimal(quote.taxAmount), currency)],
    ["Total", formatMoney(toCentsFromDecimal(quote.totalPrice), currency)],
  ];
  if (y < margin + totals.length * 14 + 16) newPage();
  y -= 6;
  totals.forEach(([label, value], index) => {
    const final = index === totals.length - 1;
    const font = final ? bold : regular;
    const color = final ? theme.colors.text : theme.colors.mutedText;
    if (final) y -= 2;
    draw(label, rightX - 240, y, theme.fontSizes.body, font, color);
    drawRight(value, rightX, y, theme.fontSizes.body, font, color);
    y -= 14;
  });

  const notes = cleanText(quote.customerNotes);
  if (notes) {
    if (y < margin + 44) newPage();
    y -= 10;
    draw("Notes", margin, y, theme.fontSizes.h2, bold);
    y -= 14;
    for (const paragraph of notes.split(/\r?\n/)) {
      for (const line of wrap(paragraph, contentWidth, theme.fontSizes.body).concat(paragraph.trim() ? [] : [""])) {
        if (y < margin + 13) newPage();
        if (line) draw(line, margin, y, theme.fontSizes.body, regular, theme.colors.mutedText);
        y -= 13;
      }
    }
  }

  return pdfDoc.save();
}
