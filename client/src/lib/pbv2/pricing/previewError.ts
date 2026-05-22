/**
 * TEMP / editor-only helpers for the PBV2 Pricing Preview Sandbox.
 *
 * Normalizes whatever shape the preview endpoint returns on failure into a
 * single structured, expandable error model. Also provides lightweight
 * client-side guards so obviously-broken payloads can surface the same UI
 * without a wasted API call.
 *
 * Nothing here is persisted — preview diagnostics are UI-only and never written
 * to product records, tree versions, quotes, orders, or line items.
 */

export const PBV2_PREVIEW_CLIENT_VALIDATION = "PBV2_PREVIEW_CLIENT_VALIDATION";

export type PreviewErrorKind =
  | "generic_error"
  | "validation_error_with_details"
  | "unexpected_error";

export interface PreviewErrorDetail {
  /** Dotted path into the payload, e.g. "width" or "selections.grommets". */
  path?: string;
  message: string;
  expected?: string;
  /** `null` is meaningful (a value was expected but nothing was received). */
  received?: string | null;
}

export interface NormalizedPreviewError {
  kind: PreviewErrorKind;
  /** Human-readable summary, always safe to show in the red banner. */
  message: string;
  errorCode?: string;
  details: PreviewErrorDetail[];
  /** Raw safe message, used when no field-level details exist. */
  rawMessage: string;
}

/** Coerce one raw entry (envelope detail / Zod issue / formula error) into a detail. */
function coerceDetail(entry: any): PreviewErrorDetail | null {
  if (entry == null) return null;
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed ? { message: trimmed } : null;
  }
  if (typeof entry !== "object") return null;

  const message =
    typeof entry.message === "string" && entry.message.trim()
      ? entry.message.trim()
      : typeof entry.code === "string" && entry.code.trim()
        ? entry.code.trim()
        : null;
  if (!message) return null;

  const detail: PreviewErrorDetail = { message };

  const pathRaw = entry.path;
  if (Array.isArray(pathRaw) && pathRaw.length > 0) {
    detail.path = pathRaw.join(".");
  } else if (typeof pathRaw === "string" && pathRaw.trim()) {
    detail.path = pathRaw.trim();
  } else if (typeof entry.code === "string" && entry.code.trim() && entry.code !== message) {
    // Formula errors carry a code instead of a path.
    detail.path = entry.code.trim();
  }

  if (typeof entry.expected === "string" && entry.expected.trim()) {
    detail.expected = entry.expected.trim();
  }
  if (entry.received !== undefined) {
    detail.received = entry.received === null ? null : String(entry.received);
  }
  return detail;
}

/**
 * Normalize a failed preview response body into a structured error.
 *
 * Accepts the preferred envelope ({ details: [...] }), raw Zod issues
 * ({ issues: [...] }), formula-error lists ({ errors: [...] }), or a bare
 * { message }. Never throws.
 */
export function normalizePreviewError(
  json: any,
  httpStatus: number,
  fallbackMessage = "Pricing preview failed.",
): NormalizedPreviewError {
  const body = json && typeof json === "object" ? json : {};
  const rawMessage =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : fallbackMessage;
  const errorCode =
    typeof body.errorCode === "string" && body.errorCode.trim()
      ? body.errorCode.trim()
      : undefined;

  const rawSources: any[] = [];
  if (Array.isArray(body.details)) rawSources.push(...body.details);
  if (Array.isArray(body.issues)) rawSources.push(...body.issues);
  if (Array.isArray(body.errors)) rawSources.push(...body.errors);

  const details = rawSources
    .map(coerceDetail)
    .filter((detail): detail is PreviewErrorDetail => detail !== null);

  let kind: PreviewErrorKind;
  if (details.length > 0) {
    kind = "validation_error_with_details";
  } else if (httpStatus >= 500 || httpStatus === 0) {
    kind = "unexpected_error";
  } else {
    kind = "generic_error";
  }

  return { kind, message: rawMessage, errorCode, details, rawMessage };
}

/** Build an error for a problem detected on the client (no API call was made). */
export function buildClientPreviewError(
  message: string,
  details: PreviewErrorDetail[],
): NormalizedPreviewError {
  return {
    kind: details.length > 0 ? "validation_error_with_details" : "generic_error",
    message,
    errorCode: PBV2_PREVIEW_CLIENT_VALIDATION,
    details,
    rawMessage: message,
  };
}

/** Build an error for an unexpected failure (network/parse/etc.). */
export function buildUnexpectedPreviewError(message: string): NormalizedPreviewError {
  const safe = message && message.trim() ? message.trim() : "Pricing preview failed unexpectedly.";
  return { kind: "unexpected_error", message: safe, details: [], rawMessage: safe };
}

export interface PreviewErrorDebugSections {
  missingSelections: PreviewErrorDetail[];
  missingVariables: PreviewErrorDetail[];
  invalidNumericInputs: PreviewErrorDetail[];
  other: PreviewErrorDetail[];
}

/** Bucket validation details into the debug sub-sections shown when expanded. */
export function categorizePreviewDetails(details: PreviewErrorDetail[]): PreviewErrorDebugSections {
  const sections: PreviewErrorDebugSections = {
    missingSelections: [],
    missingVariables: [],
    invalidNumericInputs: [],
    other: [],
  };
  for (const detail of details) {
    const path = (detail.path ?? "").toLowerCase();
    const message = detail.message.toLowerCase();
    if (
      path.startsWith("selections") ||
      path.startsWith("optionselections") ||
      message.includes("option group") ||
      message.includes("selected value") ||
      message.includes("selection")
    ) {
      sections.missingSelections.push(detail);
    } else if (
      path === "width" ||
      path === "height" ||
      path === "quantity" ||
      message.includes("positive number")
    ) {
      sections.invalidNumericInputs.push(detail);
    } else if (
      path.includes("variable") ||
      path.includes("formula") ||
      message.includes("variable")
    ) {
      sections.missingVariables.push(detail);
    } else {
      sections.other.push(detail);
    }
  }
  return sections;
}

export interface RequiredSelectionGroup {
  groupId: string;
  groupName: string;
  isRequired: boolean;
  /** Selection keys belonging to the group's options. */
  selectionKeys: string[];
}

/** Treat a sandbox selection value as "present" (non-empty). */
function hasSelectionValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

/**
 * Detect required option groups that have no selected value. Used to enrich the
 * expandable error diagnostics with actionable "what is missing" info.
 */
export function findMissingRequiredSelections(
  groups: RequiredSelectionGroup[],
  selectedValues: Record<string, unknown>,
): PreviewErrorDetail[] {
  const details: PreviewErrorDetail[] = [];
  for (const group of groups) {
    if (!group.isRequired) continue;
    if (group.selectionKeys.length === 0) continue;
    const satisfied = group.selectionKeys.some((key) => hasSelectionValue(selectedValues[key]));
    if (!satisfied) {
      details.push({
        path: `selections.${group.selectionKeys[0] ?? group.groupId}`,
        message: `Required option group '${group.groupName}' has no selected value.`,
        expected: "one selected choice",
        received: null,
      });
    }
  }
  return details;
}
