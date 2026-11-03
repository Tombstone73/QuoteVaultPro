import { PDFDocument } from "pdf-lib";
import type { InboundPdfPageSize, InboundPdfSizeAnalysis } from "@shared/inboundPdfSizeAnalysis";

const MAX_PDF_PAGES = 100;
const POINTS_PER_INCH = 72;
const PRECISION = 4;
const PDF_ANALYSIS_TIMEOUT_MS = 15_000;

export async function withAnalysisTimeout<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("PDF analysis timed out")), PDF_ANALYSIS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function round(value: number) {
  return Math.round(value * (10 ** PRECISION)) / (10 ** PRECISION);
}

export function unavailablePdfAnalysis(errorCode: InboundPdfSizeAnalysis["errorCode"], fileIdentity: string | null): InboundPdfSizeAnalysis {
  return { status: errorCode === "UNAVAILABLE" ? "unavailable" : "failed", analyzedAt: new Date().toISOString(), fileIdentity, pageCount: null, pages: [], uniformPageSize: false, effectiveWidthInches: null, effectiveHeightInches: null, units: "in", errorCode };
}

function boxForPage(page: any): { sourceBox: InboundPdfPageSize["sourceBox"]; width: number; height: number } | null {
  const candidates: Array<[InboundPdfPageSize["sourceBox"], (() => any) | undefined]> = [
    ["TrimBox", () => page.node.TrimBox?.()],
    ["CropBox", () => page.node.CropBox?.()],
    ["MediaBox", () => page.node.MediaBox?.()],
  ];
  for (const [sourceBox, read] of candidates) {
    try {
      const rectangle = read?.()?.asRectangle?.();
      if (rectangle && Number.isFinite(rectangle.width) && Number.isFinite(rectangle.height) && rectangle.width > 0 && rectangle.height > 0) {
        return { sourceBox, width: rectangle.width, height: rectangle.height };
      }
    } catch {
      // Try the next valid PDF boundary.
    }
  }
  return null;
}

export async function analyzePdfBytes(bytes: Uint8Array, fileIdentity: string | null): Promise<InboundPdfSizeAnalysis> {
  try {
    const document = await withAnalysisTimeout(PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }));
    const pages = document.getPages();
    if (pages.length === 0) return unavailablePdfAnalysis("INVALID_GEOMETRY", fileIdentity);
    if (pages.length > MAX_PDF_PAGES) return unavailablePdfAnalysis("PAGE_LIMIT", fileIdentity);
    const dimensions: InboundPdfPageSize[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const box = boxForPage(page);
      if (!box) return unavailablePdfAnalysis("INVALID_GEOMETRY", fileIdentity);
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      const widthInches = round((rotation === 90 || rotation === 270 ? box.height : box.width) / POINTS_PER_INCH);
      const heightInches = round((rotation === 90 || rotation === 270 ? box.width : box.height) / POINTS_PER_INCH);
      if (!(widthInches > 0) || !(heightInches > 0)) return unavailablePdfAnalysis("INVALID_GEOMETRY", fileIdentity);
      dimensions.push({ pageNumber: index + 1, widthInches, heightInches, rotation, sourceBox: box.sourceBox });
    }
    const first = dimensions[0];
    const uniformPageSize = dimensions.every((page) => page.widthInches === first.widthInches && page.heightInches === first.heightInches);
    return { status: "succeeded", analyzedAt: new Date().toISOString(), fileIdentity, pageCount: dimensions.length, pages: dimensions, uniformPageSize, effectiveWidthInches: uniformPageSize ? first.widthInches : null, effectiveHeightInches: uniformPageSize ? first.heightInches : null, units: "in", errorCode: null };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return unavailablePdfAnalysis(message.includes("encrypted") || message.includes("password") ? "ENCRYPTED_PDF" : "INVALID_PDF", fileIdentity);
  }
}
