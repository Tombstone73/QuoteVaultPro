import { createHash } from "node:crypto";
export type InactiveProductDraftPatch = { basePricing?: Record<string, number | null>; configuration?: Record<string, unknown>; relationships?: Record<string, unknown> };

function validatePatch(patch: InactiveProductDraftPatch): InactiveProductDraftPatch {
  const domains = [patch.basePricing, patch.configuration, patch.relationships].filter(Boolean);
  if (domains.length !== 1 || !Object.keys(domains[0] ?? {}).length) throw new Error("Provide exactly one non-empty pricing, configuration, or relationship patch.");
  return patch;
}

export const inactiveProductDraftBulkUpdateMaxTargets = 25;
export type BulkUpdateTargetStatus = "eligible" | "no_change" | "needs_clarification" | "unsupported" | "ineligible" | "stale" | "excluded";
export type BulkUpdateTarget = { productId: string; sessionId: string; productName: string; category: string | null; active: boolean; pbv2Status: string; beforeFingerprint: string; patch: InactiveProductDraftPatch; status: BulkUpdateTargetStatus; reason?: string; provenance: "shared_patch" | "product_override" };

export function fingerprintInactiveDraftBulkUpdate(targets: readonly BulkUpdateTarget[], patch: InactiveProductDraftPatch): string {
  return createHash("sha256").update(JSON.stringify({ patch, targets: targets.map((target) => ({ id: target.productId, sessionId: target.sessionId, beforeFingerprint: target.beforeFingerprint, patch: target.patch, status: target.status })) })).digest("hex");
}

export function resolveBulkUpdatePatch(shared: InactiveProductDraftPatch, override?: InactiveProductDraftPatch): InactiveProductDraftPatch {
  const sharedPatch = validatePatch(shared);
  if (!override) return sharedPatch;
  const overridePatch = validatePatch(override);
  const domains = [sharedPatch.basePricing && overridePatch.basePricing, sharedPatch.configuration && overridePatch.configuration, sharedPatch.relationships && overridePatch.relationships].filter(Boolean).length;
  if (domains > 1) throw new Error("A product override cannot cross the shared patch domain; create separate confirmed bulk plans.");
  if (sharedPatch.basePricing && overridePatch.basePricing) return validatePatch({ basePricing: { ...sharedPatch.basePricing, ...overridePatch.basePricing } });
  if (sharedPatch.configuration && overridePatch.configuration) return validatePatch({ configuration: { ...sharedPatch.configuration, ...overridePatch.configuration } });
  if (sharedPatch.relationships && overridePatch.relationships) return overridePatch;
  return overridePatch;
}

export function preflightBulkUpdateTargets(input: { requestedProductIds: readonly string[]; snapshots: readonly { productId: string; sessionId: string; productName: string; category: string | null; active: boolean; pbv2Status: string; fingerprint: string }[]; patch: InactiveProductDraftPatch; overrides?: Readonly<Record<string, InactiveProductDraftPatch>> }): BulkUpdateTarget[] {
  if (input.requestedProductIds.length > inactiveProductDraftBulkUpdateMaxTargets) throw new Error(`A bulk update may include at most ${inactiveProductDraftBulkUpdateMaxTargets} products; no targets were truncated.`);
  const unique = new Set<string>();
  return input.requestedProductIds.map((productId) => {
    const snapshot = input.snapshots.find((item) => item.productId === productId);
    if (unique.has(productId)) return { productId, sessionId: "", productName: productId, category: null, active: false, pbv2Status: "", beforeFingerprint: "", patch: input.patch, status: "excluded" as const, reason: "Duplicate product identifier in this bulk request.", provenance: "shared_patch" as const };
    unique.add(productId);
    if (!snapshot) return { productId, sessionId: "", productName: productId, category: null, active: false, pbv2Status: "", beforeFingerprint: "", patch: input.patch, status: "ineligible" as const, reason: "Inactive draft was not found in this tenant.", provenance: "shared_patch" as const };
    const patch = resolveBulkUpdatePatch(input.patch, input.overrides?.[productId]);
    if (snapshot.active || snapshot.pbv2Status !== "DRAFT") return { ...snapshot, beforeFingerprint: snapshot.fingerprint, patch, status: "ineligible" as const, reason: "Only inactive PBV2 DRAFT products may be bulk updated.", provenance: input.overrides?.[productId] ? "product_override" : "shared_patch" };
    return { ...snapshot, beforeFingerprint: snapshot.fingerprint, patch, status: "eligible" as const, provenance: input.overrides?.[productId] ? "product_override" : "shared_patch" };
  });
}
