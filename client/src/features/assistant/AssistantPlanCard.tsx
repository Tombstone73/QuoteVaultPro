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
  preview: string | null;
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
  return {
    id,
    title: asText(cardRecord.title) ?? asText(plan.title) ?? "Proposed action",
    action: asText(plan.action) ?? asText(plan.normalizedAction) ?? asText(cardRecord.action),
    status: asText(plan.status) ?? asText(cardRecord.status) ?? "preview_ready",
    planVersion: asPositiveInteger(plan.planVersion) ?? asPositiveInteger(plan.version),
    riskLevel: asText(plan.riskLevel) ?? asText(cardRecord.riskLevel) ?? "unknown",
    preview: asText(plan.preview) ?? asText(cardRecord.preview) ?? getTextFromObject(previewRecord, ["summary", "description", "title"]),
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
    partialFailureSummary: asText(plan.partialFailureSummary) ?? asText(cardRecord.partialFailureSummary) ?? asText(cardRecord.failureSummary),
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

export function AssistantPlanCard({
  card,
  context,
  onCancel,
  cancelling,
}: {
  card: unknown;
  context: AssistantContextEnvelope;
  onCancel?: (planId: string, expectedPlanVersion: number) => Promise<unknown> | void;
  cancelling?: boolean;
}) {
  const plan = toAssistantPlanCardModel(card);
  if (!plan) return null;
  const staleForContext = isPlanStaleForContext(plan, context);
  const canCancel = Boolean(onCancel && plan.planVersion && plan.canCancel && !TERMINAL_STATUSES.has(plan.status));
  const cancel = () => {
    if (onCancel && plan.planVersion) void onCancel(plan.id, plan.planVersion);
  };
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Execution plan: ${plan.title}`}>
    <div className="flex items-start justify-between gap-3">
      <div><p className="font-semibold">{plan.title}</p>{plan.action ? <p className="mt-0.5 text-muted-foreground">Action: {plan.action}</p> : null}</div>
      <RiskIndicator level={plan.riskLevel} />
    </div>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground"><span>Status: {plan.status}</span><PlanExpiration expiresAt={plan.expiresAt} /></div>
    {plan.preview ? <p className="mt-2">{plan.preview}</p> : null}
    {staleForContext || plan.staleReason ? <p className="mt-2 flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-foreground"><CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{plan.staleReason || "This preview is stale for the page you are viewing. The server must revalidate it before any future action."}</p> : null}
    {plan.missingInformation.length ? <div className="mt-2"><p className="font-medium">Information still needed</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{plan.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.affectedEntities.length ? <div className="mt-2"><p className="font-medium">Affected records</p><ul className="mt-1 space-y-1">{plan.affectedEntities.map((entity) => <li key={`${entity.type}-${entity.id}`}>{entity.href ? <a className="text-primary underline-offset-2 hover:underline" href={entity.href}>{entity.label}</a> : entity.label} <span className="text-muted-foreground">({entity.type})</span></li>)}</ul></div> : null}
    {plan.sideEffects.length ? <div className="mt-2"><p className="font-medium">Expected effects</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{plan.sideEffects.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.undo ? <p className="mt-2 text-muted-foreground">Undo: {plan.undo.available ? (plan.undo.label || "May be available after execution") : "Not available for this plan"}{plan.undo.expiresAt ? ` (until ${new Date(plan.undo.expiresAt).toLocaleString()})` : ""}</p> : null}
    {plan.steps.length ? <div className="mt-2"><p className="flex items-center gap-1 font-medium"><ListChecks className="h-3.5 w-3.5" aria-hidden="true" />Execution status</p><ul className="mt-1 space-y-1">{plan.steps.map((step) => <li key={step.id}><span className="font-medium">{step.label}</span>: {step.status}{step.detail ? ` — ${step.detail}` : ""}</li>)}</ul></div> : null}
    {plan.partialFailureSummary ? <p className="mt-2 flex items-center gap-1 rounded border border-destructive/30 bg-destructive/5 p-2"><XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{plan.status === "partially_failed" ? "Partial failure" : "Execution issue"}: {plan.partialFailureSummary}</p> : null}
    <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">Preview only. Production business write commands are not enabled, and this workspace does not provide a GO or execute control.</p>
    {canCancel ? <div className="mt-2"><Button type="button" size="sm" variant="outline" disabled={cancelling} onClick={cancel}>{cancelling ? "Cancelling plan…" : "Cancel plan"}</Button></div> : null}
  </section>;
}
