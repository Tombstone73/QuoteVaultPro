import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yauzl = require('yauzl') as {
  fromBuffer(buffer: Buffer, options: Record<string, unknown>, callback: (error: Error | null, zip: any) => void): void;
};

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRIES = 100;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_RATIO = 200;
const supportedMimeTypes: Record<string, string> = {
  pdf: 'application/pdf', ai: 'application/postscript', eps: 'application/postscript',
  svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const nestedArchives = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']);

export class InboundZipInspectionError extends Error {
  constructor(message: string, readonly statusCode: 413 | 415 = 415) { super(message); }
}

export type InboundZipManifestEntry = {
  id: string;
  filename: string;
  uncompressedBytes: number;
  compressedBytes: number;
  supported: boolean;
  reason: string | null;
  suggestedRole: 'artwork' | 'po' | 'reference' | 'other';
  mimeType: string | null;
};

export type InspectedInboundZip = {
  entries: InboundZipManifestEntry[];
  archiveSha256: string;
  buffers: Map<string, Buffer>;
};

function suggestedRole(filename: string): InboundZipManifestEntry['suggestedRole'] {
  if (/\b(?:purchase[\s_-]*order|po[\s_-]*\d|p\.?o\.?[\s_-]*\d)/i.test(filename)) return 'po';
  if (/\b(?:spec|instruction|readme|reference)/i.test(filename)) return 'reference';
  if (/\.(?:ai|eps|svg|tif|tiff|jpg|jpeg|png)$/i.test(filename) || /\b(?:art|artwork|front|back|design)/i.test(filename)) return 'artwork';
  return 'reference';
}

function unsafePath(filename: string): boolean {
  const normalized = filename.replace(/\\/g, '/');
  return normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
    || normalized.split('/').some((part) => part === '..' || part === '.')
    || /[\u0000-\u001f]/.test(filename);
}

function isLink(entry: any): boolean {
  const unixMode = (Number(entry.externalFileAttributes ?? 0) >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

export async function inspectInboundZip(buffer: Buffer): Promise<InspectedInboundZip> {
  if (buffer.length === 0 || buffer.length > MAX_ARCHIVE_BYTES) throw new InboundZipInspectionError('ZIP must be between 1 byte and 25 MB.', 413);
  if (buffer.subarray(0, 4).toString('binary') !== 'PK\x03\x04') throw new InboundZipInspectionError('Stored file is not a readable ZIP archive.');
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, autoClose: true, decodeStrings: true }, (openError, zip) => {
      if (openError || !zip) return reject(new InboundZipInspectionError('ZIP archive is corrupt or unsupported.'));
      const entries: InboundZipManifestEntry[] = [];
      const buffers = new Map<string, Buffer>();
      const names = new Set<string>();
      let expanded = 0;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      zip.on('error', () => fail(new InboundZipInspectionError('ZIP archive could not be read safely.')));
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ entries, buffers, archiveSha256: createHash('sha256').update(buffer).digest('hex') });
      });
      zip.on('entry', (entry: any) => {
        if (settled) return;
        if (entries.length >= MAX_ENTRIES) return fail(new InboundZipInspectionError('ZIP contains more than 100 entries.', 413));
        const filename = String(entry.fileName ?? '');
        if (unsafePath(filename) || isLink(entry) || entry.isEncrypted?.()) {
          return fail(new InboundZipInspectionError('ZIP contains an unsafe path, link, or encrypted entry.'));
        }
        const normalizedName = filename.replace(/\\/g, '/');
        if (names.has(normalizedName.toLowerCase())) return fail(new InboundZipInspectionError('ZIP contains duplicate entry names.'));
        names.add(normalizedName.toLowerCase());
        const uncompressedBytes = Number(entry.uncompressedSize);
        const compressedBytes = Number(entry.compressedSize);
        if (!Number.isSafeInteger(uncompressedBytes) || !Number.isSafeInteger(compressedBytes) || uncompressedBytes < 0 || compressedBytes < 0) {
          return fail(new InboundZipInspectionError('ZIP contains invalid entry sizes.'));
        }
        expanded += uncompressedBytes;
        if (uncompressedBytes > MAX_ENTRY_BYTES || expanded > MAX_EXPANDED_BYTES) return fail(new InboundZipInspectionError('ZIP exceeds the allowed expanded size.', 413));
        if (uncompressedBytes > 0 && (compressedBytes === 0 || uncompressedBytes / compressedBytes > MAX_RATIO)) {
          return fail(new InboundZipInspectionError('ZIP contains an excessive compression ratio.', 413));
        }
        const basename = normalizedName.split('/').pop() ?? '';
        const extension = basename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
        const directory = normalizedName.endsWith('/');
        const reason = directory ? 'Folder; no file to import.'
          : nestedArchives.has(extension) ? 'Nested archives are not supported.'
          : !supportedMimeTypes[extension] ? 'File type is not supported for inbound import.'
          : uncompressedBytes === 0 ? 'Empty file cannot be imported.' : null;
        const id = createHash('sha256').update(JSON.stringify({ filename: normalizedName, crc32: entry.crc32, uncompressedBytes, compressedBytes })).digest('hex');
        const manifest: InboundZipManifestEntry = { id, filename: normalizedName, uncompressedBytes, compressedBytes,
          supported: !reason, reason, suggestedRole: suggestedRole(basename), mimeType: supportedMimeTypes[extension] ?? null };
        entries.push(manifest);
        if (reason) { zip.readEntry(); return; }
        zip.openReadStream(entry, (streamError: Error | null, stream: any) => {
          if (streamError || !stream) return fail(new InboundZipInspectionError(`Could not read ${basename}.`));
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > uncompressedBytes || size > MAX_ENTRY_BYTES) { stream.destroy(); fail(new InboundZipInspectionError('ZIP entry expanded beyond its declared size.', 413)); return; }
            chunks.push(chunk);
          });
          stream.on('error', () => fail(new InboundZipInspectionError(`Could not read ${basename}.`)));
          stream.on('end', () => {
            if (settled) return;
            if (size !== uncompressedBytes) return fail(new InboundZipInspectionError('ZIP entry size did not match its manifest.'));
            buffers.set(id, Buffer.concat(chunks, size));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
