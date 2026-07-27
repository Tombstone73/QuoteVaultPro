export const inboundPdfSizeAnalysisStatuses = ["pending", "succeeded", "failed", "unavailable"] as const;
export type InboundPdfSizeAnalysisStatus = (typeof inboundPdfSizeAnalysisStatuses)[number];

export type InboundPdfPageSize = {
  pageNumber: number;
  widthInches: number;
  heightInches: number;
  rotation: number;
  sourceBox: "TrimBox" | "CropBox" | "MediaBox";
};

/** Stored on inbound_order_files.metadata_json. Values are numeric so callers can format for their locale. */
export type InboundPdfSizeAnalysis = {
  status: InboundPdfSizeAnalysisStatus;
  analyzedAt: string | null;
  fileIdentity: string | null;
  pageCount: number | null;
  pages: InboundPdfPageSize[];
  uniformPageSize: boolean;
  effectiveWidthInches: number | null;
  effectiveHeightInches: number | null;
  units: "in";
  errorCode: "UNAVAILABLE" | "NOT_PDF" | "INVALID_PDF" | "ENCRYPTED_PDF" | "INVALID_GEOMETRY" | "PAGE_LIMIT" | "READ_FAILED" | null;
};

export function isInboundPdfAttachment(file: { mimeType?: string | null; sourceFilename?: string | null }): boolean {
  return String(file.mimeType ?? "").toLowerCase().includes("pdf")
    || String(file.sourceFilename ?? "").toLowerCase().endsWith(".pdf");
}

export function inboundPdfFileIdentity(file: { fileRecordId?: string | null; checksum?: string | null; sizeBytes?: number | null }): string | null {
  const identity = [file.fileRecordId ?? "", file.checksum ?? "", file.sizeBytes ?? ""].join(":");
  return identity === "::" ? null : identity;
}

export function readInboundPdfSizeAnalysis(value: unknown): InboundPdfSizeAnalysis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<InboundPdfSizeAnalysis>;
  if (!inboundPdfSizeAnalysisStatuses.includes(candidate.status as InboundPdfSizeAnalysisStatus)) return null;
  return {
    status: candidate.status as InboundPdfSizeAnalysisStatus,
    analyzedAt: typeof candidate.analyzedAt === "string" ? candidate.analyzedAt : null,
    fileIdentity: typeof candidate.fileIdentity === "string" ? candidate.fileIdentity : null,
    pageCount: typeof candidate.pageCount === "number" ? candidate.pageCount : null,
    pages: Array.isArray(candidate.pages) ? candidate.pages.filter((page): page is InboundPdfPageSize => Boolean(
      page && typeof page === "object" && typeof page.pageNumber === "number" && typeof page.widthInches === "number" && typeof page.heightInches === "number",
    )) : [],
    uniformPageSize: candidate.uniformPageSize === true,
    effectiveWidthInches: typeof candidate.effectiveWidthInches === "number" ? candidate.effectiveWidthInches : null,
    effectiveHeightInches: typeof candidate.effectiveHeightInches === "number" ? candidate.effectiveHeightInches : null,
    units: "in",
    errorCode: candidate.errorCode ?? null,
  };
}
