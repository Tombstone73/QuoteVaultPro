/**
 * Stable, frozen configuration presentation for Sales surfaces and customer
 * documents. It never resolves today's Product definition and suppresses
 * opaque lineage identifiers from historic configuration snapshots.
 */
type FrozenSelection = Readonly<{ label: string; value: string }>;
type ResolvedConfiguration = Readonly<Record<string, unknown>>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const internalConfigurationIdentifier = /^(?:opt|choice)_[A-Za-z0-9_-]+$/u;
const importedConfigurationKey = /(?:^|_)import(?:_|$)/iu;
const internalConfigurationField = /^(?:product(?:_?version)?|option|choice|pricing_?configuration)(?:_?id|_?version|_?content_?hash)?$/iu;
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isInternalIdentifier = (value: string): boolean => uuid.test(value) || internalConfigurationIdentifier.test(value) || importedConfigurationKey.test(value);
const safeValue = (value: unknown): string | undefined => {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || !value.trim() || isInternalIdentifier(value)) return undefined;
  const normalized = value.includes("_") ? value.replaceAll("_", " ") : value;
  return value.includes("_") || /^(?:yes|no|none)$/iu.test(value) ? normalized.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : normalized;
};
const safeDimensions = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim() && !isInternalIdentifier(value)) return value;
  if (!isRecord(value)) return undefined;
  const dimensions = [value.width, value.height].filter((part): part is string | number => typeof part === "string" || typeof part === "number").map(String);
  if (!dimensions.length) return undefined;
  const unit = typeof value.unit === "string" && !isInternalIdentifier(value.unit) ? ` ${value.unit}` : "";
  return `${dimensions.join(" × ")}${unit}`;
};
const frozenPresentation = (value: unknown): readonly FrozenSelection[] | undefined => {
  if (!isRecord(value) || !Array.isArray(value.selections)) return undefined;
  return value.selections.flatMap((selection): FrozenSelection[] => {
    if (!isRecord(selection) || typeof selection.label !== "string" || typeof selection.value !== "string" || !selection.label.trim() || isInternalIdentifier(selection.label) || isInternalIdentifier(selection.value)) return [];
    return [{ label: selection.label, value: selection.value }];
  });
};

export const salesConfigurationPresentation = (resolved: ResolvedConfiguration): string => {
  const presentation = isRecord(resolved.presentation) ? resolved.presentation : undefined;
  const frozen = frozenPresentation(presentation);
  if (frozen?.length) return [safeDimensions(presentation?.dimensions), ...frozen.map((selection) => `${selection.label}: ${selection.value}`)].filter((value): value is string => Boolean(value)).join(" · ");
  const parts = [safeDimensions(resolved.dimensions)];
  const legacyValues: string[] = []; let unavailableLegacyValue = false;
  if (isRecord(resolved.selections)) for (const [key, rawValue] of Object.entries(resolved.selections)) {
    const value = safeValue(rawValue);
    if (internalConfigurationField.test(key)) unavailableLegacyValue = true;
    else if (isInternalIdentifier(key)) { if (value) legacyValues.push(value); else unavailableLegacyValue = true; }
    else if (value) parts.push(`${key}: ${value}`);
    else parts.push(`${key}: configuration value unavailable`);
  }
  if (legacyValues.length) parts.push(`Legacy options: ${legacyValues.join(", ")}`);
  else if (unavailableLegacyValue) parts.push("Configuration detail unavailable");
  return parts.filter((value): value is string => Boolean(value)).join(" · ") || "No additional configuration";
};
