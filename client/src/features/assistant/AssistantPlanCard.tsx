import * as React from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Clock3, ListChecks, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssistantContextEnvelope } from "./types";

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
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
};

/** A product proposal carries only opaque, server-produced session references.
 * The browser still submits just the turn id when requesting a plan. */
export function toAssistantProductDraftProposal(card: unknown): AssistantProductDraftProposal | null {
  const record = asRecord(card);
  if (!record || asText(record.kind) !== "action_proposal") return null;
  const proposal = asRecord(record.proposal) ?? asRecord(record.plan) ?? record;
  if (asText(proposal.action) !== "products.create_inactive_draft") return null;
  const turnId = asText(proposal.turnId) ?? asText(record.turnId);
  if (!turnId || !asText(proposal.intakeSessionId) || !asText(proposal.proposalFingerprint)) return null;
  return { turnId, title: asText(record.title) ?? "Create inactive product draft", summary: asText(record.summary) };
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
    productDraftResult: productDraftRecord ? { name: asText(productDraftRecord.name) ?? "Inactive product draft", href: (() => { const href = asText(productDraftRecord.sourceLink); return href?.startsWith("/") ? href : null; })() } : null,
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
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Product draft proposal: ${proposal.title}`}>
    <p className="font-semibold">{proposal.title}</p>
    {proposal.summary ? <p className="mt-1 text-muted-foreground">{proposal.summary}</p> : null}
    <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">This prepares one inactive product draft only. Activation, publication, active-product edits, inventory, quotes, orders, and production jobs are excluded. Sending “GO” in chat does not confirm it.</p>
    <div className="mt-2"><Button type="button" size="sm" disabled={creating} onClick={() => void onCreatePlan(proposal.turnId)}>{creating ? "Preparing plan…" : "Review inactive-draft plan"}</Button></div>
  </section>;
}

export function AssistantPlanCard({
  card,
  context,
  onCancel,
  onConfirm,
  cancelling,
  confirming,
}: {
  card: unknown;
  context: AssistantContextEnvelope;
  onCancel?: (planId: string, expectedPlanVersion: number) => Promise<unknown> | void;
  onConfirm?: (input: { planId: string; expectedPlanVersion: number; confirmationToken: string; context: AssistantContextEnvelope }) => Promise<unknown> | void;
  cancelling?: boolean;
  confirming?: boolean;
}) {
  const plan = toAssistantPlanCardModel(card);
  if (!plan) return null;
  const staleForContext = isPlanStaleForContext(plan, context);
  const canCancel = Boolean(onCancel && plan.planVersion && plan.canCancel && !TERMINAL_STATUSES.has(plan.status));
  const isProductDraft = plan.action === "products.create_inactive_draft";
  const hasConfirmableDraft = Boolean(plan.quoteInternalNote?.noteText || (isProductDraft && plan.preview && plan.missingInformation.length === 0 && !plan.partialFailureSummary));
  const canConfirm = Boolean(
    onConfirm
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
  const actionLabel = plan.quoteInternalNote ? "Add internal quote note" : isProductDraft ? "Create inactive product draft" : "Proposed action";
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Execution plan: ${plan.title}`}>
    <div className="flex items-start justify-between gap-3">
      <div><p className="font-semibold">{plan.title}</p>{plan.action ? <p className="mt-0.5 text-muted-foreground">Action: {actionLabel}</p> : null}</div>
      <RiskIndicator level={plan.riskLevel} />
    </div>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground"><span>Status: {plan.status}</span><PlanExpiration expiresAt={plan.expiresAt} /></div>
    {plan.preview ? <p className="mt-2">{plan.preview}</p> : null}
    {plan.quoteInternalNote ? <QuoteInternalNotePreview note={plan.quoteInternalNote} /> : null}
    {plan.quoteInternalNote && plan.status === "succeeded" ? <p className="mt-3 flex items-center gap-1 rounded border border-primary/25 bg-primary/5 p-2 font-medium" role="status"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Internal note added to {plan.quoteInternalNote.quotePath && plan.quoteInternalNote.quoteNumber ? <a className="text-primary underline-offset-2 hover:underline" href={plan.quoteInternalNote.quotePath}>Quote {plan.quoteInternalNote.quoteNumber}</a> : (plan.quoteInternalNote.quoteNumber ? `Quote ${plan.quoteInternalNote.quoteNumber}` : "the quote")}.</p> : null}
    {isProductDraft && plan.status === "succeeded" ? <p className="mt-3 flex items-center gap-1 rounded border border-primary/25 bg-primary/5 p-2 font-medium" role="status"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Inactive product draft created. {plan.productDraftResult?.href ? <a className="text-primary underline-offset-2 hover:underline" href={plan.productDraftResult.href}>Open {plan.productDraftResult.name} in the existing editor</a> : "Activation and publication remain unavailable in the assistant."}</p> : null}
    {staleForContext || plan.staleReason ? <p className="mt-2 flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-foreground"><CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{plan.staleReason || "This preview is stale for the page you are viewing. The server must revalidate it before any future action."}</p> : null}
    {plan.missingInformation.length ? <div className="mt-2"><p className="font-medium">Information still needed</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{plan.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.affectedEntities.length ? <div className="mt-2"><p className="font-medium">Affected records</p><ul className="mt-1 space-y-1">{plan.affectedEntities.map((entity) => <li key={`${entity.type}-${entity.id}`}>{entity.href ? <a className="text-primary underline-offset-2 hover:underline" href={entity.href}>{entity.label}</a> : entity.label} <span className="text-muted-foreground">({entity.type})</span></li>)}</ul></div> : null}
    {plan.sideEffects.length ? <div className="mt-2"><p className="font-medium">Expected effects</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{plan.sideEffects.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.undo ? <p className="mt-2 text-muted-foreground">Undo: {plan.undo.available ? (plan.undo.label || "May be available after execution") : "Not available for this plan"}{plan.undo.expiresAt ? ` (until ${new Date(plan.undo.expiresAt).toLocaleString()})` : ""}</p> : null}
    {plan.steps.length ? <div className="mt-2"><p className="flex items-center gap-1 font-medium"><ListChecks className="h-3.5 w-3.5" aria-hidden="true" />Execution status</p><ul className="mt-1 space-y-1">{plan.steps.map((step) => <li key={step.id}><span className="font-medium">{step.label}</span>: {step.status}{step.detail ? ` — ${step.detail}` : ""}</li>)}</ul></div> : null}
    {plan.partialFailureSummary ? <p className="mt-2 flex items-center gap-1 rounded border border-destructive/30 bg-destructive/5 p-2"><XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{plan.status === "partially_failed" ? "Partial failure" : "Execution issue"}: {plan.partialFailureSummary}</p> : null}
    {plan.quoteInternalNote ? <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">This plan adds one internal-only quote note. It does not make any customer-facing or operational change.</p> : isProductDraft ? <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">This plan creates one inactive product draft only. It cannot activate, publish, or modify an active product.</p> : <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">Preview only. Production business write commands are not enabled, and this workspace does not provide a GO or execute control.</p>}
    {canConfirm ? <div className="mt-2"><Button type="button" size="sm" disabled={confirming} onClick={confirm} aria-label={isProductDraft ? "GO: create inactive product draft" : "GO: add internal quote note"}>{confirming ? "Confirming…" : isProductDraft ? "GO — create inactive draft" : "GO — add internal note"}</Button></div> : null}
    {plan.quoteInternalNote && plan.confirmationAvailable && !plan.confirmationToken && plan.status === "awaiting_confirmation" ? <p className="mt-2 text-muted-foreground" role="status">Confirmation is not ready. Reload this plan before continuing.</p> : null}
    {canCancel ? <div className="mt-2"><Button type="button" size="sm" variant="outline" disabled={cancelling} onClick={cancel}>{cancelling ? "Cancelling plan…" : "Cancel plan"}</Button></div> : null}
  </section>;
}
