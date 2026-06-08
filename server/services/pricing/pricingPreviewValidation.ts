/**
 * Pure validation helpers for the PBV2 pricing-preview endpoint.
 *
 * Pricing preview is a TEMP / editor-only concern. These helpers only shape
 * request validation and the error envelope returned to the builder sandbox.
 * They never read or write product truth (trees, quotes, orders, line items).
 *
 * Backend remains the source of truth for pricing validation; this module just
 * makes payload-rejection failures actionable instead of a bare message.
 */

import { resolvePbv2RuntimeDimensions } from "@shared/pbv2/fixedDimensions";

export const PBV2_INVALID_PREVIEW_PAYLOAD = "PBV2_INVALID_PREVIEW_PAYLOAD";

export interface PreviewValidationDetail {
  /** Dotted path into the submitted payload, e.g. "width" or "selections.grommets". */
  path: string;
  /** Human-readable, safe-to-display explanation. */
  message: string;
  /** What a valid value would look like, when known. */
  expected?: string;
  /** What was actually received (stringified, truncated). null is meaningful. */
  received?: string | null;
}

export interface PreviewErrorEnvelope {
  success: false;
  message: string;
  errorCode: string;
  details: PreviewValidationDetail[];
}

export interface NormalizedPreviewRequest {
  treeJson: any;
  widthNum: number;
  heightNum: number;
  quantityNum: number;
  pbv2ExplicitSelections: Record<string, any>;
}

export type PreviewRequestValidation =
  | { ok: true; normalized: NormalizedPreviewRequest }
  | { ok: false; status: number; envelope: PreviewErrorEnvelope };

/** Render an arbitrary received value as a short, safe string for diagnostics. */
function describeReceived(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return String(value);
}

export function buildPreviewErrorEnvelope(
  message: string,
  details: PreviewValidationDetail[],
  errorCode: string = PBV2_INVALID_PREVIEW_PAYLOAD,
): PreviewErrorEnvelope {
  return { success: false, message, errorCode, details: Array.isArray(details) ? details : [] };
}

/**
 * Convert a ZodError's `.issues` array into preview validation details without
 * importing zod. Safe to call with anything (returns [] for non-arrays).
 */
export function zodIssuesToPreviewDetails(issues: unknown): PreviewValidationDetail[] {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue: any): PreviewValidationDetail => {
    const pathParts = Array.isArray(issue?.path) ? issue.path : [];
    const detail: PreviewValidationDetail = {
      path: pathParts.length > 0 ? pathParts.join(".") : "(root)",
      message: typeof issue?.message === "string" && issue.message.trim()
        ? issue.message
        : "Invalid value.",
    };
    if (typeof issue?.expected === "string") detail.expected = issue.expected;
    if (issue?.received !== undefined) {
      detail.received = issue.received === null ? null : describeReceived(issue.received);
    }
    return detail;
  });
}

function validatePositiveNumber(
  raw: unknown,
  fieldPath: string,
  label: string,
  details: PreviewValidationDetail[],
): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    details.push({
      path: fieldPath,
      message: `${label} must be a positive number.`,
      expected: "a number greater than 0",
      received: describeReceived(raw),
    });
  }
  return num;
}

/**
 * Validate + normalize a raw pricing-preview request body.
 *
 * Returns either a normalized request ready for evaluation, or a structured
 * 400 envelope describing every field that is missing or malformed.
 */
export function validatePricingPreviewRequest(body: any): PreviewRequestValidation {
  const details: PreviewValidationDetail[] = [];
  const safeBody = body && typeof body === "object" ? body : {};

  const { treeJson, width, height, quantity, optionSelectionsJson } = safeBody as Record<string, unknown>;

  if (!treeJson || typeof treeJson !== "object" || Array.isArray(treeJson)) {
    details.push({
      path: "treeJson",
      message: "A PBV2 draft tree is required to run a pricing preview.",
      expected: "a draft tree object",
      received: describeReceived(treeJson),
    });
  }

  const runtimeDimensions = resolvePbv2RuntimeDimensions({ treeJson, widthIn: width, heightIn: height });
  const widthNum = runtimeDimensions.fixedDimensions
    ? runtimeDimensions.widthIn
    : validatePositiveNumber(width, "width", "Width", details);
  const heightNum = runtimeDimensions.fixedDimensions
    ? runtimeDimensions.heightIn
    : validatePositiveNumber(height, "height", "Height", details);
  const quantityNum = validatePositiveNumber(quantity, "quantity", "Quantity", details);

  let pbv2ExplicitSelections: Record<string, any> = {};
  if (optionSelectionsJson != null) {
    if (typeof optionSelectionsJson === "string") {
      try {
        const parsed = JSON.parse(optionSelectionsJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          pbv2ExplicitSelections = parsed;
        } else {
          details.push({
            path: "optionSelectionsJson",
            message: "Option selections must be an object mapping selection keys to values.",
            expected: "a JSON object",
            received: describeReceived(parsed),
          });
        }
      } catch {
        details.push({
          path: "optionSelectionsJson",
          message: "Option selections payload is not valid JSON.",
          expected: "a JSON object",
          received: describeReceived(optionSelectionsJson),
        });
      }
    } else if (typeof optionSelectionsJson === "object" && !Array.isArray(optionSelectionsJson)) {
      pbv2ExplicitSelections = optionSelectionsJson as Record<string, any>;
    } else {
      details.push({
        path: "optionSelectionsJson",
        message: "Option selections must be an object mapping selection keys to values.",
        expected: "a JSON object",
        received: describeReceived(optionSelectionsJson),
      });
    }
  }

  if (details.length > 0) {
    return {
      ok: false,
      status: 400,
      envelope: buildPreviewErrorEnvelope("Invalid preview payload", details),
    };
  }

  return {
    ok: true,
    normalized: { treeJson, widthNum, heightNum, quantityNum, pbv2ExplicitSelections },
  };
}
