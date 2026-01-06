import type { Asset } from '../../../shared/schema';
import type { AssetVariant } from '../../../shared/schema';
import { applyThumbnailContract } from '../../lib/thumbnailContract';

/**
 * Asset with enriched URL fields for frontend consumption
 */
export interface EnrichedAsset extends Asset {
  fileUrl: string;
  originalUrl?: string;
  previewUrl?: string;
  thumbUrl?: string;
  thumbnailUrl?: string; // Alias for thumbUrl for compatibility
  previewThumbnailUrl?: string; // Alias for thumbUrl for compatibility
}

/**
 * Enriches an asset with signed URLs based on storage keys
 * 
 * Converts:
 *   fileKey → fileUrl: "/objects/{fileKey}"
 *   previewKey → previewUrl: "/objects/{previewKey}"
 *   thumbKey → thumbUrl: "/objects/{thumbKey}"
 * 
 * Frontend uses /objects/* proxy route which handles both local and Supabase storage.
 * 
 * @param asset - Asset record from database
 * @returns Asset with URL fields added
 */
export function enrichAssetWithUrls(asset: Asset): EnrichedAsset {
  const fileUrl = `/objects/${asset.fileKey}`;
  const variants = (asset as Asset & { variants?: AssetVariant[] })?.variants ?? [];

  const variantThumbKey =
    variants.find((v) => v.kind === 'thumb' && v.status === 'ready')?.key ??
    variants.find((v) => v.kind === 'thumb')?.key;
  const variantPreviewKey =
    variants.find((v) => v.kind === 'preview' && v.status === 'ready')?.key ??
    variants.find((v) => v.kind === 'preview')?.key;

  const previewKey = asset.previewKey ?? variantPreviewKey;
  const thumbKey = asset.thumbKey ?? variantThumbKey;

  const previewUrl = previewKey ? `/objects/${previewKey}` : undefined;
  const thumbUrl = thumbKey ? `/objects/${thumbKey}` : undefined;

  return applyThumbnailContract({
    ...asset,
    fileUrl,
    originalUrl: fileUrl,
    previewUrl,
    thumbUrl,
  });
}

/**
 * Batch enrich multiple assets
 */
export function enrichAssetsWithUrls(assets: Asset[]): EnrichedAsset[] {
  return assets.map(enrichAssetWithUrls);
}

/**
 * Enrich asset with role information (from asset_links join)
 */
export interface EnrichedAssetWithRole extends EnrichedAsset {
  role: string;
}

export function enrichAssetWithRole(
  asset: Asset & { role: string }
): EnrichedAssetWithRole {
  const enriched = enrichAssetWithUrls(asset);
  return {
    ...enriched,
    role: asset.role,
  };
}

export function enrichAssetsWithRoles(
  assets: Array<Asset & { role: string }>
): EnrichedAssetWithRole[] {
  return assets.map(enrichAssetWithRole);
}
