import { and, eq } from 'drizzle-orm';
import { auditLogs, pbv2TreeVersions, products } from '@shared/schema';
import { db } from '../../db';

type ActiveProductRow = {
  id: string;
  storefrontVisible: boolean;
  activeTreeStatus: string | null;
  pricingProfileConfig: unknown;
};

export function withNewProductStorefrontDefault<T extends { isActive?: boolean; storefrontVisible?: boolean }>(data: T, explicitlySupplied: boolean): T {
  return explicitlySupplied ? data : { ...data, storefrontVisible: data.isActive !== false };
}

function usesPricingOverride(config: unknown): boolean {
  return !!config && typeof config === 'object'
    && (config as { pbv2Override?: { enabled?: unknown } }).pbv2Override?.enabled === true;
}

export function summarizeStorefrontEnablement(rows: ActiveProductRow[]) {
  const alreadyEnabled = rows.filter((row) => row.storefrontVisible).length;
  return {
    totalActive: rows.length,
    alreadyEnabled,
    needingEnablement: rows.length - alreadyEnabled,
    withoutPublishedPricing: rows.filter((row) => row.activeTreeStatus !== 'ACTIVE').length,
    usingPricingOverrides: rows.filter((row) => usesPricingOverride(row.pricingProfileConfig)).length,
  };
}

function activeProductsQuery(executor: typeof db, organizationId: string) {
  return executor.select({
    id: products.id,
    storefrontVisible: products.storefrontVisible,
    activeTreeStatus: pbv2TreeVersions.status,
    pricingProfileConfig: products.pricingProfileConfig,
  }).from(products).leftJoin(pbv2TreeVersions, and(
    eq(pbv2TreeVersions.id, products.pbv2ActiveTreeVersionId),
    eq(pbv2TreeVersions.organizationId, organizationId),
    eq(pbv2TreeVersions.productId, products.id),
  )).where(and(eq(products.organizationId, organizationId), eq(products.isActive, true)));
}

export async function previewStorefrontEnablement(organizationId: string) {
  const rows = await activeProductsQuery(db, organizationId);
  return summarizeStorefrontEnablement(rows);
}

export async function enableAllActiveStorefrontProducts(organizationId: string, userId: string) {
  return db.transaction(async (tx) => {
    const rows = await activeProductsQuery(tx as unknown as typeof db, organizationId).for('update', { of: products });
    const preview = summarizeStorefrontEnablement(rows);
    const updated = await tx.update(products).set({ storefrontVisible: true }).where(and(
      eq(products.organizationId, organizationId), eq(products.isActive, true), eq(products.storefrontVisible, false),
    )).returning({ id: products.id });
    if (updated.length !== preview.needingEnablement) throw new Error('Storefront enablement changed during update');
    const result = { ...preview, updated: updated.length, skipped: preview.alreadyEnabled };
    await tx.insert(auditLogs).values({
      organizationId, userId, actionType: 'UPDATE', entityType: 'product', entityId: null,
      description: `Enabled ${updated.length} active products in the customer storefront`,
      newValues: result,
    });
    return result;
  });
}
