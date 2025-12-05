import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * File Storage Utility Module
 * 
 * Handles file storage operations for QuoteVaultPro attachments.
 * Supports local filesystem storage with structured paths and safe filenames.
 * 
 * Key Concepts:
 * - originalFilename: Exact name as uploaded by user (preserved for display)
 * - storedFilename: Sanitized safe filename used on disk ({shortId}_{slug}.{ext})
 * - relativePath: Path structure relative to storage root (org-{orgId}/orders/{orderNum}/line-{lineItemId}/{storedFilename})
 * - storageProvider: 'local' (default), 's3', 'gcs', 'supabase' (future support)
 */

/**
 * Generate a short random ID for unique file identification
 * @returns 8-character alphanumeric string
 */
export function generateShortId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Sanitize filename to create safe slug
 * - Converts to lowercase
 * - Replaces spaces with dashes
 * - Removes non-alphanumeric characters (except dashes, underscores, dots)
 * - Truncates to 60 characters max
 * 
 * @param filename Original filename
 * @returns Sanitized slug without extension
 */
export function sanitizeFilename(filename: string): string {
  // Remove extension for processing
  const baseName = filename.replace(/\.[^.]*$/, '');
  
  return baseName
    .toLowerCase()
    .replace(/\s+/g, '-')           // Spaces to dashes
    .replace(/[^a-z0-9-_]/g, '')    // Remove non-alphanumeric (keep dashes, underscores)
    .replace(/-+/g, '-')            // Collapse multiple dashes
    .replace(/^-|-$/g, '')          // Trim leading/trailing dashes
    .slice(0, 60);                  // Limit length
}

/**
 * Extract file extension from filename
 * @param filename Original filename
 * @returns Extension without dot (e.g., 'pdf', 'jpg'), or empty string if none
 */
export function getFileExtension(filename: string): string {
  const match = filename.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Generate stored filename with format: {shortId}_{slug}.{ext}
 * 
 * @param originalFilename Original filename from user
 * @returns Safe filename for disk storage
 */
export function generateStoredFilename(originalFilename: string): string {
  const shortId = generateShortId();
  const slug = sanitizeFilename(originalFilename);
  const extension = getFileExtension(originalFilename);
  
  const baseName = slug || 'file'; // Fallback if sanitization produces empty string
  return extension ? `${shortId}_${baseName}.${extension}` : `${shortId}_${baseName}`;
}

/**
 * Generate relative path for file storage
 * Path structure: org-{orgId}/orders/{orderNumber}/line-{lineItemId}/{storedFilename}
 * 
 * @param options Path generation options
 * @returns Relative path from storage root
 */
export function generateRelativePath(options: {
  organizationId: string;
  orderNumber?: string;
  lineItemId?: string;
  storedFilename: string;
  resourceType?: 'quote' | 'order' | 'customer' | 'job';
  resourceId?: string;
}): string {
  const {
    organizationId,
    orderNumber,
    lineItemId,
    storedFilename,
    resourceType,
    resourceId,
  } = options;

  const parts: string[] = [`org-${organizationId}`];

  // Order-specific path
  if (orderNumber) {
    parts.push('orders', orderNumber);
    if (lineItemId) {
      parts.push(`line-${lineItemId}`);
    }
  }
  // Generic resource path (fallback for quotes, customers, jobs)
  else if (resourceType && resourceId) {
    parts.push(`${resourceType}s`, resourceId);
  }

  parts.push(storedFilename);
  return parts.join('/');
}

/**
 * Get absolute file path from relative path
 * @param relativePath Relative path from storage root
 * @returns Absolute filesystem path
 */
export function getAbsolutePath(relativePath: string): string {
  const storageRoot = process.env.FILE_STORAGE_ROOT || path.join(process.cwd(), 'uploads');
  return path.join(storageRoot, relativePath);
}

/**
 * Ensure directory exists, creating parent directories as needed
 * @param dirPath Absolute directory path
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Save file buffer to disk at specified path
 * Creates parent directories if they don't exist
 * 
 * @param relativePath Relative path from storage root
 * @param buffer File data buffer
 * @returns Absolute path where file was saved
 */
export async function saveFile(relativePath: string, buffer: Buffer): Promise<string> {
  const absolutePath = getAbsolutePath(relativePath);
  const directory = path.dirname(absolutePath);
  
  await ensureDirectory(directory);
  await fs.writeFile(absolutePath, buffer);
  
  return absolutePath;
}

/**
 * Compute SHA256 checksum of file buffer
 * @param buffer File data buffer
 * @returns Hex-encoded SHA256 hash
 */
export function computeChecksum(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Delete file from disk
 * @param relativePath Relative path from storage root
 * @returns True if deleted, false if file didn't exist
 */
export async function deleteFile(relativePath: string): Promise<boolean> {
  try {
    const absolutePath = getAbsolutePath(relativePath);
    await fs.unlink(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false; // File didn't exist
    }
    throw error;
  }
}

/**
 * Check if file exists on disk
 * @param relativePath Relative path from storage root
 * @returns True if file exists
 */
export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    const absolutePath = getAbsolutePath(relativePath);
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file stats (size, timestamps, etc.)
 * @param relativePath Relative path from storage root
 * @returns File stats or null if file doesn't exist
 */
export async function getFileStats(relativePath: string): Promise<fs.Stats | null> {
  try {
    const absolutePath = getAbsolutePath(relativePath);
    return await fs.stat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Read file from disk
 * @param relativePath Relative path from storage root
 * @returns File buffer or null if file doesn't exist
 */
export async function readFile(relativePath: string): Promise<Buffer | null> {
  try {
    const absolutePath = getAbsolutePath(relativePath);
    return await fs.readFile(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Process uploaded file and generate all metadata
 * This is the main entry point for handling new file uploads
 * 
 * @param options File upload options
 * @returns Complete file metadata for database insertion
 */
export async function processUploadedFile(options: {
  originalFilename: string;
  buffer: Buffer;
  mimeType: string;
  organizationId: string;
  orderNumber?: string;
  lineItemId?: string;
  resourceType?: 'quote' | 'order' | 'customer' | 'job';
  resourceId?: string;
}): Promise<{
  originalFilename: string;
  storedFilename: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  checksum: string;
  absolutePath: string;
}> {
  const {
    originalFilename,
    buffer,
    organizationId,
    orderNumber,
    lineItemId,
    resourceType,
    resourceId,
  } = options;

  // Generate safe filename
  const storedFilename = generateStoredFilename(originalFilename);
  const extension = getFileExtension(originalFilename);

  // Generate path structure
  const relativePath = generateRelativePath({
    organizationId,
    orderNumber,
    lineItemId,
    storedFilename,
    resourceType,
    resourceId,
  });

  // Save file to disk
  const absolutePath = await saveFile(relativePath, buffer);

  // Compute metadata
  const sizeBytes = buffer.length;
  const checksum = computeChecksum(buffer);

  return {
    originalFilename,
    storedFilename,
    relativePath,
    extension,
    sizeBytes,
    checksum,
    absolutePath,
  };
}

/**
 * Generate thumbnail relative path from original file path
 * Thumbnails are stored in same directory with _thumb suffix
 * 
 * @param relativePath Original file relative path
 * @returns Thumbnail relative path
 */
export function generateThumbnailPath(relativePath: string): string {
  const parsed = path.parse(relativePath);
  return path.join(parsed.dir, `${parsed.name}_thumb${parsed.ext}`);
}
