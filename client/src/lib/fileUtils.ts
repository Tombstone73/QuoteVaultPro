/**
 * Format bytes to human-readable file size
 * @param bytes - File size in bytes
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string like "2.5 MB"
 */
export function formatFileSize(bytes: number | null | undefined, decimals: number = 1): string {
  if (!bytes || bytes === 0) return "0 B";
  if (!Number.isFinite(bytes) || bytes < 0) return "—";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));

  return `${size} ${sizes[i]}`;
}

/**
 * Get file type label from MIME type or filename extension
 * @param mimeType - MIME type (e.g., "application/pdf")
 * @param fileName - Filename with extension
 * @returns Readable file type (e.g., "PDF", "PNG Image")
 */
export function getFileTypeLabel(mimeType: string | null | undefined, fileName: string): string {
  // Try MIME type first
  if (mimeType) {
    const mime = mimeType.toLowerCase();
    
    // PDF
    if (mime === "application/pdf") return "PDF";
    
    // Images
    if (mime === "image/jpeg" || mime === "image/jpg") return "JPEG Image";
    if (mime === "image/png") return "PNG Image";
    if (mime === "image/gif") return "GIF Image";
    if (mime === "image/webp") return "WebP Image";
    if (mime === "image/svg+xml") return "SVG Image";
    if (mime === "image/tiff" || mime === "image/tif") return "TIFF Image";
    if (mime === "image/bmp") return "BMP Image";
    
    // Adobe formats
    if (mime === "application/postscript" || mime === "application/eps") return "EPS";
    if (mime === "application/illustrator" || mime === "application/x-illustrator") return "Adobe Illustrator";
    if (mime.includes("photoshop") || mime.includes("psd")) return "Photoshop";
    
    // Other common types
    if (mime.startsWith("image/")) return "Image";
    if (mime.includes("zip")) return "ZIP Archive";
    if (mime.includes("text/")) return "Text File";
  }
  
  // Fallback to extension
  const ext = fileName.toLowerCase().split(".").pop();
  if (!ext) return "File";
  
  const extMap: Record<string, string> = {
    pdf: "PDF",
    jpg: "JPEG Image",
    jpeg: "JPEG Image",
    png: "PNG Image",
    gif: "GIF Image",
    webp: "WebP Image",
    svg: "SVG Image",
    tif: "TIFF Image",
    tiff: "TIFF Image",
    bmp: "BMP Image",
    eps: "EPS",
    ai: "Adobe Illustrator",
    psd: "Photoshop",
    zip: "ZIP Archive",
    txt: "Text File",
  };
  
  return extMap[ext] || ext.toUpperCase();
}

/**
 * Build download URL with proper filename and Content-Disposition: attachment
 * @param baseUrl - File URL (e.g., /objects/... or /api/assets/...)
 * @param fileName - Original filename for download
 * @returns URL with download query params
 */
export function buildDownloadUrl(baseUrl: string, fileName: string): string {
  if (!baseUrl) return "";
  
  try {
    const url = new URL(baseUrl, window.location.origin);
    url.searchParams.set("download", "1");
    url.searchParams.set("filename", fileName);
    return url.toString();
  } catch {
    // Fallback for relative URLs
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}download=1&filename=${encodeURIComponent(fileName)}`;
  }
}
