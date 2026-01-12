/**
 * Normalize organization id / tenant prefixes so object keys are stable across machines.
 *
 * Canonical convention (v1): the first path segment should be the organizationId itself,
 * e.g. "org_titan_001/orders/...".
 *
 * Legacy/buggy convention observed: "org-${orgId}/..." which becomes
 * "org-org_titan_001/..." when orgId already starts with "org_".
 */

export function normalizeOrgPrefix(inputOrgId: string): string {
  const raw = (inputOrgId || "").toString().trim();
  if (!raw) return raw;

  // Exact legacy bug: "org-org_<id>" (double org prefix)
  if (raw.startsWith("org-org_")) {
    return `org_${raw.slice("org-org_".length)}`;
  }

  // Legacy bug variant: "org_org_<id>" (double org prefix with underscore)
  if (raw.startsWith("org_org_")) {
    return `org_${raw.slice("org_org_".length)}`;
  }

  // Another form of the same bug: "org-" + "org_<id>".
  if (raw.startsWith("org-") && raw.slice("org-".length).startsWith("org_")) {
    return raw.slice("org-".length);
  }

  return raw;
}

function looksLikeOrgSegment(segment: string): boolean {
  const s = (segment || "").toString().trim();
  if (!s) return false;

  // Avoid accidentally treating filenames like "org-org_foo.pdf" as a tenant folder.
  if (s.includes(".")) return false;

  if (s.startsWith("org_")) return true;
  if (s.startsWith("org-org_")) return true;
  if (s.startsWith("org_org_")) return true;

  // Legacy: "org-" + "org_<id>"
  if (s.startsWith("org-") && s.slice("org-".length).startsWith("org_")) return true;

  return false;
}

function findOrgSegmentIndex(parts: string[]): number {
  for (let i = 0; i < parts.length; i++) {
    if (looksLikeOrgSegment(parts[i] || "")) return i;
  }
  return -1;
}

function legacyOrgSegmentVariants(normalizedOrgId: string): string[] {
  const raw = (normalizedOrgId || "").toString().trim();
  if (!raw.startsWith("org_")) return [];
  const suffix = raw.slice("org_".length);
  if (!suffix) return [];
  return [`org-org_${suffix}`, `org_org_${suffix}`];
}

/**
 * Extracts the normalized orgId (e.g. "org_titan_001") from any object key that contains
 * an org segment (first or nested).
 */
export function extractNormalizedOrgIdFromKey(inputKey: string): string | null {
  const key = (inputKey || "").toString().trim().replace(/^\/+/, "");
  if (!key) return null;
  const parts = key.split("/");
  const idx = findOrgSegmentIndex(parts);
  if (idx < 0) return null;
  const seg = (parts[idx] || "").toString();
  const normalized = normalizeOrgPrefix(seg);
  return normalized.startsWith("org_") ? normalized : null;
}

/**
 * Normalizes an object key that is expected to start with an orgId segment.
 *
 * Example:
 * - "org-org_titan_001/orders/123/file.pdf" -> "org_titan_001/orders/123/file.pdf"
 */
export function normalizeTenantObjectKey(inputKey: string): string {
  const key = (inputKey || "").toString().trim().replace(/^\/+/, "");
  if (!key) return key;

  const parts = key.split("/");
  if (parts.length === 0) return key;

  const idx = findOrgSegmentIndex(parts);
  if (idx < 0) return key;

  const seg = parts[idx] || "";
  const normalized = normalizeOrgPrefix(seg);
  if (normalized === seg) return key;

  parts[idx] = normalized;
  return parts.join("/");
}

/**
 * Build a small ordered candidate list for reading objects when legacy org prefixes exist.
 *
 * Order preference:
 * 1) Canonical normalized key
 * 2) Original key (if different)
 * 3) Legacy variants of the org segment for the canonical key
 */
export function getTenantObjectKeyCandidates(inputKey: string): string[] {
  const original = (inputKey || "").toString().trim().replace(/^\/+/, "");
  if (!original) return [];

  const canonical = normalizeTenantObjectKey(original);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string) => {
    const kk = (k || "").toString().trim();
    if (!kk) return;
    if (seen.has(kk)) return;
    seen.add(kk);
    out.push(kk);
  };

  push(canonical);
  if (original !== canonical) push(original);

  // Add legacy org segment variants for the canonical key.
  const parts = canonical.split("/");
  const idx = findOrgSegmentIndex(parts);
  if (idx >= 0) {
    const normalizedOrgId = normalizeOrgPrefix(parts[idx] || "");
    for (const legacyOrgId of legacyOrgSegmentVariants(normalizedOrgId)) {
      const variantParts = [...parts];
      variantParts[idx] = legacyOrgId;
      push(variantParts.join("/"));
    }
  }

  return out;
}

/**
 * Canonicalize a thumbnail object key under `thumbs/` by normalizing legacy org prefixes
 * (org-org_*, org_org_*) to the canonical org_* segment.
 *
 * Returns null when the key is not a thumbs key.
 */
export function toCanonicalThumbsObjectKey(inputKey: string): string | null {
  const key = (inputKey || "").toString().trim().replace(/^\/+/, "");
  if (!key) return null;
  if (!key.startsWith("thumbs/")) return null;
  return normalizeTenantObjectKey(key);
}
