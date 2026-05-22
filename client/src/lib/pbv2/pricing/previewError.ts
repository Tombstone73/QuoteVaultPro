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

// ---------------------------------------------------------------------------
// Human-readable enrichment of validation paths.
//
// Backend validation reports technically-correct but unreadable paths such as
// `nodes.opt_bccf2b2b-….choices.2.pricingImpact.0.unit`. The helpers below
// resolve node IDs / choice indexes against the PBV2 tree already loaded in the
// builder so the panel can show option + choice labels. This is read-only:
// it never mutates or repairs draft data.
// ---------------------------------------------------------------------------

export interface ParsedPreviewPath {
  /** Node ID from `nodes.{nodeId}.…`, if the path is node-scoped. */
  nodeId?: string;
  /** Choice index from `…choices.{index}.…`, if present. */
  choiceIndex?: number;
  /** Index from `…pricingImpact.{index}.…`, if present. */
  pricingImpactIndex?: number;
  /** Trailing pricing field: `mode` | `cents` | `centsPerSqft` | `unit`. */
  pricingField?: string;
  /** True only when the path resolves to a node/choice pricingImpact field. */
  isPricingImpactPath: boolean;
}

/**
 * Parse a validation path. Recognizes:
 *   nodes.{nodeId}.pricingImpact.{index}.{mode|cents|centsPerSqft}
 *   nodes.{nodeId}.choices.{choiceIndex}.pricingImpact.{index}.{unit|cents|centsPerSqft|mode}
 * Anything else returns `{ isPricingImpactPath: false }` (and `nodeId` if known).
 */
export function parsePreviewPath(path: string): ParsedPreviewPath {
  const result: ParsedPreviewPath = { isPricingImpactPath: false };
  if (typeof path !== "string" || path.length === 0) return result;

  const segments = path.split(".");
  if (segments[0] !== "nodes" || segments.length < 2) return result;
  result.nodeId = segments[1];

  let i = 2;
  if (segments[i] === "choices") {
    const choiceIdx = Number(segments[i + 1]);
    if (!Number.isInteger(choiceIdx)) return result;
    result.choiceIndex = choiceIdx;
    i += 2;
  }

  if (segments[i] === "pricingImpact") {
    const impactIdx = Number(segments[i + 1]);
    if (Number.isInteger(impactIdx)) {
      result.pricingImpactIndex = impactIdx;
      result.pricingField = segments[i + 2];
      result.isPricingImpactPath = true;
    }
  }

  return result;
}

/** Pick the first non-empty string/number value from `source` for the given keys. */
function pickLabel(source: any, keys: string[]): string | null {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Locate a node by ID in `treeJson.nodes`, supporting array or record form. */
export function findTreeNode(treeJson: unknown, nodeId: string): any | null {
  if (!treeJson || typeof treeJson !== "object" || !nodeId) return null;
  const nodesRaw = (treeJson as any).nodes;
  if (!nodesRaw) return null;
  if (Array.isArray(nodesRaw)) {
    return (
      nodesRaw.find(
        (node: any) =>
          node && (node.id === nodeId || node.nodeId === nodeId || node.key === nodeId),
      ) ?? null
    );
  }
  if (typeof nodesRaw === "object") {
    return (nodesRaw as Record<string, any>)[nodeId] ?? null;
  }
  return null;
}

/** Best human label for a node: label → name → title → key → nodeId fallback. */
export function getNodeLabel(treeJson: unknown, nodeId: string): string {
  const node = findTreeNode(treeJson, nodeId);
  return pickLabel(node, ["label", "name", "title", "key"]) ?? nodeId;
}

/**
 * Best human label for a choice: label → name → title → value → id, with a
 * `Choice #{index + 1}` fallback. Returns null when the choice is absent.
 */
export function getChoiceLabel(node: any, choiceIndex: number): string | null {
  const choices = node && Array.isArray(node.choices) ? node.choices : [];
  if (choiceIndex < 0 || choiceIndex >= choices.length) return null;
  const choice = choices[choiceIndex];
  return pickLabel(choice, ["label", "name", "title", "value", "id"]) ?? `Choice #${choiceIndex + 1}`;
}

export interface EnrichedPreviewDetail {
  /** User-facing location, e.g. "Grommets > Choice: Top Left" or "Unknown option". */
  displayLocation: string;
  /** Plain-English explanation of what is wrong. */
  friendlyMessage: string;
  /** Plain-English instruction for fixing it (omitted when no useful fix exists). */
  suggestedFix?: string;
  /** Short category label/badge text. */
  category: string;
  /** Raw technical path, always preserved for developer debugging. */
  technicalPath: string;
  expected?: string;
  received?: string | null;
}

interface PricingFieldInfo {
  category: string;
  friendly: string;
  fixAction: string;
}

/** Map a trailing pricing field to user-facing category / message / fix verb. */
function describePricingField(field: string | undefined, scope: "node" | "choice"): PricingFieldInfo {
  switch (field) {
    case "unit":
      return {
        category: "Missing pricing unit",
        friendly:
          scope === "choice"
            ? "This choice is missing its pricing unit."
            : "This pricing rule is missing its pricing unit.",
        fixAction: "choose the pricing unit",
      };
    case "mode":
      return {
        category: "Invalid pricing adjustment type",
        friendly: "This pricing rule uses an invalid adjustment type.",
        fixAction: "select a valid pricing adjustment type",
      };
    case "cents":
    case "centsPerSqft":
      return {
        category: "Missing pricing amount",
        friendly: "This pricing rule is missing its pricing amount.",
        fixAction: "enter the pricing amount",
      };
    default:
      return {
        category: "Pricing setup issue",
        friendly: "This pricing rule has an invalid setting.",
        fixAction: "review the pricing settings",
      };
  }
}

/** Lightly humanize a non-pricing path (width / selections / treeJson / …). */
function humanizeGenericPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower === "width" || lower === "height" || lower === "quantity") {
    return `Preview input: ${path.charAt(0).toUpperCase()}${path.slice(1)}`;
  }
  if (lower.startsWith("selections") || lower.startsWith("optionselections")) {
    return "Option selections";
  }
  if (lower === "treejson" || lower.startsWith("treejson")) {
    return "Draft tree";
  }
  return path;
}

/**
 * Enrich a single validation detail into a user-facing object, resolving node
 * IDs and choice indexes against `treeJson`. Always returns a value — falls
 * back safely to "Unknown option" / "{Option} > Unknown choice" when lookups
 * fail — and always preserves the raw `technicalPath`.
 */
export function enrichPreviewDetail(
  detail: PreviewErrorDetail,
  treeJson: unknown,
): EnrichedPreviewDetail {
  const technicalPath = detail.path ?? "";
  const enriched: EnrichedPreviewDetail = {
    displayLocation: "Pricing preview",
    friendlyMessage: detail.message,
    category: "Validation issue",
    technicalPath,
    expected: detail.expected,
    received: detail.received,
  };

  const parsed = technicalPath ? parsePreviewPath(technicalPath) : null;
  if (!parsed || !parsed.isPricingImpactPath || !parsed.nodeId) {
    if (technicalPath) enriched.displayLocation = humanizeGenericPath(technicalPath);
    return enriched;
  }

  const node = findTreeNode(treeJson, parsed.nodeId);
  const nodeLabel = node ? getNodeLabel(treeJson, parsed.nodeId) : null;
  const scope: "node" | "choice" = parsed.choiceIndex !== undefined ? "choice" : "node";
  const info = describePricingField(parsed.pricingField, scope);

  enriched.category = info.category;
  enriched.friendlyMessage = info.friendly;

  if (parsed.choiceIndex !== undefined) {
    if (!node) {
      enriched.displayLocation = "Unknown option";
      enriched.suggestedFix = "Open the related option and review its choice pricing settings.";
    } else {
      const choiceLabel = getChoiceLabel(node, parsed.choiceIndex);
      if (choiceLabel === null) {
        enriched.displayLocation = `${nodeLabel} > Unknown choice`;
        enriched.suggestedFix = `Open ${nodeLabel} and review the affected choice's pricing settings.`;
      } else {
        enriched.displayLocation = `${nodeLabel} > Choice: ${choiceLabel}`;
        enriched.suggestedFix = `Open ${nodeLabel}, edit the ${choiceLabel} choice, and ${info.fixAction}.`;
      }
    }
  } else if (!node) {
    enriched.displayLocation = "Unknown option";
    enriched.suggestedFix = "Open the related option and review its pricing settings.";
  } else {
    enriched.displayLocation = String(nodeLabel);
    enriched.suggestedFix = `Open ${nodeLabel} and ${info.fixAction}.`;
  }

  return enriched;
}

/** Enrich every detail in a list. */
export function enrichPreviewDetails(
  details: PreviewErrorDetail[],
  treeJson: unknown,
): EnrichedPreviewDetail[] {
  return details.map((detail) => enrichPreviewDetail(detail, treeJson));
}

/**
 * Build the plain-English summary shown above the issue list, e.g.
 * "Pricing preview found 4 setup problems. These appear to be incomplete
 * pricing settings on product options."
 */
export function buildPreviewErrorSummary(enriched: EnrichedPreviewDetail[]): string {
  const count = enriched.length;
  if (count === 0) return "";
  const noun = count === 1 ? "setup problem" : "setup problems";
  let summary = `Pricing preview found ${count} ${noun}.`;
  const pricingCount = enriched.filter((entry) =>
    entry.category.toLowerCase().includes("pricing"),
  ).length;
  if (pricingCount > 0 && pricingCount * 2 >= count) {
    summary += " These appear to be incomplete pricing settings on product options.";
  }
  return summary;
}
