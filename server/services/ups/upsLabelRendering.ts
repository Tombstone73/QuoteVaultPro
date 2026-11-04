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
  if (Math.abs(ratio - 1.5) > 0.08) throw new FulfillmentHttpError(422, "UPS label dimensions do not match 4 × 6 stock. Download original evidence for review.", "UPS_LABEL_STOCK_UNSUPPORTED");
  const rotation = width > height ? 90 : 0;
  const bytes = await image.rotate(rotation).png().toBuffer();
  return { bytes, mimeType: "image/png" as const, rotation, width: Math.min(width, height), height: Math.max(width, height) };
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
