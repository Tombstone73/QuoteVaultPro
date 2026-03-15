import type { Asset } from '../../../shared/schema';
import { applyThumbnailContract } from '../../lib/thumbnailContract';
import {
  resolveDerivativeFileAccess,
  resolveOriginalFileAccess,
  type OriginalFileAccessResult,
} from '../../lib/supabaseObjectHelpers';

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

async function buildDerivativeUrls(asset: Asset) {
  const [previewAccess, thumbAccess] = await Promise.all([
    resolveDerivativeFileAccess(asset, 'preview'),
    resolveDerivativeFileAccess(asset, 'thumbnail'),
  ]);

  return {
    previewUrl: previewAccess.url,
    thumbUrl: thumbAccess.url,
  };
}

export async function enrichAssetPreviewUrls(asset: Asset): Promise<EnrichedAsset> {
  const { previewUrl, thumbUrl } = await buildDerivativeUrls(asset);

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
  const derivativeUrls = await enrichAssetPreviewUrls(asset);
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
