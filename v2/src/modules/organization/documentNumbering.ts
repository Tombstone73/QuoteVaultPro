import { V2ApplicationError } from "../../errors/applicationError.js";

export const nativeNumberingKinds = ["quote", "order"] as const;
export type NativeNumberingKind = (typeof nativeNumberingKinds)[number];

export const nativeNumberingDefaults: Readonly<Record<NativeNumberingKind, Readonly<{ prefix: string; nextNumber: bigint }>>> = Object.freeze({
  quote: Object.freeze({ prefix: "QT-", nextNumber: 1000n }),
  order: Object.freeze({ prefix: "ORD-", nextNumber: 1000n }),
});

export type NumberingConfiguration = Readonly<{
  kind: NativeNumberingKind;
  prefix: string;
  nextNumber: string;
  nextDisplayNumber: string;
  status: "ready";
  adoption: "native_v2" | "lazy_native_default";
}>;

export type NumberingSettings = Readonly<{
  revision: string;
  documents: readonly NumberingConfiguration[];
  sharedJobNumber: Readonly<{
    owner: "order_number";
    behavior: "order_display_number";
    configurableSeparately: false;
  }>;
  compatibility: Readonly<{
    legacyQuoteOrder: "converged";
    legacyInvoice: "compatibility_managed";
    legacyPurchaseOrder: "compatibility_managed";
    importedHistoricalDocuments: "preserved";
  }>;
  readiness: Readonly<{
    status: "ready" | "migration_required" | "needs_attention";
    reasons: readonly string[];
  }>;
}>;

export type SaveNumberingSettings = Readonly<{
  expectedRevision: string;
  quote: Readonly<{ prefix: string; nextNumber: bigint }>;
  order: Readonly<{ prefix: string; nextNumber: bigint }>;
}>;

const object = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", message);
  return value as Record<string, unknown>;
};

const prefix = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new V2ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  const normalized = value.trim();
  if (normalized.length > 16 || !/^[A-Za-z0-9_-]*$/u.test(normalized)) throw new V2ApplicationError("VALIDATION_ERROR", `${field} may contain at most 16 letters, numbers, dashes, or underscores.`);
  return normalized;
};

const nextNumber = (value: unknown, field: string): bigint => {
  if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) throw new V2ApplicationError("VALIDATION_ERROR", `${field} must be a positive whole-number string.`);
  const parsed = BigInt(value.trim());
  if (parsed < 1n) throw new V2ApplicationError("VALIDATION_ERROR", `${field} must be a positive whole-number string.`);
  return parsed;
};

export const numberingSettingsInput = (value: unknown): SaveNumberingSettings => {
  const body = object(value, "Numbering settings are required.");
  if (typeof body.expectedRevision !== "string" || !body.expectedRevision.trim() || body.expectedRevision.length > 160) throw new V2ApplicationError("VALIDATION_ERROR", "expectedRevision is required.");
  const quote = object(body.quote, "Quote numbering is required.");
  const order = object(body.order, "Order numbering is required.");
  return {
    expectedRevision: body.expectedRevision.trim(),
    quote: { prefix: prefix(quote.prefix, "Quote prefix"), nextNumber: nextNumber(quote.nextNumber, "Quote next number") },
    order: { prefix: prefix(order.prefix, "Order prefix"), nextNumber: nextNumber(order.nextNumber, "Order next number") },
  };
};

export const displayFor = (prefixValue: string, next: bigint): string => `${prefixValue}${next.toString()}`;

/** Pure future-only guard shared by the transactional Settings adapter. */
export const assertFutureNextNumber = (kind: NativeNumberingKind, desired: bigint, currentNext: bigint, highestAllocated: bigint): void => {
  if (desired < currentNext) throw new V2ApplicationError("CONFLICT", `The next ${kind} number cannot move backward.`);
  if (desired <= highestAllocated) throw new V2ApplicationError("CONFLICT", `The next ${kind} number must be greater than existing native ${kind} numbers.`);
};
