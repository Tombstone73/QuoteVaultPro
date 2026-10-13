import type { MediaAsset, Product, UpdateProduct } from '@shared/schema';

export class ProductImageAssignmentError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

function customerSafeImageUrl(url: string): boolean {
  if (url.startsWith('/objects/')) return url.length <= 2048 && !url.includes('..') && !/[?#\\]/.test(url);
  try {
    const parsed = new URL(url);
    return url.length <= 2048 && parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function validateProductImageAssignments(raw: unknown, existing: string[], mediaAssets: Pick<MediaAsset, 'url' | 'mimeType'>[]): string[] {
  if (!Array.isArray(raw) || raw.length > 20 || raw.some((url) => typeof url !== 'string')) {
    throw new ProductImageAssignmentError(400, 'Provide up to 20 image URLs.');
  }
  const allowed = new Set([...existing, ...mediaAssets.filter((asset) => asset.mimeType.startsWith('image/')).map((asset) => asset.url)]);
  const urls = raw as string[];
  if (new Set(urls).size !== urls.length || urls.some((url) => !allowed.has(url) || !customerSafeImageUrl(url))) {
    throw new ProductImageAssignmentError(400, 'Select valid images from this product or your media library.');
  }
  return urls;
}

type ProductImageRepository = {
  getProductById(organizationId: string, productId: string): Promise<Product | undefined>;
  getAllMediaAssets(organizationId: string): Promise<MediaAsset[]>;
  updateProduct(organizationId: string, productId: string, patch: UpdateProduct): Promise<Product | undefined>;
};

export async function saveProductImages(repository: ProductImageRepository, organizationId: string, productId: string, raw: unknown): Promise<Product> {
  const product = await repository.getProductById(organizationId, productId);
  if (!product) throw new ProductImageAssignmentError(404, 'Product not found.');
  const mediaAssets = await repository.getAllMediaAssets(organizationId);
  const thumbnailUrls = validateProductImageAssignments(raw, product.thumbnailUrls, mediaAssets);
  const updated = await repository.updateProduct(organizationId, productId, { thumbnailUrls });
  if (!updated) throw new ProductImageAssignmentError(404, 'Product not found.');
  return updated;
}
