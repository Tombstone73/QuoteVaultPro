import { canReadProductImageKey, getProductImageTenantFromKey } from '../utils/orgKeys';
import { signedUploadFolder } from '../services/storage/productImageUploadPath';

describe('product image object ownership', () => {
  test('recognizes tenant-scoped image keys under any provider prefix', () => {
    expect(signedUploadFolder('uploads', 'org_a', 'product-image')).toBe('uploads/product-images/org_a');
    expect(signedUploadFolder('custom/uploads/', 'org_a', 'product-image')).toBe('custom/uploads/product-images/org_a');
    expect(signedUploadFolder('uploads', 'org_a')).toBe('uploads');
    expect(getProductImageTenantFromKey('uploads/product-images/org_a/image.webp')).toBe('org_a');
    expect(getProductImageTenantFromKey('custom/uploads/product-images/11111111-1111-4111-8111-111111111111/image.webp'))
      .toBe('11111111-1111-4111-8111-111111111111');
    expect(canReadProductImageKey('uploads/product-images/org_a/image.webp', 'org_a')).toBe(true);
    expect(canReadProductImageKey('uploads/product-images/org_a/image.webp', 'org_b')).toBe(false);
  });

  test('leaves existing legacy upload keys unchanged', () => {
    expect(getProductImageTenantFromKey('uploads/legacy-image-id')).toBeNull();
    expect(canReadProductImageKey('uploads/legacy-image-id', 'org_b')).toBe(true);
  });
});
