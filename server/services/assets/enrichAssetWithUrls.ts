import type { Asset } from '../../../shared/schema';
import type { AssetVariant } from '../../../shared/schema';
import { applyThumbnailContract } from '../../lib/thumbnailContract';
import { resolveOriginalFileAccess, type OriginalFileAccessResult } from '../../lib/supabaseObjectHelpers';

/**
 * Asset with enriched URL fields for frontend consumption
 */
export interface EnrichedAsset extends Asset {
  fileUrl?: string | null;
  originalUrl?: string | null;
  downloadUrl?: string | null;
  objectPath?: string | null;
  availabilityStatus?: OriginalFileAccessResult['availabilityStatus'];
  previewUrl?: string | null;
  thumbUrl?: string | null;
  thumbnailUrl?: string; // Alias for thumbUrl for compatibility
  previewThumbnailUrl?: string; // Alias for thumbUrl for compatibility
}

function buildDerivativeUrls(asset: Asset) {
  const variants = (asset as Asset & { variants?: AssetVariant[] })?.variants ?? [];

  const variantThumbKey =
    variants.find((v) => v.kind === 'thumb' && v.status === 'ready')?.key ??
    variants.find((v) => v.kind === 'thumb')?.key;
  const variantPreviewKey =
    variants.find((v) => v.kind === 'preview' && v.status === 'ready')?.key ??
    variants.find((v) => v.kind === 'preview')?.key;

  const previewKey = asset.previewKey ?? variantPreviewKey;
  const thumbKey = asset.thumbKey ?? variantThumbKey;

  return {
    previewUrl: previewKey ? `/objects/${previewKey}` : null,
    thumbUrl: thumbKey ? `/objects/${thumbKey}` : null,
  };
}

export function enrichAssetPreviewUrls(asset: Asset): EnrichedAsset {
  const { previewUrl, thumbUrl } = buildDerivativeUrls(asset);

  return applyThumbnailContract({
    ...asset,
    fileUrl: null,
    originalUrl: null,
    downloadUrl: null,
    objectPath: null,
    availabilityStatus: 'missing' as const,
    previewUrl,
    thumbUrl,
  });
}

/**
 * Enriches an asset with canonical original-file URLs plus derivative preview URLs.
 *
 * Original-file fields come from `fileRecordId` via canonical read resolution.
 * Preview/thumb fields still come from derivative keys on the asset record.
 */
export async function enrichAssetWithUrls(asset: Asset): Promise<EnrichedAsset> {
  const derivativeUrls = enrichAssetPreviewUrls(asset);
  const originalAccess = await resolveOriginalFileAccess(asset);

  return applyThumbnailContract({
    ...derivativeUrls,
    fileUrl: originalAccess.originalUrl,
    originalUrl: originalAccess.originalUrl,
    downloadUrl: originalAccess.downloadUrl,
    objectPath: originalAccess.objectPath,
    availabilityStatus: originalAccess.availabilityStatus,
  });
}

/**
 * Batch enrich multiple assets
 */
export async function enrichAssetsWithUrls(assets: Asset[]): Promise<EnrichedAsset[]> {
  return Promise.all(assets.map(enrichAssetWithUrls));
}

/**
 * Enrich asset with role information (from asset_links join)
 */
export interface EnrichedAssetWithRole extends EnrichedAsset {
  role: string;
}

export async function enrichAssetWithRole(
  asset: Asset & { role: string }
): Promise<EnrichedAssetWithRole> {
  const enriched = await enrichAssetWithUrls(asset);
  return {
    ...enriched,
    role: asset.role,
  };
}

export async function enrichAssetsWithRoles(
  assets: Array<Asset & { role: string }>
): Promise<EnrichedAssetWithRole[]> {
  return Promise.all(assets.map(enrichAssetWithRole));
}
