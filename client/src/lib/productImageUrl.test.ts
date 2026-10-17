import { productImageDisplayUrl } from './productImageUrl';

jest.mock('@/lib/apiConfig', () => ({
  apiUrl: (path: string) => `https://api-dev.printershero.com${path}`,
  objectsUrl: (path: string) => `https://objects-dev.printershero.com${path}`,
}));

test('Product images use the cookie-authenticated API reader, not the separate objects host', () => {
  expect(productImageDisplayUrl('/objects/uploads/product-images/org-a/file')).toBe('https://api-dev.printershero.com/objects/uploads/product-images/org-a/file');
  expect(productImageDisplayUrl('https://images.example.com/product.png')).toBe('https://images.example.com/product.png');
  expect(productImageDisplayUrl('uploads/product-images/org-a/file')).toBeNull();
});
