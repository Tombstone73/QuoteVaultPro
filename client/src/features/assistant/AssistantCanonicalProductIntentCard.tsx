import * as React from "react";
import { Button } from "@/components/ui/button";

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

export type CanonicalProductIntentCard = {
  proposalId: string | null;
  title: string;
  revision: number;
  fingerprint: string;
  ready: boolean;
  blockers: string[];
  questions: string[];
  recommendations: Array<{ id: string; title: string; description: string }>;
  candidates: Array<{ id: string; label: string; description: string; blocksConfirmation: boolean; kind: string; input: string | null; href: string | null }>;
  fields: Array<{ label: string; value: string }>;
};

export type CanonicalProductIntentProposal = {
  turnId: string;
  title: string;
  proposalId: string;
  revision: number;
  fingerprint: string;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((item): item is string => Boolean(item)).slice(0, 30) : [];
}

function displayValue(value: unknown): string | null {
  const single = text(value);
  if (single) return single;
  const values = strings(value);
  return values.length ? values.join(" · ") : null;
}
function actions(value: unknown, requireBlocking = false) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => { const action = record(item); const id = text(action?.id); const label = text(action?.title) ?? text(action?.label); const description = text(action?.description); const blocksConfirmation = action?.blocksConfirmation === true; const kind = text(action?.kind) ?? "recommendation"; return id && label && description && (!requireBlocking || blocksConfirmation) ? [{ id, label, description, blocksConfirmation, kind, input: text(action?.input), href: text(record(action?.candidate)?.href) }] : []; });
}

/**
 * Strict boundary for server-projected ProductDraftIntent presentation. This
 * intentionally accepts only display primitives: product facts remain owned
 * by the canonical backend DTO and are never reconstructed in the browser.
 */
export function toCanonicalProductIntentCard(value: unknown): CanonicalProductIntentCard | null {
  const outer = record(value);
  const details = record(outer?.details);
  const dto = record(details?.canonicalProductIntent) ?? record(outer?.canonicalProductIntent);
  const readiness = record(dto?.readiness);
  const fields = record(dto?.fields);
  const revision = dto?.revision;
  const fingerprint = text(dto?.fingerprint);
  const proposalId = text(details?.proposalId);
  if (!outer || outer.kind !== "canonical_product_intent_proposal" || !dto || dto.kind !== "canonical_product_intent_proposal" || !readiness || !fields
    || !Number.isInteger(revision) || (revision as number) < 0 || !fingerprint || !/^[a-f0-9]{64}$/i.test(fingerprint)
    || typeof readiness.ready !== "boolean") return null;

  const knownLabels = [
    "Product", "Category", "Measurement", "Quantity", "Pricing", "Material", "Options",
    "Proof", "Production job", "Production route", "Lifecycle", "Visibility",
  ];
  const rendered = Object.entries(fields).flatMap(([label, fieldValue]) => {
    const safeLabel = text(label);
    const safeValue = displayValue(fieldValue);
    return safeLabel && safeValue ? [{ label: safeLabel, value: safeValue }] : [];
  });
  rendered.sort((left, right) => {
    const leftIndex = knownLabels.indexOf(left.label);
    const rightIndex = knownLabels.indexOf(right.label);
    return (leftIndex < 0 ? knownLabels.length : leftIndex) - (rightIndex < 0 ? knownLabels.length : rightIndex);
  });

  return {
    proposalId,
    title: text(dto.title) ?? text(outer.title) ?? "Product draft",
    revision: revision as number,
    fingerprint,
    ready: readiness.ready,
    blockers: strings(readiness.blockers),
    questions: strings(readiness.questions),
    recommendations: actions(dto.optionalRecommendations).map(({ id, label, description }) => ({ id, title: label, description })), candidates: actions(dto.candidateResolutions, true),
    fields: rendered,
  };
}

/** The action envelope carries only the server-persisted revision identity. */
export function toCanonicalProductIntentProposal(value: unknown): CanonicalProductIntentProposal | null {
  const card = record(value);
  const proposal = record(card?.proposal) ?? record(card?.plan);
  const proposalId = text(proposal?.proposalId);
  const turnId = text(proposal?.turnId) ?? text(card?.turnId);
  const fingerprint = text(proposal?.fingerprint);
  const revision = proposal?.revision;
  if (!card || card.kind !== "action_proposal" || proposal?.action !== "products.create_from_canonical_intent"
    || !proposalId || !turnId || !fingerprint || !/^[a-f0-9]{64}$/i.test(fingerprint)
    || !Number.isInteger(revision) || (revision as number) < 0) return null;
  return { turnId, title: text(card.title) ?? "Create inactive product draft", proposalId, revision: revision as number, fingerprint };
}

function IssueList({ title, values, tone }: { title: string; values: string[]; tone: "blocker" | "question" }) {
  if (!values.length) return null;
  const numbered = tone === "question";
  const List = numbered ? "ol" : "ul";
  return <div className={`mt-3 rounded border p-2 ${tone === "blocker" ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30 bg-amber-500/10"}`}>
    <p className="font-medium">{title}</p>
    {numbered ? <p className="mt-1 text-muted-foreground">Answer these in the conversation. They must be resolved before review.</p> : null}
    <List className={`mt-1 space-y-1 ${numbered ? "list-decimal pl-5" : "list-disc pl-4"}`}>
      {values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}
    </List>
  </div>;
}

export function CanonicalProductIntentCardView({ card, onInteraction }: { card: CanonicalProductIntentCard; onInteraction?: (input: { proposalId: string; action: "accept_recommendation" | "dismiss_recommendation" | "apply_candidate"; actionId: string; newProductName?: string }) => Promise<unknown> }) {
  const [override, setOverride] = React.useState<CanonicalProductIntentCard | null>(null);
  React.useEffect(() => setOverride(null), [card.fingerprint]);
  const currentCard = override ?? card;
  const needsInput = currentCard.questions.length > 0 || currentCard.blockers.length > 0;
  const [rename, setRename] = React.useState(""); const [busy, setBusy] = React.useState<string | null>(null);
  const interact = async (action: "accept_recommendation" | "dismiss_recommendation" | "apply_candidate", actionId: string, newProductName?: string) => { if (!onInteraction || !currentCard.proposalId) return; setBusy(actionId); try { const result = await onInteraction({ proposalId: currentCard.proposalId, action, actionId, newProductName }); const raw = record(result); const next = raw?.card ? toCanonicalProductIntentCard({ kind: "canonical_product_intent_proposal", details: { canonicalProductIntent: raw.card, proposalId: currentCard.proposalId } }) : null; if (next) setOverride(next); } finally { setBusy(null); } };
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Product draft: ${currentCard.title}`}>
    <div className="flex items-start justify-between gap-3">
      <div><p className="font-semibold">{currentCard.title}</p><p className="mt-0.5 text-muted-foreground">Product configuration</p></div>
      <span className="shrink-0 rounded bg-muted px-2 py-1 font-medium text-muted-foreground">Revision {currentCard.revision}</span>
    </div>
    {currentCard.fields.length ? <dl className="mt-3 grid gap-1 sm:grid-cols-2">{currentCard.fields.map((field) => <div key={field.label}><dt className="inline font-medium">{field.label}: </dt><dd className="inline">{field.value}</dd></div>)}</dl> : <p className="mt-3 text-muted-foreground">The latest product revision is still being prepared.</p>}
    <IssueList title="Required decisions" values={currentCard.questions} tone="question" />
    {currentCard.candidates.length ? <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2"><p className="font-medium">Required to continue</p><ul className="mt-1 list-disc space-y-1 pl-4">{currentCard.candidates.map((action) => <li key={action.id}><span className="font-medium">{action.label}:</span> {action.description}{action.input === "new_product_name" ? <span className="mt-1 flex gap-1"><input className="rounded border bg-background px-1" value={rename} onChange={(event) => setRename(event.target.value)} placeholder="New product name" /><Button size="sm" disabled={!rename.trim() || busy !== null} onClick={() => void interact("apply_candidate", action.id, rename)}>Rename</Button></span> : onInteraction ? <Button className="ml-1" size="sm" disabled={busy !== null} onClick={() => void interact("apply_candidate", action.id)}>{busy === action.id ? "Applying…" : action.href ? "Open existing" : "Select"}</Button> : action.href ? <a className="ml-1 text-primary underline" href={action.href}>Open existing</a> : null}</li>)}</ul></div> : null}
    <IssueList title="Blocking validation" values={currentCard.blockers} tone="blocker" />
    {currentCard.recommendations.length ? <div className="mt-3 rounded border border-primary/25 bg-primary/5 p-2"><p className="font-medium">Product suggestions</p><p className="mt-1 text-muted-foreground">Optional improvements; they do not block review or GO.</p><ul className="mt-1 list-disc space-y-1 pl-4">{currentCard.recommendations.map((recommendation) => <li key={recommendation.id}><span className="font-medium">{recommendation.title}:</span> {recommendation.description}{onInteraction && currentCard.proposalId ? <span className="ml-2 inline-flex gap-1"><Button size="sm" disabled={busy === recommendation.id} onClick={() => void interact("accept_recommendation", recommendation.id)}>Add</Button><Button size="sm" variant="outline" disabled={busy === recommendation.id} onClick={() => void interact("dismiss_recommendation", recommendation.id)}>Dismiss</Button></span> : null}</li>)}</ul></div> : null}
    <p className="mt-3 rounded bg-muted/60 p-2 text-muted-foreground">
      {needsInput ? "This revision cannot be confirmed until the required decisions are resolved." : currentCard.ready ? "Ready for server-side review and confirmation. Any later correction creates a new revision." : "This revision is not yet ready for review."}
    </p>
  </section>;
}

export function CanonicalProductIntentReviewProposalCard({ proposal, onCreatePlan, creating, stale = false }: { proposal: CanonicalProductIntentProposal; onCreatePlan: (turnId: string) => Promise<unknown> | void; creating?: boolean; stale?: boolean }) {
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Product draft review: ${proposal.title}`}>
    <p className="font-semibold">{proposal.title}</p>
    <p className="mt-1 text-muted-foreground">Review this product draft before confirming creation of one inactive product and one PBV2 draft.</p>
    <p className="mt-2 text-muted-foreground">Revision {proposal.revision} is bound to this review. Later corrections require a new review.</p>
    {stale ? <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2" role="status">A newer product revision is available. This review is stale and cannot be used.</p> : null}
    <div className="mt-2"><Button type="button" size="sm" disabled={creating || stale} onClick={() => void onCreatePlan(proposal.turnId)}>{stale ? "Review stale — refresh required" : creating ? "Preparing plan…" : "Review product plan"}</Button></div>
  </section>;
}
