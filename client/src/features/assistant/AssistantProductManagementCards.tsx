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

const PRODUCT_CARD_KINDS = new Set([
  "product_intake_summary", "product_missing_information", "product_comparison", "product_material_selection",
  "product_options_summary", "product_pricing_summary", "product_routing_summary", "product_validation_errors",
  "product_validation_warnings", "product_draft_preview", "product_draft_created",
]);

export type AssistantProductManagementCard = {
  kind: string;
  title: string;
  summary: string | null;
  fields: Array<{ label: string; value: string }>;
  items: string[];
  assumptions: string[];
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
  return {
    kind,
    title: text(source.title) ?? "Product Management",
    summary: text(source.summary),
    fields: [...namedFields, ...objectFields].slice(0, 16),
    items: list(details.items ?? details.questions ?? details.errors ?? details.warnings ?? details.options ?? details.reusedRecords),
    assumptions: list(details.assumptions ?? details.inheritedAssumptions),
    editorPath: safePath(details.editorPath ?? details.reviewUrl ?? details.sourceLink),
    draftStatus: text(details.draftStatus ?? details.status),
  };
}

function CardIcon({ kind }: { kind: string }) {
  if (kind === "product_missing_information") return <CircleHelp className="h-4 w-4" aria-hidden="true" />;
  if (kind === "product_validation_errors") return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
  if (kind === "product_draft_created") return <ShieldCheck className="h-4 w-4" aria-hidden="true" />;
  if (kind === "product_draft_preview") return <PackagePlus className="h-4 w-4" aria-hidden="true" />;
  return <Lightbulb className="h-4 w-4" aria-hidden="true" />;
}

export function AssistantProductManagementCardView({ card }: { card: AssistantProductManagementCard }) {
  const errors = card.kind === "product_validation_errors";
  const missing = card.kind === "product_missing_information";
  const created = card.kind === "product_draft_created";
  return <section className="mt-2 rounded-md border bg-background/80 p-3 text-xs" aria-label={`Product Management: ${card.title}`}>
    <div className="flex items-start gap-2"><CardIcon kind={card.kind} /><div><p className="font-semibold">{card.title}</p>{card.summary ? <p className="mt-0.5 text-muted-foreground">{card.summary}</p> : null}</div></div>
    {created ? <p className="mt-2 rounded border border-primary/25 bg-primary/5 p-2 font-medium">Inactive product draft created. Activation and publication remain unavailable in the assistant.</p> : null}
    {errors ? <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2">Validation must be resolved before a draft can be confirmed.</p> : null}
    {missing ? <p className="mt-2 rounded bg-muted/60 p-2">Answer these questions in the conversation. The server maintains the intake state.</p> : null}
    {card.fields.length ? <dl className="mt-2 grid gap-1 sm:grid-cols-2">{card.fields.map((field) => <div key={field.label}><dt className="inline font-medium">{field.label}: </dt><dd className="inline">{field.value}</dd></div>)}</dl> : null}
    {card.items.length ? <ul className="mt-2 list-disc space-y-0.5 pl-4">{card.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
    {card.assumptions.length ? <div className="mt-2"><p className="font-medium">Assumptions and inherited defaults</p><ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">{card.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {card.draftStatus ? <p className="mt-2 text-muted-foreground">Status: {card.draftStatus}</p> : null}
    {card.editorPath ? <a href={card.editorPath} className="mt-3 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"><FilePenLine className="h-3.5 w-3.5" aria-hidden="true" />Open inactive draft in the existing editor</a> : null}
  </section>;
}
