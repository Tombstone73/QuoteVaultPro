import * as React from "react";
import { AlertTriangle, CircleHelp, FilePenLine, Lightbulb, PackagePlus, ShieldCheck } from "lucide-react";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((item): item is string => Boolean(item)).slice(0, 30) : [];
}
function safePath(value: unknown) { const path = text(value); return path?.startsWith("/") ? path : null; }
function cents(value: unknown) { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? `$${(value / 100).toFixed(2)}` : null; }

const PRODUCT_CARD_KINDS = new Set([
  "product_intake_summary", "product_missing_information", "product_comparison", "product_material_selection",
  "product_options_summary", "product_pricing_summary", "product_routing_summary", "product_validation_errors",
  "product_validation_warnings", "product_draft_preview", "product_draft_created",
  "product_draft_snapshot", "product_draft_changes", "product_draft_update_preview", "product_draft_updated",
  "product_draft_update_failed", "product_draft_update_unsupported", "product_active_product_unsupported",
]);

export type AssistantProductChange = { label: string; before: string | null; after: string | null; };

function toChanges(value: unknown): AssistantProductChange[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((item) => {
    const change = record(item);
    if (!change) return [];
    const label = text(change.label) ?? text(change.field) ?? text(change.name);
    if (!label) return [];
    const before = text(change.before) ?? text(change.previous) ?? text(change.oldValue);
    const after = text(change.after) ?? text(change.next) ?? text(change.newValue);
    return before || after ? [{ label, before, after }] : [];
  });
}

export type AssistantProductManagementCard = {
  kind: string;
  title: string;
  summary: string | null;
  fields: Array<{ label: string; value: string }>;
  items: string[];
  assumptions: string[];
  changes: AssistantProductChange[];
  validationErrors: string[];
  warnings: string[];
  unsupportedReasons: string[];
  editorPath: string | null;
  draftStatus: string | null;
};

/** A presentation adapter for bounded, server-created Product Management cards. */
export function toAssistantProductManagementCard(card: unknown): AssistantProductManagementCard | null {
  const source = record(card);
  const kind = text(source?.kind);
  if (!source || !kind || !PRODUCT_CARD_KINDS.has(kind)) return null;
  const details = record(source.details) ?? record(source.product) ?? source;
  const rawFields = record(details.fields);
  const proposedFields = record(details.proposedFields);
  const namedFields = [
    ["Product", details.productName ?? details.name], ["Category", details.category], ["Sell unit", details.sellUnit],
    ["Dimensions", details.dimensions], ["Pricing", details.pricingMethod ?? details.pricingBasis], ["Routing", details.routing],
    ["Material", details.material], ["Draft status", details.draftStatus ?? details.status],
  ].flatMap(([label, value]) => {
    const rendered = text(value);
    return rendered ? [{ label: String(label), value: rendered }] : [];
  });
  const objectFields = rawFields ? Object.entries(rawFields).flatMap(([label, value]) => {
    const rendered = text(value);
    return rendered ? [{ label: String(label), value: rendered }] : [];
  }) : [];
  const proposedDraftFields = proposedFields ? [
    ["Pricing model", proposedFields.pricingModel],
    ["Square-foot price", cents(proposedFields.perSqftCents)],
    ["Per-piece price", cents(proposedFields.perPieceCents)],
    ["Minimum charge", cents(proposedFields.minimumChargeCents)],
    ["Material", proposedFields.material],
    ["Route", proposedFields.productionRoute],
    ["Sheet / roll constraints", proposedFields.sheetOrRollConstraints],
    ["Allow rotation", proposedFields.allowRotation === true ? "Allowed" : proposedFields.allowRotation === false ? "Not allowed" : null],
  ].flatMap(([label, value]) => {
    const rendered = text(value);
    return rendered ? [{ label: String(label), value: rendered }] : [];
  }) : [];
  return {
    kind,
    title: text(source.title) ?? "Product Management",
    summary: text(source.summary),
    fields: [...namedFields, ...objectFields, ...proposedDraftFields].slice(0, 16),
    items: list(details.items ?? details.questions ?? details.errors ?? details.warnings ?? details.options ?? details.reusedRecords),
    assumptions: list(details.assumptions ?? details.inheritedAssumptions),
    changes: toChanges(details.changes ?? details.beforeAfter ?? details.patchChanges ?? details.fieldChanges),
    validationErrors: list(details.validationErrors ?? details.errors),
    warnings: list(details.warnings ?? details.validationWarnings),
    unsupportedReasons: list(details.unsupportedReasons ?? details.unsupportedChanges),
    editorPath: safePath(details.editorPath ?? details.reviewUrl ?? details.sourceLink ?? details.productEditorPath),
    draftStatus: text(details.draftStatus ?? details.status),
  };
}

function CardIcon({ kind }: { kind: string }) {
  if (kind === "product_missing_information") return <CircleHelp className="h-4 w-4" aria-hidden="true" />;
  if (kind === "product_validation_errors") return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
  if (kind === "product_draft_created" || kind === "product_draft_updated") return <ShieldCheck className="h-4 w-4" aria-hidden="true" />;
  if (kind === "product_draft_preview" || kind === "product_draft_update_preview") return <PackagePlus className="h-4 w-4" aria-hidden="true" />;
  return <Lightbulb className="h-4 w-4" aria-hidden="true" />;
}

export function AssistantProductManagementCardView({ card }: { card: AssistantProductManagementCard }) {
  const errors = card.kind === "product_validation_errors";
  const missing = card.kind === "product_missing_information";
  const created = card.kind === "product_draft_created" || card.kind === "product_draft_updated";
  const activeUnsupported = card.kind === "product_active_product_unsupported";
  const updateUnsupported = card.kind === "product_draft_update_unsupported";
  const failed = card.kind === "product_draft_update_failed";
  return <section className="mt-2 rounded-md border bg-background/80 p-3 text-xs" aria-label={`Product Management: ${card.title}`}>
    <div className="flex items-start gap-2"><CardIcon kind={card.kind} /><div><p className="font-semibold">{card.title}</p>{card.summary ? <p className="mt-0.5 text-muted-foreground">{card.summary}</p> : null}</div></div>
    {created ? <p className="mt-2 rounded border border-primary/25 bg-primary/5 p-2 font-medium">Inactive product draft {card.kind === "product_draft_updated" ? "updated" : "created"}. Activation and publication remain unavailable in the assistant.</p> : null}
    {activeUnsupported ? <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2">This product is active. Conversational editing is available only for inactive drafts; use the existing product editor for active-product changes.</p> : null}
    {updateUnsupported ? <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2">This requested draft change is not available through the assistant. Review it in the existing product editor instead.</p> : null}
    {failed ? <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2">The draft was not fully updated. Review the reported issue in the existing editor before proposing another change.</p> : null}
    {errors ? <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2">Validation must be resolved before a draft can be confirmed.</p> : null}
    {missing ? <p className="mt-2 rounded bg-muted/60 p-2">Answer these questions in the conversation. The server maintains the intake state.</p> : null}
    {card.fields.length ? <dl className="mt-2 grid gap-1 sm:grid-cols-2">{card.fields.map((field) => <div key={field.label}><dt className="inline font-medium">{field.label}: </dt><dd className="inline">{field.value}</dd></div>)}</dl> : null}
    {card.changes.length ? <div className="mt-3 overflow-x-auto"><p className="font-medium">Exact proposed changes</p><table className="mt-1 w-full min-w-[28rem] border-collapse text-left"><thead className="text-muted-foreground"><tr><th className="border-b p-1 font-medium">Field</th><th className="border-b p-1 font-medium">Before</th><th className="border-b p-1 font-medium">After</th></tr></thead><tbody>{card.changes.map((change) => <tr key={`${change.label}-${change.before}-${change.after}`}><th className="border-b p-1 align-top font-medium">{change.label}</th><td className="border-b p-1 align-top">{change.before ?? "Unchanged / not set"}</td><td className="border-b p-1 align-top">{change.after ?? "Cleared"}</td></tr>)}</tbody></table></div> : null}
    {card.validationErrors.length ? <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2"><p className="font-medium">Validation errors</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{card.validationErrors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
    {card.warnings.length ? <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2"><p className="font-medium">Warnings</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{card.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
    {card.unsupportedReasons.length ? <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2"><p className="font-medium">Not available through the assistant</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{card.unsupportedReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div> : null}
    {card.items.length ? <ul className="mt-2 list-disc space-y-0.5 pl-4">{card.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
    {card.assumptions.length ? <div className="mt-2"><p className="font-medium">Assumptions and inherited defaults</p><ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">{card.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {card.draftStatus ? <p className="mt-2 text-muted-foreground">Status: {card.draftStatus}</p> : null}
    {card.editorPath ? <a href={card.editorPath} className="mt-3 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"><FilePenLine className="h-3.5 w-3.5" aria-hidden="true" />Open inactive draft in the existing editor</a> : null}
  </section>;
}
