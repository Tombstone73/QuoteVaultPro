import { open } from 'node:fs/promises';
import { ARTWORK_PREVIEW_MAX_BYTES, ARTWORK_PREVIEW_TIMEOUT_MS, renderArtworkPdfFirstPage } from './artworkPdfRenderer';
import { detectArtworkFormat } from '@shared/artworkPreview';
import { canonicalFileReadResolver } from './storage/CanonicalFileReadResolver';
import { fileRecordRepository } from '../storage/fileRecord.repo';
import { storageProviderConfigRepository } from '../storage/storageProviderConfig.repo';
import { storageRegistry } from './storage/StorageRegistry';

export async function readBoundedPreviewSource(kind: 'signed_url' | 'local_file', value: string): Promise<Buffer> {
  if (kind === 'local_file') {
    const file = await open(value, 'r');
    try {
      if ((await file.stat()).size > ARTWORK_PREVIEW_MAX_BYTES) throw new Error('preview_size_limit');
      const chunks: Buffer[] = [];
      let size = 0;
      const startedAt = Date.now();
      while (true) {
        if (Date.now() - startedAt > ARTWORK_PREVIEW_TIMEOUT_MS) throw new Error('preview_timeout');
        const chunk = Buffer.alloc(1024 * 1024);
        const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > ARTWORK_PREVIEW_MAX_BYTES) throw new Error('preview_size_limit');
        chunks.push(chunk.subarray(0, bytesRead));
      }
      return Buffer.concat(chunks);
    } finally { await file.close(); }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARTWORK_PREVIEW_TIMEOUT_MS);
  try {
    const response = await fetch(value, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('preview_source_unavailable');
    if (Number(response.headers.get('content-length')) > ARTWORK_PREVIEW_MAX_BYTES) throw new Error('preview_size_limit');
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > ARTWORK_PREVIEW_MAX_BYTES) throw new Error('preview_size_limit');
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks);
    } finally { await reader.cancel().catch(() => undefined); }
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Resolve the already-authorized source through the existing private storage adapter. */
export async function readArtworkPreviewSource(fileRecordId: string | null | undefined, organizationId: string): Promise<Buffer> {
  if (!fileRecordId) throw new Error('preview_source_unavailable');
  const record = await fileRecordRepository.getByIdForOrganization(organizationId, fileRecordId);
  if (!record || record.organizationId !== organizationId) throw new Error('preview_source_unavailable');
  const source = await canonicalFileReadResolver.resolveOriginal(fileRecordId);
  if (source.status !== 'available' || !source.providerConfigId) throw new Error('preview_source_unavailable');
  const config = await storageProviderConfigRepository.getById(source.providerConfigId);
  if (!config) throw new Error('preview_source_unavailable');
  const handle = await storageRegistry.getAdapter(config.providerType).getDownloadHandle({
    providerConfig: config, objectKey: source.objectKey, localPathRef: source.localPathRef,
  });
  return readBoundedPreviewSource(handle.kind === 'signed_url' ? 'signed_url' : 'local_file', handle.value);
}

const inFlight = new Map<string, Promise<Buffer>>();
/** Bound source downloads as well as converters; attachment/asset triggers share a render. */
export function renderVectorArtworkPreview(fileRecordId: string | null | undefined, organizationId: string): Promise<Buffer> {
  const key = `${organizationId}:${fileRecordId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (inFlight.size >= 2) return Promise.reject(new Error('preview_renderer_busy'));
  const task = (async () => {
    const bytes = await readArtworkPreviewSource(fileRecordId, organizationId);
    console.info('[ArtworkPreview]', { fileRecordId, format: detectArtworkFormat(bytes), renderer: 'pdfjs-canvas' });
    return renderArtworkPdfFirstPage(bytes);
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}
