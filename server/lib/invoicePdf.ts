import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

import { DEFAULT_INVOICE_PDF_THEME, type InvoicePdfTheme, type Rgb } from './invoicePdfTheme';

type CompanySettingsLike = {
  companyName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
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
} | null;

type InvoicePdfParams = {
  invoice: InvoiceLike;
  customer: CustomerLike;
  companySettings: CompanySettingsLike;
  paymentSummary: {
    amountPaidCents: number;
    amountDueCents: number;
    statusLabel?: string | null;
  };
  lineItems: InvoiceLineItemLike[];
  job?: {
    poNumber?: string | null;
    jobNumber?: string | null;
  } | null;
  overrides?: {
    // Data URL only (no remote fetch)
    logoDataUrl?: string | null;
    footerText?: string | null;
    showTradeTerms?: boolean;
    // Overrides watermark text when enabled
    watermarkText?: string | null;
  };
  documentType?: 'invoice' | 'quote';
  validUntil?: Date | string | null;
};

const toRgb = (c: Rgb) => rgb(c[0], c[1], c[2]);

const joinNonEmpty = (values: Array<string | null | undefined>, sep = '\n') =>
  values
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter((v) => !!v)
    .join(sep)
    .trim();

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

function buildAddressBlock(params: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  legacy?: string | null;
}): string {
  const hasStructured = !!(
    (params.line1 && String(params.line1).trim()) ||
    (params.line2 && String(params.line2).trim()) ||
    (params.city && String(params.city).trim()) ||
    (params.state && String(params.state).trim()) ||
    (params.postalCode && String(params.postalCode).trim()) ||
    (params.country && String(params.country).trim())
  );

  if (hasStructured) {
    const cityStateZip = joinNonEmpty(
      [
        joinNonEmpty([
          params.city,
          [params.state, params.postalCode].filter(Boolean).join(' ').trim() || null,
        ], ', '),
      ],
      ''
    );

    return joinNonEmpty([params.line1, params.line2, cityStateZip || null, params.country]);
  }

  return joinNonEmpty([params.legacy]);
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
          paymentSummary: {
            amountPaidCents: 0,
            amountDueCents: toSafeCents((arg1 as any)?.totalCents ?? 0),
            statusLabel: String((arg1 as any)?.status || '').trim() || null,
          },
          lineItems: [],
        };

  const invoice = params.invoice || {};
  const customer = params.customer || {};
  const companySettings = params.companySettings || null;

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

  const resolveLogoDataUrl = (): string | null => {
    const override = (params.overrides?.logoDataUrl || '').trim();
    if (override) return override;

    const themeLogo = (theme.header.logo.dataUrl || '').trim();
    if (themeLogo) return themeLogo;

    const csLogo = String(companySettings?.logoUrl || '').trim();
    if (csLogo.startsWith('data:')) return csLogo;

    return null;
  };

  const resolveFooterText = (): string => {
    const override = params.overrides?.footerText;
    if (override != null) return String(override).trim();
    return String(theme.footer.text || '').trim();
  };

  const normalizeStatusLabel = (raw: unknown): string => String(raw || '').trim().toLowerCase();

  const resolveWatermarkText = (): string => {
    const override = (params.overrides?.watermarkText || '').trim();
    if (override) return override;

    if (!theme.watermark.enabled) return '';
    if (theme.watermark.mode === 'none') return '';
    if (theme.watermark.mode === 'paid') return theme.watermark.textPaid;
    if (theme.watermark.mode === 'draft') return theme.watermark.textDraft;

    const statusLabel = normalizeStatusLabel(params.paymentSummary?.statusLabel);
    const invoiceStatus = normalizeStatusLabel(invoice.status);

    if (invoiceStatus === 'draft' || statusLabel === 'draft') return theme.watermark.textDraft;
    if (invoiceStatus === 'paid' || statusLabel === 'paid') return theme.watermark.textPaid;
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

  const drawTitanLogo = (x: number, topY: number) => {
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
  };

  const drawHeaderLogo = (x: number, topY: number) => {
    const mode = theme.header.logo.mode;
    const dataUrl = resolveLogoDataUrl();

    const shouldUseImage =
      mode === 'image' ? !!dataUrl :
      mode === 'titan' ? false :
      mode === 'none' ? false :
      !!dataUrl;

    if (mode === 'none') return;

    if (!shouldUseImage) {
      drawTitanLogo(x, topY);
      return;
    }

    if (!dataUrl) return;
    const decoded = tryDecodeDataUrl(dataUrl);
    if (!decoded) {
      // Fallback to TITAN if the override isn't a supported data URL
      drawTitanLogo(x, topY);
      return;
    }

    const maxW = theme.header.logo.maxWidth;
    const maxH = theme.header.logo.maxHeight;

    const drawImage = async () => {
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
    };

    // Defer actual embed until awaited by header flow.
    return drawImage();
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
  const invoiceNumber = invoice.invoiceNumber ? String(invoice.invoiceNumber) : '';
  const issueDate = fmtDate(invoice.issueDate);
  const dueDate = fmtDate(invoice.dueDate);

  const headerTopY = y;
  const maybeLogoPromise = drawHeaderLogo(margin, headerTopY);
  if (maybeLogoPromise instanceof Promise) await maybeLogoPromise;

  const rightX = width - margin;
  const isQuote = params.documentType === 'quote';
  const invoiceTitle = isQuote
    ? (invoiceNumber ? `QUOTE #${invoiceNumber}` : 'QUOTE')
    : (invoiceNumber ? `INVOICE #${invoiceNumber}` : 'INVOICE');
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
  if (isQuote) {
    const validUntilDate = fmtDate(params.validUntil);
    if (validUntilDate) {
      drawTextRight(`VALID UNTIL: ${validUntilDate}`, { rightX, y: metaY, size: theme.fontSizes.small, color: theme.colors.mutedText });
      metaY -= theme.header.metaLineHeight;
    }
  } else if (dueDate) {
    drawTextRight(`DUE: ${dueDate}`, { rightX, y: metaY, size: theme.fontSizes.small, color: theme.colors.mutedText });
    metaY -= theme.header.metaLineHeight;
  }

  y = Math.min(headerTopY - 48, metaY) - 10;
  drawDivider();
  y -= theme.header.dividerGap;

  // -----------------
  // FROM / BILL TO / SHIP TO blocks
  // -----------------
  const companyName = (companySettings?.companyName || '').trim();
  const fromBlock = joinNonEmpty([
    companyName || null,
    (companySettings?.address || '').trim() || null,
    joinNonEmpty([
      (companySettings?.phone || '').trim() || null,
      (companySettings?.email || '').trim() || null,
    ], ' • ') || null,
    (companySettings?.website || '').trim() || null,
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

  const threeColsGap = 18;
  const colW = (width - margin * 2 - threeColsGap * 2) / 3;

  const blockTopY = y;
  const drawAddressCol = (label: string, text: string, colIndex: number) => {
    const x = margin + colIndex * (colW + threeColsGap);
    drawText(label, { x, y: blockTopY, size: theme.fontSizes.h2, bold: true });

    const contentY = blockTopY - 14;
    if (!text) return contentY;

    const r = drawWrapped(text, {
      x,
      y: contentY,
      width: colW,
      size: theme.fontSizes.body,
      lineHeight: 13,
      color: theme.colors.text,
    });
    return r.bottomY;
  };

  const fromBottom = drawAddressCol('FROM', fromBlock, 0);
  const billBottom = drawAddressCol('BILL TO', billToBlock, 1);
  const shipBottom = effectiveShowShipTo ? drawAddressCol('SHIP TO', shipToAddr, 2) : blockTopY - 14;

  y = Math.min(fromBottom, billBottom, shipBottom) - 14;

  // -----------------
  // PO / JOB bar
  // -----------------
  const po = String(params.job?.poNumber || '').trim();
  const job = String(params.job?.jobNumber || '').trim();
  if (po || job) {
    const barH = 22;
    page.drawRectangle({
      x: margin,
      y: y - barH + 4,
      width: width - margin * 2,
      height: barH,
      color: toRgb(theme.colors.jobBarBg),
    });

    const textY = y - 12;
    if (po) drawText(`PO # ${po}`, { x: margin + 10, y: textY, size: theme.fontSizes.small, bold: true });

    if (job) {
      drawTextRight(`JOB: ${job}`, { rightX: width - margin - 10, y: textY, size: theme.fontSizes.small, bold: true });
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

  const lineItems = params.lineItems || [];
  for (const li of lineItems) {
    ensureSpace(bottomSafeY + 170);

    const qty = Math.max(0, Math.round(Number(li?.quantity ?? 0) || 0));
    const unitCents = li?.unitPriceCents != null ? toSafeCents(li.unitPriceCents) : toCentsFromDecimal(li?.unitPrice);
    const totalCents = li?.lineTotalCents != null ? toSafeCents(li.lineTotalCents) : toCentsFromDecimal(li?.totalPrice);

    const descRaw = (li?.description || li?.name || '').toString().trim() || '-';
    const sku = (li?.sku || '').toString().trim();

    const unitLine = unitCents > 0 ? `Unit: ${fmtMoney(unitCents, currency)}` : '';
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

      page.drawRectangle({
        x: boxX,
        y: boxY + (rowH - boxSize) / 2,
        width: boxSize,
        height: boxSize,
        color: toRgb(theme.colors.thumbPlaceholderBg),
        borderColor: toRgb(theme.colors.thumbPlaceholderBorder),
        borderWidth: 1,
      });

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
          page.drawImage(img, {
            x: boxX + (boxSize - drawW) / 2,
            y: boxY + (rowH - boxSize) / 2 + (boxSize - drawH) / 2,
            width: drawW,
            height: drawH,
          });
        } catch {
          // If embedding fails, keep the gray box.
        }
      }
    }

    // description
    let descY = rowTopY - 11;
    for (let i = 0; i < descLines.length; i++) {
      const line = descLines[i];
      const isMeta = line.startsWith('SKU:') || line.startsWith('Unit:');
      drawText(line, {
        x: xDesc,
        y: descY,
        size: isMeta ? theme.fontSizes.small : theme.fontSizes.body,
        color: isMeta ? theme.colors.mutedText : theme.colors.text,
      });
      descY -= lineH;
    }

    // qty and price (right-aligned)
    drawTextRight(String(qty), {
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
  const totalCents = toSafeCents(invoice.totalCents);

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

  if (!isQuote) {
    drawTotalRow('Paid', fmtMoney(paidCents, currency));
    drawTotalRow('Remaining', fmtMoney(dueCents, currency), { bold: true });
  }

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
