/** Illustrator/EPS always use derivatives, even when the browser reports application/pdf. */
export function isVectorArtwork(fileName?: string | null, mimeType?: string | null): boolean {
  return /\.(ai|eps)$/i.test(fileName ?? '') || /illustrator|postscript/i.test(mimeType ?? '');
}

export type ArtworkFormat = 'pdf' | 'postscript' | 'unknown';
export function detectArtworkFormat(bytes: Uint8Array): ArtworkFormat {
  // Bounded header inspection only; never interpret source text or execute PostScript.
  const header = Array.from(bytes.subarray(0, 32), byte => String.fromCharCode(byte)).join('');
  if (/^%PDF-\d\.\d/.test(header)) return 'pdf';
  if (header.startsWith('%!PS') || (bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6)) return 'postscript';
  return 'unknown';
}

export function artworkPreviewMessage(status?: string | null, error?: string | null): string {
  if (error?.startsWith('preview_unsupported')) return 'Preview unavailable for this Illustrator/EPS file.';
  if (status === 'thumb_failed' || status === 'failed') return 'Preview generation failed. Download the original file.';
  if (status === 'uploaded' || status === 'thumb_pending' || status === 'pending') return 'Generating preview...';
  return 'Preview unavailable for this Illustrator/EPS file.';
}
