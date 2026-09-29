import { open } from 'node:fs/promises';
import { isVectorArtwork } from '@shared/artworkPreview';

export function assertArtworkHeaderNotExecutable(fileName: string, mimeType: string, bytes: Uint8Array): void {
  if (!isVectorArtwork(fileName, mimeType)) return;
  const prefix = Buffer.from(bytes.subarray(0, 4)).toString('hex');
  if (prefix.startsWith('4d5a') || prefix === '7f454c46' || prefix.startsWith('2321') || ['feedface','feedfacf','cefaedfe','cffaedfe'].includes(prefix)) {
    throw Object.assign(new Error('Executable content cannot be uploaded as Illustrator/EPS artwork.'), { statusCode: 400, code: 'INVALID_ARTWORK_CONTENT' });
  }
}

/** Inspect only a small header, including signed direct uploads, before linking an original. */
export async function readArtworkUploadHeader(kind: string, value: string): Promise<Buffer> {
  if (kind !== 'signed_url') {
    const file = await open(value, 'r');
    try {
      const header = Buffer.alloc(32);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      return header.subarray(0, bytesRead);
    } finally { await file.close(); }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(value, { headers: { Range: 'bytes=0-31' }, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('Unable to inspect artwork upload');
    const reader = response.body.getReader();
    const parts: Buffer[] = [];
    let count = 0;
    try {
      while (count < 32) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const part = Buffer.from(chunk.value.subarray(0, 32 - count));
        parts.push(part); count += part.length;
      }
      return Buffer.concat(parts);
    } finally { await reader.cancel().catch(() => undefined); }
  } finally { clearTimeout(timer); controller.abort(); }
}
