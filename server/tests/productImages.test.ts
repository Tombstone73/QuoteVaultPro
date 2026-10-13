import { expect, test } from '@jest/globals';
import { ProductImageAssignmentError, saveProductImages, validateProductImageAssignments } from '../services/products/productImages';

const first = '/objects/uploads/image-a';
const second = 'https://images.example.com/image-b.png';
const mediaAssets = [{ url: first, mimeType: 'image/png' }, { url: second, mimeType: 'image/png' }, { url: '/objects/uploads/manual.pdf', mimeType: 'application/pdf' }];

test('image assignments use only customer-safe images owned by this product or tenant media library', () => {
  expect(validateProductImageAssignments([second, first], [], mediaAssets as any)).toEqual([second, first]);
  expect(() => validateProductImageAssignments(['/objects/uploads/other-tenant'], [], mediaAssets as any)).toThrow(ProductImageAssignmentError);
  expect(() => validateProductImageAssignments(['/objects/../api/admin'], [], mediaAssets as any)).toThrow(ProductImageAssignmentError);
  expect(() => validateProductImageAssignments(['/objects/uploads/manual.pdf'], [], mediaAssets as any)).toThrow(ProductImageAssignmentError);
  expect(() => validateProductImageAssignments([first, first], [], mediaAssets as any)).toThrow(ProductImageAssignmentError);
});

test('save and reload preserves primary ordering and updates no pricing fields', async () => {
  let stored: any = { id: 'product-a', organizationId: 'org-a', thumbnailUrls: [first], pricingProfileConfig: { base: 440 }, pbv2ActiveTreeVersionId: 'tree-a' };
  const patches: any[] = [];
  const repository: any = {
    getProductById: async (organizationId: string, id: string) => organizationId === 'org-a' && id === 'product-a' ? stored : undefined,
    getAllMediaAssets: async (organizationId: string) => organizationId === 'org-a' ? mediaAssets : [],
    updateProduct: async (organizationId: string, id: string, patch: any) => {
      expect([organizationId, id]).toEqual(['org-a', 'product-a']);
      patches.push(patch);
      stored = { ...stored, ...patch };
      return stored;
    },
  };
  await saveProductImages(repository, 'org-a', 'product-a', [second, first]);
  expect((await repository.getProductById('org-a', 'product-a')).thumbnailUrls).toEqual([second, first]);
  expect(patches).toEqual([{ thumbnailUrls: [second, first] }]);
  expect(stored.pricingProfileConfig).toEqual({ base: 440 });
  expect(stored.pbv2ActiveTreeVersionId).toBe('tree-a');
  await expect(saveProductImages(repository, 'org-b', 'product-a', [first])).rejects.toMatchObject({ statusCode: 404 });
  expect(patches).toHaveLength(1);
});
