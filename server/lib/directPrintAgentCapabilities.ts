export const MINIMUM_QUICK_NOTE_AGENT_VERSION = "1.0.24";

function parseNumericVersion(version: string | null | undefined): number[] | null {
  const normalized = version?.trim().replace(/^v/i, "");
  if (!normalized) return null;
  const components = normalized.split(".");
  if (!components.length || components.some((component) => !/^\d+$/.test(component))) return null;
  const values = components.map(Number);
  return values.every(Number.isSafeInteger) ? values : null;
}

export function isNumericAgentVersion(version: string | null | undefined): boolean {
  return parseNumericVersion(version) !== null;
}

export function isAgentVersionAtLeast(version: string | null | undefined, minimumVersion: string): boolean {
  const actual = parseNumericVersion(version);
  const minimum = parseNumericVersion(minimumVersion);
  if (!actual || !minimum) return false;
  const length = Math.max(actual.length, minimum.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (actual[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export function supportsQuickNoteAgent(version: string | null | undefined): boolean {
  return isAgentVersionAtLeast(version, MINIMUM_QUICK_NOTE_AGENT_VERSION);
}
