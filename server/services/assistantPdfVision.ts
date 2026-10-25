import { AssistantImageError } from "./assistantImageValidation";
import { ASSISTANT_SCANNED_PDF_MAX_PAGES } from "./assistantAttachmentExtraction";

/** Render only bounded pages to provider-visible images. PDF scripts, links,
 * form actions, and remote resources are never opened or executed. */
export async function renderAssistantPdfPages(buffer: Buffer, pageNumbers: readonly number[]) {
  if (pageNumbers.length > ASSISTANT_SCANNED_PDF_MAX_PAGES) throw new AssistantImageError(413, "Too many scanned PDF pages.");
  try {
    const canvas = await import("@napi-rs/canvas");
    const globals = globalThis as any;
    globals.DOMMatrix ??= canvas.DOMMatrix;
    globals.ImageData ??= canvas.ImageData;
    globals.Path2D ??= canvas.Path2D;
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
    const images: Array<{ mimeType: "image/png"; dataUrl: string }> = [];
    for (const pageNumber of pageNumbers) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) throw new AssistantImageError(415, "Invalid scanned PDF page.");
      const page = await document.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1600 / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const target = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: target.getContext("2d") as any, viewport }).promise;
      const png = target.toBuffer("image/png");
      if (png.length > 5 * 1024 * 1024) throw new AssistantImageError(413, `Rendered PDF page ${pageNumber} exceeds the image limit.`);
      images.push({ mimeType: "image/png", dataUrl: `data:image/png;base64,${png.toString("base64")}` });
    }
    await document.destroy();
    return images;
  } catch (error) {
    if (error instanceof AssistantImageError) throw error;
    throw new AssistantImageError(415, "The scanned PDF pages could not be rendered for visual reading.");
  }
}
