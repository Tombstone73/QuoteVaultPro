import { afterAll, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';

const exists = jest.fn<(path: string) => Promise<{ data: boolean; error: { message: string } | null }>>();
const from = jest.fn(() => ({ exists }));
jest.unstable_mockModule('@supabase/supabase-js', () => ({ createClient: () => ({ storage: { from } }) }));

const previousUrl = process.env.SUPABASE_URL;
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let SupabaseStorageService: typeof import('../supabaseStorage').SupabaseStorageService;

beforeAll(async () => {
  process.env.SUPABASE_URL = 'https://storage.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
  ({ SupabaseStorageService } = await import('../supabaseStorage'));
});
beforeEach(() => { exists.mockReset(); from.mockClear(); });
afterAll(() => {
  if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

test('verifies the exact private object key instead of searching a folder', async () => {
  exists.mockResolvedValue({ data: true, error: null });
  expect(await new SupabaseStorageService('private').fileExists('orders/art.png')).toBe(true);
  expect(from).toHaveBeenCalledWith('private');
  expect(exists).toHaveBeenCalledWith('orders/art.png');
});

test('reports a confirmed absent object and keeps provider failures distinct', async () => {
  exists.mockResolvedValueOnce({ data: false, error: { message: 'not found' } });
  expect(await new SupabaseStorageService('private').fileExists('orders/missing.png')).toBe(false);
  exists.mockResolvedValueOnce({ data: false, error: null });
  expect(await new SupabaseStorageService('private').fileExists('orders/missing.png')).toBe(false);
  exists.mockResolvedValueOnce({ data: true, error: { message: 'storage unavailable' } });
  await expect(new SupabaseStorageService('private').fileExists('orders/error.png')).rejects.toThrow('Failed to verify stored file');
});
