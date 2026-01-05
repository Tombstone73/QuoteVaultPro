import type { Asset } from '../../../shared/schema';

/**
 * Asset with enriched URL fields for frontend consumption
 */
export interface EnrichedAsset extends Asset {
  fileUrl: string;
  previewUrl?: string;
  thumbUrl?: string;
  thumbnailUrl?: string; // Alias for thumbUrl for compatibility
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
  const previewUrl = asset.previewKey ? `/objects/${asset.previewKey}` : undefined;
  const thumbUrl = asset.thumbKey ? `/objects/${asset.thumbKey}` : undefined;

  return {
    ...asset,
    fileUrl,
    previewUrl,
    thumbUrl,
    thumbnailUrl: thumbUrl, // Alias for compatibility with existing UI code
  };
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
