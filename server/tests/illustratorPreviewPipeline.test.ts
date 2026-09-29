import { beforeEach, expect, jest, test } from '@jest/globals';
import sharp from 'sharp';

let row: any;
const writes: any[] = [];
const updates: any[] = [];
const render = jest.fn<any>();
const persist = jest.fn<any>();
const source = { status: 'available', providerConfigId: 'provider', objectKey: 'originals/logo.ai' };
const adapter = { putObject: jest.fn<any>(async (input: any) => { writes.push(input); return { objectKey: input.requestedTarget }; }), verifyObject: jest.fn<any>(async () => ({ exists: true })) };
jest.unstable_mockModule('../db', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
  update: () => ({ set: (values: any) => ({ where: async () => { updates.push(values); Object.assign(row, values); } }) }),
} }));
jest.unstable_mockModule('../services/readArtworkPreviewSource', () => ({ renderVectorArtworkPreview: render }));
jest.unstable_mockModule('../services/storage/persistFileDerivative', () => ({ persistReadyFileDerivative: persist }));
jest.unstable_mockModule('../services/storage/CanonicalFileReadResolver', () => ({ canonicalFileReadResolver: { resolveOriginal: async () => source } }));
jest.unstable_mockModule('../storage/storagePlacement.repo', () => ({ storagePlacementRepository: { getActiveCanonicalPlacementByFileRecordId: async () => ({ id: 'placement', bucket: 'private' }) } }));
jest.unstable_mockModule('../storage/storageProviderConfig.repo', () => ({ storageProviderConfigRepository: { getById: async () => ({ providerType: 'supabase' }) } }));
jest.unstable_mockModule('../services/storage/StorageRegistry', () => ({ storageRegistry: { getAdapter: () => adapter } }));
const { generateImageDerivatives } = await import('../services/thumbnailGenerator');

beforeEach(async () => {
  row = { id: 'attachment', fileRecordId: 'file-original', fileName: 'logo.ai', originalFilename: 'logo.ai', thumbStatus: 'thumb_pending' };
  writes.length = 0; updates.length = 0; persist.mockClear(); render.mockReset();
  render.mockResolvedValue(await sharp({ create: { width: 800, height: 400, channels: 3, background: '#0055aa' } }).png().toBuffer());
});
const run = () => generateImageDerivatives('attachment','order','originals/logo.ai','application/octet-stream','supabase','org','logo.ai');

test('existing attachment pipeline writes only linked derivatives and marks ready', async () => {
  await run();
  expect(render).toHaveBeenCalledWith('file-original','org');
  expect(writes).toHaveLength(2);
  expect(writes.every(x => x.requestedTarget.startsWith('thumbs/') && x.mimeType === 'image/jpeg')).toBe(true);
  expect(writes.map(x => x.requestedTarget)).toEqual(['thumbs/org/order/attachment/file-original.thumb.jpg','thumbs/org/order/attachment/file-original.preview.jpg']);
  expect(persist.mock.calls.map(([x]: any) => x.derivativeType).sort()).toEqual(['preview','thumbnail']);
  expect(row).toMatchObject({ fileRecordId:'file-original', fileName:'logo.ai', thumbStatus:'thumb_ready' });
  expect(updates.every(x => !('fileUrl' in x) && !('fileRecordId' in x) && !('fileName' in x))).toBe(true);
  await run(); expect(render).toHaveBeenCalledTimes(1);
});
test.each(['preview_unsupported_postscript','preview_unsupported_unknown','preview_timeout','preview_render_failed'])('failure %s preserves original and terminates pending state', async reason => {
  render.mockRejectedValue(new Error(reason));
  await expect(run()).resolves.toBeUndefined();
  expect(row).toMatchObject({ fileRecordId:'file-original', fileName:'logo.ai', thumbStatus:'thumb_failed', thumbError:reason });
  expect(writes).toHaveLength(0); expect(persist).not.toHaveBeenCalled();
});
test('replacement source receives a different derivative identity', async () => {
  await run();
  row = { id:'attachment', fileRecordId:'replacement', fileName:'logo.ai', thumbStatus:'thumb_pending' };
  await run();
  expect(writes[2].requestedTarget).toContain('/replacement.thumb.jpg');
  expect(persist.mock.calls[2][0].fileRecordId).toBe('replacement');
});
test('infrastructure diagnostics are not stored as customer-visible error text', async () => {
  render.mockRejectedValue(new Error('secret /server/path stack'));
  await run(); expect(row.thumbError).toBe('preview_generation_failed');
});
