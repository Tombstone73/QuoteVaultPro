/** Normalize an optional public website without fetching it or changing stored data. */
export function normalizeOptionalWebsite(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || /[\s\\\u0000-\u001f\u007f]/.test(trimmed)) return undefined;

  const hasHttpScheme = /^https?:\/\//i.test(trimmed);
  // Do not reinterpret unsupported schemes or relative URLs as bare domains.
  if (!hasHttpScheme && (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[/?#]/.test(trimmed))) return undefined;
  const candidate = hasHttpScheme ? trimmed : `https://${trimmed}`;
  const authority = candidate.slice(candidate.indexOf('://') + 3).split(/[/?#]/, 1)[0];
  // WHATWG URL normalizes some ambiguous authorities; reject those inputs.
  if (!authority || /[@%]/.test(authority) || authority.endsWith(':')) return undefined;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    const labels = parsed.hostname.split('.');
    if (parsed.hostname.length > 253 || labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return undefined;
    // Customer websites must have a DNS-style host, not an IP or local name.
    const suffix = labels[labels.length - 1];
    if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/i.test(suffix)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function isNormalizedWebsiteValid(value: unknown): boolean {
  return typeof normalizeOptionalWebsite(value) === 'string';
}
