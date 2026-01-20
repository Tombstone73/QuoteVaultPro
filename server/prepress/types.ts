/**
 * Prepress Service Type Definitions
 * 
 * Stable contracts for PDF preflight reports and analysis results.
 * Version: prepress_report_v1
 */

export type IssueSeverity = "BLOCKER" | "WARNING" | "INFO";

export interface PrepressIssue {
  severity: IssueSeverity;
  code: string; // e.g. "FONT_NOT_EMBEDDED", "TOOL_MISSING", "LOW_RESOLUTION_IMAGE"
  message: string;
  page?: number;
  bbox?: {
    x: number; // normalized 0..1
    y: number; // normalized 0..1
    w: number; // normalized 0..1
    h: number; // normalized 0..1
  };
  meta?: Record<string, any>;
}

export interface IssueCounts {
  BLOCKER: number;
  WARNING: number;
  INFO: number;
}

export interface PageSize {
  width: number;
  height: number;
  unit: string; // e.g., "pt", "in", "mm"
}

export interface ImageAnalysis {
  page: number;
  dpi: number;
  width: number;
  height: number;
}

export interface ColorSpaceInfo {
  hasRGB: boolean;
  hasCMYK: boolean;
  hasSpot: boolean;
}

export interface ToolAvailability {
  qpdf: boolean;
  pdfinfo: boolean;
  pdffonts: boolean;
  ghostscript: boolean;
  pdftocairo: boolean;
  imagemagick: boolean;
}

export interface ToolVersions {
  qpdf?: string;
  pdfinfo?: string;
  pdffonts?: string;
  ghostscript?: string;
  pdftocairo?: string;
  imagemagick?: string;
}

export interface PrepressAnalysis {
  pageCount: number;
  pageSizes: PageSize[];
  fontsEmbedded: boolean | "unknown";
  images: ImageAnalysis[] | "not_analyzed";
  colorSpace: ColorSpaceInfo | "not_analyzed";
}

export interface PrepressReportSummary {
  score: number; // 0-100
  counts: IssueCounts;
  pageCount: number;
}

export interface PrepressFixResult {
  before: {
    score: number;
    counts: IssueCounts;
  };
  after: {
    score: number;
    counts: IssueCounts;
  };
  applied: string[]; // e.g., ["normalize_via_ghostscript"]
}

/**
 * Normalization metadata for non-PDF inputs
 */
export interface NormalizationInfo {
  originalFormat: 'pdf' | 'jpg' | 'jpeg' | 'png' | 'tif' | 'tiff' | 'ai' | 'psd';
  normalizedFormat: 'pdf' | null;
  notes: string[];
  metadata?: {
    dpi?: number;
    width?: number;
    height?: number;
    colorSpace?: string;
  };
}

/**
 * Stable Report JSON Contract (v1)
 * 
 * This contract is versioned and must remain backward-compatible.
 * Changes require a new version number.
 */
export interface PrepressReport {
  version: "prepress_report_v1";
  jobId: string;
  mode: "check" | "check_and_fix";
  timestamp: string; // ISO8601
  
  input: {
    filename: string;
    sizeBytes: number;
    pageCount: number;
  };
  
  summary: {
    score: number; // 100 minus penalties
    counts: IssueCounts;
  };
  
  issues: PrepressIssue[];
  
  analysis: PrepressAnalysis;
  
  // Tool availability and versions (for debugging and reproducibility)
  toolAvailability: ToolAvailability;
  toolVersions: ToolVersions;
  
  // Normalization info (for non-PDF inputs)
  normalization?: NormalizationInfo;
  
  // Only present when mode === "check_and_fix"
  fix?: PrepressFixResult;
}

/**
 * Output manifest tracks which downloadable outputs exist for a job
 */
export interface OutputManifest {
  report_json: boolean;
  proof_png: boolean;
  fixed_pdf?: boolean; // Only for check_and_fix mode
}

/**
 * Error structure for failed jobs
 */
export interface PrepressError {
  message: string;
  code: string; // e.g., "UPLOAD_FAILED", "PROCESSING_TIMEOUT", "INVALID_PDF"
  details?: Record<string, any>;
  stack?: string; // Only in development
}

/**
 * Config for temp file paths
 */
export interface PrepressPaths {
  tempRoot: string;
  jobDir: string; // {tempRoot}/{jobId}
  inputFile: string; // {tempRoot}/{jobId}/input.pdf
  outputDir: string; // {tempRoot}/{jobId}/output
  reportJson: string; // {tempRoot}/{jobId}/output/report.json
  proofPng: string; // {tempRoot}/{jobId}/output/proof.png
  fixedPdf: string; // {tempRoot}/{jobId}/output/fixed.pdf
}
