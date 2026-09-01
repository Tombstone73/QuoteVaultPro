import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { resolveInvoicePdfFinancialSummary } from '../../shared/invoiceAccountingDisplay';

import {
  type RemittanceAddress,
} from '@shared/companyInfoInvoiceBranding';
import {
  buildDocumentAddressBlock,
  buildDocumentCompanyBranding,
  cleanDocumentText,
  joinNonEmptyDocumentValues,
  resolveCompanyLogoDataUrl,
  type CompanyDocumentBrandingInput,
} from './documentCompanyBranding';
import { DEFAULT_INVOICE_PDF_THEME, type InvoicePdfTheme, type Rgb } from './invoicePdfTheme';
import { getCustomerVisibleBundleLines } from '../services/lineItemBundles';
import { resolveHourlyServiceCommercialTerms } from '../../shared/hourlyServicePricing';

type CompanySettingsLike = CompanyDocumentBrandingInput & {
  remittanceAddress?: RemittanceAddress | null;
  invoicePaymentInstructions?: string | null;
  invoiceFooterNote?: string | null;
  checksPayableTo?: string | null;
} | null;

type CustomerLike = {
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  billingStreet1?: string | null;
  billingStreet2?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;
  shippingStreet1?: string | null;
  shippingStreet2?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPostalCode?: string | null;
  shippingCountry?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
} | null;

type InvoiceLike = {
  invoiceNumber?: number | null;
  displayNumber?: string | null;
  issueDate?: Date | string | null;
  dueDate?: Date | string | null;
  status?: string | null;
  currency?: string | null;
  subtotalCents?: number | null;
  taxCents?: number | null;
  shippingCents?: number | null;
  totalCents?: number | null;
  notesPublic?: string | null;
  terms?: string | null;
  customTerms?: string | null;
} | null;

type InvoiceLineItemLike = {
  description?: string | null;
  quantity?: number | null;
  unitPriceCents?: number | null;
  lineTotalCents?: number | null;
  unitPrice?: string | number | null;
  totalPrice?: string | number | null;
  name?: string | null;
  sku?: string | null;
  // v1-safe thumbnail strategy: data URLs only (no remote fetch)
  thumbnailDataUrl?: string | null;
  parentLineItemId?: string | null;
  lineItemRole?: "standalone" | "parent" | "child" | null;
  childDisplayMode?: "hidden" | "visible_summary" | "visible_detail" | null;
  pbv2SnapshotJson?: Record<string, any> | null;
} | null;

type InvoicePdfParams = {
  invoice: InvoiceLike;
  customer: CustomerLike;
  companySettings: CompanySettingsLike;
  paymentSummary: {
    totalCents: number;
    amountPaidCents: number;
    amountDueCents: number;
    statusLabel?: string | null;
  };
  lineItems: InvoiceLineItemLike[];
  job?: {
    poNumber?: string | null;
    jobNumber?: string | null;
    jobLabel?: string | null;
  } | null;
  overrides?: {
    // Data URL only (no remote fetch)
    logoDataUrl?: string | null;
    footerText?: string | null;
    showTradeTerms?: boolean;
    // Overrides watermark text when enabled
    watermarkText?: string | null;
  };
};

export function getInvoicePdfWatermarkState(statusLabel: unknown): 'draft' | 'paid' | null {
  const normalized = String(statusLabel || '').trim().toLowerCase();
  if (normalized === 'draft') return 'draft';
  if (normalized === 'paid') return 'paid';
  return null;
}

const toRgb = (c: Rgb) => rgb(c[0], c[1], c[2]);

const joinNonEmpty = joinNonEmptyDocumentValues;

const toSafeCents = (v: unknown): number => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
};

const toCentsFromDecimal = (v: unknown): number => {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
};

const fmtMoney = (cents: number, currency: string) => {
  const safe = toSafeCents(cents);
  const amount = safe / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

const fmtDate = (d: unknown): string => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(dt.getTime())) return '';

  // Deterministic: force UTC so output doesn't vary by server locale/timezone.
  const fmt = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  });
  return fmt.format(dt);
};

const buildAddressBlock = buildDocumentAddressBlock;
const cleanText = cleanDocumentText;

export function resolveInvoiceCompanyDisplayData(companySettings: CompanySettingsLike) {
  const settings = companySettings || {};
  const branding = buildDocumentCompanyBranding(settings);
  const remittanceEnabled = settings.remittanceAddress?.enabled === true;
  const explicitRemittanceAddress = buildAddressBlock({
    line1: settings.remittanceAddress?.line1,
    line2: settings.remittanceAddress?.line2,
    city: settings.remittanceAddress?.city,
    state: settings.remittanceAddress?.state,
    postalCode: settings.remittanceAddress?.postalCode,
    country: settings.remittanceAddress?.country,
    legacy: null,
  });
  const paymentAddress = remittanceEnabled && explicitRemittanceAddress
    ? explicitRemittanceAddress
    : branding.physicalAddress;

  return {
    companyDisplayName: branding.companyDisplayName,
    legalCompanyName: branding.legalCompanyName,
    showLegalCompanyName: branding.showLegalCompanyName,
    physicalAddress: branding.physicalAddress,
    remittanceEnabled,
    paymentAddress,
    paymentAddressLabel: remittanceEnabled && explicitRemittanceAddress
      ? 'Send payments to'
      : 'Payment mailing address',
    phone: branding.phone,
    email: branding.email,
    website: branding.website,
    taxId: branding.taxId,
    invoiceLogoUrl: branding.invoiceLogoUrl,
    invoiceLogoAssetId: branding.invoiceLogoAssetId,
    invoicePaymentInstructions: cleanText(settings.invoicePaymentInstructions),
    invoiceFooterNote: cleanText(settings.invoiceFooterNote),
    checksPayableTo: cleanText(settings.checksPayableTo),
  };
}

function wrapText(params: {
  text: string;
  maxWidth: number;
  font: any;
  fontSize: number;
  maxLines?: number;
}): string[] {
  const raw = String(params.text || '').replace(/\r/g, '');
  const chunks = raw.split('\n');
  const lines: string[] = [];

  const pushLine = (s: string) => {
    if (!s) return;
    lines.push(s);
  };

  for (const chunk of chunks) {
    const words = chunk.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    let current = '';
    for (const w of words) {
      const next = current ? `${current} ${w}` : w;
      const width = params.font.widthOfTextAtSize(next, params.fontSize);
      if (width <= params.maxWidth) {
        current = next;
        continue;
      }
      if (current) pushLine(current);
      current = w;

      if (params.maxLines && lines.length >= params.maxLines) break;
    }
    if (params.maxLines && lines.length >= params.maxLines) break;
    if (current) pushLine(current);

    if (params.maxLines && lines.length >= params.maxLines) break;
  }

  if (params.maxLines && lines.length > params.maxLines) {
    return lines.slice(0, params.maxLines);
  }
  return lines;
}

function statusBadgeBg(label: string, theme: InvoicePdfTheme): Rgb {
  const s = String(label || '').trim().toLowerCase();
  if (s === 'paid') return theme.statusBadge.backgrounds.paid;
  if (s === 'partially paid') return theme.statusBadge.backgrounds.partial;
  if (s === 'unpaid') return theme.statusBadge.backgrounds.unpaid;
  if (s === 'draft') return theme.statusBadge.backgrounds.draft;
  if (s === 'voided') return theme.statusBadge.backgrounds.voided;
  return theme.statusBadge.backgrounds.draft;
}

function tryDecodeDataUrl(dataUrl: string): { mime: 'png' | 'jpeg'; bytes: Uint8Array } | null {
  const raw = String(dataUrl || '').trim();
  if (!raw.startsWith('data:')) return null;

  const m = raw.match(/^data:(image\/(png|jpeg));base64,(.+)$/i);
  if (!m) return null;

  const subtype = String(m[2] || '').toLowerCase();
  const b64 = m[3] || '';
  if (!b64) return null;

  try {
    const buf = Buffer.from(b64, 'base64');
    return { mime: subtype === 'png' ? 'png' : 'jpeg', bytes: new Uint8Array(buf) };
  } catch {
    return null;
  }
}

export async function generateInvoicePdfBytes(invoice: InvoiceLike, theme?: InvoicePdfTheme): Promise<Uint8Array>;
export async function generateInvoicePdfBytes(params: InvoicePdfParams, theme?: InvoicePdfTheme): Promise<Uint8Array>;
export async function generateInvoicePdfBytes(
  arg1: InvoicePdfParams | InvoiceLike,
  theme: InvoicePdfTheme = DEFAULT_INVOICE_PDF_THEME
): Promise<Uint8Array> {
  const params: InvoicePdfParams =
    arg1 && typeof arg1 === 'object' && 'paymentSummary' in (arg1 as any) && 'lineItems' in (arg1 as any)
      ? (arg1 as InvoicePdfParams)
      : {
          invoice: arg1 as InvoiceLike,
          customer: null,
          companySettings: null,
          paymentSummary: resolveInvoicePdfFinancialSummary(arg1 as InvoiceLike),
          lineItems: [],
        };

  const invoice = params.invoice || {};
  const customer = params.customer || {};
  const companySettings = params.companySettings || null;
  const companyDisplay = resolveInvoiceCompanyDisplayData(companySettings);

  const currency = String(invoice.currency || 'USD').toUpperCase();

  const pdfDoc = await PDFDocument.create();

  // Deterministic metadata (do not leak wall-clock time into output).
  const fixedDate = new Date('2000-01-01T00:00:00.000Z');
  try {
    pdfDoc.setCreator('QuoteVaultPro');
    pdfDoc.setProducer('QuoteVaultPro');
    pdfDoc.setCreationDate(fixedDate);
    pdfDoc.setModificationDate(fixedDate);
  } catch {
    // ignore - metadata setters are optional
  }

  let page = pdfDoc.addPage([theme.page.width, theme.page.height]);
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts[theme.fonts.regular]);
  const fontBold = await pdfDoc.embedFont(StandardFonts[theme.fonts.bold]);

  const margin = theme.page.margin;
  const footerReserve = theme.footer.enabled ? theme.footer.reservedHeight : 0;
  const bottomSafeY = margin + footerReserve;
  let y = height - margin;

  const drawText = (text: string, opts: { x: number; y: number; size?: number; bold?: boolean; color?: Rgb }) => {
    page.drawText(text, {
      x: opts.x,
      y: opts.y,
      size: opts.size ?? theme.fontSizes.body,
      font: opts.bold ? fontBold : font,
      color: toRgb(opts.color ?? theme.colors.text),
    });
  };

  const drawTextRight = (text: string, opts: { rightX: number; y: number; size?: number; bold?: boolean; color?: Rgb }) => {
    const size = opts.size ?? theme.fontSizes.body;
    const usedFont = opts.bold ? fontBold : font;
    const w = usedFont.widthOfTextAtSize(text, size);
    drawText(text, { x: opts.rightX - w, y: opts.y, size, bold: opts.bold, color: opts.color });
  };

  const drawWrapped = (text: string, opts: { x: number; y: number; width: number; size?: number; bold?: boolean; color?: Rgb; lineHeight?: number; maxLines?: number }) => {
    const size = opts.size ?? theme.fontSizes.body;
    const usedFont = opts.bold ? fontBold : font;
    const lines = wrapText({ text, maxWidth: opts.width, font: usedFont, fontSize: size, maxLines: opts.maxLines });
    const lh = opts.lineHeight ?? Math.round(size * 1.25);
    let cy = opts.y;
    for (const line of lines) {
      drawText(line, { x: opts.x, y: cy, size, bold: opts.bold, color: opts.color });
      cy -= lh;
    }
    return { bottomY: cy, linesCount: lines.length };
  };

  const resolveLogoDataUrl = async (): Promise<string | null> => {
    const override = (params.overrides?.logoDataUrl || '').trim();
    if (override) return override;

    const themeLogo = (theme.header.logo.dataUrl || '').trim();
    if (themeLogo) return themeLogo;

    return resolveCompanyLogoDataUrl(companySettings);
  };

  const resolveFooterText = (): string => {
    const override = params.overrides?.footerText;
    if (override != null) return String(override).trim();
    if (companyDisplay.invoiceFooterNote) return companyDisplay.invoiceFooterNote;
    return String(theme.footer.text || '').trim();
  };

  const resolveWatermarkText = (): string => {
    const override = (params.overrides?.watermarkText || '').trim();
    if (override) return override;

    if (!theme.watermark.enabled) return '';
    if (theme.watermark.mode === 'none') return '';
    if (theme.watermark.mode === 'paid') return theme.watermark.textPaid;
    if (theme.watermark.mode === 'draft') return theme.watermark.textDraft;

    const watermarkState = getInvoicePdfWatermarkState(params.paymentSummary?.statusLabel);

    if (watermarkState === 'draft') return theme.watermark.textDraft;
    if (watermarkState === 'paid') return theme.watermark.textPaid;
    return '';
  };

  const drawWatermark = () => {
    const text = resolveWatermarkText();
    if (!text) return;

    const size = theme.watermark.fontSize;
    const usedFont = fontBold;
    const w = usedFont.widthOfTextAtSize(text, size);

    // Centered watermark; rotate for a typical stamp look.
    page.drawText(text, {
      x: Math.max(margin, (width - w) / 2),
      y: height / 2,
      size,
      font: usedFont,
      color: toRgb(theme.watermark.color),
      rotate: degrees(theme.watermark.rotationDegrees),
    });
  };

  const drawFooter = () => {
    if (!theme.footer.enabled) return;
    const text = resolveFooterText();
    if (!text) return;

    const size = theme.footer.fontSize;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;

    const lh = Math.max(10, Math.round(size * 1.25));
    // Place footer inside the reserved bottom band, starting near the bottom.
    const startY = Math.max(10, Math.min(margin - 6, 10 + Math.max(0, footerReserve - lh * lines.length)));

    let yy = startY;
    for (const line of lines) {
      if (theme.footer.align === 'left') {
        drawText(line, { x: margin, y: yy, size, color: theme.footer.color });
      } else if (theme.footer.align === 'right') {
        drawTextRight(line, { rightX: width - margin, y: yy, size, color: theme.footer.color });
      } else {
        const usedFont = font;
        const tw = usedFont.widthOfTextAtSize(line, size);
        drawText(line, { x: (width - tw) / 2, y: yy, size, color: theme.footer.color });
      }
      yy += lh;
    }
  };

  const newPage = () => {
    page = pdfDoc.addPage([theme.page.width, theme.page.height]);
    y = height - margin;
    drawWatermark();
    drawFooter();
  };

  // Render page-level decorations on the first page too.
  drawWatermark();
  drawFooter();

  const drawDivider = () => {
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 1,
      color: toRgb(theme.colors.border),
    });
  };

  const drawTitanLogo = (x: number, topY: number): { width: number; height: number } => {
    const markSize = theme.header.titanMarkSize;
    const markY = topY - markSize;

    page.drawRectangle({
      x,
      y: markY,
      width: markSize,
      height: markSize,
      color: rgb(0.1, 0.1, 0.1),
    });

    drawText('TITAN', {
      x: x + markSize + theme.header.titanWordmarkGap,
      y: topY - 14,
      size: theme.header.titanWordmarkFontSize,
      bold: true,
    });

    const wordmarkWidth = fontBold.widthOfTextAtSize('TITAN', theme.header.titanWordmarkFontSize);
    return { width: markSize + theme.header.titanWordmarkGap + wordmarkWidth, height: markSize };
  };

  const drawHeaderLogo = async (x: number, topY: number): Promise<{ width: number; height: number }> => {
    const mode = theme.header.logo.mode;
    const dataUrl = await resolveLogoDataUrl();

    const shouldUseImage =
      mode === 'image' ? !!dataUrl :
      mode === 'titan' ? false :
      mode === 'none' ? false :
      !!dataUrl;

    if (mode === 'none') return { width: 0, height: 0 };

    if (mode === 'titan') {
      return drawTitanLogo(x, topY);
    }

    if (!shouldUseImage) return { width: 0, height: 0 };
    if (!dataUrl) return { width: 0, height: 0 };
    const decoded = tryDecodeDataUrl(dataUrl);
    if (!decoded) {
      return { width: 0, height: 0 };
    }

    const maxW = Math.min(theme.header.logo.maxWidth, 88);
    const maxH = Math.min(theme.header.logo.maxHeight, 44);

    try {
      const img = decoded.mime === 'png'
        ? await pdfDoc.embedPng(decoded.bytes)
        : await pdfDoc.embedJpg(decoded.bytes);

      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      page.drawImage(img, {
        x,
        y: topY - drawH,
        width: drawW,
        height: drawH,
      });
      return { width: drawW, height: drawH };
    } catch {
      // Logo embedding should never block invoice generation.
      return { width: 0, height: 0 };
    }
  };

  const drawStatusBadge = (label: string, rightX: number, topY: number) => {
    const text = String(label || '').trim();
    if (!text) return;

    const size = theme.statusBadge.fontSize;
    const paddingX = theme.statusBadge.paddingX;
    const paddingY = theme.statusBadge.paddingY;
    const displayText = theme.statusBadge.uppercase ? text.toUpperCase() : text;
    const textW = fontBold.widthOfTextAtSize(displayText, size);
    const badgeW = textW + paddingX * 2;
    const badgeH = size + paddingY * 2;

    const x = rightX - badgeW;
    const yBadge = topY - badgeH;

    page.drawRectangle({
      x,
      y: yBadge,
      width: badgeW,
      height: badgeH,
      color: toRgb(statusBadgeBg(text, theme)),
    });

    drawText(displayText, {
      x: x + paddingX,
      y: yBadge + paddingY + 1,
      size,
      bold: true,
      color: theme.statusBadge.textColor,
    });
  };

  // -----------------
  // Header
  // -----------------
  const invoiceNumber = invoice.displayNumber || (invoice.invoiceNumber ? String(invoice.invoiceNumber) : '');
  const issueDate = fmtDate(invoice.issueDate);
  const dueDate = fmtDate(invoice.dueDate);

  const headerTopY = y;
  const logo = await drawHeaderLogo(margin, headerTopY + 2);
  const brandGap = logo.width > 0 ? 14 : 0;
  const brandTextX = margin + logo.width + brandGap;
  const brandTextMaxWidth = Math.max(190, width - margin * 2 - logo.width - brandGap - 220);
  const brandLines = [
    companyDisplay.companyDisplayName || null,
    companyDisplay.showLegalCompanyName ? companyDisplay.legalCompanyName : null,
    companyDisplay.physicalAddress || null,
    joinNonEmpty([
      companyDisplay.phone || null,
      companyDisplay.email || null,
    ], ' | ') || null,
    companyDisplay.website || null,
  ].filter((value): value is string => !!value && String(value).trim().length > 0);
  const brandFontSize = theme.fontSizes.small;
  const brandLineHeight = 10;
  const wrappedBrandLines: Array<{ text: string; bold: boolean }> = [];
  brandLines.slice(0, 5).forEach((line, lineIndex) => {
    const usedFont = lineIndex === 0 ? fontBold : font;
    wrapText({ text: line, maxWidth: brandTextMaxWidth, font: usedFont, fontSize: brandFontSize, maxLines: lineIndex === 0 ? 2 : 3 })
      .slice(0, lineIndex === 0 ? 2 : 3)
      .forEach((text) => wrappedBrandLines.push({ text, bold: lineIndex === 0 }));
  });
  const brandTextHeight = Math.max(brandLineHeight, wrappedBrandLines.length * brandLineHeight);
  const brandBlockHeight = Math.max(logo.height, brandTextHeight);
  let brandY = headerTopY - Math.max(0, (brandBlockHeight - brandTextHeight) / 2);
  for (const line of wrappedBrandLines) {
    drawText(line.text, {
      x: brandTextX,
      y: brandY,
      size: brandFontSize,
      bold: line.bold,
      color: theme.colors.mutedText,
    });
    brandY -= brandLineHeight;
  }

  const rightX = width - margin;
  const invoiceTitle = invoiceNumber ? `INVOICE #${invoiceNumber}` : 'INVOICE';
  drawTextRight(invoiceTitle, { rightX, y: headerTopY - theme.header.titleOffsetY, size: theme.fontSizes.title, bold: true });

  const statusLabel = String(params.paymentSummary?.statusLabel || '').trim();
  if (statusLabel) {
    drawStatusBadge(statusLabel, rightX, headerTopY - theme.header.statusOffsetY);
  }

  let metaY = headerTopY - theme.header.metaStartOffsetY;
  if (issueDate) {
    drawTextRight(`ISSUE: ${issueDate}`, { rightX, y: metaY, size: theme.fontSizes.small, color: theme.colors.mutedText });
    metaY -= theme.header.metaLineHeight;
  }
  if (dueDate) {
    drawTextRight(`DUE: ${dueDate}`, { rightX, y: metaY, size: theme.fontSizes.small, color: theme.colors.mutedText });
    metaY -= theme.header.metaLineHeight;
  }

  y = Math.min(headerTopY - brandBlockHeight - 16, metaY - 8);

  // -----------------
  // FROM / BILL TO / SHIP TO blocks
  // -----------------
  const fromBlock = joinNonEmpty([
    companyDisplay.companyDisplayName || null,
    companyDisplay.showLegalCompanyName ? `Legal: ${companyDisplay.legalCompanyName}` : null,
    companyDisplay.physicalAddress || null,
    joinNonEmpty([
      companyDisplay.phone || null,
      companyDisplay.email || null,
    ], ' • ') || null,
    companyDisplay.website || null,
    companyDisplay.taxId ? `Tax ID: ${companyDisplay.taxId}` : null,
  ]);

  const billToBlock = joinNonEmpty([
    (customer.companyName || '').trim() || null,
    buildAddressBlock({
      line1: customer.billingStreet1,
      line2: customer.billingStreet2,
      city: customer.billingCity,
      state: customer.billingState,
      postalCode: customer.billingPostalCode,
      country: customer.billingCountry,
      legacy: customer.billingAddress,
    }) || null,
    joinNonEmpty([(customer.phone || '').trim() || null, (customer.email || '').trim() || null], ' • ') || null,
  ]);

  const shipToAddr = buildAddressBlock({
    line1: customer.shippingStreet1,
    line2: customer.shippingStreet2,
    city: customer.shippingCity,
    state: customer.shippingState,
    postalCode: customer.shippingPostalCode,
    country: customer.shippingCountry,
    legacy: customer.shippingAddress,
  });

  const effectiveShowShipTo =
    theme.flags.showShipTo && !theme.flags.showBlindShip && !!shipToAddr && shipToAddr.trim().length > 0;

  const addressColsGap = 28;
  const addressColW = effectiveShowShipTo
    ? (width - margin * 2 - addressColsGap) / 2
    : (width - margin * 2);

  // TODO: Add configurable document block positioning for printed/window-envelope invoice layouts.
  const blockTopY = y;
  const drawAddressCol = (label: string, text: string, colIndex: number) => {
    const x = margin + colIndex * (addressColW + addressColsGap);
    drawText(label, { x, y: blockTopY, size: theme.fontSizes.h2, bold: true });

    const contentY = blockTopY - 14;
    if (!text) return contentY;

    const r = drawWrapped(text, {
      x,
      y: contentY,
      width: addressColW,
      size: theme.fontSizes.body,
      lineHeight: 13,
      color: theme.colors.text,
    });
    return r.bottomY;
  };

  const billBottom = drawAddressCol('BILL TO', billToBlock, 0);
  const shipBottom = effectiveShowShipTo ? drawAddressCol('SHIP TO', shipToAddr, 1) : blockTopY - 14;

  y = Math.min(billBottom, shipBottom) - 14;

  // -----------------
  // PO / JOB bar
  // -----------------
  // TODO: honor organization-level invoice document display preferences when
  // those settings are introduced. Until then, present non-empty order context.
  const po = String(params.job?.poNumber || '').trim();
  const jobNumber = String(params.job?.jobNumber || '').trim();
  const jobLabel = String(params.job?.jobLabel || '').trim();
  const contextLines = [
    po ? `PO # ${po}` : null,
    jobLabel ? `Job: ${jobLabel}` : null,
    jobNumber ? `Order # ${jobNumber}` : null,
  ].filter((line): line is string => Boolean(line));
  const wrappedContextLines = contextLines.flatMap((line) => wrapText({
    text: line,
    maxWidth: width - margin * 2 - 20,
    font: fontBold,
    fontSize: theme.fontSizes.small,
  }));
  if (wrappedContextLines.length) {
    const lineHeight = 12;
    const barH = Math.max(22, 10 + wrappedContextLines.length * lineHeight);
    page.drawRectangle({
      x: margin,
      y: y - barH + 4,
      width: width - margin * 2,
      height: barH,
      color: toRgb(theme.colors.jobBarBg),
    });

    let textY = y - 12;
    for (const line of wrappedContextLines) {
      drawText(line, { x: margin + 10, y: textY, size: theme.fontSizes.small, bold: true });
      textY -= lineHeight;
    }

    y -= barH + 10;
  }

  // -----------------
  // Line items table
  // -----------------
  const tableW = width - margin * 2;
  const thumbW = theme.flags.showThumbnails ? theme.columns.thumb : 0;
  const gap = theme.columns.gap;
  const qtyW = theme.columns.qty;
  const priceW = theme.columns.price;
  const descW = tableW - (thumbW ? thumbW + gap : 0) - qtyW - gap - priceW;

  const xThumb = margin;
  const xDesc = xThumb + (thumbW ? thumbW + gap : 0);
  const xQty = xDesc + descW + gap;
  const xPrice = xQty + qtyW + gap;

  const drawTableHeader = () => {
    const headerH = 20;
    page.drawRectangle({
      x: margin,
      y: y - headerH + 4,
      width: tableW,
      height: headerH,
      color: toRgb(theme.colors.tableHeaderBg),
    });

    const ty = y - 11;
    if (thumbW) drawText(' ', { x: xThumb, y: ty, size: theme.fontSizes.small, bold: true });
    drawText('DESCRIPTION', { x: xDesc, y: ty, size: theme.fontSizes.small, bold: true, color: theme.colors.mutedText });
    drawTextRight('QTY', { rightX: xQty + qtyW, y: ty, size: theme.fontSizes.small, bold: true, color: theme.colors.mutedText });
    drawTextRight('PRICE', { rightX: xPrice + priceW, y: ty, size: theme.fontSizes.small, bold: true, color: theme.colors.mutedText });

    y -= headerH + 8;
  };

  const ensureSpace = (minBottomY: number) => {
    if (y < minBottomY) {
      newPage();
      drawTableHeader();
    }
  };

  drawTableHeader();

  const lineItems = getCustomerVisibleBundleLines((params.lineItems || []).filter((line): line is NonNullable<InvoiceLineItemLike> => Boolean(line)));
  for (const li of lineItems) {
    ensureSpace(bottomSafeY + 170);

    const hourlyTerms = resolveHourlyServiceCommercialTerms(li as Record<string, any>);
    const qty = hourlyTerms?.quantity ?? Math.max(0, Math.round(Number(li?.quantity ?? 0) || 0));
    const unitCents = hourlyTerms?.rateCents ?? (li?.unitPriceCents != null ? toSafeCents(li.unitPriceCents) : toCentsFromDecimal(li?.unitPrice));
    const totalCents = li?.lineTotalCents != null ? toSafeCents(li.lineTotalCents) : toCentsFromDecimal(li?.totalPrice);

    const descRaw = (li?.description || li?.name || '').toString().trim() || '-';
    const sku = (li?.sku || '').toString().trim();

    const unitLine = unitCents > 0 ? `${hourlyTerms ? "Rate" : "Unit"}: ${fmtMoney(unitCents, currency)}${hourlyTerms ? "/hr" : ""}` : '';
    const baseDesc = sku ? `${descRaw}\nSKU: ${sku}${unitLine ? `\n${unitLine}` : ''}` : `${descRaw}${unitLine ? `\n${unitLine}` : ''}`;

    const descLines = wrapText({
      text: baseDesc,
      maxWidth: descW,
      font,
      fontSize: theme.fontSizes.body,
      maxLines: 3,
    });

    const lineH = 13;
    const contentH = descLines.length * lineH;
    const thumbH = 36;
    const rowH = Math.max(thumbH + 8, contentH + 6);

    const rowTopY = y;

    if (thumbW) {
      const boxX = xThumb;
      const boxY = rowTopY - rowH + 8;
      const boxSize = Math.min(thumbW, thumbH);
      const dataUrl = (li as any)?.thumbnailDataUrl ? String((li as any).thumbnailDataUrl) : '';
      const decoded = dataUrl ? tryDecodeDataUrl(dataUrl) : null;
      if (decoded) {
        try {
          const img = decoded.mime === 'png'
            ? await pdfDoc.embedPng(decoded.bytes)
            : await pdfDoc.embedJpg(decoded.bytes);

          const scale = Math.min(boxSize / img.width, boxSize / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          page.drawRectangle({
            x: boxX,
            y: boxY + (rowH - boxSize) / 2,
            width: boxSize,
            height: boxSize,
            color: toRgb(theme.colors.thumbPlaceholderBg),
            borderColor: toRgb(theme.colors.thumbPlaceholderBorder),
            borderWidth: 1,
          });
          page.drawImage(img, {
            x: boxX + (boxSize - drawW) / 2,
            y: boxY + (rowH - boxSize) / 2 + (boxSize - drawH) / 2,
            width: drawW,
            height: drawH,
          });
        } catch {
          // An invalid derivative is treated like no artwork rather than a
          // misleading empty image box.
        }
      }
    }

    // description
    let descY = rowTopY - 11;
    for (let i = 0; i < descLines.length; i++) {
      const line = descLines[i];
      const isMeta = line.startsWith('SKU:') || line.startsWith('Unit:') || line.startsWith('Rate:');
      drawText(line, {
        x: xDesc,
        y: descY,
        size: isMeta ? theme.fontSizes.small : theme.fontSizes.body,
        color: isMeta ? theme.colors.mutedText : theme.colors.text,
      });
      descY -= lineH;
    }

    // qty and price (right-aligned)
    drawTextRight(`${qty}${hourlyTerms ? " hr" : ""}`, {
      rightX: xQty + qtyW,
      y: rowTopY - 11,
      size: theme.fontSizes.body,
    });

    drawTextRight(fmtMoney(totalCents, currency), {
      rightX: xPrice + priceW,
      y: rowTopY - 11,
      size: theme.fontSizes.body,
      bold: true,
    });

    // row divider
    page.drawLine({
      start: { x: margin, y: rowTopY - rowH },
      end: { x: width - margin, y: rowTopY - rowH },
      thickness: 1,
      color: toRgb(theme.colors.border),
    });

    y -= rowH + 6;
  }

  y -= 6;

  // -----------------
  // Totals
  // -----------------
  const subtotalCents = toSafeCents(invoice.subtotalCents);
  const taxCents = toSafeCents(invoice.taxCents);
  const shippingCents = toSafeCents(invoice.shippingCents);
  const totalCents = toSafeCents(params.paymentSummary.totalCents);

  const paidCents = toSafeCents(params.paymentSummary.amountPaidCents);
  const dueCents = toSafeCents(params.paymentSummary.amountDueCents);

  const totalsBoxW = 240;
  const totalsX = width - margin - totalsBoxW;

  const totalsNeeded = 110 + (taxCents > 0 ? 14 : 0) + (shippingCents > 0 ? 14 : 0) + (paidCents > 0 ? 14 : 0) + (dueCents > 0 ? 14 : 0);
  if (y < bottomSafeY + totalsNeeded) {
    newPage();
  }

  const drawTotalRow = (label: string, value: string, opts?: { bold?: boolean; muted?: boolean }) => {
    const size = theme.fontSizes.body;
    const labelColor = opts?.muted ? theme.colors.mutedText : theme.colors.text;

    drawText(label, { x: totalsX, y, size, bold: opts?.bold, color: labelColor });
    drawTextRight(value, { rightX: totalsX + totalsBoxW, y, size, bold: opts?.bold, color: labelColor });
    y -= 14;
  };

  drawTotalRow('Subtotal', fmtMoney(subtotalCents, currency), { muted: true });
  if (taxCents > 0) drawTotalRow('Tax', fmtMoney(taxCents, currency), { muted: true });
  if (shippingCents > 0) drawTotalRow('Shipping', fmtMoney(shippingCents, currency), { muted: true });

  y -= 2;
  drawTotalRow('Total', fmtMoney(totalCents, currency), { bold: true });

  drawTotalRow('Paid', fmtMoney(paidCents, currency));
  drawTotalRow('Remaining', fmtMoney(dueCents, currency), { bold: true });

  // -----------------
  // Notes (public)
  // -----------------
  const notes = (invoice.notesPublic || '').toString().trim();
  if (notes) {
    const needed = 60;
    if (y < bottomSafeY + needed) newPage();

    y -= 10;
    drawText('Notes', { x: margin, y, size: theme.fontSizes.h2, bold: true });
    y -= 14;
    const r = drawWrapped(notes, {
      x: margin,
      y,
      width: width - margin * 2,
      size: theme.fontSizes.body,
      lineHeight: 13,
      color: theme.colors.mutedText,
    });
    y = r.bottomY;
  }

  // -----------------
  // Payment / remittance instructions
  // -----------------
  const paymentBlock = joinNonEmpty([
    companyDisplay.checksPayableTo ? `Checks payable to: ${companyDisplay.checksPayableTo}` : null,
    companyDisplay.invoicePaymentInstructions || null,
    companyDisplay.paymentAddress
      ? `${companyDisplay.paymentAddressLabel}\n${companyDisplay.paymentAddress}`
      : null,
    companyDisplay.invoiceFooterNote || null,
  ], '\n\n');

  if (paymentBlock) {
    const needed = 95;
    if (y < bottomSafeY + needed) newPage();

    y -= 12;
    drawDivider();
    y -= 14;

    drawText('Payment', { x: margin, y, size: theme.fontSizes.h2, bold: true });
    y -= 14;

    const r = drawWrapped(paymentBlock, {
      x: margin,
      y,
      width: width - margin * 2,
      size: theme.fontSizes.body,
      lineHeight: 13,
      color: theme.colors.mutedText,
      maxLines: 16,
    });
    y = r.bottomY;
  }

  // -----------------
  // Trade Terms footer (only if present)
  // -----------------
  const showTradeTerms = (params.overrides?.showTradeTerms ?? theme.tradeTerms.enabled) === true;
  const termsText =
    String(invoice.customTerms || '').trim() ||
    String(theme.tradeTerms.defaultText ?? theme.termsText ?? '').trim();

  if (showTradeTerms && termsText) {
    const needed = 70;
    if (y < bottomSafeY + needed) newPage();

    y -= 12;
    drawDivider();
    y -= 14;

    drawText(theme.tradeTerms.title || 'Trade Terms', { x: margin, y, size: theme.fontSizes.h2, bold: true });
    y -= 14;

    const r = drawWrapped(termsText, {
      x: margin,
      y,
      width: width - margin * 2,
      size: theme.fontSizes.body,
      lineHeight: 13,
      color: theme.colors.mutedText,
      maxLines: 10,
    });
    y = r.bottomY;
  }

  return pdfDoc.save({ useObjectStreams: false });
}
