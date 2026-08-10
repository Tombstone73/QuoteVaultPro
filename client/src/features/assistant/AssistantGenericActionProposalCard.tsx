import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type UnknownRecord = Record<string, unknown>;
type SourceLink = { label: string; href: string };

/** Presentation allowlist only; the execution route remains authoritative. */
const genericActionCommands = new Set([
  "customers.create", "customers.update_profile", "customers.update_commercial_terms", "contacts.create", "contacts.update",
  "orders.create", "orders.update_editable", "quotes.convert_to_order",
  "production.intake_line_items", "production.send_to_prepress", "production.update_job_status", "production.add_job_note",
  "fulfillment.create_shipment", "fulfillment.update_shipment_details", "fulfillment.mark_shipped", "fulfillment.create_pickup_ticket", "fulfillment.add_note",
  "billing.create_invoice", "billing.update_invoice_draft", "billing.send_invoice", "billing.add_invoice_note",
  "payments.record_manual_payment", "payments.add_payment_note",
  "products.update_existing_product",
] as const);

export type GenericActionProposal = {
  turnId: string; command: string; humanAction: string; title: string; summary: string | null;
  sourceLinks: SourceLink[]; affectedEntities: Array<{ label: string; href: string | null }>;
  parameters: Array<{ label: string; value: string }>; riskLevel: string | null; warnings: string[];
};

function record(value: unknown): UnknownRecord | null { return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function displayValue(value: unknown): string | null { return text(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "boolean" ? String(value) : null); }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(text).filter((item): item is string => Boolean(item)).slice(0, 12) : []; }
function links(value: unknown): SourceLink[] { return Array.isArray(value) ? value.slice(0, 12).flatMap((entry) => { const item = record(entry); const label = text(item?.label); const href = text(item?.href); return label && href?.startsWith("/") ? [{ label, href }] : []; }) : []; }
function actionLabel(command: string) { return command.split(".").map((part) => part.replaceAll("_", " ")).join(" ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function proposalDetails(command: string, cards: unknown[]) {
  return cards.flatMap((candidate) => {
    const card = record(candidate); const details = record(card?.details);
    return card && text(card.kind) !== "action_proposal" && details && (text(details.commandName) === command || text(details.action) === command) ? [{ card, details }] : [];
  })[0] ?? null;
}

function parameters(value: UnknownRecord | null) {
  if (!value) return [];
  const changes = Array.isArray(value.changes) ? value.changes.flatMap((entry) => { const change = record(entry); const label = text(change?.label) ?? text(change?.field) ?? text(change?.name); const after = displayValue(change?.after) ?? displayValue(change?.value) ?? displayValue(change?.next); return label && after ? [{ label, value: after }] : []; }) : [];
  const supplied = Array.isArray(value.parameters) ? value.parameters.flatMap((entry) => { const parameter = record(entry); const label = text(parameter?.label) ?? text(parameter?.name) ?? text(parameter?.field); const parameterValue = displayValue(parameter?.value); return label && parameterValue ? [{ label, value: parameterValue }] : []; }) : [];
  return [...changes, ...supplied].slice(0, 12);
}

function affected(value: UnknownRecord | null, sourceLinks: SourceLink[]) {
  const explicit = Array.isArray(value?.affectedEntities) ? value!.affectedEntities.flatMap((entry) => { const entity = record(entry); const label = text(entity?.label) ?? text(entity?.name); const href = text(record(entity?.sourceLink)?.href) ?? text(entity?.href); return label ? [{ label, href: href?.startsWith("/") ? href : null }] : []; }) : [];
  return explicit.length ? explicit.slice(0, 12) : sourceLinks.map((link) => ({ label: link.label, href: link.href }));
}

export function toGenericActionProposal(card: unknown, supportingCards: unknown[] = []): GenericActionProposal | null {
  const cardRecord = record(card); if (!cardRecord || text(cardRecord.kind) !== "action_proposal") return null;
  const proposal = record(cardRecord.proposal) ?? record(cardRecord.plan) ?? cardRecord;
  const command = text(proposal.action); const turnId = text(proposal.turnId) ?? text(cardRecord.turnId);
  if (!command || !turnId || !genericActionCommands.has(command as never)) return null;
  const sessionKey = command === "products.update_existing_product" ? "productId" : command.startsWith("customers.") || command.startsWith("contacts.") ? "crmIntakeSessionId" : command.startsWith("orders.") || command === "quotes.convert_to_order" ? "orderIntakeSessionId" : command.startsWith("production.") ? "productionIntakeSessionId" : command.startsWith("fulfillment.") ? "fulfillmentIntakeSessionId" : command.startsWith("billing.") ? "billingIntakeSessionId" : "paymentIntakeSessionId";
  const fingerprint = text(proposal.proposalFingerprint);
  if (!text(proposal[sessionKey]) || !fingerprint || !/^[a-f0-9]{64}$/i.test(fingerprint)) return null;
  const related = proposalDetails(command, supportingCards); const details = record(cardRecord.details) ?? related?.details ?? null;
  const directLinks = links(cardRecord.sourceLinks); const sourceLinks = directLinks.length ? directLinks : links(related?.card.sourceLinks ?? details?.sourceLinks);
  return { turnId, command, humanAction: actionLabel(command), title: text(cardRecord.title) ?? actionLabel(command), summary: text(cardRecord.summary) ?? text(details?.summary), sourceLinks, affectedEntities: affected(details, sourceLinks), parameters: parameters(details), riskLevel: text(cardRecord.riskLevel) ?? text(proposal.riskLevel) ?? text(details?.riskLevel), warnings: Array.from(new Set([...strings(cardRecord.warnings), ...strings(details?.warnings)])) };
}

export function AssistantGenericActionProposalCard({ proposal, onCreatePlan, creating, error }: { proposal: GenericActionProposal; onCreatePlan: (turnId: string) => Promise<unknown> | void; creating?: boolean; error?: string | null }) {
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Action proposal: ${proposal.command}`}>
    <p className="font-semibold">{proposal.title}</p><p className="mt-1 text-muted-foreground">Command: {proposal.command}</p><p className="mt-1"><span className="font-medium">Action: </span>{proposal.humanAction}</p>
    {proposal.summary ? <p className="mt-2 text-muted-foreground">{proposal.summary}</p> : null}{proposal.riskLevel ? <p className="mt-2"><span className="font-medium">Risk: </span>{proposal.riskLevel}</p> : null}
    {proposal.affectedEntities.length ? <div className="mt-2"><p className="font-medium">Affected records</p><ul className="mt-1 space-y-1">{proposal.affectedEntities.map((entity) => <li key={`${entity.label}-${entity.href ?? ""}`}>{entity.href ? <a className="text-primary underline-offset-2 hover:underline" href={entity.href}>{entity.label}</a> : entity.label}</li>)}</ul></div> : null}
    {proposal.parameters.length ? <dl className="mt-2 grid gap-1 sm:grid-cols-2">{proposal.parameters.map((parameter) => <div key={`${parameter.label}-${parameter.value}`}><dt className="inline font-medium">{parameter.label}: </dt><dd className="inline">{parameter.value}</dd></div>)}</dl> : null}
    {proposal.warnings.length ? <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2"><p className="flex items-center gap-1 font-medium"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Warnings</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
    {error ? <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2" role="alert">Unable to prepare the server plan: {error}</p> : null}
    <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">Review creates a server-bound plan. This card cannot execute the action, and typing GO in chat does not confirm it.</p>
    <div className="mt-2"><Button type="button" size="sm" disabled={creating} onClick={() => void onCreatePlan(proposal.turnId)}>{creating ? "Preparing plan…" : "Review server plan"}</Button></div>
  </section>;
}
