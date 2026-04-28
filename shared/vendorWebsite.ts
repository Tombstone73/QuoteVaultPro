export function normalizeOptionalWebsite(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return value == null ? undefined : undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return undefined;
    }

    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function isNormalizedWebsiteValid(value: unknown): boolean {
  return typeof normalizeOptionalWebsite(value) === 'string';
}