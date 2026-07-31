import * as React from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Clock3, ListChecks, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssistantContextEnvelope } from "./types";
import { ConfigurableProductConfirmationCardView, ConfigurableProductResultCardView, toConfigurableProductConfirmation, toConfigurableProductResult, type ConfigurableProductConfirmationCard, type ConfigurableProductResultCard } from "./AssistantConfigurableProductCards";

/**
 * Deliberately narrow display model for the Stage 3 server card.  The browser
 * receives a preview only; it never turns a model suggestion into a command.
 * Keeping this adapter local also makes newly added server fields harmless.
 */
export type AssistantPlanCardModel = {
  id: string;
  title: string;
  action: string | null;
  status: string;
  planVersion: number | null;
  riskLevel: string;
  confirmationAvailable: boolean;
  confirmationToken: string | null;
  preview: string | null;
  quoteInternalNote: {
    quoteId: string | null;
    quoteNumber: string | null;
    customerName: string | null;
    noteText: string | null;
    quotePath: string | null;
    unchangedItems: string[];
  } | null;
  productDraftUpdate: {
    productName: string | null;
    draftStatus: string | null;
    editorPath: string | null;
    changes: Array<{ label: string; before: string | null; after: string | null }>;
    validationErrors: string[];
    warnings: string[];
    unchangedAreas: string[];
  } | null;
  productPricingChangeSet: { targetCount: number; eligibleCount: number; rows: Array<{ productName: string; active: boolean; before: UnknownRecord; after: UnknownRecord }>; excluded: Array<{ productName: string; reason: string }> } | null;
  productPricingRollback: { changeSetId: string; requestSummary: string; targetCount: number; eligibleCount: number; rows: Array<{ productName: string; before: UnknownRecord; current: UnknownRecord; restore: UnknownRecord; reason: string | null }> } | null;
  productDraftCreate: {
    productName: string | null;
    category: string | null;
    measurementMode: string | null;
    pricingModel: string | null;
    perSqftCents: number | null;
    perPieceCents: number | null;
    minimumChargeCents: number | null;
    material: string | null;
    productionRoute: string | null;
    sheetOrRollConstraints: string | null;
    allowRotation: boolean | null;
    fixedDimensions: string | null;
    requiresDimensions: boolean | null;
    quantityBehavior: string | null;
    commonOptions: string[];
    warnings: string[];
    status: string | null;
  } | null;
  orderCreate: {
    customerName: string;
    contactName: string | null;
    orderStatus: string;
    productionDeferred: boolean;
    totalCents: number;
    warnings: string[];
    lines: Array<{ productId: string; productName: string; quantity: number; measurementMode: string | null; dimensions: { widthIn: number; heightIn: number; unit: string } | null; pbv2TreeVersionId: string; selections: Array<{ groupId: string; groupLabel: string; valueId: string; valueLabel: string; source: "explicit" | "default_accepted" | "system" }>; unitPriceCents: number; totalCents: number; minimumChargeApplied: boolean; warnings: string[] }>;
  } | null;
  affectedEntities: Array<{ id: string; type: string; label: string; href: string | null }>;
  sideEffects: string[];
  missingInformation: string[];
  undo: { available: boolean; label: string | null; expiresAt: string | null } | null;
  expiresAt: string | null;
  staleReason: string | null;
  contextBinding: { route: string | null; entityType: string | null; entityId: string | null };
  canCancel: boolean;
  steps: Array<{ id: string; label: string; status: string; detail: string | null }>;
  partialFailureSummary: string | null;
  productDraftResult: { name: string; href: string | null } | null;
  configurableProduct: ConfigurableProductConfirmationCard | null;
  configurableProductResult: ConfigurableProductResultCard | null;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asDisplayText(value: unknown): string | null {
  const text = asText(value);
  if (text) return text;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "boolean" ? String(value) : null;
}

function productDraftUpdateDisplayValue(label: string, value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalizedLabel = label.toLowerCase();
    if (normalizedLabel.includes("square foot")) return `${moneyFromCents(value)} per square foot`;
    if (normalizedLabel.includes("per piece")) return `${moneyFromCents(value)} per piece`;
    if (normalizedLabel.includes("minimum charge")) return moneyFromCents(value);
  }
  return asDisplayText(value);
}

function asTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asText).filter((item): item is string => Boolean(item)).slice(0, 25);
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function getTextFromObject(value: unknown, keys: string[]) {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of keys) {
    const text = asText(record[key]);
    if (text) return text;
  }
  return null;
}

function toAffectedEntities(value: unknown): AssistantPlanCardModel["affectedEntities"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 25).flatMap((item) => {
    const entity = asRecord(item);
    const id = entity ? asText(entity.id) ?? asText(entity.recordId) ?? asText(entity.entityId) : null;
    const type = entity ? asText(entity.type) ?? asText(entity.entityType) : null;
    if (!id || !type) return [];
    const href = asText(entity?.href) ?? asText(entity?.sourceLink && asRecord(entity.sourceLink)?.href);
    return [{
      id,
      type,
      label: asText(entity?.label) ?? `${type} ${id}`,
      href: href?.startsWith("/") ? href : null,
    }];
  });
}

function toSteps(value: unknown): AssistantPlanCardModel["steps"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item, index) => {
    const step = asRecord(item);
    const label = step ? asText(step.label) ?? asText(step.name) ?? asText(step.commandName) : null;
    if (!label) return [];
    return [{
      id: asText(step?.id) ?? `step-${index + 1}`,
      label,
      status: asText(step?.status) ?? "pending",
      detail: asText(step?.detail) ?? asText(step?.summary) ?? asText(step?.error),
    }];
  });
}

function toSideEffects(value: unknown): string[] {
  if (typeof value === "string") return asText(value) ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => {
    const text = asText(item) ?? getTextFromObject(item, ["description", "summary", "label"]);
    return text ? [text] : [];
  }).slice(0, 25);
  const record = asRecord(value);
  return record ? [
    getTextFromObject(record, ["summary", "description"]),
    ...asTextList(record.items),
  ].filter((item): item is string => Boolean(item)).slice(0, 25) : [];
}

function toMissingInformation(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = asText(item);
    if (text) return [text];
    const record = asRecord(item);
    const label = getTextFromObject(record, ["label", "field"]);
    const description = getTextFromObject(record, ["description"]);
    return label ? [`${label}${description ? `: ${description}` : ""}`] : [];
  }).slice(0, 20);
}

function toQuoteInternalNote(action: string | null, preview: UnknownRecord | null): AssistantPlanCardModel["quoteInternalNote"] {
  if (action !== "quotes.add_internal_note" || !preview) return null;
  const nested = asRecord(preview.quoteInternalNote);
  const value = nested ?? preview;
  const sourceLink = asRecord(value.sourceLink);
  const quotePath = asText(value.quotePath) ?? asText(value.quoteLink) ?? asText(asRecord(value.quote)?.href) ?? asText(sourceLink?.href);
  return {
    quoteId: asText(value.quoteId) ?? asText(asRecord(value.quote)?.id),
    quoteNumber: asText(value.quoteNumber) ?? asText(asRecord(value.quote)?.number),
    customerName: asText(value.customerName) ?? asText(asRecord(value.customer)?.name),
    noteText: asText(value.noteText) ?? asText(value.internalNote) ?? asText(value.note),
    quotePath: quotePath?.startsWith("/") ? quotePath : null,
    unchangedItems: asTextList(value.unchangedItems ?? value.unchangedFields ?? value.unchanged),
  };
}

function toProductDraftUpdate(action: string | null, preview: UnknownRecord | null): AssistantPlanCardModel["productDraftUpdate"] {
  if (action !== "products.update_inactive_draft" || !preview) return null;
  const value = asRecord(preview.productInactiveDraftUpdate) ?? asRecord(preview.productDraftUpdate) ?? asRecord(preview.productDraft) ?? preview;
  const changeValues = value.changes ?? value.beforeAfter ?? value.patchChanges ?? value.fieldChanges;
  const changes = Array.isArray(changeValues) ? changeValues.slice(0, 30).flatMap((item) => {
    const change = asRecord(item);
    if (!change) return [];
    const label = asText(change.label) ?? asText(change.field) ?? asText(change.name);
    if (!label) return [];
    const before = productDraftUpdateDisplayValue(label, change.before) ?? productDraftUpdateDisplayValue(label, change.previous) ?? productDraftUpdateDisplayValue(label, change.oldValue);
    const after = productDraftUpdateDisplayValue(label, change.after) ?? productDraftUpdateDisplayValue(label, change.next) ?? productDraftUpdateDisplayValue(label, change.newValue);
    return before || after ? [{ label, before, after }] : [];
  }) : [];
  const editorPath = asText(value.editorPath) ?? asText(value.reviewUrl) ?? asText(value.sourceLink) ?? asText(preview.editorPath);
  return {
    productName: asText(value.productName) ?? asText(value.name),
    draftStatus: asText(value.draftStatus) ?? asText(value.status),
    editorPath: editorPath?.startsWith("/") ? editorPath : null,
    changes,
    validationErrors: asTextList(value.validationErrors ?? value.errors),
    warnings: asTextList(value.warnings ?? value.validationWarnings),
    unchangedAreas: asTextList(value.unchangedAreas ?? value.unchangedFields ?? value.unchanged),
  };
}

function toProductPricingChangeSet(action: string | null, preview: UnknownRecord | null): AssistantPlanCardModel["productPricingChangeSet"] {
  if (action !== "products.adjust_pricing" || !preview) return null;
  const value = asRecord(preview.productPricingChangeSet); if (!value) return null;
  const rows = Array.isArray(value.rows) ? value.rows.slice(0, 100).flatMap((item) => { const row = asRecord(item); const productName = asText(row?.productName); const before = asRecord(row?.before); const after = asRecord(row?.after); return productName && before && after ? [{ productName, active: row?.active === true, before, after }] : []; }) : [];
  const excluded = Array.isArray(value.excluded) ? value.excluded.slice(0, 100).flatMap((item) => { const row = asRecord(item); const productName = asText(row?.productName); const reason = asText(row?.reason); return productName && reason ? [{ productName, reason }] : []; }) : [];
  return { targetCount: asPositiveInteger(value.targetCount) ?? rows.length, eligibleCount: asPositiveInteger(value.eligibleCount) ?? rows.length, rows, excluded };
}

function toCents(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function toProductDraftCreate(action: string | null, preview: UnknownRecord | null): AssistantPlanCardModel["productDraftCreate"] {
  if (action !== "products.create_inactive_draft" || !preview) return null;
  const value = asRecord(preview.productInactiveDraft) ?? asRecord(preview.productDraft) ?? preview;
  const fields = asRecord(value.proposedFields);
  if (!fields) return null;
  return {
    productName: asText(value.productName),
    category: asText(fields.category),
    measurementMode: asText(fields.measurementMode),
    pricingModel: asText(fields.pricingModel),
    perSqftCents: toCents(fields.perSqftCents),
    perPieceCents: toCents(fields.perPieceCents),
    minimumChargeCents: toCents(fields.minimumChargeCents),
    material: asText(fields.material),
    productionRoute: asText(fields.productionRoute),
    sheetOrRollConstraints: asText(fields.sheetOrRollConstraints),
    allowRotation: typeof fields.allowRotation === "boolean" ? fields.allowRotation : null,
    fixedDimensions: asText(fields.fixedDimensions),
    requiresDimensions: typeof fields.requiresDimensions === "boolean" ? fields.requiresDimensions : null,
    quantityBehavior: asText(fields.quantityBehavior),
    commonOptions: asTextList(fields.commonOptions),
    warnings: asTextList(value.warnings),
    status: asText(fields.status),
  };
}

function toOrderCreate(action: string | null, preview: UnknownRecord | null): AssistantPlanCardModel["orderCreate"] {
  if (action !== "orders.create" || !preview) return null;
  const value = asRecord(preview.orderCreate);
  const customer = asRecord(value?.customer);
  const customerName = asText(customer?.name);
  const totalCents = toCents(value?.totalCents);
  if (!value || !customerName || totalCents === null) return null;
  const lines = Array.isArray(value.lines) ? value.lines.slice(0, 25).flatMap((item) => {
    const line = asRecord(item); const productId = asText(line?.productId); const productName = asText(line?.productName); const quantity = asPositiveInteger(line?.quantity); const unitPriceCents = toCents(line?.unitPriceCents); const lineTotalCents = toCents(line?.totalCents); const treeVersionId = asText(line?.pbv2TreeVersionId);
    if (!line || !productId || !productName || !quantity || unitPriceCents === null || lineTotalCents === null || !treeVersionId) return [];
    const dimensionsValue = asRecord(line.dimensions); const widthIn = typeof dimensionsValue?.widthIn === "number" && Number.isFinite(dimensionsValue.widthIn) ? dimensionsValue.widthIn : null; const heightIn = typeof dimensionsValue?.heightIn === "number" && Number.isFinite(dimensionsValue.heightIn) ? dimensionsValue.heightIn : null;
    const selections = Array.isArray(line.selections) ? line.selections.slice(0, 30).flatMap((selection) => { const entry = asRecord(selection); const groupId = asText(entry?.groupId); const groupLabel = asText(entry?.groupLabel); const valueId = asText(entry?.valueId); const valueLabel = asText(entry?.valueLabel); const source: "explicit" | "default_accepted" | "system" = entry?.source === "explicit" || entry?.source === "default_accepted" ? entry.source : "system"; return groupId && groupLabel && valueId && valueLabel ? [{ groupId, groupLabel, valueId, valueLabel, source }] : []; }) : [];
    return [{ productId, productName, quantity, measurementMode: asText(line.measurementMode), dimensions: widthIn === null || heightIn === null ? null : { widthIn, heightIn, unit: asText(dimensionsValue?.unit) ?? "in" }, pbv2TreeVersionId: treeVersionId, selections, unitPriceCents, totalCents: lineTotalCents, minimumChargeApplied: line.minimumChargeApplied === true, warnings: asTextList(line.warnings) }];
  }) : [];
  return { customerName, contactName: asText(customer?.contactName), orderStatus: asText(value.orderStatus) ?? "new", productionDeferred: value.productionDeferred === true, totalCents, warnings: asTextList(value.warnings), lines };
}

export type AssistantQuoteNoteProposal = {
  turnId: string;
  title: string;
  summary: string | null;
  quoteInternalNote: NonNullable<AssistantPlanCardModel["quoteInternalNote"]>;
};

export type AssistantProductDraftProposal = {
  turnId: string;
  title: string;
  summary: string | null;
  action: "products.create_inactive_draft" | "products.update_inactive_draft";
};

export type AssistantProductPricingProposal = {
  turnId: string;
  title: string;
  summary: string | null;
  rollback: boolean;
};

export function toAssistantProductPricingProposal(card: unknown): AssistantProductPricingProposal | null {
  const record = asRecord(card);
  if (!record || asText(record.kind) !== "action_proposal") return null;
  const proposal = asRecord(record.proposal) ?? asRecord(record.plan) ?? record;
  const action = asText(proposal.action);
  if (action !== "products.adjust_pricing" && action !== "products.rollback_pricing_change_set") return null;
  const turnId = asText(proposal.turnId) ?? asText(record.turnId);
  return turnId && asText(proposal.changeSetId) && asText(proposal.fingerprint)
    ? { turnId, title: asText(record.title) ?? (action === "products.rollback_pricing_change_set" ? "Roll back product pricing" : "Adjust product pricing"), summary: asText(record.summary), rollback: action === "products.rollback_pricing_change_set" }
    : null;
}

function toProductPricingRollback(action: string | null, preview: UnknownRecord | null): AssistantPlanCardModel["productPricingRollback"] {
  if (action !== "products.rollback_pricing_change_set" || !preview) return null;
  const value = asRecord(preview.productPricingRollback); if (!value) return null;
  const changeSetId = asText(value.changeSetId); const requestSummary = asText(value.requestSummary);
  const rows = Array.isArray(value.rows) ? value.rows.slice(0, 100).flatMap((item) => { const row = asRecord(item); const productName = asText(row?.productName); const before = asRecord(row?.before); const current = asRecord(row?.current); const restore = asRecord(row?.proposedRestore); return productName && before && current && restore ? [{ productName, before, current, restore, reason: asText(row?.reason) }] : []; }) : [];
  if (!changeSetId || !requestSummary || !rows.length) return null;
  return { changeSetId, requestSummary, targetCount: asPositiveInteger(value.targetCount) ?? rows.length, eligibleCount: asPositiveInteger(value.eligibleCount) ?? rows.length, rows };
}

export type AssistantQuoteDraftProposal = {
  turnId: string;
  title: string;
  summary: string | null;
  action: "quotes.create_draft" | "quotes.update_draft";
};

export function toAssistantQuoteDraftProposal(card: unknown): AssistantQuoteDraftProposal | null {
  const record = asRecord(card);
  if (!record || asText(record.kind) !== "action_proposal") return null;
  const proposal = asRecord(record.proposal) ?? asRecord(record.plan) ?? record;
  const action = asText(proposal.action);
  if (action !== "quotes.create_draft" && action !== "quotes.update_draft") return null;
  const turnId = asText(proposal.turnId) ?? asText(record.turnId);
  const bound = action === "quotes.create_draft"
    ? Boolean(asText(proposal.quoteIntakeSessionId) && asText(proposal.proposalFingerprint))
    : Boolean(asText(proposal.quoteId) && asText(proposal.quoteIntakeSessionId) && asText(proposal.proposalFingerprint) && asText(proposal.expectedQuoteFingerprint));
  return turnId && bound ? { turnId, title: asText(record.title) ?? (action === "quotes.create_draft" ? "Create draft quote" : "Update draft quote"), summary: asText(record.summary), action } : null;
}

/** A product proposal carries only opaque, server-produced session references.
 * The browser still submits just the turn id when requesting a plan. */
export function toAssistantProductDraftProposal(card: unknown): AssistantProductDraftProposal | null {
  const record = asRecord(card);
  if (!record || asText(record.kind) !== "action_proposal") return null;
  const proposal = asRecord(record.proposal) ?? asRecord(record.plan) ?? record;
  const action = asText(proposal.action);
  if (action !== "products.create_inactive_draft" && action !== "products.update_inactive_draft") return null;
  const turnId = asText(proposal.turnId) ?? asText(record.turnId);
  const hasBoundReference = action === "products.create_inactive_draft"
    ? Boolean(asText(proposal.intakeSessionId) && asText(proposal.proposalFingerprint))
    : Boolean((asText(proposal.intakeSessionId) || asText(proposal.draftReference) || asText(proposal.productDraftId)) && asText(proposal.proposalFingerprint));
  if (!turnId || !hasBoundReference) return null;
  return { turnId, title: asText(record.title) ?? (action === "products.update_inactive_draft" ? "Update inactive product draft" : "Create inactive product draft"), summary: asText(record.summary), action };
}

/** A proposal is display-only until the browser asks the server to create a plan. */
export function toAssistantQuoteNoteProposal(card: unknown): AssistantQuoteNoteProposal | null {
  const record = asRecord(card);
  if (!record || asText(record.kind) !== "action_proposal") return null;
  const proposal = asRecord(record.proposal) ?? asRecord(record.plan) ?? record;
  const action = asText(proposal.action) ?? asText(proposal.normalizedAction);
  const turnId = asText(proposal.turnId) ?? asText(record.turnId);
  const preview = asRecord(proposal.preview) ?? asRecord(record.preview);
  const quoteInternalNote = toQuoteInternalNote(action, preview);
  if (!turnId || !quoteInternalNote?.noteText) return null;
  return {
    turnId,
    title: asText(record.title) ?? "Proposed internal quote note",
    summary: asText(record.summary) ?? getTextFromObject(preview, ["summary", "description"]),
    quoteInternalNote,
  };
}

/** Converts only known presentation-safe fields from a persisted card. */
export function toAssistantPlanCardModel(card: unknown): AssistantPlanCardModel | null {
  const cardRecord = asRecord(card);
  const kind = asText(cardRecord?.kind);
  if (!cardRecord || !kind || !["action_plan", "missing_information", "execution_progress", "execution_result"].includes(kind)) return null;
  const plan = asRecord(cardRecord.plan) ?? cardRecord;
  const id = asText(plan.id) ?? asText(plan.planId);
  if (!id) return null;
  const previewRecord = asRecord(plan.preview) ?? asRecord(cardRecord.preview);
  const context = asRecord(plan.contextBinding) ?? asRecord(plan.contextSnapshot) ?? asRecord(cardRecord.contextBinding);
  const missing = toMissingInformation(plan.missingInformation ?? cardRecord.missingInformation ?? cardRecord.missingFields);
  const undo = asRecord(previewRecord?.undo);
  const action = asText(plan.action) ?? asText(plan.normalizedAction) ?? asText(cardRecord.action);
  const confirmation = asRecord(plan.confirmation) ?? asRecord(cardRecord.confirmation);
  const productDraft = asRecord(asRecord(plan.executionResult)?.details)?.productDraft;
  const productDraftRecord = asRecord(productDraft);
  const executionDetails = asRecord(asRecord(plan.executionResult)?.details);
  return {
    id,
    title: asText(cardRecord.title) ?? asText(plan.title) ?? "Proposed action",
    action,
    status: asText(plan.status) ?? asText(cardRecord.status) ?? "preview_ready",
    planVersion: asPositiveInteger(plan.planVersion) ?? asPositiveInteger(plan.version),
    riskLevel: asText(plan.riskLevel) ?? asText(cardRecord.riskLevel) ?? "unknown",
    confirmationAvailable: plan.confirmationAvailable === true || cardRecord.confirmationAvailable === true,
    // A token is never rendered. It is used only as an opaque, server-issued
    // credential by the dedicated confirmation request.
    confirmationToken: asText(plan.confirmationToken) ?? asText(cardRecord.confirmationToken) ?? asText(confirmation?.token),
    preview: asText(plan.preview) ?? asText(cardRecord.preview) ?? getTextFromObject(previewRecord, ["summary", "description", "title"]),
    quoteInternalNote: toQuoteInternalNote(action, previewRecord),
    productDraftCreate: toProductDraftCreate(action, previewRecord),
    orderCreate: toOrderCreate(action, previewRecord),
    productDraftUpdate: toProductDraftUpdate(action, previewRecord),
    productPricingChangeSet: toProductPricingChangeSet(action, previewRecord),
    productPricingRollback: toProductPricingRollback(action, previewRecord),
    affectedEntities: toAffectedEntities(plan.affectedEntities ?? plan.affectedRecords ?? previewRecord?.affectedEntities ?? cardRecord.affectedEntities),
    sideEffects: toSideEffects(plan.sideEffects ?? previewRecord?.sideEffects ?? cardRecord.sideEffects),
    missingInformation: missing,
    undo: undo ? { available: undo.available === true, label: asText(undo.label), expiresAt: asText(undo.expiresAt) } : null,
    expiresAt: asText(plan.expiresAt) ?? asText(cardRecord.expiresAt),
    staleReason: asText(plan.staleReason) ?? asText(cardRecord.staleReason),
    contextBinding: {
      route: asText(context?.route),
      entityType: asText(context?.entityType),
      entityId: asText(context?.entityId),
    },
    // This is intentionally server-provided. The UI never infers that a plan
    // can be cancelled or, critically, that it can execute.
    canCancel: plan.canCancel === true || plan.cancellationAvailable === true || cardRecord.cancellationAvailable === true,
    steps: toSteps(plan.steps ?? cardRecord.steps ?? cardRecord.executionSteps),
    partialFailureSummary: asText(plan.partialFailureSummary) ?? asText(plan.failureSummary) ?? asText(cardRecord.partialFailureSummary) ?? asText(cardRecord.failureSummary),
    productDraftResult: productDraftRecord ? { name: asText(productDraftRecord.name) ?? "Inactive product draft", href: (() => { const href = asText(productDraftRecord.sourceLink) ?? asText(productDraftRecord.editorPath) ?? asText(productDraftRecord.reviewUrl); return href?.startsWith("/") ? href : null; })() } : null,
    configurableProduct: action === "products.create_configurable_draft" ? toConfigurableProductConfirmation(previewRecord?.configurableProduct) : null,
    configurableProductResult: toConfigurableProductResult(executionDetails?.configurableProduct),
  };
}

/** A local visual warning only; the server remains authoritative for invalidation. */
export function isPlanStaleForContext(plan: AssistantPlanCardModel, context: AssistantContextEnvelope) {
  const binding = plan.contextBinding;
  return Boolean(
    (binding.route && binding.route !== context.route)
    || (binding.entityType && binding.entityType !== context.entityType)
    || (binding.entityId && binding.entityId !== context.entityId),
  );
}

export function getPlanExpirationText(expiresAt: string | null, now = Date.now()) {
  if (!expiresAt) return "No expiration supplied";
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return "Expiration unavailable";
  const remaining = expiry - now;
  if (remaining <= 0) return "Expired";
  const minutes = Math.ceil(remaining / 60_000);
  return minutes === 1 ? "Expires in 1 minute" : `Expires in ${minutes} minutes`;
}

function RiskIndicator({ level }: { level: string }) {
  const normalized = level.toLowerCase();
  const Icon = normalized === "high" || normalized === "critical" ? ShieldAlert : normalized === "low" ? CheckCircle2 : AlertTriangle;
  return <span className="inline-flex items-center gap-1 font-medium" aria-label={`Risk level: ${level}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />Risk: {level}</span>;
}

function PlanExpiration({ expiresAt }: { expiresAt: string | null }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="inline-flex items-center gap-1" role="status"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{getPlanExpirationText(expiresAt, now)}</span>;
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "partially_failed", "cancelled", "expired", "invalidated"]);

function QuoteInternalNotePreview({ note }: { note: NonNullable<AssistantPlanCardModel["quoteInternalNote"]> }) {
  return <div className="mt-3 rounded border border-primary/20 bg-primary/5 p-3">
    <p className="font-semibold">Internal quote note</p>
    <p className="mt-1 text-muted-foreground">Internal staff only. It will not be shown to the customer.</p>
    <dl className="mt-2 grid gap-1">
      {note.quoteNumber ? <div><dt className="inline font-medium">Quote: </dt><dd className="inline">{note.quotePath ? <a className="text-primary underline-offset-2 hover:underline" href={note.quotePath}>{note.quoteNumber}</a> : note.quoteNumber}</dd></div> : null}
      {note.customerName ? <div><dt className="inline font-medium">Customer: </dt><dd className="inline">{note.customerName}</dd></div> : null}
    </dl>
    <p className="mt-3 font-medium">Exact internal note</p>
    <blockquote className="mt-1 whitespace-pre-wrap rounded border bg-background p-2 text-foreground">{note.noteText || "Note text is unavailable; do not confirm this plan."}</blockquote>
    <p className="mt-3 font-medium">Will not change</p>
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
      {(note.unchangedItems.length ? note.unchangedItems : ["Pricing", "Quote status", "Customer-facing notes", "Order state", "Production", "Invoice", "Payment"]).map((item) => <li key={item}>{item}</li>)}
    </ul>
  </div>;
}

function ProductDraftUpdatePreview({ update }: { update: NonNullable<AssistantPlanCardModel["productDraftUpdate"]> }) {
  return <div className="mt-3 rounded border border-primary/20 bg-primary/5 p-3">
    <p className="font-semibold">Inactive draft update</p>
    <p className="mt-1 text-muted-foreground">This is an exact before-and-after preview. It cannot activate or publish the product.</p>
    {update.productName || update.draftStatus ? <p className="mt-2">{update.productName ? <><span className="font-medium">Draft: </span>{update.editorPath ? <a className="text-primary underline-offset-2 hover:underline" href={update.editorPath}>{update.productName}</a> : update.productName}</> : null}{update.draftStatus ? <span className="text-muted-foreground"> · {update.draftStatus}</span> : null}</p> : null}
    {update.changes.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[28rem] border-collapse text-left"><thead className="text-muted-foreground"><tr><th className="border-b p-1 font-medium">Field</th><th className="border-b p-1 font-medium">Before</th><th className="border-b p-1 font-medium">After</th></tr></thead><tbody>{update.changes.map((change) => <tr key={`${change.label}-${change.before}-${change.after}`}><th className="border-b p-1 align-top font-medium">{change.label}</th><td className="border-b p-1 align-top">{change.before ?? "Unchanged / not set"}</td><td className="border-b p-1 align-top">{change.after ?? "Cleared"}</td></tr>)}</tbody></table></div> : null}
    {update.validationErrors.length ? <div className="mt-3 rounded border border-destructive/30 bg-destructive/5 p-2"><p className="font-medium">Validation errors</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{update.validationErrors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
    {update.warnings.length ? <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2"><p className="font-medium">Warnings</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{update.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
    {update.unchangedAreas.length ? <div className="mt-3"><p className="font-medium">Explicitly unchanged</p><ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">{update.unchangedAreas.map((area) => <li key={area}>{area}</li>)}</ul></div> : null}
  </div>;
}

function ProductPricingChangeSetPreview({ changeSet }: { changeSet: NonNullable<AssistantPlanCardModel["productPricingChangeSet"]> }) {
  const price = (values: UnknownRecord) => Object.entries(values).map(([key, value]) => `${key}: ${typeof value === "number" ? moneyFromCents(value) : String(value)}`).join(", ");
  return <div className="mt-3 rounded border border-primary/20 bg-primary/5 p-3"><p className="font-semibold">Product pricing change set</p><p className="mt-1 text-muted-foreground">Exact target IDs and scalar values were persisted before confirmation. Product lifecycle, publication, visibility, routing, options, and historical snapshots remain unchanged.</p><p className="mt-2"><span className="font-medium">Targets: </span>{changeSet.eligibleCount} eligible of {changeSet.targetCount}</p><details className="mt-2"><summary className="cursor-pointer font-medium">Exact product list ({changeSet.rows.length})</summary><ul className="mt-1 list-disc pl-4">{changeSet.rows.map((row) => <li key={row.productName}>{row.productName} ({row.active ? "active" : "inactive"}): {price(row.before)} → {price(row.after)}</li>)}</ul></details>{changeSet.excluded.length ? <p className="mt-2 text-muted-foreground">Excluded: {changeSet.excluded.map((row) => `${row.productName} (${row.reason})`).join("; ")}</p> : null}</div>;
}

function OrderCreatePreview({ order }: { order: NonNullable<AssistantPlanCardModel["orderCreate"]> }) {
  return <div className="mt-3 rounded border border-primary/20 bg-primary/5 p-3">
    <p className="font-medium">Order to create</p>
    <dl className="mt-1 grid gap-1 sm:grid-cols-2"><div><dt className="inline font-medium">Customer: </dt><dd className="inline">{order.customerName}</dd></div>{order.contactName ? <div><dt className="inline font-medium">Contact: </dt><dd className="inline">{order.contactName}</dd></div> : null}<div><dt className="inline font-medium">Status: </dt><dd className="inline">{order.orderStatus}</dd></div><div><dt className="inline font-medium">Order total: </dt><dd className="inline">{moneyFromCents(order.totalCents)}</dd></div></dl>
    {order.productionDeferred ? <p className="mt-2 text-muted-foreground">Production is deferred. This plan will not schedule production, reserve inventory, create fulfillment, invoice, or payment records.</p> : null}
    <div className="mt-3 space-y-3">{order.lines.map((line) => <div key={`${line.productId}-${line.pbv2TreeVersionId}`} className="rounded border border-border/70 bg-background/70 p-2"><p className="font-medium">{line.productName}</p><dl className="mt-1 grid gap-1 sm:grid-cols-2"><div><dt className="inline font-medium">Quantity: </dt><dd className="inline">{line.quantity}</dd></div>{line.dimensions ? <div><dt className="inline font-medium">Size: </dt><dd className="inline">{line.dimensions.widthIn} × {line.dimensions.heightIn} {line.dimensions.unit}</dd></div> : null}{line.measurementMode ? <div><dt className="inline font-medium">Measurement: </dt><dd className="inline">{line.measurementMode.replaceAll("_", " ")}</dd></div> : null}<div><dt className="inline font-medium">Unit price: </dt><dd className="inline">{moneyFromCents(line.unitPriceCents)}</dd></div><div><dt className="inline font-medium">Line total: </dt><dd className="inline">{moneyFromCents(line.totalCents)}</dd></div>{line.minimumChargeApplied ? <div><dt className="inline font-medium">Minimum charge: </dt><dd className="inline">Applied</dd></div> : null}</dl>{line.selections.length ? <dl className="mt-2 grid gap-1 sm:grid-cols-2">{line.selections.map((selection) => <div key={`${selection.groupId}-${selection.valueId}`}><dt className="inline font-medium">{selection.groupLabel}: </dt><dd className="inline">{selection.valueLabel}{selection.source === "default_accepted" ? " (default accepted)" : null}</dd></div>)}</dl> : null}<p className="mt-2 text-muted-foreground">PBV2 snapshot: {line.pbv2TreeVersionId}</p>{line.warnings.length ? <ul className="mt-2 list-disc pl-4 text-amber-700 dark:text-amber-300">{line.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</div>)}</div>
    {order.warnings.length ? <ul className="mt-2 list-disc pl-4 text-amber-700 dark:text-amber-300">{order.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
  </div>;
}

function moneyFromCents(value: number | null): string {
  return value == null ? "Not set" : `$${(value / 100).toFixed(2)}`;
}

function ProductDraftCreatePreview({ draft }: { draft: NonNullable<AssistantPlanCardModel["productDraftCreate"]> }) {
  const fields = [
    ["Name", draft.productName],
    ["Category", draft.category],
    ["Measurement", draft.measurementMode],
    ["Fixed dimensions", draft.fixedDimensions],
    ["Requires dimensions", draft.requiresDimensions == null ? null : draft.requiresDimensions ? "Yes" : "No"],
    ["Pricing model", draft.pricingModel],
    ["Square-foot price", moneyFromCents(draft.perSqftCents)],
    ["Per-piece price", moneyFromCents(draft.perPieceCents)],
    ["Minimum charge", moneyFromCents(draft.minimumChargeCents)],
    ["Material", draft.material],
    ["Route", draft.productionRoute],
    ["Sheet / roll constraints", draft.sheetOrRollConstraints],
    ["Allow rotation", draft.allowRotation == null ? null : draft.allowRotation ? "Allowed" : "Not allowed"],
    ["Quantity behavior", draft.quantityBehavior],
    ["Status", draft.status === "inactive_draft" ? "Inactive draft" : draft.status],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1]));
  return <div className="mt-3 rounded border border-primary/20 bg-primary/5 p-3">
    <p className="font-semibold">Inactive product draft to create</p>
    <p className="mt-1 text-muted-foreground">These server-derived fields will create one inactive product and PBV2 DRAFT only.</p>
    <dl className="mt-2 grid gap-1 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="inline font-medium">{label}: </dt><dd className="inline">{value}</dd></div>)}</dl>
    {draft.commonOptions.length ? <p className="mt-2"><span className="font-medium">Options: </span>{draft.commonOptions.join(", ")}</p> : null}
    {draft.warnings.length ? <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2"><p className="font-medium">Review warnings</p><ul className="mt-1 list-disc pl-4">{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
  </div>;
}

export function AssistantQuoteNoteProposalCard({
  proposal,
  onCreatePlan,
  creating,
}: {
  proposal: AssistantQuoteNoteProposal;
  onCreatePlan: (turnId: string) => Promise<unknown> | void;
  creating?: boolean;
}) {
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Quote note proposal: ${proposal.title}`}>
    <p className="font-semibold">{proposal.title}</p>
    {proposal.summary ? <p className="mt-1 text-muted-foreground">{proposal.summary}</p> : null}
    <QuoteInternalNotePreview note={proposal.quoteInternalNote} />
    <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">Review this proposed internal-only note before creating a confirmation plan. Sending “GO” in chat does not confirm it.</p>
    <div className="mt-2"><Button type="button" size="sm" disabled={creating} onClick={() => void onCreatePlan(proposal.turnId)}>{creating ? "Preparing plan…" : "Review internal-note plan"}</Button></div>
  </section>;
}

export function AssistantProductDraftProposalCard({ proposal, onCreatePlan, creating }: { proposal: AssistantProductDraftProposal; onCreatePlan: (turnId: string) => Promise<unknown> | void; creating?: boolean }) {
  const updating = proposal.action === "products.update_inactive_draft";
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Product draft proposal: ${proposal.title}`}>
    <p className="font-semibold">{proposal.title}</p>
    {proposal.summary ? <p className="mt-1 text-muted-foreground">{proposal.summary}</p> : null}
    <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">This prepares one inactive product draft only. Activation, publication, active-product edits, inventory, quotes, orders, and production jobs are excluded. Sending “GO” in chat does not confirm it.</p>
    <div className="mt-2"><Button type="button" size="sm" disabled={creating} onClick={() => void onCreatePlan(proposal.turnId)}>{creating ? "Preparing plan…" : updating ? "Review draft-update plan" : "Review inactive-draft plan"}</Button></div>
  </section>;
}

function ProductPricingRollbackPreview({ rollback }: { rollback: NonNullable<AssistantPlanCardModel["productPricingRollback"]> }) {
  const price = (values: UnknownRecord) => Object.entries(values).map(([key, value]) => `${key}: ${typeof value === "number" ? moneyFromCents(value) : String(value)}`).join(", ");
  return <div className="mt-3 rounded border border-primary/20 bg-primary/5 p-3"><p className="font-semibold">Pricing rollback</p><p className="mt-1 text-muted-foreground">Restores only still-matching scalar fields from {rollback.changeSetId}. Later edits are conflicts and will not be overwritten.</p><p className="mt-2"><span className="font-medium">Original request: </span>{rollback.requestSummary}</p><p className="mt-1"><span className="font-medium">Eligible: </span>{rollback.eligibleCount} of {rollback.targetCount}</p><details className="mt-2"><summary className="cursor-pointer font-medium">Exact restoration values ({rollback.rows.length})</summary><ul className="mt-1 list-disc pl-4">{rollback.rows.map((row) => <li key={row.productName}>{row.productName}: {price(row.current)} → {price(row.restore)}{row.reason ? ` (${row.reason})` : ""}</li>)}</ul></details></div>;
}

export function AssistantProductPricingProposalCard({ proposal, onCreatePlan, creating }: { proposal: AssistantProductPricingProposal; onCreatePlan: (turnId: string) => Promise<unknown> | void; creating?: boolean }) {
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Product pricing proposal: ${proposal.title}`}>
    <p className="font-semibold">{proposal.title}</p>
    {proposal.summary ? <p className="mt-1 text-muted-foreground">{proposal.summary}</p> : null}
    <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">{proposal.rollback ? "This prepares an exact rollback plan. Later price edits are conflicts and will not be overwritten." : "This prepares an exact, persisted scalar-pricing plan."} It cannot change product lifecycle, publication, visibility, routing, options, or historical transactions. Sending “GO” in chat does not confirm it.</p>
    <div className="mt-2"><Button type="button" size="sm" disabled={creating} onClick={() => void onCreatePlan(proposal.turnId)}>{creating ? "Preparing plan…" : proposal.rollback ? "Review rollback plan" : "Review pricing plan"}</Button></div>
  </section>;
}

export function AssistantQuoteDraftProposalCard({ proposal, onCreatePlan, creating }: { proposal: AssistantQuoteDraftProposal; onCreatePlan: (turnId: string) => Promise<unknown> | void; creating?: boolean }) {
  const updating = proposal.action === "quotes.update_draft";
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Quote draft proposal: ${proposal.title}`}>
    <p className="font-semibold">{proposal.title}</p>
    {proposal.summary ? <p className="mt-1 text-muted-foreground">{proposal.summary}</p> : null}
    <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">The server will revalidate customer, product, PBV2 pricing, taxes, and editable draft state before the dedicated GO confirmation. This cannot send, accept, convert, schedule, reserve inventory, invoice, or email.</p>
    <div className="mt-2"><Button type="button" size="sm" disabled={creating} onClick={() => void onCreatePlan(proposal.turnId)}>{creating ? "Preparing plan…" : updating ? "Review draft-update plan" : "Review draft quote plan"}</Button></div>
  </section>;
}

export function AssistantPlanCard({
  card,
  context,
  onCancel,
  onConfirm,
  cancelling,
  confirming,
  allowGenericConfirmation = false,
  genericActionLabel,
  confirmationError,
}: {
  card: unknown;
  context: AssistantContextEnvelope;
  onCancel?: (planId: string, expectedPlanVersion: number) => Promise<unknown> | void;
  onConfirm?: (input: { planId: string; expectedPlanVersion: number; confirmationToken: string; context: AssistantContextEnvelope }) => Promise<unknown> | void;
  cancelling?: boolean;
  confirming?: boolean;
  /** Only the turn-bound generic proposal adapter may opt into this path. */
  allowGenericConfirmation?: boolean;
  genericActionLabel?: string;
  confirmationError?: string | null;
}) {
  const plan = toAssistantPlanCardModel(card);
  if (!plan) return null;
  const staleForContext = isPlanStaleForContext(plan, context);
  const canCancel = Boolean(onCancel && plan.planVersion && plan.canCancel && !TERMINAL_STATUSES.has(plan.status));
  const isProductDraft = plan.action === "products.create_inactive_draft" || plan.action === "products.update_inactive_draft";
  const isProductDraftUpdate = plan.action === "products.update_inactive_draft";
  const isProductPricingChangeSet = plan.action === "products.adjust_pricing";
  const isProductPricingRollback = plan.action === "products.rollback_pricing_change_set";
  const isConfigurableProduct = plan.action === "products.create_configurable_draft";
  const isQuoteDraft = plan.action === "quotes.create_draft" || plan.action === "quotes.update_draft";
  const isQuoteDraftUpdate = plan.action === "quotes.update_draft";
  const genericPlan = allowGenericConfirmation && !plan.quoteInternalNote && !isConfigurableProduct && !isProductPricingRollback && !isProductPricingChangeSet && !isQuoteDraft && !isProductDraft;
  const hasConfirmableDraft = Boolean(plan.quoteInternalNote?.noteText || (isQuoteDraft && plan.preview && plan.missingInformation.length === 0 && !plan.partialFailureSummary) || (isProductDraft && plan.preview && plan.missingInformation.length === 0 && !plan.partialFailureSummary && (!isProductDraftUpdate || Boolean(plan.productDraftUpdate && plan.productDraftUpdate.changes.length > 0 && plan.productDraftUpdate.validationErrors.length === 0))) || (isConfigurableProduct && plan.configurableProduct?.ready && plan.missingInformation.length === 0 && !plan.partialFailureSummary) || (isProductPricingChangeSet && plan.preview && plan.missingInformation.length === 0 && !plan.partialFailureSummary && Boolean(plan.productPricingChangeSet?.rows.length)) || (isProductPricingRollback && plan.preview && plan.missingInformation.length === 0 && !plan.partialFailureSummary && Boolean(plan.productPricingRollback?.rows.length)) || (allowGenericConfirmation && plan.preview && plan.missingInformation.length === 0 && !plan.partialFailureSummary));
  const canConfirm = Boolean(
    onConfirm
    && !genericPlan
    && hasConfirmableDraft
    && plan.planVersion
    && plan.confirmationAvailable
    && plan.confirmationToken
    && plan.status === "awaiting_confirmation"
    && !staleForContext
    && !plan.staleReason,
  );
  const cancel = () => {
    if (onCancel && plan.planVersion) void onCancel(plan.id, plan.planVersion);
  };
  const confirm = () => {
    if (onConfirm && plan.planVersion && plan.confirmationToken) {
      void onConfirm({ planId: plan.id, expectedPlanVersion: plan.planVersion, confirmationToken: plan.confirmationToken, context });
    }
  };
  const actionLabel = plan.quoteInternalNote ? "Add internal quote note" : isConfigurableProduct ? "Create configurable inactive product draft" : isProductPricingRollback ? "Roll back product pricing" : isProductPricingChangeSet ? "Adjust product pricing" : isQuoteDraftUpdate ? "Update draft quote" : isQuoteDraft ? "Create draft quote" : isProductDraftUpdate ? "Update inactive product draft" : isProductDraft ? "Create inactive product draft" : genericActionLabel ?? "Proposed action";
  const canConfirmGeneric = Boolean(onConfirm && genericPlan && plan.planVersion && plan.confirmationAvailable && plan.confirmationToken && plan.status === "awaiting_confirmation" && !staleForContext && !plan.staleReason);
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Execution plan: ${plan.title}`}>
    <div className="flex items-start justify-between gap-3">
      <div><p className="font-semibold">{plan.title}</p>{plan.action ? <p className="mt-0.5 text-muted-foreground">Action: {actionLabel}</p> : null}</div>
      <RiskIndicator level={plan.riskLevel} />
    </div>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground"><span>Status: {plan.status}</span><PlanExpiration expiresAt={plan.expiresAt} /></div>
    {plan.preview ? <p className="mt-2">{plan.preview}</p> : null}
    {plan.quoteInternalNote ? <QuoteInternalNotePreview note={plan.quoteInternalNote} /> : null}
    {plan.orderCreate ? <OrderCreatePreview order={plan.orderCreate} /> : null}
    {plan.productDraftCreate ? <ProductDraftCreatePreview draft={plan.productDraftCreate} /> : null}
    {plan.productDraftUpdate ? <ProductDraftUpdatePreview update={plan.productDraftUpdate} /> : null}
    {plan.productPricingChangeSet ? <ProductPricingChangeSetPreview changeSet={plan.productPricingChangeSet} /> : null}
    {plan.productPricingRollback ? <ProductPricingRollbackPreview rollback={plan.productPricingRollback} /> : null}
    {plan.configurableProduct ? <ConfigurableProductConfirmationCardView confirmation={plan.configurableProduct} /> : null}
    {plan.configurableProductResult ? <ConfigurableProductResultCardView result={plan.configurableProductResult} /> : null}
    {genericPlan && plan.status === "succeeded" ? <p className="mt-3 flex items-center gap-1 rounded border border-primary/25 bg-primary/5 p-2 font-medium" role="status"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Action completed successfully.</p> : null}
    {plan.quoteInternalNote && plan.status === "succeeded" ? <p className="mt-3 flex items-center gap-1 rounded border border-primary/25 bg-primary/5 p-2 font-medium" role="status"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Internal note added to {plan.quoteInternalNote.quotePath && plan.quoteInternalNote.quoteNumber ? <a className="text-primary underline-offset-2 hover:underline" href={plan.quoteInternalNote.quotePath}>Quote {plan.quoteInternalNote.quoteNumber}</a> : (plan.quoteInternalNote.quoteNumber ? `Quote ${plan.quoteInternalNote.quoteNumber}` : "the quote")}.</p> : null}
    {isProductDraft && plan.status === "succeeded" ? <p className="mt-3 flex items-center gap-1 rounded border border-primary/25 bg-primary/5 p-2 font-medium" role="status"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Inactive product draft {isProductDraftUpdate ? "updated" : "created"}. {plan.productDraftResult?.href ? <a className="text-primary underline-offset-2 hover:underline" href={plan.productDraftResult.href}>Open {plan.productDraftResult.name} in the existing editor</a> : "Activation and publication remain unavailable in the assistant."}</p> : null}
    {staleForContext || plan.staleReason ? <p className="mt-2 flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-foreground"><CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{plan.staleReason || "This preview is stale for the page you are viewing. The server must revalidate it before any future action."}</p> : null}
    {plan.missingInformation.length ? <div className="mt-2"><p className="font-medium">Information still needed</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{plan.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.affectedEntities.length ? <div className="mt-2"><p className="font-medium">Affected records</p><ul className="mt-1 space-y-1">{plan.affectedEntities.map((entity) => <li key={`${entity.type}-${entity.id}`}>{entity.href ? <a className="text-primary underline-offset-2 hover:underline" href={entity.href}>{entity.label}</a> : entity.label} <span className="text-muted-foreground">({entity.type})</span></li>)}</ul></div> : null}
    {plan.sideEffects.length ? <div className="mt-2"><p className="font-medium">Expected effects</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{plan.sideEffects.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.undo ? <p className="mt-2 text-muted-foreground">Undo: {plan.undo.available ? (plan.undo.label || "May be available after execution") : "Not available for this plan"}{plan.undo.expiresAt ? ` (until ${new Date(plan.undo.expiresAt).toLocaleString()})` : ""}</p> : null}
    {plan.steps.length ? <div className="mt-2"><p className="flex items-center gap-1 font-medium"><ListChecks className="h-3.5 w-3.5" aria-hidden="true" />Execution status</p><ul className="mt-1 space-y-1">{plan.steps.map((step) => <li key={step.id}><span className="font-medium">{step.label}</span>: {step.status}{step.detail ? ` — ${step.detail}` : ""}</li>)}</ul></div> : null}
    {plan.partialFailureSummary ? <p className="mt-2 flex items-center gap-1 rounded border border-destructive/30 bg-destructive/5 p-2"><XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{plan.status === "partially_failed" ? "Partial failure" : "Execution issue"}: {plan.partialFailureSummary}</p> : null}
    {plan.quoteInternalNote ? <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">This plan adds one internal-only quote note. It does not make any customer-facing or operational change.</p> : isConfigurableProduct ? <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">This plan creates exactly one inactive, unpublished product with a PBV2 DRAFT tree. It cannot activate, publish, or make the product live-quotable.</p> : isProductPricingRollback ? <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">The rollback restores only exact scalar fields that have not been changed since the original execution. It cannot alter lifecycle, publication, visibility, or historical transactions.</p> : isProductPricingChangeSet ? <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">Effective immediately for future pricing calculations only. The exact persisted rows can be rolled back later if their values remain unchanged.</p> : isQuoteDraft ? <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">This plan {isQuoteDraftUpdate ? "updates" : "creates"} exactly one internal draft quote. It cannot send, accept, convert, schedule production, reserve inventory, invoice, collect payment, fulfill, or email.</p> : isProductDraft ? <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">This plan {isProductDraftUpdate ? "updates" : "creates"} one inactive product draft only. It cannot activate, publish, or modify an active product.</p> : genericPlan ? <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">The server binds this plan to its proposal, tenant, actor, fingerprint, confirmation token, revalidation, and idempotency record.</p> : <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">Preview only. Production business write commands are not enabled, and this workspace does not provide a GO or execute control.</p>}
    {isProductDraftUpdate && plan.productDraftUpdate?.validationErrors.length ? <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2" role="status">Resolve validation errors before this draft update can be confirmed.</p> : null}
    {confirmationError ? <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2" role="alert">Confirmation was not completed: {confirmationError}</p> : null}
    {canConfirmGeneric ? <div className="mt-2"><Button type="button" size="sm" disabled={confirming} onClick={confirm} aria-label={`GO: ${actionLabel}`}>{confirming ? "Confirming…" : `GO — ${actionLabel}`}</Button></div> : null}
    {canConfirm ? <div className="mt-2"><Button type="button" size="sm" disabled={confirming} onClick={confirm} aria-label={isConfigurableProduct ? "GO: create configurable inactive product draft" : isProductPricingRollback ? "GO: roll back product pricing" : isProductPricingChangeSet ? "GO: adjust product pricing" : isQuoteDraftUpdate ? "GO: update draft quote" : isQuoteDraft ? "GO: create draft quote" : isProductDraftUpdate ? "GO: update inactive product draft" : isProductDraft ? "GO: create inactive product draft" : "GO: add internal quote note"}>{confirming ? "Confirming…" : isConfigurableProduct ? "GO — create configurable inactive draft" : isProductPricingRollback ? "GO — roll back product pricing" : isProductPricingChangeSet ? "GO — adjust product pricing" : isQuoteDraftUpdate ? "GO — update draft quote" : isQuoteDraft ? "GO — create draft quote" : isProductDraftUpdate ? "GO — update inactive draft" : isProductDraft ? "GO — create inactive draft" : "GO — add internal note"}</Button></div> : null}
    {plan.quoteInternalNote && plan.confirmationAvailable && !plan.confirmationToken && plan.status === "awaiting_confirmation" ? <p className="mt-2 text-muted-foreground" role="status">Confirmation is not ready. Reload this plan before continuing.</p> : null}
    {canCancel ? <div className="mt-2"><Button type="button" size="sm" variant="outline" disabled={cancelling} onClick={cancel}>{cancelling ? "Cancelling plan…" : "Cancel plan"}</Button></div> : null}
  </section>;
}
