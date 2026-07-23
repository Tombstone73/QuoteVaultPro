import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { ProductionSides } from "@shared/productionHydration";

type BasicProofPreview = {
  bytes: Buffer;
  mimeType: string | null;
  fileName: string;
};

export type BasicProofRenderStatus = "ready" | "metadata_only";

export type BasicProofPdfArgs = {
  orderNumber: string | null;
  lineItemLabel: string;
  displaySizeLabel: string | null;
  finishedWidth?: number | null;
  finishedHeight?: number | null;
  quantity: number | null;
  finishingSummary: string[];
  printSides: ProductionSides;
  useSameArtworkBothSides: boolean;
  preflightStatus: string;
  generatedAt: Date;
  artworkPreviews: ProofArtworkPreview[];
};

type BasicProofSinglePageArgs = Omit<BasicProofPdfArgs, "artworkPreviews"> & ProofArtworkPreview;

export type ProofArtworkMediaBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function resolveProofArtworkMediaBox(args: {
  x: number;
  y: number;
  maxWidth: number;
  maxHeight: number;
  finishedWidth?: number | null;
  finishedHeight?: number | null;
}): ProofArtworkMediaBox {
  const finishedWidth = Number(args.finishedWidth);
  const finishedHeight = Number(args.finishedHeight);
  const hasFinishedAspectRatio = Number.isFinite(finishedWidth) && finishedWidth > 0
    && Number.isFinite(finishedHeight) && finishedHeight > 0;
  const aspectRatio = hasFinishedAspectRatio ? finishedWidth / finishedHeight : args.maxWidth / args.maxHeight;
  const width = Math.min(args.maxWidth, args.maxHeight * aspectRatio);
  const height = width / aspectRatio;
  return {
    x: args.x + (args.maxWidth - width) / 2,
    y: args.y + (args.maxHeight - height) / 2,
    width,
    height,
  };
}

export async function generateBasicProofPdfBytes(args: BasicProofPdfArgs): Promise<{ bytes: Uint8Array; renderStatus: BasicProofRenderStatus }> {
  const panels = args.artworkPreviews.length > 0
    ? args.artworkPreviews
    : [{ label: "Artwork" as const, sourceFileName: null, preview: null, previewError: "Artwork not assigned." }];

  if (args.printSides !== "Double-sided" || args.useSameArtworkBothSides || panels.length === 1) {
    return generateSingleArtworkProofPdfBytes({ ...args, ...panels[0] });
  }

  const combined = await PDFDocument.create();
  let allReady = true;
  for (const panel of panels) {
    const rendered = await generateSingleArtworkProofPdfBytes({ ...args, ...panel });
    allReady = allReady && rendered.renderStatus === "ready";
    const source = await PDFDocument.load(rendered.bytes);
    const pages = await combined.copyPages(source, source.getPageIndices());
    for (const page of pages) combined.addPage(page);
  }
  combined.setTitle(`Proof - ${args.lineItemLabel}`);
  combined.setSubject(`Double-sided proof with ${panels.length} artwork sides`);
  return {
    bytes: await combined.save({ useObjectStreams: false }),
    renderStatus: allReady ? "ready" : "metadata_only",
  };
}

export type ProofArtworkPreview = {
  label: "Artwork" | "Front" | "Back";
  sourceFileName: string | null;
  preview: BasicProofPreview | null;
  previewError?: string | null;
};

export async function generateCombinedProofPdfBytes(
  items: BasicProofPdfArgs[],
): Promise<{ bytes: Uint8Array; renderStatus: BasicProofRenderStatus }> {
  if (items.length === 0) {
    throw new Error("A combined proof requires at least one line item");
  }

  const combined = await PDFDocument.create();
  let allPreviewsReady = true;
  for (const item of items) {
    const rendered = await generateBasicProofPdfBytes(item);
    allPreviewsReady = allPreviewsReady && rendered.renderStatus === "ready";
    const source = await PDFDocument.load(rendered.bytes);
    const pages = await combined.copyPages(source, source.getPageIndices());
    for (const page of pages) combined.addPage(page);
  }

  const orderNumber = items[0]?.orderNumber;
  combined.setTitle(`Combined Proof${orderNumber ? ` - Order ${orderNumber}` : ""}`);
  combined.setSubject(`Combined proof package covering ${items.length} line items`);
  combined.setCreator("QuoteVaultPro");
  combined.setProducer("QuoteVaultPro");
  return {
    bytes: await combined.save({ useObjectStreams: false }),
    renderStatus: allPreviewsReady ? "ready" : "metadata_only",
  };
}

function drawWrappedText(args: {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  lineHeight: number;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
}) {
  const { page, text, x, y, maxWidth, lineHeight, font, size, color = rgb(0.14, 0.17, 0.23) } = args;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);

  let cursorY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursorY, font, size, color });
    cursorY -= lineHeight;
  }

  return cursorY;
}

export function buildProofPdfFacts(args: BasicProofSinglePageArgs): Array<{ label: string; value: string }> {
  return [
    { label: "Finished Size", value: args.displaySizeLabel || "Not specified" },
    { label: "Quantity", value: args.quantity != null ? String(args.quantity) : "Not specified" },
    { label: "Print Sides", value: args.printSides },
    ...(args.printSides === "Double-sided" && args.useSameArtworkBothSides
      ? [{ label: "Artwork Sides", value: "Same artwork used on front and back." }]
      : []),
    { label: "Preflight", value: args.preflightStatus.replace(/_/g, " ") },
    { label: "Source", value: args.sourceFileName || "Persisted artwork source" },
  ];
}

async function generateSingleArtworkProofPdfBytes(args: BasicProofSinglePageArgs): Promise<{ bytes: Uint8Array; renderStatus: BasicProofRenderStatus }> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 42;
  const previewWidth = 300;
  const previewHeight = 390;
  const panelX = margin + previewWidth + 18;
  const panelWidth = pageWidth - panelX - margin;

  pdfDoc.setTitle(`Proof - ${args.lineItemLabel}`);
  pdfDoc.setSubject("QuoteVaultPro basic proof");
  pdfDoc.setCreator("QuoteVaultPro");
  pdfDoc.setProducer("QuoteVaultPro");
  pdfDoc.setCreationDate(args.generatedAt);
  pdfDoc.setModificationDate(args.generatedAt);

  page.drawRectangle({ x: 0, y: pageHeight - 110, width: pageWidth, height: 110, color: rgb(0.96, 0.97, 0.99) });
  page.drawText("Basic Proof", { x: margin, y: pageHeight - 56, font: fontBold, size: 24, color: rgb(0.07, 0.18, 0.66) });
  const artworkLabel = args.useSameArtworkBothSides && args.printSides === "Double-sided"
    ? "Front & Back Artwork"
    : args.label === "Artwork"
      ? "Artwork"
      : `${args.label} Artwork`;
  page.drawText(`${args.lineItemLabel || "Line Item"} - ${artworkLabel}`, { x: margin, y: pageHeight - 84, font: font, size: 12, color: rgb(0.18, 0.21, 0.29) });

  const orderLabel = args.orderNumber ? `Order #${args.orderNumber}` : "Order";
  page.drawText(orderLabel, { x: pageWidth - margin - fontBold.widthOfTextAtSize(orderLabel, 11), y: pageHeight - 56, font: fontBold, size: 11, color: rgb(0.18, 0.21, 0.29) });
  page.drawText(`Generated ${args.generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`, {
    x: pageWidth - margin - font.widthOfTextAtSize(`Generated ${args.generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`, 9),
    y: pageHeight - 74,
    font,
    size: 9,
    color: rgb(0.39, 0.44, 0.55),
  });

  const previewX = margin;
  const previewY = pageHeight - 132 - previewHeight;
  page.drawRectangle({ x: previewX, y: previewY, width: previewWidth, height: previewHeight, borderColor: rgb(0.78, 0.82, 0.9), borderWidth: 1, color: rgb(1, 1, 1) });
  const mediaBox = resolveProofArtworkMediaBox({
    x: previewX + 12,
    y: previewY + 12,
    maxWidth: previewWidth - 24,
    maxHeight: previewHeight - 24,
    finishedWidth: args.finishedWidth,
    finishedHeight: args.finishedHeight,
  });
  const mediaInset = 6;
  const artworkMaxWidth = Math.max(1, mediaBox.width - mediaInset * 2);
  const artworkMaxHeight = Math.max(1, mediaBox.height - mediaInset * 2);

  let previewRendered = false;
  if (args.preview?.bytes?.length) {
    try {
      const mime = String(args.preview.mimeType || "").toLowerCase();
      if (mime.includes("application/pdf")) {
        const [embeddedPage] = await pdfDoc.embedPdf(args.preview.bytes, [0]);
        const scale = Math.min(artworkMaxWidth / embeddedPage.width, artworkMaxHeight / embeddedPage.height);
        const drawWidth = embeddedPage.width * scale;
        const drawHeight = embeddedPage.height * scale;
        const drawX = mediaBox.x + (mediaBox.width - drawWidth) / 2;
        const drawY = mediaBox.y + (mediaBox.height - drawHeight) / 2;
        page.drawPage(embeddedPage, { x: drawX, y: drawY, xScale: scale, yScale: scale });
        previewRendered = true;
      } else {
        const image = mime.includes("png")
          ? await pdfDoc.embedPng(args.preview.bytes)
          : mime.includes("jpeg") || mime.includes("jpg")
            ? await pdfDoc.embedJpg(args.preview.bytes)
            : null;

        if (image) {
          const dims = image.scale(1);
          const scale = Math.min(artworkMaxWidth / dims.width, artworkMaxHeight / dims.height);
          const drawWidth = dims.width * scale;
          const drawHeight = dims.height * scale;
          const drawX = mediaBox.x + (mediaBox.width - drawWidth) / 2;
          const drawY = mediaBox.y + (mediaBox.height - drawHeight) / 2;
          page.drawImage(image, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
          previewRendered = true;
        }
      }
    } catch {
      previewRendered = false;
    }
  }

  if (!previewRendered) {
    page.drawRectangle({ x: mediaBox.x + mediaInset, y: mediaBox.y + mediaInset, width: artworkMaxWidth, height: artworkMaxHeight, color: rgb(1, 0.97, 0.93) });
    page.drawText("Incomplete Draft Proof", { x: margin + 32, y: pageHeight - 188, font: fontBold, size: 16, color: rgb(0.66, 0.21, 0.07) });
    drawWrappedText({
      page,
      text: args.previewError
        ? `Artwork preview could not be embedded. ${args.previewError} Do not send this draft to the customer.`
        : args.sourceFileName
          ? `Artwork preview could not be embedded for ${args.sourceFileName}. Do not send this draft to the customer.`
          : "Artwork preview could not be embedded from the persisted source. Do not send this draft to the customer.",
      x: margin + 32,
      y: pageHeight - 218,
      maxWidth: previewWidth - 64,
      lineHeight: 16,
      font,
      size: 11,
      color: rgb(0.48, 0.24, 0.12),
    });
  }

  page.drawRectangle({
    ...mediaBox,
    borderColor: rgb(0.31, 0.45, 0.74),
    borderWidth: 1.25,
    borderOpacity: 0.9,
  });

  page.drawText("Proof Basis", { x: panelX, y: pageHeight - 154, font: fontBold, size: 15, color: rgb(0.14, 0.17, 0.23) });

  const facts = buildProofPdfFacts(args);

  let cursorY = pageHeight - 182;
  for (const fact of facts) {
    page.drawText(fact.label.toUpperCase(), { x: panelX, y: cursorY, font: fontBold, size: 8, color: rgb(0.43, 0.48, 0.58) });
    cursorY = drawWrappedText({
      page,
      text: fact.value,
      x: panelX,
      y: cursorY - 16,
      maxWidth: panelWidth,
      lineHeight: 14,
      font,
      size: 11,
    }) - 10;
  }

  page.drawText("Finishing Facts", { x: panelX, y: cursorY - 8, font: fontBold, size: 13, color: rgb(0.14, 0.17, 0.23) });
  cursorY -= 30;

  const finishing = args.finishingSummary.length > 0 ? args.finishingSummary : ["No finishing details were captured in persisted line-item data."];
  for (const item of finishing.slice(0, 8)) {
    page.drawCircle({ x: panelX + 4, y: cursorY + 4, size: 2.5, color: rgb(0.07, 0.18, 0.66) });
    cursorY = drawWrappedText({
      page,
      text: item,
      x: panelX + 12,
      y: cursorY,
      maxWidth: panelWidth - 12,
      lineHeight: 14,
      font,
      size: 10.5,
    }) - 8;
  }

  page.drawLine({ start: { x: margin, y: 72 }, end: { x: pageWidth - margin, y: 72 }, thickness: 1, color: rgb(0.86, 0.89, 0.94) });
  drawWrappedText({
    page,
    text: "This proof is generated from saved line-item data and saved artwork sources only. It is an approval artifact, not a production-ready preflight result.",
    x: margin,
    y: 56,
    maxWidth: pageWidth - margin * 2,
    lineHeight: 12,
    font,
    size: 9,
    color: rgb(0.43, 0.48, 0.58),
  });

  return {
    bytes: await pdfDoc.save({ useObjectStreams: false }),
    renderStatus: previewRendered ? "ready" : "metadata_only",
  };
}
