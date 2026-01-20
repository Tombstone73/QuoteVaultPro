import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, deleteFile } from "../storage";
import path from "path";
import os from "os";

const execAsync = promisify(exec);
const TOOL_TIMEOUT_MS = parseInt(process.env.PREPRESS_TOOL_TIMEOUT_MS || '180000');

/**
 * File Format Normalizer
 * 
 * Converts various print file formats (JPG, PNG, TIF, AI, PSD) into PDF
 * for downstream preflight processing.
 * 
 * Fail-soft: Missing tools produce warnings, not crashes.
 */

export type SupportedFormat = 'pdf' | 'jpg' | 'jpeg' | 'png' | 'tif' | 'tiff' | 'ai' | 'psd';

export interface FormatDetectionResult {
  format: SupportedFormat;
  mimeType: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface NormalizationResult {
  originalFormat: SupportedFormat;
  normalizedFormat: 'pdf' | null;
  normalizedBuffer: Buffer | null;
  notes: string[];
  issues: Array<{
    severity: 'BLOCKER' | 'WARNING' | 'INFO';
    code: string;
    message: string;
    meta?: Record<string, any>;
  }>;
  metadata?: {
    dpi?: number;
    width?: number;
    height?: number;
    colorSpace?: string;
  };
}

/**
 * Detect file format from magic bytes and MIME type
 */
export function detectFileFormat(
  buffer: Buffer,
  mimeType: string,
  filename: string
): FormatDetectionResult {
  // Check magic bytes first (most reliable)
  const magicBytes = buffer.slice(0, 16);
  
  // PDF: %PDF-
  if (magicBytes.toString('utf-8', 0, 5) === '%PDF-') {
    return { format: 'pdf', mimeType: 'application/pdf', confidence: 'high' };
  }
  
  // JPEG: FF D8 FF
  if (magicBytes[0] === 0xFF && magicBytes[1] === 0xD8 && magicBytes[2] === 0xFF) {
    return { format: 'jpg', mimeType: 'image/jpeg', confidence: 'high' };
  }
  
  // PNG: 89 50 4E 47
  if (magicBytes[0] === 0x89 && magicBytes[1] === 0x50 && 
      magicBytes[2] === 0x4E && magicBytes[3] === 0x47) {
    return { format: 'png', mimeType: 'image/png', confidence: 'high' };
  }
  
  // TIFF: II* or MM*
  if ((magicBytes[0] === 0x49 && magicBytes[1] === 0x49 && magicBytes[2] === 0x2A) ||
      (magicBytes[0] === 0x4D && magicBytes[1] === 0x4D && magicBytes[2] === 0x2A)) {
    return { format: 'tif', mimeType: 'image/tiff', confidence: 'high' };
  }
  
  // PSD: 38 42 50 53
  if (magicBytes.toString('utf-8', 0, 4) === '8BPS') {
    return { format: 'psd', mimeType: 'image/vnd.adobe.photoshop', confidence: 'high' };
  }
  
  // AI files are PDF-based, so check for PDF signature + .ai extension
  const ext = path.extname(filename).toLowerCase();
  if (magicBytes.toString('utf-8', 0, 5) === '%PDF-' && ext === '.ai') {
    return { format: 'ai', mimeType: 'application/postscript', confidence: 'high' };
  }
  
  // Fallback to MIME type
  if (mimeType.includes('pdf')) {
    return { format: 'pdf', mimeType, confidence: 'medium' };
  }
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
    return { format: 'jpg', mimeType, confidence: 'medium' };
  }
  if (mimeType.includes('png')) {
    return { format: 'png', mimeType, confidence: 'medium' };
  }
  if (mimeType.includes('tiff') || mimeType.includes('tif')) {
    return { format: 'tif', mimeType, confidence: 'medium' };
  }
  if (mimeType.includes('photoshop') || ext === '.psd') {
    return { format: 'psd', mimeType, confidence: 'low' };
  }
  if (mimeType.includes('illustrator') || ext === '.ai') {
    return { format: 'ai', mimeType, confidence: 'medium' };
  }
  
  // Fallback to extension
  if (ext === '.jpg' || ext === '.jpeg') {
    return { format: 'jpg', mimeType: 'image/jpeg', confidence: 'low' };
  }
  if (ext === '.png') {
    return { format: 'png', mimeType: 'image/png', confidence: 'low' };
  }
  if (ext === '.tif' || ext === '.tiff') {
    return { format: 'tif', mimeType: 'image/tiff', confidence: 'low' };
  }
  
  // Default to PDF (original behavior)
  return { format: 'pdf', mimeType, confidence: 'low' };
}

/**
 * Get image metadata using ImageMagick identify
 */
async function getImageMetadata(inputPath: string): Promise<{
  width: number;
  height: number;
  dpi?: number;
  colorSpace?: string;
} | null> {
  try {
    const { stdout } = await execAsync(
      `identify -format "%w %h %x %[colorspace]" "${inputPath}"`,
      { timeout: TOOL_TIMEOUT_MS }
    );
    
    const parts = stdout.trim().split(' ');
    if (parts.length >= 4) {
      const dpiRaw = parseFloat(parts[2]);
      return {
        width: parseInt(parts[0]),
        height: parseInt(parts[1]),
        dpi: isNaN(dpiRaw) ? undefined : Math.round(dpiRaw),
        colorSpace: parts[3],
      };
    }
  } catch (error) {
    // Tool not available or failed
  }
  
  return null;
}

/**
 * Normalize raster image (JPG/PNG/TIF) to PDF using ImageMagick
 */
async function normalizeRasterToPdf(
  buffer: Buffer,
  format: 'jpg' | 'jpeg' | 'png' | 'tif' | 'tiff'
): Promise<NormalizationResult> {
  const tempDir = os.tmpdir();
  const inputPath = path.join(tempDir, `prepress-input-${Date.now()}.${format}`);
  const outputPath = path.join(tempDir, `prepress-output-${Date.now()}.pdf`);
  
  const result: NormalizationResult = {
    originalFormat: format === 'jpeg' ? 'jpg' : format === 'tiff' ? 'tif' : format,
    normalizedFormat: null,
    normalizedBuffer: null,
    notes: [],
    issues: [],
  };
  
  try {
    // Write input file
    await writeFile(inputPath, buffer);
    
    // Get metadata before conversion
    const metadata = await getImageMetadata(inputPath);
    if (metadata) {
      result.metadata = metadata;
      result.notes.push(`Original dimensions: ${metadata.width}x${metadata.height}px`);
      
      if (metadata.dpi) {
        result.notes.push(`DPI: ${metadata.dpi}`);
        
        // Check for low DPI
        if (metadata.dpi < 150) {
          result.issues.push({
            severity: 'WARNING',
            code: 'LOW_DPI',
            message: `Image DPI is ${metadata.dpi}, recommended minimum is 300 for print`,
            meta: { dpi: metadata.dpi, recommended: 300 },
          });
        } else if (metadata.dpi < 300) {
          result.issues.push({
            severity: 'INFO',
            code: 'MARGINAL_DPI',
            message: `Image DPI is ${metadata.dpi}, recommended is 300 for optimal print quality`,
            meta: { dpi: metadata.dpi, recommended: 300 },
          });
        }
      } else {
        result.notes.push('DPI metadata not available');
      }
      
      if (metadata.colorSpace) {
        result.notes.push(`Color space: ${metadata.colorSpace}`);
        
        if (metadata.colorSpace.toLowerCase().includes('rgb')) {
          result.issues.push({
            severity: 'INFO',
            code: 'RGB_COLORSPACE',
            message: 'Image is in RGB color space. CMYK is preferred for print.',
            meta: { colorSpace: metadata.colorSpace },
          });
        }
      }
    }
    
    // Try ImageMagick convert
    try {
      const { stdout, stderr } = await execAsync(
        `convert "${inputPath}" -compress Zip -quality 95 "${outputPath}"`,
        { timeout: TOOL_TIMEOUT_MS }
      );
      
      if (stderr) {
        result.notes.push(`ImageMagick warnings: ${stderr.slice(0, 200)}`);
      }
      
      // Read normalized PDF
      const normalizedBuffer = await readFile(outputPath);
      result.normalizedFormat = 'pdf';
      result.normalizedBuffer = normalizedBuffer;
      result.notes.push('Converted to PDF using ImageMagick');
      
    } catch (convertError: any) {
      // ImageMagick not available or conversion failed
      result.issues.push({
        severity: 'BLOCKER',
        code: 'NORMALIZATION_FAILED',
        message: `Failed to convert ${format.toUpperCase()} to PDF. ImageMagick may not be installed.`,
        meta: { 
          error: convertError.message,
          suggestion: 'Install ImageMagick or upload a PDF file instead',
        },
      });
      result.notes.push('ImageMagick conversion failed or tool not available');
    }
    
  } finally {
    // Cleanup temp files
    await deleteFile(inputPath).catch(() => {});
    await deleteFile(outputPath).catch(() => {});
  }
  
  return result;
}

/**
 * Normalize Adobe Illustrator file to PDF
 * AI files are PDF-based, so we can pass them through with validation
 */
async function normalizeAiToPdf(buffer: Buffer): Promise<NormalizationResult> {
  const result: NormalizationResult = {
    originalFormat: 'ai',
    normalizedFormat: 'pdf',
    normalizedBuffer: buffer, // AI files are already PDF-compatible
    notes: ['Adobe Illustrator file (PDF-based) passed through for preflight'],
    issues: [],
  };
  
  // AI files are PDF-based, but warn about potential compatibility
  result.issues.push({
    severity: 'INFO',
    code: 'AI_FILE_DETECTED',
    message: 'Adobe Illustrator file detected. File will be processed as PDF.',
    meta: { 
      note: 'For best results, export as PDF/X-4 from Illustrator before upload',
    },
  });
  
  return result;
}

/**
 * Normalize Photoshop PSD file to PDF
 * PSD requires special handling and may not be fully supported
 */
async function normalizePsdToPdf(buffer: Buffer): Promise<NormalizationResult> {
  const tempDir = os.tmpdir();
  const inputPath = path.join(tempDir, `prepress-input-${Date.now()}.psd`);
  const outputPath = path.join(tempDir, `prepress-output-${Date.now()}.pdf`);
  
  const result: NormalizationResult = {
    originalFormat: 'psd',
    normalizedFormat: null,
    normalizedBuffer: null,
    notes: [],
    issues: [],
  };
  
  try {
    // Write input file
    await writeFile(inputPath, buffer);
    
    // Try ImageMagick convert (flatten to single layer)
    try {
      const { stdout, stderr } = await execAsync(
        `convert "${inputPath}[0]" -flatten -compress Zip -quality 95 "${outputPath}"`,
        { timeout: TOOL_TIMEOUT_MS }
      );
      
      if (stderr) {
        result.notes.push(`ImageMagick warnings: ${stderr.slice(0, 200)}`);
      }
      
      // Read normalized PDF
      const normalizedBuffer = await readFile(outputPath);
      result.normalizedFormat = 'pdf';
      result.normalizedBuffer = normalizedBuffer;
      result.notes.push('Converted to PDF using ImageMagick (flattened to single layer)');
      
      // Warn about layer flattening
      result.issues.push({
        severity: 'WARNING',
        code: 'PSD_FLATTENED',
        message: 'PSD file was flattened to a single layer during conversion. Layer information was lost.',
        meta: { 
          suggestion: 'For better control, flatten and export as PDF or TIFF from Photoshop before upload',
        },
      });
      
    } catch (convertError: any) {
      // ImageMagick not available or conversion failed
      result.issues.push({
        severity: 'BLOCKER',
        code: 'PSD_NORMALIZATION_FAILED',
        message: 'Failed to convert PSD to PDF. ImageMagick may not be installed or PSD format is unsupported.',
        meta: { 
          error: convertError.message,
          suggestion: 'Flatten layers and export as PDF, TIFF, or JPG from Photoshop',
        },
      });
      result.notes.push('ImageMagick PSD conversion failed or tool not available');
    }
    
  } finally {
    // Cleanup temp files
    await deleteFile(inputPath).catch(() => {});
    await deleteFile(outputPath).catch(() => {});
  }
  
  return result;
}

/**
 * Main normalization entry point
 */
export async function normalizeFile(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<NormalizationResult> {
  const detection = detectFileFormat(buffer, mimeType, filename);
  
  console.log(`[Normalizer] Detected format: ${detection.format} (confidence: ${detection.confidence})`);
  
  switch (detection.format) {
    case 'pdf':
      // PDF: pass through unchanged
      return {
        originalFormat: 'pdf',
        normalizedFormat: 'pdf',
        normalizedBuffer: buffer,
        notes: ['PDF file, no normalization needed'],
        issues: [],
      };
    
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'tif':
    case 'tiff':
      return normalizeRasterToPdf(buffer, detection.format);
    
    case 'ai':
      return normalizeAiToPdf(buffer);
    
    case 'psd':
      return normalizePsdToPdf(buffer);
    
    default:
      return {
        originalFormat: detection.format,
        normalizedFormat: null,
        normalizedBuffer: null,
        notes: [`Unknown format: ${detection.format}`],
        issues: [{
          severity: 'BLOCKER',
          code: 'UNSUPPORTED_FORMAT',
          message: `File format '${detection.format}' is not supported`,
          meta: { 
            detectedFormat: detection.format,
            suggestion: 'Please upload PDF, JPG, PNG, TIF, AI, or PSD files',
          },
        }],
      };
  }
}
