export const parityClassifications = [
  "PARITY",
  "INTENTIONAL_DIFFERENCE",
  "V2_DEFECT",
  "V1_LEGACY_DEFECT",
  "SEMANTICALLY_EQUIVALENT",
  "NOT_COMPARABLE",
  "DEFERRED",
  "INSUFFICIENT_EVIDENCE",
  "DOMAIN_DECISION_REQUIRED",
] as const;

export type ParityClassification = (typeof parityClassifications)[number];
export type ParityValue = null | boolean | number | string | readonly ParityValue[] | { readonly [key: string]: ParityValue };
export type ParityDrift = Readonly<{ path: string; v1: ParityValue | undefined; v2: ParityValue | undefined }>;
export type ParityResult = Readonly<{
  domain: string;
  fixture: string;
  classification: ParityClassification | "UNCLASSIFIED_DRIFT";
  drifts: readonly ParityDrift[];
}>;

export type NormalizationRules = Readonly<{
  ignoredKeys?: readonly string[];
  unorderedArrayPaths?: readonly string[];
}>;

const defaultIgnoredKeys = new Set([
  "quoteId", "orderId", "invoiceId", "lineId", "checkpointId", "operationId",
  "businessRequestId", "requestId", "auditId", "outboxId", "createdAt", "updatedAt", "occurredAt",
]);

const isRecord = (value: ParityValue): value is { readonly [key: string]: ParityValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stable = (value: ParityValue): string => JSON.stringify(value);

/** Removes architecture-only identities while retaining commercial values. */
export const normalizeParityValue = (
  value: ParityValue,
  rules: NormalizationRules = {},
  path = "$",
): ParityValue => {
  const ignored = new Set([...defaultIgnoredKeys, ...(rules.ignoredKeys ?? [])]);
  if (Array.isArray(value)) {
    const normalized = value.map((item, index) => normalizeParityValue(item, rules, `${path}[${index}]`));
    return rules.unorderedArrayPaths?.includes(path) ? [...normalized].sort((left, right) => stable(left).localeCompare(stable(right))) : normalized;
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !ignored.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, normalizeParityValue(nested, rules, `${path}.${key}`)])) as ParityValue;
};

const differences = (v1: ParityValue | undefined, v2: ParityValue | undefined, path: string): ParityDrift[] => {
  if (v1 === undefined || v2 === undefined || typeof v1 !== "object" || v1 === null || typeof v2 !== "object" || v2 === null) {
    return Object.is(v1, v2) ? [] : [{ path, v1, v2 }];
  }
  if (Array.isArray(v1) || Array.isArray(v2)) {
    if (!Array.isArray(v1) || !Array.isArray(v2) || v1.length !== v2.length) return [{ path, v1, v2 }];
    return v1.flatMap((item, index) => differences(item, v2[index], `${path}[${index}]`));
  }
  const keys = new Set([...Object.keys(v1), ...Object.keys(v2)]);
  return [...keys].flatMap((key) => differences(v1[key], v2[key], path === "$" ? key : `${path}.${key}`));
};

/** Produces field-level drift suitable for triage rather than opaque object equality. */
export const compareParity = (input: Readonly<{
  domain: string;
  fixture: string;
  v1: ParityValue;
  v2: ParityValue;
  normalization?: NormalizationRules;
  classificationWhenEqual?: ParityClassification;
  /** A reviewed, material difference remains in `drifts`; it is never normalized away. */
  classificationWhenDrift?: Exclude<ParityClassification, "PARITY">;
}>): ParityResult => {
  const v1 = normalizeParityValue(input.v1, input.normalization);
  const v2 = normalizeParityValue(input.v2, input.normalization);
  const drifts = differences(v1, v2, "$");
  return {
    domain: input.domain,
    fixture: input.fixture,
    classification: drifts.length ? input.classificationWhenDrift ?? "UNCLASSIFIED_DRIFT" : input.classificationWhenEqual ?? "PARITY",
    drifts,
  };
};

export const requireParity = (result: ParityResult): void => {
  if (result.classification !== "UNCLASSIFIED_DRIFT") return;
  const first = result.drifts[0];
  throw new Error([
    `domain: ${result.domain}`,
    `fixture: ${result.fixture}`,
    `field: ${first?.path ?? "$"}`,
    `V1: ${JSON.stringify(first?.v1)}`,
    `V2: ${JSON.stringify(first?.v2)}`,
    "classification: UNCLASSIFIED DRIFT",
  ].join("\n"));
};
