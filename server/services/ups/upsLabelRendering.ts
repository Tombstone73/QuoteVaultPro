import { FulfillmentHttpError } from "../fulfillment/types";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

/** A derived print artifact only. Never writes back to the carrier evidence.
 * UPS raster labels can arrive as 6x4 landscape pixels, text turned left.
 * A quarter turn preserves pixels; portrait sources must not be turned again.
 */
export async function renderUpsLabelImage(original: Buffer) {
  const image = sharp(original, { limitInputPixels: 16_000_000, animated: false });
  let metadata: sharp.Metadata;
  try { metadata = await image.metadata(); }
  catch { throw new FulfillmentHttpError(422, "UPS label cannot be decoded. Download original evidence for review.", "UPS_LABEL_DECODE_FAILED"); }
  const { width, height } = metadata;
  if (metadata.format !== "gif" || !width || !height || (metadata.pages ?? 1) !== 1) throw new FulfillmentHttpError(422, "UPS label is not a supported single-frame GIF. Download original evidence for review.", "UPS_LABEL_FORMAT_UNSUPPORTED");
  const ratio = Math.max(width, height) / Math.min(width, height);
  let outputWidth = Math.min(width, height), outputHeight = Math.max(width, height);
  let removedTrailingPaddingPx = 0;
  const rotation = width > height ? 90 : 0;
  if (Math.abs(ratio - 1.75) <= 0.02) {
    // Legacy UPS GIFs have a 7x4 canvas with an extra white trailing area.
    // Remove white pixels only, never text, rules, marks or barcode pixels.
    const { data, info } = await image.clone().flatten({ background: '#ffffff' }).removeAlpha()
      .rotate(rotation).raw().toBuffer({ resolveWithObject: true });
    let lastContentRow = info.height - 1;
    outer: for (; lastContentRow >= 0; lastContentRow--) {
      const start = lastContentRow * info.width * info.channels;
      for (let i = start; i < start + info.width * info.channels; i++) if (data[i] !== 255) break outer;
    }
    outputHeight = Math.max(Math.round(outputWidth * 1.5), lastContentRow + 1);
    removedTrailingPaddingPx = Math.max(0, info.height - outputHeight);
  }
  if (Math.abs(outputHeight / outputWidth - 1.5) > 0.08) throw new FulfillmentHttpError(422, "UPS label dimensions do not match 4 × 6 stock. Download original evidence for review.", "UPS_LABEL_STOCK_UNSUPPORTED");
  const bytes = await image.rotate(rotation).extract({ left: 0, top: 0, width: outputWidth, height: outputHeight }).png().toBuffer();
  return { bytes, mimeType: "image/png" as const, rotation, width: outputWidth, height: outputHeight, removedTrailingPaddingPx };
}

export async function renderUpsLabelPdf(original: Buffer): Promise<Buffer> {
  const image = await renderUpsLabelImage(original);
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedPng(image.bytes);
  const page = pdf.addPage([288, 432]);
  // One uniform scale; no stretching, clipping, PDF /Rotate, or driver rotation.
  const scale = Math.min(288 / image.width, 432 / image.height);
  const width = image.width * scale, height = image.height * scale;
  page.drawImage(embedded, { x: (288 - width) / 2, y: (432 - height) / 2, width, height });
  return Buffer.from(await pdf.save());
}
