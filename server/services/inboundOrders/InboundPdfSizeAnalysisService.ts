import { analyzePdfBytes as analyzeInboundPdfBytes, withAnalysisTimeout, unavailablePdfAnalysis as invalid } from "../artwork/analyzePdfSize";
export { analyzePdfBytes as analyzeInboundPdfBytes } from "../artwork/analyzePdfSize";
import type { InboundOrderFile } from "@shared/schema";
import {
  inboundPdfFileIdentity,
  isInboundPdfAttachment,
  readInboundPdfSizeAnalysis,
  type InboundPdfSizeAnalysis,
} from "@shared/inboundPdfSizeAnalysis";
import { inboundOrdersRepository } from "../../storage/inboundOrders.repo";

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
