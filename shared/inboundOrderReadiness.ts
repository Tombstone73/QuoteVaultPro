import type { InboundOrderArtworkLink, InboundOrderReviewDraftPayload, InboundOrderReviewDraftDto, InboundOrderProductOptionsResponse } from "./inboundOrdersApi";
import { inboundAttachmentRoleToClassification } from "./inboundAttachmentClassification";
import { resolveProductionSides } from "./productionHydration";
import { hasUsableInboundLinePrice } from "./inboundOrderPricing";
import { getMissingInboundPbv2RequiredOptions } from "./inboundOrderPbv2Options";
type Draft = InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto;
type Decision = Draft["missingDecisionsJson"][number];
export type InboundProductConfiguration = InboundOrderProductOptionsResponse["data"];
/** Normalize parser field paths, not customer content or arbitrary decision text. */
function decisionField(value: string | null | undefined): string {
  return String(value ?? "").replace(/\[(\d+)\]/g, ".$1").replace(/[_\s-]/g, "")
    .replace(/^reviewedLineItemsJson/i, "lineItems").replace(/^reviewedCustomerJson/i, "customer")
    .replace(/^reviewedOrderJson/i, "order").toLowerCase();
}
export function inboundDecisionTarget(decision: Pick<Decision, "field">): "customer" | "contact" | "product" | "dimensions" | "quantity" | "artwork" | "product-options" | "dueDate" | "fulfillment" | null {
  const field = decisionField(decision.field).replace(/^lineitems(?:\.\d+)?\./, "").replace(/^order\./, "");
  if (/^(?:customer(?:\.(?:name|selectedcustomerid|companyname))?|selectedcustomerid)$/.test(field)) return "customer";
  if (/^(?:contact(?:\.(?:name|selectedcontactid))?|(?:customer\.)?(?:contactid|contactname|selectedcontactid)|customer\.contact)$/.test(field)) return "contact";
  if (/^(?:product|productname|productid|productselection|productconfirmation|selectedproductid)$/.test(field)) return "product";
  if (/^(?:dimensions?|finisheddimensions?|finishedsize|size|width|height)(?:\.|$)/.test(field)) return "dimensions";
  if (/^(?:quantity|qty|quantityconfirmation|quantityconfirmed)(?:\.|$)/.test(field)) return "quantity";
  if (/^(?:artwork|artworklinks|artworkassignment)(?:\.|$)/.test(field)) return "artwork";
  // Only the missing-selection contract is delegated to PBV2. A nested,
  // request-specific option decision may require an explicit staff decision.
  if (/^(?:options|optionselections(?:json)?|requiredoptions|pbv2options)$/.test(field)) return "product-options";
  if (/^(?:duedate|requestedduedate|requireddate)$/.test(field)) return "dueDate";
  if (/^(?:shipmethod|shippingmethod|requestedshipmethod|requestedpickup|shipping|pickup|fulfillment(?:type|method)?)$/.test(field)) return "fulfillment";
  return null;
}
export function isInboundOptionsDecision(decision: Pick<Decision, "field" | "label" | "reason">): boolean {
  return inboundDecisionTarget(decision) === "product-options"
    && /required|missing|not selected|unselected|incomplete/i.test(`${decision.field} ${decision.label} ${decision.reason}`);
}
export type InboundReadinessTarget = "customer" | "product" | "quantity" | "dimensions" | "artwork" | "dueDate" | "fulfillment" | "pricing" | "product-options" | "review";
export type InboundReadinessProblem = { label: string; target: InboundReadinessTarget; lineIndex: number | null };
function inboundDecisionReadinessTarget(decision: Pick<Decision, "field" | "label" | "reason">): InboundReadinessTarget {
  if (isInboundEvidenceDecision(decision)) return "review";
  const target = inboundDecisionTarget(decision);
  return target === "contact" ? "customer" : target ?? "review";
}
/** Canonical review gates shared with the working draft. Evidence/version checks remain server-side. */
export function isActiveClassifiedArtworkLink(link: InboundOrderArtworkLink): boolean {
  return link.source !== "staff_removed"
    && (link.classification ?? inboundAttachmentRoleToClassification(link.role)) === "ARTWORK";
}

export function hasAssignedClassifiedArtwork(payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">): boolean {
  return payload.reviewedLineItemsJson.some((lineItem) => lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
}

export function hasCompleteDoubleSidedArtwork(lineItem: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number]): boolean {
  const selected = lineItem.optionSelectionsJson?.selected ?? {};
  const rawSelectionIndicatesDoubleSided = Object.entries(selected).some(([key, entry]) => (
    /side|sides|print[_\s-]*side/i.test(key)
    && /double|two|2[_\s-]*sided|\bds\b/i.test(String(entry?.value ?? ""))
  ));
  if (resolveProductionSides(lineItem) !== "Double-sided" && !rawSelectionIndicatesDoubleSided) return true;
  const artwork = lineItem.artworkLinks.filter(isActiveClassifiedArtworkLink);
  return artwork.some((link) => link.assignmentSide === "both")
    || (artwork.some((link) => link.assignmentSide === "front") && artwork.some((link) => link.assignmentSide === "back"));
}

export function isArtworkDecision(decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">): boolean {
  return /artwork/i.test(`${decision.field} ${decision.label} ${decision.reason}`);
}

export function isQuantityDecision(decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">): boolean {
  return /quantity/i.test(`${decision.field} ${decision.label} ${decision.reason}`);
}

export function isDimensionsDecision(decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">): boolean {
  const field = String(decision.field ?? "");
  if (inboundDecisionTarget({ field }) === "dimensions") return true;

  const text = `${decision.label} ${decision.reason}`;
  return /what\s+(?:size|dimensions?)\b.*\bneeded\b|\b(?:size|dimensions?)\b.*\b(?:missing|required|unclear)\b/i.test(text)
    && !/\bpole\s+pocket\b/i.test(text);
}

export function artworkLineIndex(value: string | null | undefined): number | null {
  const match = decisionField(value).match(/lineitems\.(\d+)\.artwork/i);
  return match ? Number(match[1]) : null;
}

export function quantityLineIndex(value: string | null | undefined): number | null {
  const match = decisionField(value).match(/lineitems\.(\d+)\.quantity/i);
  return match ? Number(match[1]) : null;
}

export function dimensionsLineIndex(value: string | null | undefined): number | null {
  const match = decisionField(value).match(/lineitems\.(\d+)\.(?:finished)?(?:dimensions?|size|width|height)/i);
  return match ? Number(match[1]) : null;
}

export function reviewedLineIndex(value: string | null | undefined): number | null {
  const match = decisionField(value).match(/lineitems\.(\d+)(?:\.|$)/i);
  return match ? Number(match[1]) : null;
}

export function decisionReferencesRemovedLine(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field">,
): boolean {
  const lineIndex = reviewedLineIndex(decision.field);
  return lineIndex != null && lineIndex >= payload.reviewedLineItemsJson.length;
}

export function hasValidLineItemQuantity(
  lineItem: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number] | undefined,
): boolean {
  return typeof lineItem?.quantity === "number"
    && Number.isFinite(lineItem.quantity)
    && lineItem.quantity > 0;
}

export function hasValidLineItemDimensions(
  lineItem: InboundOrderReviewDraftPayload["reviewedLineItemsJson"][number] | undefined,
): boolean {
  return typeof lineItem?.width === "number"
    && Number.isFinite(lineItem.width)
    && lineItem.width > 0
    && typeof lineItem.height === "number"
    && Number.isFinite(lineItem.height)
    && lineItem.height > 0;
}

export function artworkDecisionIsResolvedByAssignment(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">,
): boolean {
  const lineIndex = artworkLineIndex(decision.field);
  if (lineIndex == null) return payload.reviewedLineItemsJson.length > 0 && payload.reviewedLineItemsJson.every(line => line.artworkLinks.some(isActiveClassifiedArtworkLink));
  return payload.reviewedLineItemsJson[lineIndex]?.artworkLinks.some(isActiveClassifiedArtworkLink) ?? false;
}

export function quantityDecisionIsResolvedByLineItem(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">,
): boolean {
  const lineIndex = quantityLineIndex(decision.field);
  return lineIndex != null ? hasValidLineItemQuantity(payload.reviewedLineItemsJson[lineIndex])
    : payload.reviewedLineItemsJson.length > 0 && payload.reviewedLineItemsJson.every(hasValidLineItemQuantity);
}

export function dimensionsDecisionIsResolvedByLineItem(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  decision: Pick<InboundOrderReviewDraftPayload["missingDecisionsJson"][number], "field" | "label" | "reason">,
): boolean {
  const lineIndex = dimensionsLineIndex(decision.field);
  if (lineIndex != null) return hasValidLineItemDimensions(payload.reviewedLineItemsJson[lineIndex]);
  return payload.reviewedLineItemsJson.length > 0 && payload.reviewedLineItemsJson.every(hasValidLineItemDimensions);
}

export function isStaleMissingArtworkWarning(
  payload: Pick<InboundOrderReviewDraftPayload, "reviewedLineItemsJson">,
  warning: Pick<InboundOrderReviewDraftPayload["warningsJson"][number], "code" | "message" | "fieldPath">,
): boolean {
  const text = `${warning.code ?? ""} ${warning.message ?? ""} ${warning.fieldPath ?? ""}`.toLowerCase();
  if (!text.includes("artwork") || !/(missing|not linked|not attached|unassigned)/.test(text)) return false;
  const lineIndex = artworkLineIndex(warning.fieldPath);
  if (lineIndex == null) return hasAssignedClassifiedArtwork(payload);
  return payload.reviewedLineItemsJson[lineIndex]?.artworkLinks.some(isActiveClassifiedArtworkLink) ?? false;
}

export function draftHasArtworkThatNeedsAssignment(payload: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto): boolean {
  if (hasAssignedClassifiedArtwork(payload)) return false;
  if (payload.reviewedArtworkJson.unassignedAttachments.some(isActiveClassifiedArtworkLink)) return true;
  if (payload.reviewedArtworkJson.refs.some((reference) => reference.purpose === "artwork")) return true;
  return payload.reviewedArtworkJson.status === "supplied";
}

/**
 * "to_follow" is the staff-confirmed inbound order bypass. It deliberately
 * remains distinct from supplied artwork so downstream work can see that the
 * source file is still outstanding.
 */
export function hasArtworkBypassForOrder(payload: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto): boolean {
  return payload.reviewedArtworkJson.status === "to_follow";
}

export function artworkIsRequiredForOrder(payload: InboundOrderReviewDraftPayload | InboundOrderReviewDraftDto): boolean {
  return !hasAssignedClassifiedArtwork(payload)
    && payload.reviewedArtworkJson.status !== "not_required";
}

export function inboundReviewDraftProblems(draft: Draft, configurations?: readonly (InboundProductConfiguration | null)[]): InboundReadinessProblem[] {
  const errors: InboundReadinessProblem[] = [];
  const add = (label: string, target: InboundReadinessTarget, lineIndex: number | null = null) => errors.push({ label, target, lineIndex });
  const customer = draft.reviewedCustomerJson;
  if (customer.senderMatch?.status === "ambiguous" && customer.selectedCustomerSource !== "staff_selected" && customer.selectedContactSource !== "staff_selected") {
    add("Sender email matches multiple customer/contact relationships. Confirm the correct customer and contact.", "customer");
  }
  if (!customer.selectedCustomerId && !customer.unresolvedCustomer) {
    add("Select a customer candidate or mark the customer unresolved.", "customer");
  }

  if (draft.reviewedLineItemsJson.length === 0) {
    add("At least one line item is required.", "product");
  }

  draft.reviewedLineItemsJson.forEach((lineItem, index) => {
    const label = lineItem.productName || lineItem.sourceText || `Line item ${index + 1}`;
    if (!lineItem.quantity) {
      add(`${label}: quantity is required.`, "quantity", index);
    }
    if (!lineItem.selectedProductId && !lineItem.productUnresolved) {
      add(`${label}: select a product candidate or mark product unresolved.`, "product", index);
    }
    if (lineItem.pricingReviewJson?.status === "mismatch" && (!lineItem.pricingReviewJson.acknowledged || !lineItem.pricingReviewJson.resolution)) {
      add(`${label}: PO price differs from system price. Acknowledge or resolve pricing before conversion.`, "pricing", index);
    }
    if (!hasUsableInboundLinePrice(lineItem.pricingReviewJson, lineItem.quantity)) {
      add(`${label}: system pricing is unavailable or zero. Enter a valid unit or total price override before conversion.`, "pricing", index);
    }
    const artworkBypassed = hasArtworkBypassForOrder(draft);
    if (!artworkBypassed && draft.reviewedArtworkJson.status !== "not_required" && !hasCompleteDoubleSidedArtwork(lineItem)) {
      add(`${label}: assign Back artwork or choose the same artwork for both sides.`, "artwork", index);
    }
  });

  const artworkBypassed = hasArtworkBypassForOrder(draft);
  const artworkRequired = artworkIsRequiredForOrder(draft);
  if (artworkRequired && !artworkBypassed) {
    add("Artwork is missing. Assign artwork or select Bypass artwork before marking the draft ready for order conversion.", "artwork");
  }

  if (!artworkBypassed && draftHasArtworkThatNeedsAssignment(draft)) {
    const targetLineIndex = draft.reviewedLineItemsJson.findIndex((lineItem) => !lineItem.artworkLinks.some(isActiveClassifiedArtworkLink));
    add(`Line ${Math.max(0, targetLineIndex) + 1} needs artwork assignment.`, "artwork", Math.max(0, targetLineIndex));
  }

  draft.missingDecisionsJson.forEach((decision) => {
    if (decision.status !== "still_blocking") return;
    if (inboundDecisionResolvedByCurrentDraft(draft, decision, configurations)) return;
    // Selected-product requirements need the current catalog tree. The server's
    // synchronous DTO is advisory; mark-ready/conversion always load that tree.
    if (isDimensionsDecision(decision) && !isInboundEvidenceDecision(decision)) return;
    if (!configurations && isInboundOptionsDecision(decision) && !isInboundEvidenceDecision(decision)) return;
    if (decision.severity === "blocking") {
      add(`${decision.label}: resolve or acknowledge this blocking decision.`, inboundDecisionReadinessTarget(decision), reviewedLineIndex(decision.field));
    } else if (!artworkBypassed && isArtworkDecision(decision)) {
      add(`Line ${(artworkLineIndex(decision.field) ?? 0) + 1} needs artwork assignment or an explicit artwork-status decision.`, "artwork", artworkLineIndex(decision.field));
    }
  });

  return errors;
}

export function validateInboundReviewDraft(draft: Draft, configurations?: readonly (InboundProductConfiguration | null)[]): string[] {
  return Array.from(new Set(inboundReviewDraftProblems(draft, configurations).map(problem => problem.label)));
}


/** Supplied fields supersede historical missing-field observations, never evidence conflicts or ambiguous choices. */
export function inboundDecisionResolvedByCurrentDraft(draft: Draft, decision: Pick<Decision, "field" | "label" | "reason">, configurations?: readonly (InboundProductConfiguration | null)[]): boolean {
  // The selected product's finished-size gate below still rejects missing or
  // invalid dimensions. Page geometry alone is a Prepress observation.
  if (isInboundArtworkSizeObservation(decision)) return true;
  if (isInboundEvidenceDecision(decision)) return false;
  if (decisionReferencesRemovedLine(draft, decision)) return true;
  if (isArtworkDecision(decision) && hasArtworkBypassForOrder(draft)) return true;
  if (isArtworkDecision(decision) && artworkDecisionIsResolvedByAssignment(draft, decision)) return true;
  const target = inboundDecisionTarget(decision) ?? (isDimensionsDecision(decision) ? "dimensions" : null);
  const index = reviewedLineIndex(decision.field);
  const lines = index == null ? draft.reviewedLineItemsJson : draft.reviewedLineItemsJson.slice(index, index + 1);
  if (target === "quantity" || (quantityLineIndex(decision.field) != null && isQuantityDecision(decision))) return quantityDecisionIsResolvedByLineItem(draft, decision);
  if (target === "dimensions" || target === "product-options") {
    if (target === "product-options" && !isInboundOptionsDecision(decision)) return false;
    if (!configurations) return target === "dimensions" && dimensionsDecisionIsResolvedByLineItem(draft, decision);
    return lines.length > 0 && lines.every((line, offset) => {
      const config = configurations[index ?? offset];
      if (!line.selectedProductId || config?.productId !== line.selectedProductId) return false;
      return target === "dimensions" ? !config.requiresEnteredDimensions || hasValidLineItemDimensions(line)
        : (!config.activeTreeVersionId || !line.pbv2TreeVersionId || config.activeTreeVersionId === line.pbv2TreeVersionId)
          && getMissingInboundPbv2RequiredOptions(config.treeJson, line.optionSelectionsJson).length === 0;
    });
  }
  if (target === "product") return lines.length > 0 && lines.every(line => Boolean(line.selectedProductId && !line.productUnresolved));
  if (target === "customer") return Boolean(draft.reviewedCustomerJson.selectedCustomerId && !draft.reviewedCustomerJson.unresolvedCustomer);
  if (target === "contact") return Boolean(draft.reviewedCustomerJson.selectedContactId && !draft.reviewedCustomerJson.unresolvedContact);
  if (target === "dueDate") return Boolean(draft.reviewedOrderJson.dueDate?.trim());
  if (target === "fulfillment") {
    const field = decisionField(decision.field).replace(/^order\./, "");
    return Boolean(draft.reviewedOrderJson.shipMethod?.trim() || draft.reviewedOrderJson.fulfillmentType === "pickup"
      || (!/^(?:shipmethod|shippingmethod)$/.test(field) && draft.reviewedOrderJson.fulfillmentType === "shipping"));
  }
  return false;
}

export function isInboundArtworkSizeObservation(observation: { label?: string | null; reason?: string | null; message?: string | null }): boolean {
  const text = `${observation.label ?? ""} ${observation.reason ?? ""} ${observation.message ?? ""}`;
  return /(?:pdf|artwork)\s+(?:page\s+)?(?:size|dimensions?)/i.test(text)
    && /finished|requested|order line/i.test(text)
    && /differ|mismatch|discrepancy/i.test(text)
    && !/quarantin|unreadable|inaccessible|ownership|linkage|stale|unavailable/i.test(text);
}

/** These require source reconciliation, not merely a populated form field. */
export function isInboundEvidenceDecision(decision: Pick<Decision, "field" | "label" | "reason">): boolean {
  return /^(?:evidence|source)(?:\.|evidence|$)/i.test(decisionField(decision.field))
    || /ownership conflict|linkage conflict|quarantin|unreadable|inaccessible|reconcil|stale evidence|(?:source|documents?|email|\bpo\b).*(?:conflict|disagree)/i.test(`${decision.label} ${decision.reason}`);
}
export function inboundProductConfigurationProblems(line: Draft["reviewedLineItemsJson"][number], config: InboundProductConfiguration | null, index: number): InboundReadinessProblem[] {
  if (!line.selectedProductId) return [];
  const label = line.productName || config?.productName || `Line item ${index + 1}`;
  const problem = (message: string, target: InboundReadinessTarget): InboundReadinessProblem => ({ label: message, target, lineIndex: index });
  if (!config || config.productId !== line.selectedProductId) return [problem(`${label}: selected active product configuration is unavailable. Review the selected product.`, "product")];
  if (config.activeTreeVersionId && line.pbv2TreeVersionId && line.pbv2TreeVersionId !== config.activeTreeVersionId) return [problem(`${label}: product options changed. Refresh the selected product and review its options before conversion.`, "product-options")];
  const errors: InboundReadinessProblem[] = [];
  if (config.requiresEnteredDimensions && !hasValidLineItemDimensions(line)) errors.push(problem(`${label}: width and height are required for this product type.`, "dimensions"));
  const missing = getMissingInboundPbv2RequiredOptions(config.treeJson, line.optionSelectionsJson);
  if (missing.length) errors.push(problem(`${label} requires ${missing.map(option => option.label).join(", ")} before conversion.`, "product-options"));
  return errors;
}

export function validateInboundProductConfiguration(line: Draft["reviewedLineItemsJson"][number], config: InboundProductConfiguration | null, index: number): string[] {
  return inboundProductConfigurationProblems(line, config, index).map(problem => problem.label);
}
