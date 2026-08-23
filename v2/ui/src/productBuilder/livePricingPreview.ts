/**
 * Pure request preparation for the live Product Builder pricing preview.
 *
 * This deliberately contains no price calculation.  Its only jobs are to
 * decide whether the current configuration is complete enough to ask the
 * canonical server and to create a deterministic identity for that request.
 */
export type LivePreviewPayload = Readonly<{
  quantity: number;
  width?: number;
  height?: number;
  selections: Readonly<Record<string, unknown>>;
}>;

export type LivePreviewRequest = Readonly<{
  fingerprint: string;
  payload: LivePreviewPayload;
}>;

export type LivePreviewPreparation =
  | Readonly<{ kind: "ready"; request: LivePreviewRequest }>
  | Readonly<{ kind: "incomplete"; reasons: readonly string[] }>;

export type LivePreviewConfiguration = Readonly<{
  effectiveSelections: Readonly<Record<string, unknown>>;
  requiredOptionSelectionKeys: readonly string[];
}>;

export type LivePreviewInput = Readonly<{
  measurementMode: "dimensions_required" | "quantity_only";
  quantity: string;
  width: string;
  height: string;
  configuration: LivePreviewConfiguration;
  optionLabels: Readonly<Record<string, string>>;
}>;

/** A response can only become the displayed confirmation when it belongs to
 * the configuration still rendered by the Builder. */
export const acceptsLivePreviewResponse = (
  latestFingerprint: string | null,
  responseFingerprint: string | null,
): boolean => latestFingerprint !== null && latestFingerprint === responseFingerprint;

export type ConfirmedLivePreview<Value> = Readonly<{ fingerprint: string; value: Value }>;

/** Presentation state is intentionally separate from canonical pricing. It
 * retains only a previously-confirmed server value while a newer request is
 * debouncing/fetching or fails. */
export const presentLivePreview = <Value,>(input: Readonly<{
  currentFingerprint: string | null;
  responseFingerprint: string | null;
  debouncing: boolean;
  fetching: boolean;
  serverError?: string | null;
  confirmed: ConfirmedLivePreview<Value> | null;
}>): Readonly<{
  confirmed: ConfirmedLivePreview<Value> | null;
  updating: boolean;
  stale: boolean;
  error: string | null;
}> => {
  const responseIsCurrent = acceptsLivePreviewResponse(input.currentFingerprint, input.responseFingerprint);
  return {
    confirmed: input.confirmed,
    updating: input.currentFingerprint !== null && (input.debouncing || input.fetching),
    stale: Boolean(input.confirmed && input.confirmed.fingerprint !== input.currentFingerprint),
    error: responseIsCurrent ? input.serverError ?? null : null,
  };
};

const isMissing = (value: unknown): boolean => value === undefined
  || value === null
  || (typeof value === "string" && !value.trim())
  || (Array.isArray(value) && value.length === 0);

const positive = (value: string): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** Stable object serialization makes both React Query cache identity and
 * latest-response protection independent of object insertion order. */
export const livePreviewFingerprint = (payload: LivePreviewPayload): string => JSON.stringify({
  quantity: payload.quantity,
  ...(payload.width === undefined ? {} : { width: payload.width }),
  ...(payload.height === undefined ? {} : { height: payload.height }),
  selections: Object.fromEntries(Object.entries(payload.selections)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, canonicalValue(value)])),
});

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalValue(nested)]));
};

export const prepareLivePreview = (input: LivePreviewInput): LivePreviewPreparation => {
  const reasons: string[] = [];
  const quantity = positive(input.quantity);
  if (quantity === undefined) reasons.push("Enter a quantity greater than zero.");
  const width = input.measurementMode === "dimensions_required" ? positive(input.width) : undefined;
  const height = input.measurementMode === "dimensions_required" ? positive(input.height) : undefined;
  if (input.measurementMode === "dimensions_required" && width === undefined) reasons.push("Enter a width greater than zero.");
  if (input.measurementMode === "dimensions_required" && height === undefined) reasons.push("Enter a height greater than zero.");
  const missingOptions = input.configuration.requiredOptionSelectionKeys.filter((key) => isMissing(input.configuration.effectiveSelections[key]));
  if (missingOptions.length) reasons.push(`Select required options: ${missingOptions.map((key) => input.optionLabels[key] ?? key).join(", ")}.`);
  if (reasons.length || quantity === undefined) return { kind: "incomplete", reasons };
  const payload: LivePreviewPayload = {
    quantity,
    ...(input.measurementMode === "dimensions_required" && width !== undefined && height !== undefined ? { width, height } : {}),
    selections: input.configuration.effectiveSelections,
  };
  return { kind: "ready", request: { payload, fingerprint: livePreviewFingerprint(payload) } };
};
