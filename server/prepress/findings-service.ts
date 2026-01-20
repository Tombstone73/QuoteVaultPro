import { db } from "../db";
import { prepressFindings, prepressFixLogs, type InsertPrepressFinding, type InsertPrepressFixLog } from "./schema";
import { eq, and } from "drizzle-orm";

/**
 * Prepress Findings and Fix Logs Service
 * 
 * Manages detection and logging of:
 * - Missing DPI (temporary placeholder)
 * - Spot colors
 * - Other preflight findings
 * - Fix audit trail
 * 
 * TEMP → PERMANENT rules:
 * - Findings/fixes are written during job.status='running'
 * - Become immutable when job reaches succeeded/failed/cancelled
 * - Cascade deleted when job is removed
 */

/**
 * Record a preflight finding
 */
export async function createFinding(finding: InsertPrepressFinding) {
  const [created] = await db.insert(prepressFindings).values(finding).returning();
  return created;
}

/**
 * Record a fix action
 */
export async function createFixLog(fixLog: InsertPrepressFixLog) {
  const [created] = await db.insert(prepressFixLogs).values(fixLog).returning();
  return created;
}

/**
 * Get all findings for a job (org-scoped)
 */
export async function getJobFindings(jobId: string, organizationId: string) {
  return await db.query.prepressFindings.findMany({
    where: and(
      eq(prepressFindings.prepressJobId, jobId),
      eq(prepressFindings.organizationId, organizationId)
    ),
    orderBy: (findings, { asc }) => [asc(findings.createdAt)],
  });
}

/**
 * Get all fix logs for a job (org-scoped)
 */
export async function getJobFixLogs(jobId: string, organizationId: string) {
  return await db.query.prepressFixLogs.findMany({
    where: and(
      eq(prepressFixLogs.prepressJobId, jobId),
      eq(prepressFixLogs.organizationId, organizationId)
    ),
    orderBy: (logs, { asc }) => [asc(logs.createdAt)],
  });
}

/**
 * Helper: Log missing DPI finding
 * 
 * TODO: Future enforcement - make this a BLOCKER when DPI requirements are defined
 */
export async function logMissingDpi(
  jobId: string,
  organizationId: string,
  options: {
    detectedDpi?: number;
    requiredDpi?: number;
    pageNumber?: number;
    message?: string;
  }
) {
  return await createFinding({
    organizationId,
    prepressJobId: jobId,
    findingType: 'missing_dpi',
    severity: 'info', // TODO: Change to 'blocker' when enforcement is added
    message: options.message || `DPI metadata missing or below requirements`,
    pageNumber: options.pageNumber,
    detectedDpi: options.detectedDpi,
    requiredDpi: options.requiredDpi || 300,
    metadata: options,
  });
}

/**
 * Helper: Log spot color detection
 * 
 * Excludes operational spot colors:
 * - CutContour
 * - SpotWhite
 * - White
 * - (add more as needed)
 */
const OPERATIONAL_SPOT_COLORS = [
  'cutcontour',
  'spotwhite',
  'white',
  'cut',
  'dieline',
];

export function isOperationalSpotColor(colorName: string): boolean {
  return OPERATIONAL_SPOT_COLORS.includes(colorName.toLowerCase().trim());
}

export async function logSpotColor(
  jobId: string,
  organizationId: string,
  options: {
    spotColorName: string;
    colorModel?: string;
    pageNumber?: number;
    artboardName?: string;
    objectReference?: string;
  }
) {
  // Skip operational spot colors
  if (isOperationalSpotColor(options.spotColorName)) {
    console.log(`[Prepress Findings] Skipping operational spot color: ${options.spotColorName}`);
    return null;
  }
  
  return await createFinding({
    organizationId,
    prepressJobId: jobId,
    findingType: 'spot_color_detected',
    severity: 'info', // Informational, not an error
    message: `Spot color detected: ${options.spotColorName}`,
    pageNumber: options.pageNumber,
    artboardName: options.artboardName,
    objectReference: options.objectReference,
    spotColorName: options.spotColorName,
    colorModel: options.colorModel || 'Spot',
    metadata: options,
  });
}

/**
 * Helper: Log a fix action
 * 
 * Example usage:
 * await logFix(jobId, orgId, {
 *   fixType: 'rgb_to_cmyk',
 *   description: 'Converted RGB image to CMYK',
 *   fixedByUserId: userId, // or null for automation
 *   beforeSnapshot: { colorSpace: 'RGB' },
 *   afterSnapshot: { colorSpace: 'CMYK' }
 * });
 */
export async function logFix(
  jobId: string,
  organizationId: string,
  options: {
    fixType: InsertPrepressFixLog['fixType'];
    description: string;
    fixedByUserId?: string | null;
    beforeSnapshot?: any;
    afterSnapshot?: any;
  }
) {
  return await createFixLog({
    organizationId,
    prepressJobId: jobId,
    fixType: options.fixType,
    description: options.description,
    fixedByUserId: options.fixedByUserId || null,
    beforeSnapshot: options.beforeSnapshot || null,
    afterSnapshot: options.afterSnapshot || null,
  });
}
