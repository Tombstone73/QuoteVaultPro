import type {
  PrepressReport,
  PrepressIssue,
  IssueCounts,
  PrepressAnalysis,
  ToolAvailability,
  ToolVersions,
  PrepressReportSummary,
  OutputManifest,
  NormalizationInfo,
} from "./types";
import type { PrepressJob } from "./schema";
import { detectTools, detectToolVersions, logToolAvailability } from "./toolchain/detector";
import { runQPDF } from "./toolchain/qpdf";
import { runPDFInfo, runPDFFonts } from "./toolchain/pdfinfo";
import { normalizeViaGhostscript } from "./toolchain/ghostscript";
import { renderProof } from "./toolchain/renderer";
import { normalizeFile, detectFileFormat } from "./toolchain/normalizer";
import { createInputAdapter } from "./adapters/InputAdapter";
import { createOutputAdapter } from "./adapters/OutputAdapter";
import { logMissingDpi, logSpotColor, logFix } from "./findings-service";

/**
 * Prepress Pipeline Orchestrator
 * 
 * Main logic for running preflight checks and auto-fixes.
 * Fail-soft: missing tools produce warnings, not failures.
 */

/**
 * Create a "tool missing" warning issue
 */
function toolMissingWarning(toolName: string): PrepressIssue {
  return {
    severity: "WARNING",
    code: "TOOL_MISSING",
    message: `Tool '${toolName}' is not available. Some checks will be skipped.`,
    meta: { tool: toolName },
  };
}

/**
 * Compute score from issue counts
 * Score = 100 - (BLOCKER * 10) - (WARNING * 2) - (INFO * 0.5)
 */
function computeScore(counts: IssueCounts): number {
  const penalties = (counts.BLOCKER * 10) + (counts.WARNING * 2) + (counts.INFO * 0.5);
  return Math.max(0, Math.min(100, 100 - penalties));
}

/**
 * Count issues by severity
 */
function countIssues(issues: PrepressIssue[]): IssueCounts {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity]++;
      return counts;
    },
    { BLOCKER: 0, WARNING: 0, INFO: 0 } as IssueCounts
  );
}

/**
 * Run preflight pipeline on a file (supports PDF, JPG, PNG, TIF, AI, PSD)
 * 
 * @param job - Prepress job metadata
 * @returns Complete preflight report
 */
export async function runPreflightPipeline(job: PrepressJob): Promise<PrepressReport> {
  const inputAdapter = createInputAdapter();
  const outputAdapter = createOutputAdapter();
  
  // Detect available tools
  const toolAvailability = await detectTools();
  const toolVersions = await detectToolVersions(toolAvailability);
  
  // Log tool availability for debugging
  logToolAvailability(toolAvailability, toolVersions);
  
  // Fetch input file
  const inputBuffer = await inputAdapter.fetchInput(job.id);
  
  // Detect file format and normalize if needed
  const normalizationResult = await normalizeFile(
    inputBuffer,
    job.contentType,
    job.originalFilename
  );
  
  // Track normalization info for the report
  let normalizationInfo: NormalizationInfo | undefined;
  if (normalizationResult.originalFormat !== 'pdf') {
    normalizationInfo = {
      originalFormat: normalizationResult.originalFormat,
      normalizedFormat: normalizationResult.normalizedFormat,
      notes: normalizationResult.notes,
      metadata: normalizationResult.metadata,
    };
  }
  
  // Get the PDF buffer to analyze (either original or normalized)
  const pdfBuffer = normalizationResult.normalizedBuffer || inputBuffer;
  
  // Initialize results
  const issues: PrepressIssue[] = [];
  
  // Add normalization issues (if any)
  issues.push(...normalizationResult.issues);
  
  const analysis: PrepressAnalysis = {
    pageCount: 0,
    pageSizes: [],
    fontsEmbedded: "unknown",
    images: "not_analyzed",
    colorSpace: "not_analyzed",
  };
  
  // If normalization failed (no PDF to analyze), skip preflight checks
  if (!normalizationResult.normalizedBuffer && normalizationResult.originalFormat !== 'pdf') {
    console.log(`[Prepress Pipeline] Normalization failed for job ${job.id}, skipping PDF preflight`);
    
    const counts = countIssues(issues);
    const score = computeScore(counts);
    
    const report: PrepressReport = {
      version: "prepress_report_v1",
      jobId: job.id,
      mode: job.mode,
      timestamp: new Date().toISOString(),
      input: {
        filename: job.originalFilename,
        sizeBytes: job.sizeBytes,
        pageCount: 0,
      },
      summary: {
        score,
        counts,
      },
      issues,
      analysis,
      toolAvailability,
      toolVersions,
      normalization: normalizationInfo,
    };
    
    // Store report JSON
    const reportJson = JSON.stringify(report, null, 2);
    await outputAdapter.storeOutput(job.id, 'report_json', Buffer.from(reportJson, 'utf-8'));
    
    return report;
  }
  
  // 1. QPDF sanity check (if available)
  if (toolAvailability.qpdf) {
    const qpdfResult = await runQPDF(pdfBuffer);
    issues.push(...qpdfResult.issues);
    
    if (!qpdfResult.valid) {
      console.log(`[Prepress Pipeline] QPDF found structural issues in job ${job.id}`);
    }
  } else {
    issues.push(toolMissingWarning('qpdf'));
  }
  
  // 2. Metadata extraction (if available)
  if (toolAvailability.pdfinfo) {
    const metadata = await runPDFInfo(pdfBuffer);
    analysis.pageCount = metadata.pageCount;
    analysis.pageSizes = metadata.pageSizes;
    issues.push(...metadata.issues);
  } else {
    issues.push(toolMissingWarning('pdfinfo'));
  }
  
  // TODO: Detect and log missing DPI (temporary placeholder)
  // This is informational only for now. Future enforcement will:
  // 1. Extract actual DPI from images in PDF
  // 2. Compare against required DPI (default 300)
  // 3. Optionally block job if DPI too low
  if (normalizationInfo && normalizationInfo.metadata?.dpi) {
    const detectedDpi = normalizationInfo.metadata.dpi;
    const requiredDpi = 300; // TODO: Make configurable
    
    if (detectedDpi < requiredDpi) {
      try {
        await logMissingDpi(job.id, job.organizationId || 'standalone', {
          detectedDpi,
          requiredDpi,
          message: `Image DPI (${detectedDpi}) is below recommended ${requiredDpi} DPI`,
        });
        console.log(`[Prepress Pipeline] Logged missing DPI finding for job ${job.id}`);
      } catch (error: any) {
        console.error(`[Prepress Pipeline] Failed to log DPI finding:`, error);
        // Fail soft - don't crash pipeline
      }
    }
  }
  
  // TODO: Spot color detection
  // Future implementation will use pdfimages or similar to extract color info
  // For now, this is a placeholder for the detection logic
  // When implemented, call: await logSpotColor(job.id, orgId, { spotColorName, ... })
  
  // 3. Font analysis (if available)
  if (toolAvailability.pdffonts) {
    const fonts = await runPDFFonts(pdfBuffer);
    analysis.fontsEmbedded = fonts.allEmbedded;
    issues.push(...fonts.issues);
  } else {
    issues.push(toolMissingWarning('pdffonts'));
  }
  
  // 4. Render proof (if available)
  if (toolAvailability.pdftocairo) {
    try {
      const proofPng = await renderProof(pdfBuffer, { page: 1, dpi: 150 });
      await outputAdapter.storeOutput(job.id, 'proof_png', proofPng);
      console.log(`[Prepress Pipeline] Generated proof image for job ${job.id}`);
    } catch (error: any) {
      issues.push({
        severity: "WARNING",
        code: "PROOF_RENDER_FAILED",
        message: `Failed to render proof image: ${error.message}`,
      });
    }
  } else {
    issues.push(toolMissingWarning('pdftocairo'));
  }
  
  // Compute summary
  const counts = countIssues(issues);
  const score = computeScore(counts);
  
  // Build base report
  const report: PrepressReport = {
    version: "prepress_report_v1",
    jobId: job.id,
    mode: job.mode,
    timestamp: new Date().toISOString(),
    input: {
      filename: job.originalFilename,
      sizeBytes: job.sizeBytes,
      pageCount: analysis.pageCount,
    },
    summary: {
      score,
      counts,
    },
    issues,
    analysis,
    toolAvailability,
    toolVersions,
    normalization: normalizationInfo,
  };
  
  // 5. Auto-fix (if mode === check_and_fix && ghostscript available)
  if (job.mode === 'check_and_fix' && toolAvailability.ghostscript) {
    try {
      console.log(`[Prepress Pipeline] Running auto-fix for job ${job.id}`);
      
      const fixedPdfBuffer = await normalizeViaGhostscript(pdfBuffer);
      await outputAdapter.storeOutput(job.id, 'fixed_pdf', fixedPdfBuffer);
      
      // Log the fix action
      try {
        await logFix(job.id, job.organizationId || 'standalone', {
          fixType: 'pdf_normalize',
          description: 'Normalized PDF via Ghostscript with /prepress settings',
          fixedByUserId: null, // Automated fix
          beforeSnapshot: { 
            tool: 'original',
            issues: issues.length,
          },
          afterSnapshot: {
            tool: 'ghostscript',
            settings: '/prepress',
          },
        });
        console.log(`[Prepress Pipeline] Logged fix action for job ${job.id}`);
      } catch (error: any) {
        console.error(`[Prepress Pipeline] Failed to log fix action:`, error);
        // Fail soft
      }
      
      // Re-analyze fixed PDF
      const afterIssues: PrepressIssue[] = [];
      
      if (toolAvailability.qpdf) {
        const qpdfResult = await runQPDF(fixedPdfBuffer);
        afterIssues.push(...qpdfResult.issues);
      }
      
      if (toolAvailability.pdffonts) {
        const fonts = await runPDFFonts(fixedPdfBuffer);
        afterIssues.push(...fonts.issues);
      }
      
      const afterCounts = countIssues(afterIssues);
      const afterScore = computeScore(afterCounts);
      
      report.fix = {
        before: { score, counts },
        after: { score: afterScore, counts: afterCounts },
        applied: ['normalize_via_ghostscript'],
      };
      
      console.log(`[Prepress Pipeline] Auto-fix complete for job ${job.id}. Score: ${score} → ${afterScore}`);
      
    } catch (error: any) {
      issues.push({
        severity: "WARNING",
        code: "AUTO_FIX_FAILED",
        message: `Auto-fix failed: ${error.message}`,
      });
    }
  } else if (job.mode === 'check_and_fix' && !toolAvailability.ghostscript) {
    issues.push(toolMissingWarning('ghostscript'));
    issues.push({
      severity: "WARNING",
      code: "AUTO_FIX_UNAVAILABLE",
      message: "Auto-fix requested but Ghostscript is not available",
    });
  }
  
  // Store report JSON
  const reportJson = JSON.stringify(report, null, 2);
  await outputAdapter.storeOutput(job.id, 'report_json', Buffer.from(reportJson, 'utf-8'));
  
  return report;
}

/**
 * Build report summary for database storage
 */
export function buildReportSummary(report: PrepressReport): PrepressReportSummary {
  return {
    score: report.summary.score,
    counts: report.summary.counts,
    pageCount: report.input.pageCount,
  };
}

/**
 * Build output manifest for database storage
 */
export function buildOutputManifest(report: PrepressReport): OutputManifest {
  return {
    report_json: true, // Always generated
    proof_png: report.toolAvailability.pdftocairo, // Only if renderer available
    fixed_pdf: report.mode === 'check_and_fix' && report.toolAvailability.ghostscript,
  };
}
