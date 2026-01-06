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

  // Another form of the same bug: "org-" + "org_<id>".
  if (raw.startsWith("org-") && raw.slice("org-".length).startsWith("org_")) {
    return raw.slice("org-".length);
  }

  return raw;
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

  const first = parts[0];
  const normalizedFirst = normalizeOrgPrefix(first);
  if (normalizedFirst === first) return key;

  parts[0] = normalizedFirst;
  return parts.join("/");
}
