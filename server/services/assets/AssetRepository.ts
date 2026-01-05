import { db } from '../../db';
import { assets, assetVariants, assetLinks } from '../../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import type { Asset, InsertAsset, AssetVariant, AssetLink } from '../../../shared/schema';

/**
 * Asset Repository
 * 
 * Handles all CRUD operations for the canonical Asset pipeline.
 * All methods enforce multi-tenant isolation via organizationId.
 */
export class AssetRepository {
  /**
   * Create a new asset record
   * Called after uploading a file to storage
   */
  async createAsset(
    organizationId: string,
    data: Omit<InsertAsset, 'organizationId'>
  ): Promise<Asset> {
    const [asset] = await db
      .insert(assets)
      .values({
        ...data,
        organizationId,
      })
      .returning();

    if (!asset) {
      throw new Error('Failed to create asset');
    }

    return asset;
  }

  /**
   * Get asset by ID with tenant isolation
   */
  async getAssetById(organizationId: string, assetId: string): Promise<Asset | null> {
    const [asset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.organizationId, organizationId)))
      .limit(1);

    return asset || null;
  }

  /**
   * Get multiple assets by IDs with tenant isolation
   */
  async getAssetsByIds(organizationId: string, assetIds: string[]): Promise<Asset[]> {
    if (assetIds.length === 0) {
      return [];
    }

    return db
      .select()
      .from(assets)
      .where(and(inArray(assets.id, assetIds), eq(assets.organizationId, organizationId)));
  }

  /**
   * List all assets linked to a specific parent (quote, order, invoice, etc.)
   */
  async listAssetsForParent(
    organizationId: string,
    parentType: 'quote_line_item' | 'order' | 'order_line_item' | 'invoice' | 'note',
    parentId: string
  ): Promise<Array<Asset & { role: string }>> {
    const results = await db
      .select({
        asset: assets,
        role: assetLinks.role,
      })
      .from(assetLinks)
      .innerJoin(assets, eq(assetLinks.assetId, assets.id))
      .where(
        and(
          eq(assetLinks.organizationId, organizationId),
          eq(assetLinks.parentType, parentType),
          eq(assetLinks.parentId, parentId)
        )
      );

    return results.map((r) => ({ ...r.asset, role: r.role }));
  }

  /**
   * List all assets linked to multiple parents (batch operation)
   * Useful for listing assets for all items in a quote or order
   */
  async listAssetsForParents(
    organizationId: string,
    parentType: 'quote_line_item' | 'order' | 'order_line_item' | 'invoice' | 'note',
    parentIds: string[]
  ): Promise<Map<string, Array<Asset & { role: string }>>> {
    if (parentIds.length === 0) {
      return new Map();
    }

    const results = await db
      .select({
        asset: assets,
        role: assetLinks.role,
        parentId: assetLinks.parentId,
      })
      .from(assetLinks)
      .innerJoin(assets, eq(assetLinks.assetId, assets.id))
      .where(
        and(
          eq(assetLinks.organizationId, organizationId),
          eq(assetLinks.parentType, parentType),
          inArray(assetLinks.parentId, parentIds)
        )
      );

    const map = new Map<string, Array<Asset & { role: string }>>();
    for (const result of results) {
      const existing = map.get(result.parentId) || [];
      existing.push({ ...result.asset, role: result.role });
      map.set(result.parentId, existing);
    }

    return map;
  }

  /**
   * Create an asset link (connect asset to quote/order/invoice/etc.)
   */
  async linkAsset(
    organizationId: string,
    assetId: string,
    parentType: 'quote_line_item' | 'order' | 'order_line_item' | 'invoice' | 'note',
    parentId: string,
    role: 'primary' | 'attachment' | 'proof' | 'reference' | 'other' = 'other'
  ): Promise<AssetLink> {
    const [link] = await db
      .insert(assetLinks)
      .values({
        organizationId,
        assetId,
        parentType,
        parentId,
        role,
      })
      .returning();

    if (!link) {
      throw new Error('Failed to create asset link');
    }

    return link;
  }

  /**
   * Batch create asset links (for quote→order conversion)
   */
  async linkAssetsBatch(
    links: Array<{
      organizationId: string;
      assetId: string;
      parentType: 'quote_line_item' | 'order' | 'order_line_item' | 'invoice' | 'note';
      parentId: string;
      role?: 'primary' | 'attachment' | 'proof' | 'reference' | 'other';
    }>
  ): Promise<AssetLink[]> {
    if (links.length === 0) {
      return [];
    }

    return db.insert(assetLinks).values(links).returning();
  }

  /**
   * Update asset preview keys after thumbnail generation
   */
  async setAssetPreviewKeys(
    organizationId: string,
    assetId: string,
    data: {
      previewKey?: string;
      thumbKey?: string;
      previewStatus: 'pending' | 'ready' | 'failed';
      previewError?: string | null;
    }
  ): Promise<Asset> {
    const [updated] = await db
      .update(assets)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(assets.id, assetId), eq(assets.organizationId, organizationId)))
      .returning();

    if (!updated) {
      throw new Error('Failed to update asset preview keys');
    }

    return updated;
  }

  /**
   * Upsert asset variant record
   * Used by thumbnail/preview generators
   */
  async upsertVariant(
    organizationId: string,
    assetId: string,
    kind: 'thumb' | 'preview' | 'prepress_normalized' | 'prepress_report',
    key: string,
    status: 'pending' | 'ready' | 'failed',
    error?: string | null
  ): Promise<AssetVariant> {
    // Check if variant exists
    const [existing] = await db
      .select()
      .from(assetVariants)
      .where(and(eq(assetVariants.assetId, assetId), eq(assetVariants.kind, kind)))
      .limit(1);

    if (existing) {
      // Update existing
      const [updated] = await db
        .update(assetVariants)
        .set({
          key,
          status,
          error,
          updatedAt: new Date(),
        })
        .where(eq(assetVariants.id, existing.id))
        .returning();

      return updated!;
    } else {
      // Insert new
      const [variant] = await db
        .insert(assetVariants)
        .values({
          organizationId,
          assetId,
          kind,
          key,
          status,
          error,
        })
        .returning();

      return variant!;
    }
  }

  /**
   * Get all variants for an asset
   */
  async getVariantsForAsset(
    organizationId: string,
    assetId: string
  ): Promise<AssetVariant[]> {
    return db
      .select()
      .from(assetVariants)
      .where(
        and(eq(assetVariants.assetId, assetId), eq(assetVariants.organizationId, organizationId))
      );
  }

  /**
   * List all assets with preview_status='pending'
   * Used by thumbnail worker
   */
  async listPendingPreviewAssets(organizationId: string): Promise<Asset[]> {
    return db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.organizationId, organizationId),
          eq(assets.previewStatus, 'pending')
        )
      );
  }

  /**
   * List all assets with preview_status='pending' across all orgs
   * Used by thumbnail worker (global scan)
   */
  async listAllPendingPreviewAssets(): Promise<Asset[]> {
    return db.select().from(assets).where(eq(assets.previewStatus, 'pending'));
  }

  /**
   * Delete asset link
   */
  async unlinkAsset(
    organizationId: string,
    assetId: string,
    parentType: 'quote_line_item' | 'order' | 'order_line_item' | 'invoice' | 'note',
    parentId: string
  ): Promise<void> {
    await db
      .delete(assetLinks)
      .where(
        and(
          eq(assetLinks.organizationId, organizationId),
          eq(assetLinks.assetId, assetId),
          eq(assetLinks.parentType, parentType),
          eq(assetLinks.parentId, parentId)
        )
      );
  }

  /**
   * Delete asset and all its links/variants (cascade via FK)
   */
  async deleteAsset(organizationId: string, assetId: string): Promise<void> {
    await db
      .delete(assets)
      .where(and(eq(assets.id, assetId), eq(assets.organizationId, organizationId)));
  }
}

// Singleton instance
export const assetRepository = new AssetRepository();
