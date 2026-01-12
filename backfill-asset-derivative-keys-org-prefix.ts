/**
 * Dev-only utility: Fix legacy org prefixes in asset derivative keys.
 *
 * Problem:
 * - We observed mixed org folder prefixes in storage keys (e.g. org-org_*, org_org_*)
 * - Asset preview generator historically wrote keys like: thumbs/org_${orgId}/...
 *   which becomes thumbs/org_org_titan_001/... for orgIds that already include org_.
 *
 * This script performs a SAFE rewrite for assets.thumbKey/assets.previewKey:
 * - Only rewrites when the normalized key exists in Supabase AND the legacy key does NOT.
 * - Does NOT move/copy/delete any objects.
 *
 * Usage:
 *   ALLOW_DEV_BACKFILL_ASSET_DERIVATIVE_KEYS=true npx tsx backfill-asset-derivative-keys-org-prefix.ts
 *
 * Optional env:
 *   DRY_RUN=true      (default true)
 *   LIMIT=500
 *   ONLY_ORG_ID=org_titan_001
 */

import 'dotenv/config';
import { and, eq, or, sql } from 'drizzle-orm';
import { db } from './server/db';
import { assets } from './shared/schema';
import { SupabaseStorageService, isSupabaseConfigured } from './server/supabaseStorage';
import { normalizeTenantObjectKey } from './server/utils/orgKeys';

function isTruthyEnv(value: string | undefined): boolean {
  const v = (value ?? '').toString().toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function looksLikeLegacyOrgPrefixInKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const k = key.trim();
  if (!k) return false;
  return k.includes('/org-org_') || k.includes('/org_org_') || k.startsWith('org-org_') || k.startsWith('org_org_');
}

async function maybeRewriteKey(supabase: SupabaseStorageService, key: string): Promise<{ original: string; rewritten: string } | null> {
  if (!looksLikeLegacyOrgPrefixInKey(key)) return null;

  const rewritten = normalizeTenantObjectKey(key);
  if (!rewritten || rewritten === key) return null;

  const [existsLegacy, existsNew] = await Promise.all([
    supabase.fileExists(key).catch(() => false),
    supabase.fileExists(rewritten).catch(() => false),
  ]);

  if (existsNew && !existsLegacy) {
    return { original: key, rewritten };
  }

  return null;
}

async function main() {
  const allow = isTruthyEnv(process.env.ALLOW_DEV_BACKFILL_ASSET_DERIVATIVE_KEYS);
  const dryRun = process.env.DRY_RUN == null ? true : isTruthyEnv(process.env.DRY_RUN);
  const limit = process.env.LIMIT != null ? Number(process.env.LIMIT) : 500;
  const onlyOrgId = process.env.ONLY_ORG_ID ? String(process.env.ONLY_ORG_ID) : null;

  if (!allow) {
    throw new Error(
      'Refusing to run: set ALLOW_DEV_BACKFILL_ASSET_DERIVATIVE_KEYS=true to acknowledge this is a one-time dev utility.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run in production (NODE_ENV=production).');
  }

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured; cannot safely backfill by existence check.');
  }

  const supabase = new SupabaseStorageService();

  console.log('[BackfillAssetDerivativeKeysOrgPrefix] Starting');
  console.log(`- dryRun: ${dryRun}`);
  console.log(`- limit: ${limit}`);
  console.log(`- onlyOrgId: ${onlyOrgId ?? '(all orgs)'}`);

  const rows = await db
    .select({
      id: assets.id,
      organizationId: assets.organizationId,
      thumbKey: assets.thumbKey,
      previewKey: assets.previewKey,
    })
    .from(assets)
    .where(
      and(
        onlyOrgId ? eq(assets.organizationId, onlyOrgId) : sql`true`,
        or(
          sql`${assets.thumbKey} like '%/org-org_%'`,
          sql`${assets.thumbKey} like '%/org_org_%'`,
          sql`${assets.previewKey} like '%/org-org_%'`,
          sql`${assets.previewKey} like '%/org_org_%'`
        )
      )
    )
    .limit(limit);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const updates: Record<string, any> = {};

    if (row.thumbKey) {
      const rewrite = await maybeRewriteKey(supabase, row.thumbKey);
      if (rewrite) updates.thumbKey = rewrite.rewritten;
    }

    if (row.previewKey) {
      const rewrite = await maybeRewriteKey(supabase, row.previewKey);
      if (rewrite) updates.previewKey = rewrite.rewritten;
    }

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      await db
        .update(assets)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, row.id));
    }

    updated++;
  }

  console.log('[BackfillAssetDerivativeKeysOrgPrefix] Done');
  console.log(`- candidates: ${rows.length}`);
  console.log(`- updated: ${updated}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`- skipped: ${skipped}`);
}

main().catch((err) => {
  console.error('[BackfillAssetDerivativeKeysOrgPrefix] Failed', err);
  process.exit(1);
});
