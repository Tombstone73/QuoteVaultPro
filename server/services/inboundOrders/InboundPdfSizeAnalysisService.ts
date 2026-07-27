import { PDFDocument } from "pdf-lib";
import type { InboundOrderFile } from "@shared/schema";
import {
  inboundPdfFileIdentity,
  isInboundPdfAttachment,
  readInboundPdfSizeAnalysis,
  type InboundPdfPageSize,
  type InboundPdfSizeAnalysis,
} from "@shared/inboundPdfSizeAnalysis";
import { inboundOrdersRepository } from "../../storage/inboundOrders.repo";

const MAX_PDF_PAGES = 100;
const POINTS_PER_INCH = 72;
const PRECISION = 4;
const PDF_ANALYSIS_TIMEOUT_MS = 15_000;

async function withAnalysisTimeout<T>(work: Promise<T>): Promise<T> {
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

function invalid(errorCode: InboundPdfSizeAnalysis["errorCode"], fileIdentity: string | null): InboundPdfSizeAnalysis {
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

export async function analyzeInboundPdfBytes(bytes: Uint8Array, fileIdentity: string | null): Promise<InboundPdfSizeAnalysis> {
  try {
    const document = await withAnalysisTimeout(PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }));
    const pages = document.getPages();
    if (pages.length === 0) return invalid("INVALID_GEOMETRY", fileIdentity);
    if (pages.length > MAX_PDF_PAGES) return invalid("PAGE_LIMIT", fileIdentity);
    const dimensions: InboundPdfPageSize[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const box = boxForPage(page);
      if (!box) return invalid("INVALID_GEOMETRY", fileIdentity);
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      const widthInches = round((rotation === 90 || rotation === 270 ? box.height : box.width) / POINTS_PER_INCH);
      const heightInches = round((rotation === 90 || rotation === 270 ? box.width : box.height) / POINTS_PER_INCH);
      if (!(widthInches > 0) || !(heightInches > 0)) return invalid("INVALID_GEOMETRY", fileIdentity);
      dimensions.push({ pageNumber: index + 1, widthInches, heightInches, rotation, sourceBox: box.sourceBox });
    }
    const first = dimensions[0];
    const uniformPageSize = dimensions.every((page) => page.widthInches === first.widthInches && page.heightInches === first.heightInches);
    return { status: "succeeded", analyzedAt: new Date().toISOString(), fileIdentity, pageCount: dimensions.length, pages: dimensions, uniformPageSize, effectiveWidthInches: uniformPageSize ? first.widthInches : null, effectiveHeightInches: uniformPageSize ? first.heightInches : null, units: "in", errorCode: null };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return invalid(message.includes("encrypted") || message.includes("password") ? "ENCRYPTED_PDF" : "INVALID_PDF", fileIdentity);
  }
}

export function pendingInboundPdfAnalysis(file: InboundOrderFile): InboundPdfSizeAnalysis | null {
  if (!isInboundPdfAttachment(file)) return null;
  const fileIdentity = inboundPdfFileIdentity(file);
  if (!file.fileRecordId) return invalid("UNAVAILABLE", fileIdentity);
  return { status: "pending", analyzedAt: null, fileIdentity, pageCount: null, pages: [], uniformPageSize: false, effectiveWidthInches: null, effectiveHeightInches: null, units: "in", errorCode: null };
}

export class InboundPdfSizeAnalysisService {
  private readonly scans = new Map<string, Promise<InboundPdfSizeAnalysis>>();

  constructor(private readonly repository = inboundOrdersRepository) {}

  async scan(args: {
    organizationId: string;
    inboundRecordId: string;
    file: InboundOrderFile;
    force?: boolean;
    readBytes: () => Promise<Uint8Array>;
  }): Promise<InboundPdfSizeAnalysis> {
    if (!isInboundPdfAttachment(args.file)) return invalid("NOT_PDF", inboundPdfFileIdentity(args.file));
    const identity = inboundPdfFileIdentity(args.file);
    const stored = readInboundPdfSizeAnalysis((args.file.metadataJson as Record<string, unknown> | null)?.pdfSizeAnalysis);
    if (!args.force && stored?.fileIdentity === identity && stored.status === "succeeded") return stored;
    const key = `${args.organizationId}:${args.file.id}:${identity ?? "unknown"}`;
    const active = this.scans.get(key);
    if (active) return active;

    const task = (async () => {
      const pending = pendingInboundPdfAnalysis(args.file) ?? invalid("NOT_PDF", identity);
      const metadataJson = { ...(args.file.metadataJson ?? {}), pdfSizeAnalysis: pending };
      await this.repository.updateFile({ organizationId: args.organizationId, inboundRecordId: args.inboundRecordId, fileId: args.file.id, patch: { metadataJson } });
      if (pending.status === "unavailable") return pending;
      let analysis: InboundPdfSizeAnalysis;
      try {
        analysis = await withAnalysisTimeout(analyzeInboundPdfBytes(await withAnalysisTimeout(args.readBytes()), identity));
      } catch {
        analysis = invalid("READ_FAILED", identity);
      }
      await this.repository.updateFile({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        fileId: args.file.id,
        patch: { metadataJson: { ...(args.file.metadataJson ?? {}), pdfSizeAnalysis: analysis } },
      });
      return analysis;
    })();
    this.scans.set(key, task);
    try {
      return await task;
    } finally {
      this.scans.delete(key);
    }
  }
}

export const inboundPdfSizeAnalysisService = new InboundPdfSizeAnalysisService();
