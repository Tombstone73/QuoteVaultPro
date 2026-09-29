import { beforeEach, afterEach, expect, jest, test } from '@jest/globals';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const record = jest.fn<any>();
const resolve = jest.fn<any>();
const handle = jest.fn<any>();
jest.unstable_mockModule('../storage/fileRecord.repo', () => ({ fileRecordRepository: { getByIdForOrganization: record } }));
jest.unstable_mockModule('../services/storage/CanonicalFileReadResolver', () => ({ canonicalFileReadResolver: { resolveOriginal: resolve } }));
jest.unstable_mockModule('../storage/storageProviderConfig.repo', () => ({ storageProviderConfigRepository: { getById: async () => ({ providerType:'supabase' }) } }));
jest.unstable_mockModule('../services/storage/StorageRegistry', () => ({ storageRegistry: { getAdapter: () => ({ getDownloadHandle:handle }) } }));
const { readArtworkPreviewSource, readBoundedPreviewSource } = await import('../services/readArtworkPreviewSource');
const { readArtworkUploadHeader } = await import('../services/artworkUploadValidation');
const originalFetch = global.fetch;
beforeEach(() => { record.mockReset(); resolve.mockReset(); handle.mockReset(); });
afterEach(() => { global.fetch = originalFetch; });

test('cross-tenant source rejected before accessing storage', async () => {
  record.mockResolvedValue(null);
  await expect(readArtworkPreviewSource('other-file','org-a')).rejects.toThrow('preview_source_unavailable');
  expect(record).toHaveBeenCalledWith('org-a','other-file'); expect(resolve).not.toHaveBeenCalled(); expect(handle).not.toHaveBeenCalled();
});
test('bounded local reads preserve original filename and bytes; header inspection closes file', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'ai-preview-test-'));
  const file=path.join(dir,'customer art $ quote.ai'); const bytes=Buffer.from('%PDF-1.4\nfixture');
  try {
    await writeFile(file,bytes);
    expect(await readBoundedPreviewSource('local_file',file)).toEqual(bytes);
    expect(await readArtworkUploadHeader('local_file',file)).toEqual(bytes);
    record.mockResolvedValue({ organizationId:'org' });
    resolve.mockResolvedValue({ status:'available',providerConfigId:'config',localPathRef:file });
    handle.mockResolvedValue({kind:'local_file',value:file});
    expect(createHash('sha256').update(await readArtworkPreviewSource('file','org')).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
  } finally { await unlink(file); await rmdir(dir); }
});
test('oversized remote response rejected without downloading the body', async () => {
  global.fetch=jest.fn<any>(async () => new Response('small',{headers:{'content-length':String(2*1024**3)}}));
  await expect(readBoundedPreviewSource('signed_url','https://storage.test/private')).rejects.toThrow('preview_size_limit');
});
test('remote signed URL uses bounded header-only inspection even if Range ignored', async () => {
  const cancel=jest.fn();
  global.fetch=jest.fn<any>(async () => new Response(new ReadableStream({ start(controller){controller.enqueue(new TextEncoder().encode('%PDF-1.4'+'x'.repeat(1024)));}, cancel })));
  const header=await readArtworkUploadHeader('signed_url','https://storage.test/private');
  expect(header.length).toBe(32); expect(cancel).toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledWith('https://storage.test/private',expect.objectContaining({headers:{Range:'bytes=0-31'}}));
});
