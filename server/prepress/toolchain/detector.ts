import { exec } from "child_process";
import { promisify } from "util";
import type { ToolAvailability, ToolVersions } from "../types";

const execAsync = promisify(exec);

/**
 * Tool Detector
 * 
 * Checks which PDF processing tools are available on the system.
 * Fail-soft: missing tools result in warnings, not crashes.
 */

/**
 * Check if a command is available in PATH
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    // Try to get version or help output
    await execAsync(`${command} --version`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get version string for a tool (best effort)
 */
async function getToolVersion(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`${command} --version`, { timeout: 5000 });
    // Extract first line, trim whitespace
    const firstLine = stdout.split('\n')[0].trim();
    return firstLine || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect all available tools
 * 
 * @returns Object with boolean flags for each tool
 */
export async function detectTools(): Promise<ToolAvailability> {
  const [qpdf, pdfinfo, pdffonts, ghostscript, pdftocairo, imagemagick] = await Promise.all([
    commandExists('qpdf'),
    commandExists('pdfinfo'),
    commandExists('pdffonts'),
    commandExists('gs'), // Ghostscript command
    commandExists('pdftocairo'),
    commandExists('convert'), // ImageMagick command
  ]);
  
  return {
    qpdf,
    pdfinfo,
    pdffonts,
    ghostscript,
    pdftocairo,
    imagemagick,
  };
}

/**
 * Get versions for all available tools (best effort)
 * 
 * @returns Object with version strings for available tools
 */
export async function detectToolVersions(availability: ToolAvailability): Promise<ToolVersions> {
  const versions: ToolVersions = {};
  
  if (availability.qpdf) {
    versions.qpdf = await getToolVersion('qpdf');
  }
  
  if (availability.pdfinfo) {
    versions.pdfinfo = await getToolVersion('pdfinfo');
  }
  
  if (availability.pdffonts) {
    versions.pdffonts = await getToolVersion('pdffonts');
  }
  
  if (availability.ghostscript) {
    versions.ghostscript = await getToolVersion('gs');
  }
  
  if (availability.pdftocairo) {
    versions.pdftocairo = await getToolVersion('pdftocairo');
  }
  
  if (availability.imagemagick) {
    versions.imagemagick = await getToolVersion('convert');
  }
  
  return versions;
}

/**
 * Log tool availability for debugging
 */
export function logToolAvailability(availability: ToolAvailability, versions: ToolVersions): void {
  console.log('[Prepress Toolchain] Tool Availability:');
  for (const [tool, available] of Object.entries(availability)) {
    const version = versions[tool as keyof ToolVersions];
    const status = available ? `✓ ${version || 'version unknown'}` : '✗ not available';
    console.log(`  ${tool}: ${status}`);
  }
}
