import * as React from "react";
import { Bot, Expand, Maximize2, Minus, PanelBottom, PanelLeft, PanelRight, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useArchiveAssistantConversations, useAssistantConversation, useAssistantConversations, useCancelAssistantPlan, useCancelAssistantReportResolution, useCanonicalProductIntentInteraction, useConfirmAssistantQuoteInternalNote, useCreateAssistantConversation, useCreateAssistantExecutionPlan, useSelectAssistantReportResolution, useSendAssistantTurn, useSubmitAssistantOrderOptionSelections, useUpdateAssistantConversation } from "@/hooks/useAssistantApi";
import { useAssistantWorkspace } from "./AssistantWorkspaceProvider";
import type { AssistantPresentation } from "./types";
import type { AssistantContextEnvelope } from "./types";
import type { AssistantStructuredCard } from "@shared/assistantContracts";
import { formatAssistantDisplayValue } from "@shared/assistantDisplay";
import { AssistantPlanCard, AssistantProductDraftProposalCard, AssistantProductPricingProposalCard, AssistantQuoteDraftProposalCard, AssistantQuoteNoteProposalCard, toAssistantPlanCardModel, toAssistantProductDraftProposal, toAssistantProductPricingProposal, toAssistantQuoteDraftProposal, toAssistantQuoteNoteProposal } from "./AssistantPlanCard";
import { AssistantProductManagementCardView, toAssistantProductManagementCard } from "./AssistantProductManagementCards";
import { ConfigurableProductConfirmationCardView, toConfigurableProductConfirmation, toConfigurableProductProposal } from "./AssistantConfigurableProductCards";
import { CanonicalProductIntentCardView, CanonicalProductIntentReviewProposalCard, toCanonicalProductIntentCard, toCanonicalProductIntentProposal } from "./AssistantCanonicalProductIntentCard";
import { AssistantGenericActionProposalCard, toGenericActionProposal } from "./AssistantGenericActionProposalCard";
import { assistantComposerHelper, assistantConversationLabel, visibleAssistantConversations } from "./assistantWorkspaceCore";
import { useAssistantConversationScroll } from "./useAssistantConversationScroll";
import { AssistantConversationSidebar } from "./AssistantConversationManagement";
import { AssistantWorkingIndicator, resolveAssistantWorkingState } from "./AssistantWorkingIndicator";
import type { AssistantMessage, AssistantResponseState } from "@shared/assistantContracts";

type AssistantResponsePresentation = "conversational" | "collection" | "record_summary" | "analytical" | "proposed_action" | "execution_result" | "diagnostic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function diagnosticLabel(card: AssistantStructuredCard): string {
  if ("title" in card) return card.title;
  return "toolName" in card ? card.toolName : "Assistant diagnostic";
}

function diagnosticStatus(card: AssistantStructuredCard): string | null {
  return "toolStatus" in card && card.toolStatus ? card.toolStatus : "status" in card ? card.status : null;
}

function diagnosticDetails(card: AssistantStructuredCard): { category: string | null; code: string | null; step: string | null } {
  const details = "details" in card && isRecord(card.details) ? card.details : null;
  return {
    category: text(details?.failureCategory),
    code: text(details?.failureCode),
    step: text(details?.failingStep),
  };
}

function actionErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(message.replace(/^\d+:\s*/, "")) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === "string" && parsed.error.message.trim() ? parsed.error.message : fallback;
  } catch {
    return message || fallback;
  }
}

export function responsePresentationForCards(presentation: AssistantResponsePresentation | undefined): AssistantResponsePresentation {
  return presentation === "collection" || presentation === "record_summary" || presentation === "analytical" || presentation === "proposed_action" || presentation === "execution_result" || presentation === "diagnostic"
    ? presentation
    : "conversational";
}

function SourceActions({ sources }: { sources: Array<{ href: string; label: string }> }) {
  const uniqueSources = Array.from(new Map(sources.map((source) => [source.href, source])).values());
  if (!uniqueSources.length) return null;
  return <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
    {uniqueSources.map((source) => <a key={`${source.href}-${source.label}`} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={source.href}>{source.label}</a>)}
  </div>;
}

function CollectionRows({ details, sources }: { details: unknown; sources: Array<{ href: string; label: string }> }) {
  const matches = isRecord(details) && Array.isArray(details.matches) ? details.matches : [];
  const rows = matches.flatMap((match) => {
    const item = isRecord(match) ? match : null;
    const link = item && isRecord(item.sourceLink) ? item.sourceLink : null;
    const href = text(link?.href);
    const label = text(item?.label) ?? text(link?.label);
    return href && label ? [{ href, label, secondary: text(item?.secondaryDescription), status: text(item?.status) }] : [];
  });
  const visible = rows.length ? rows : sources.map((source) => ({ href: source.href, label: source.label, secondary: null, status: null }));
  if (!visible.length) return null;
  return <div className="mt-3 divide-y rounded-lg border border-border/60 bg-card/30">{visible.slice(0, 10).map((row) => <a key={`${row.href}-${row.label}`} href={row.href} className="block px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="font-medium text-foreground">{row.label}</span>{row.secondary ? <span className="ml-2 text-muted-foreground">{row.secondary}</span> : null}{row.status ? <span className="ml-2 text-xs text-muted-foreground">{formatAssistantDisplayValue(row.status)}</span> : null}</a>)}</div>;
}

function AnalyticalDetails({ details }: { details: unknown }) {
  const metrics = isRecord(details) && Array.isArray(details.metrics) ? details.metrics : [];
  if (!metrics.length) return null;
  return <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{metrics.slice(0, 12).flatMap((metric) => {
    const item = isRecord(metric) ? metric : null;
    const label = text(item?.label);
    const value = typeof item?.value === "number" || typeof item?.value === "string" ? String(item.value) : null;
    return label && value ? [<div key={label} className="rounded-lg border border-border/70 bg-card/40 px-3 py-2"><p className="text-lg font-semibold tabular-nums">{value}</p><p className="text-xs leading-4 text-muted-foreground">{label}</p></div>] : [];
  })}</div>;
}

type SuggestedPrompt = { id: string; label: string; prompt: string; presentationPriority: number };

function suggestedPrompts(details: unknown): SuggestedPrompt[] {
  if (!isRecord(details) || !Array.isArray(details.suggestedPrompts)) return [];
  return details.suggestedPrompts.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = text(candidate.id);
    const label = text(candidate.label);
    const prompt = text(candidate.prompt);
    const priority = numericValue(candidate.presentationPriority);
    return id && label && prompt && priority !== null ? [{ id, label, prompt, presentationPriority: priority }] : [];
  }).sort((left, right) => left.presentationPriority - right.presentationPriority).slice(0, 4);
}

function SuggestedPromptChips({ details, onSubmit }: { details: unknown; onSubmit?: (prompt: string) => void }) {
  const prompts = suggestedPrompts(details);
  if (!prompts.length || !onSubmit) return null;
  return <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggested follow-up questions">
    {prompts.map((suggestion) => <Button key={suggestion.id} type="button" variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal px-2.5 py-1.5 text-left text-xs" onClick={() => onSubmit(suggestion.prompt)}>{suggestion.label}</Button>)}
  </div>;
}

function formatSquareFeet(value: unknown): string | null {
  const squareFeet = numericValue(value);
  return squareFeet === null ? null : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(squareFeet)} finished sq ft`;
}

function OperationalOrderSummaryDetails({ details, sources, onSubmitSuggestion }: { details: unknown; sources: Array<{ href: string; label: string }>; onSubmitSuggestion?: (prompt: string) => void }) {
  if (!isRecord(details) || !isRecord(details.operational)) return <><SourceActions sources={sources} /><SuggestedPromptChips details={details} onSubmit={onSubmitSuggestion} /></>;
  const operational = details.operational;
  const lineItems = Array.isArray(operational.lineItems) ? operational.lineItems.filter(isRecord) : [];
  const production = isRecord(operational.production) ? operational.production : null;
  const stations = production && Array.isArray(production.stations) ? production.stations.filter(isRecord) : [];
  const priority = text(operational.priority);
  const fulfillment = text(operational.fulfillmentStatus);
  const billing = text(operational.billingStatus);
  const total = numericValue(operational.orderTotal);
  const printProgressWarning = production && production.printProgressAvailable === false ? text(production.printProgressWarning) : null;
  return <div className="mt-3 space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {priority ? <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-2 text-xs"><p className="font-medium">{formatAssistantDisplayValue(priority)}</p><p className="text-muted-foreground">Priority</p></div> : null}
      {fulfillment ? <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-2 text-xs"><p className="font-medium">{formatAssistantDisplayValue(fulfillment)}</p><p className="text-muted-foreground">Fulfillment</p></div> : null}
      {billing ? <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-2 text-xs"><p className="font-medium">{formatAssistantDisplayValue(billing)}</p><p className="text-muted-foreground">Billing</p></div> : null}
      {total !== null ? <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-2 text-xs"><p className="font-medium tabular-nums">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)}</p><p className="text-muted-foreground">Order total</p></div> : null}
    </div>
    {lineItems.length ? <section className="overflow-hidden rounded-lg border border-border/60 bg-card/30"><div className="border-b border-border/60 bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">Line items · ordered pieces and finished geometry</div><div className="divide-y">{lineItems.slice(0, 25).map((line, index) => {
      const sequence = numericValue(line.sequence) ?? index + 1;
      const label = text(line.label) ?? "Order line";
      const product = text(line.productName) ?? text(line.materialName);
      const pieces = numericValue(line.orderedPieces);
      const dimensions = isRecord(line.dimensions) ? [numericValue(line.dimensions.widthInches), numericValue(line.dimensions.heightInches)] : null;
      const size = dimensions && dimensions[0] !== null && dimensions[1] !== null ? `${dimensions[0]} × ${dimensions[1]} in` : null;
      const sidedness = text(line.sidedness);
      const stationsForLine = Array.isArray(line.stations) ? line.stations.map(text).filter((value): value is string => Boolean(value)) : [];
      return <div key={`${sequence}-${label}-${index}`} className="px-3 py-2.5 text-sm"><p className="font-medium">Line {sequence} · {label}</p><p className="mt-0.5 text-xs text-muted-foreground">{[product, pieces === null ? null : `${new Intl.NumberFormat().format(pieces)} ordered pieces`, size, formatSquareFeet(line.finishedSquareFeet), sidedness === "unavailable" ? "Sidedness unavailable" : sidedness ? formatAssistantDisplayValue(sidedness) : null, stationsForLine.length ? stationsForLine.join(", ") : null].filter(Boolean).join(" · ")}</p></div>;
    })}</div></section> : null}
    {production ? <section className="rounded-lg border border-border/60 bg-card/30 px-3 py-2.5 text-sm"><p className="font-medium">Production</p><p className="mt-0.5 text-xs text-muted-foreground">{[`${numericValue(production.totalJobs) ?? 0} jobs`, `${numericValue(production.queuedJobs) ?? 0} queued`, `${numericValue(production.inProductionJobs) ?? 0} in production`, `${numericValue(production.completedJobs) ?? 0} completed`].join(" · ")}</p>{stations.length ? <p className="mt-1 text-xs text-muted-foreground">{stations.map((station) => `${text(station.stationLabel) ?? "Station"}: ${numericValue(station.jobCount) ?? 0}`).join(" · ")}</p> : null}{printProgressWarning ? <p className="mt-1 text-xs text-muted-foreground">{printProgressWarning}</p> : null}</section> : null}
    <SourceActions sources={sources} />
    <SuggestedPromptChips details={details} onSubmit={onSubmitSuggestion} />
  </div>;
}

function CustomerProductSalesDetails({ details, sources }: { details: unknown; sources: Array<{ href: string; label: string }> }) {
  if (!isRecord(details)) return <SourceActions sources={sources} />;
  const rows = Array.isArray(details.rows) ? details.rows.filter(isRecord) : [];
  if (!rows.length) return <SourceActions sources={sources} />;
  const money = (value: unknown) => typeof value === "number" ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value / 100) : "—";
  return <div className="mt-3 space-y-2"><div className="overflow-x-auto rounded-lg border border-border/60 bg-card/30"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Revenue</th><th className="px-3 py-2 text-right">Qty.</th><th className="px-3 py-2 text-right">Invoices</th></tr></thead><tbody>{rows.slice(0, 25).map((row, index) => <tr key={`${text(row.label) ?? "product"}-${index}`} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{text(row.label) ?? "Unnamed product"}</td><td className="px-3 py-2 text-right tabular-nums">{money(row.revenueCents)}</td><td className="px-3 py-2 text-right tabular-nums">{typeof row.quantity === "number" ? row.quantity : "—"}</td><td className="px-3 py-2 text-right tabular-nums">{typeof row.invoiceCount === "number" ? row.invoiceCount : "—"}</td></tr>)}</tbody></table></div>{Array.isArray(details.warnings) ? <p className="text-xs text-muted-foreground">{details.warnings.filter((warning): warning is string => typeof warning === "string").join(" ")}</p> : null}<SourceActions sources={sources} /></div>;
}

/** Dedicated UI for a paused analytical report. The card treats every value
 * as presentation text; selection sends only the opaque candidate ID and the
 * optimistic resolution version back to the server. */
function CustomerResolutionSelectionCard({ card }: { card: AssistantStructuredCard }) {
  const [selectedCandidateId, setSelectedCandidateId] = React.useState<string | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const selectResolution = useSelectAssistantReportResolution();
  const cancelResolution = useCancelAssistantReportResolution();
  const rawCard = card as unknown as Record<string, unknown>;
  const details = isRecord(rawCard.details) ? rawCard.details : null;
  const resolution = details && isRecord(details.resolution)
    ? details.resolution
    : details && text(details.resolutionId)
      ? details
    : isRecord(rawCard.resolution)
      ? rawCard.resolution
      : null;
  const resolutionId = text(resolution?.resolutionId);
  const version = numericValue(resolution?.version);
  const status = text(resolution?.status) ?? "awaiting_entity_resolution";
  const candidates: Record<string, unknown>[] = Array.isArray(resolution?.candidates) ? resolution.candidates.filter(isRecord) : [];
  const isSelectable = !cancelled && status === "awaiting_entity_resolution" && Boolean(resolutionId) && version !== null;
  if (!resolutionId || version === null || !candidates.length) return null;

  return <section className="rounded-xl border border-border/70 bg-card/45 px-3 py-3 text-sm shadow-sm" data-testid="assistant-customer-resolution-card">
    <p className="font-medium text-foreground">{text(rawCard.title) ?? "Choose a company"}</p>
    <p className="mt-1 text-muted-foreground">{text(rawCard.summary) ?? "Choose the purchasing company for this report."}</p>
    <div className="mt-3 space-y-2">
      {candidates.map((candidate: Record<string, unknown>) => {
        const candidateId = text(candidate.candidateId);
        const companyName = text(candidate.companyName) ?? "Company";
        const companyStatus = text(candidate.companyStatus);
        const location = text(candidate.location);
        const reason = text(candidate.matchReason);
        const companyLink = isRecord(candidate.companyLink)
          ? sourceLink(candidate.companyLink)
          : text(candidate.companyPath)
            ? { href: text(candidate.companyPath)!, label: `Open ${companyName}` }
            : null;
        const relatedContacts = Array.isArray(candidate.relatedContactNames) ? candidate.relatedContactNames.map(text).filter((name: string | null): name is string => Boolean(name)) : [];
        if (!candidateId) return null;
        const pending = selectResolution.isPending && selectedCandidateId === candidateId;
        return <div key={candidateId} className="rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-medium">{companyName}</p><p className="mt-0.5 text-xs text-muted-foreground">{[companyStatus, location].filter(Boolean).join(" · ")}</p></div></div>
          {reason ? <p className="mt-1 text-xs text-muted-foreground">{reason}</p> : null}
          {relatedContacts.length ? <p className="mt-1 text-xs text-muted-foreground">Related contacts: {relatedContacts.join(", ")}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!isSelectable || Boolean(selectedCandidateId) || selectResolution.isPending} onClick={() => {
              setSelectedCandidateId(candidateId);
              selectResolution.mutate({ resolutionId, candidateId, expectedVersion: version }, { onError: () => setSelectedCandidateId(null) });
            }}>{pending ? "Selecting…" : selectedCandidateId ? "Selected" : "Select company"}</Button>
            {companyLink ? <Button asChild type="button" size="sm" variant="outline"><a href={companyLink.href}>Open company</a></Button> : null}
          </div>
        </div>;
      })}
    </div>
    {isSelectable ? <Button type="button" size="sm" variant="ghost" className="mt-2 text-muted-foreground" disabled={cancelResolution.isPending || Boolean(selectedCandidateId)} onClick={() => {
      setCancelled(true);
      cancelResolution.mutate({ resolutionId, expectedVersion: version }, { onError: () => setCancelled(false) });
    }}>{cancelResolution.isPending ? "Cancelling…" : "Cancel report"}</Button> : null}
    {!isSelectable || selectedCandidateId ? <p className="mt-3 text-xs text-muted-foreground">{selectedCandidateId || status === "resuming" ? "Continuing the saved report…" : status === "resumed" ? "Report continued." : "This selection is no longer available."}</p> : null}
  </section>;
}

function OrderOptionSelectionCard({ card, conversationId, context }: { card: AssistantStructuredCard; conversationId: string | null; context: AssistantContextEnvelope }) {
  const submitSelection = useSubmitAssistantOrderOptionSelections();
  const raw = card as unknown as Record<string, unknown>;
  const details = isRecord(raw.details) ? raw.details : null;
  const payload = details && isRecord(details.orderOptionSelection) ? details.orderOptionSelection : null;
  const sessionId = text(payload?.orderIntakeSessionId); const productId = text(payload?.productId); const productName = text(payload?.productName); const treeId = text(payload?.pbv2TreeVersionId);
  const quantity = numericValue(payload?.quantity); const dimensions = isRecord(payload?.dimensions) ? payload.dimensions : null;
  const width = numericValue(dimensions?.widthIn); const height = numericValue(dimensions?.heightIn); const unit = text(dimensions?.unit) ?? "in";
  const groups = Array.isArray(payload?.groups) ? payload.groups.filter(isRecord) : [];
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [useDefaults, setUseDefaults] = React.useState(false);
  if (!conversationId || !sessionId || !productId || !productName || !treeId || !groups.length) return null;
  const complete = groups.every((group) => Boolean(values[text(group.nodeId) ?? ""]));
  const submit = () => submitSelection.mutate({ conversationId, orderIntakeSessionId: sessionId, productId, pbv2TreeVersionId: treeId, selections: Object.entries(values).map(([nodeId, valueId]) => ({ nodeId, valueId })), useRemainingDefaults: useDefaults, context });
  return <section className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 text-sm shadow-sm" data-testid="assistant-order-option-selection-card">
    <p className="font-medium text-foreground">{text(raw.title) ?? "Order options needed"}</p>
    <p className="mt-1 text-muted-foreground">{productName}{quantity !== null ? ` · Quantity: ${quantity}` : ""}{width !== null && height !== null ? ` · ${width} × ${height} ${unit}` : ""}</p>
    <p className="mt-1 text-xs text-muted-foreground">{text(payload?.helperText) ?? text(raw.summary)}</p>
    <div className="mt-3 space-y-3">{groups.map((group) => {
      const nodeId = text(group.nodeId); const label = text(group.label) ?? "Option"; const choices = Array.isArray(group.choices) ? group.choices.filter(isRecord) : [];
      if (!nodeId || !choices.length) return null;
      const value = values[nodeId] ?? "";
      return <fieldset key={nodeId} className="rounded-lg border border-border/60 bg-background/70 p-3"><legend className="px-1 font-medium">{label}</legend>{choices.length <= 4 ? <RadioGroup value={value} onValueChange={(next) => setValues((current) => ({ ...current, [nodeId]: next }))} className="mt-2 gap-2">{choices.map((choice) => { const valueId = text(choice.valueId); const choiceLabel = text(choice.label); if (!valueId || !choiceLabel) return null; return <label key={valueId} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted/60"><RadioGroupItem value={valueId} /><span>{choiceLabel}</span>{choice.isDefault === true ? <span className="text-xs text-muted-foreground">Default</span> : null}</label>; })}</RadioGroup> : <Select value={value} onValueChange={(next) => setValues((current) => ({ ...current, [nodeId]: next }))}><SelectTrigger className="mt-2"><SelectValue placeholder={`Choose ${label}`} /></SelectTrigger><SelectContent>{choices.map((choice) => { const valueId = text(choice.valueId); const choiceLabel = text(choice.label); return valueId && choiceLabel ? <SelectItem key={valueId} value={valueId}>{choiceLabel}{choice.isDefault === true ? " (Default)" : ""}</SelectItem> : null; })}</SelectContent></Select>}</fieldset>;
    })}</div>
    <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant={useDefaults ? "secondary" : "outline"} disabled={submitSelection.isPending} onClick={() => setUseDefaults((value) => !value)}>{useDefaults ? "Remaining defaults will be used" : "Use remaining defaults"}</Button><Button type="button" size="sm" disabled={submitSelection.isPending || (!complete && !useDefaults)} onClick={submit}>{submitSelection.isPending ? "Continuing…" : "Continue"}</Button></div>
    {submitSelection.isError ? <p role="status" className="mt-2 text-xs text-destructive">Unable to continue with these options. Refresh the request and try again.</p> : null}
  </section>;
}

type AssistantSourceLink = { href: string; label: string };

function sourceLink(value: unknown): AssistantSourceLink | null {
  if (!isRecord(value)) return null;
  const href = text(value.href);
  const label = text(value.label);
  return href && label ? { href, label } : null;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatQuantity(value: unknown, unit: unknown): string | null {
  const quantity = numericValue(value);
  if (quantity === null) return null;
  const label = text(unit);
  return `${new Intl.NumberFormat().format(quantity)}${label ? ` ${label}` : ""}`;
}

function productionLineLabel(item: Record<string, unknown>): string {
  const sequence = numericValue(item.lineItemSequence) ?? numericValue(item.lineSequence) ?? numericValue(item.displayNumber);
  const lineIdentity = sequence === null ? null : `Line ${sequence}`;
  const itemLabel = text(item.lineItemLabel) ?? text(item.productName) ?? text(item.label) ?? "Production item";
  return lineIdentity ? `${lineIdentity} · ${itemLabel}` : itemLabel;
}

function productionDueLabel(item: Record<string, unknown>): string | null {
  const dueState = text(item.dueState);
  if (dueState) return formatAssistantDisplayValue(dueState);
  if (item.overdue === true) return "Overdue";
  const dueDate = text(item.dueDate);
  if (!dueDate) return null;
  const parsed = new Date(dueDate);
  return Number.isNaN(parsed.getTime()) ? `Due ${dueDate}` : `Due ${parsed.toLocaleDateString()}`;
}

function uniqueLinks(links: Array<AssistantSourceLink | null>): AssistantSourceLink[] {
  const unique = new Map<string, AssistantSourceLink>();
  links.forEach((link) => {
    if (link && !unique.has(link.href)) unique.set(link.href, link);
  });
  return Array.from(unique.values());
}

function ProductionReportingDetails({ details, sources }: { details: unknown; sources: Array<{ href: string; label: string }> }) {
  if (!isRecord(details)) return <SourceActions sources={sources} />;
  const stations = Array.isArray(details.stations) ? details.stations.filter(isRecord) : [];
  const categories = Array.isArray(details.categories) ? details.categories.filter(isRecord) : [];
  const urgentJobs = Array.isArray(details.urgentJobs) ? details.urgentJobs.filter(isRecord) : Array.isArray(details.attentionItems) ? details.attentionItems.filter(isRecord) : [];
  const metrics = stations.flatMap((station) => {
    const label = text(station.stationLabel);
    const activeJobs = numericValue(station.activeJobs);
    if (!label || activeJobs === null) return [];
    const lines = numericValue(station.uniqueLineItems) ?? numericValue(station.activeLineItems) ?? numericValue(station.lineItemCount);
    const orders = numericValue(station.uniqueOrders) ?? numericValue(station.orderCount);
    const remaining = formatQuantity(station.remainingQuantity ?? station.totalRemainingQuantity, station.quantityUnit);
    const detail = [
      `${activeJobs} active ${activeJobs === 1 ? "job" : "jobs"}`,
      lines === null ? null : `${lines} ${lines === 1 ? "line" : "lines"}`,
      orders === null ? null : `${orders} ${orders === 1 ? "order" : "orders"}`,
      remaining ? `${remaining} remaining` : null,
      typeof station.overdueJobs === "number" ? `${station.overdueJobs} overdue` : null,
    ].filter(Boolean).join(" · ");
    return [{ label, value: activeJobs, detail }];
  });
  const groups = new Map<string, { key: string; items: Record<string, unknown>[] }>();
  urgentJobs.forEach((item, index) => {
    const key = text(item.orderId) ?? text(item.orderNumber) ?? text(item.productionJobId) ?? text(item.jobId) ?? `item-${index}`;
    const group = groups.get(key) ?? { key, items: [] };
    group.items.push(item);
    groups.set(key, group);
  });
  const orderGroups = Array.from(groups.values());
  const linkedHrefs = new Set(orderGroups.flatMap((group) => group.items.flatMap((item) => [
    sourceLink(item.orderSourceLink)?.href,
    sourceLink(item.productionJobSourceLink)?.href,
    sourceLink(item.sourceLink)?.href,
  ].filter((href): href is string => Boolean(href)))));
  return <div className="mt-3 space-y-3">
    {metrics.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{metrics.slice(0, 12).map((metric) => <div key={metric.label} className="rounded-lg border border-border/70 bg-card/40 px-3 py-2"><p className="text-lg font-semibold tabular-nums">{metric.value}</p><p className="text-xs leading-4 text-muted-foreground">{metric.label}</p><p className="text-[11px] text-muted-foreground">{metric.detail}</p></div>)}</div> : null}
    {categories.length ? <div className="grid grid-cols-2 gap-2">{categories.map((category) => {
      const label = text(category.label);
      const available = category.available === true;
      const value = typeof category.count === "number" ? String(category.count) : "Unavailable";
      return label ? <div key={label} className="rounded-lg border border-border/70 bg-card/40 px-3 py-2"><p className="font-medium">{value}</p><p className="text-xs text-muted-foreground">{label}{!available ? " — unavailable" : ""}</p></div> : null;
    })}</div> : null}
    {orderGroups.length ? <div className="space-y-3">{orderGroups.map((group) => {
      const first = group.items[0]!;
      const orderNumber = text(first.orderNumber);
      const customer = text(first.customerName);
      const due = productionDueLabel(first);
      const orderLink = uniqueLinks(group.items.map((item) => sourceLink(item.orderSourceLink)))[0] ?? null;
      return <section key={group.key} className="overflow-hidden rounded-lg border border-border/60 bg-card/30">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 bg-muted/20 px-3 py-2">
          <div><p className="font-medium text-sm">{orderNumber ? `Order ${orderNumber}` : "Production order"}{customer ? ` · ${customer}` : ""}</p>{due ? <p className="text-xs text-muted-foreground">{due}</p> : null}</div>
          {orderLink ? <a href={orderLink.href} className="text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{orderLink.label}</a> : null}
        </div>
        <div className="divide-y">{group.items.map((item, index) => {
          const jobLink = uniqueLinks([sourceLink(item.productionJobSourceLink), sourceLink(item.sourceLink)]).find((link) => link.href !== orderLink?.href) ?? null;
          const unit = item.quantityUnit;
          const ordered = formatQuantity(item.orderedQuantity, unit);
          const completed = formatQuantity(item.completedQuantity, unit);
          const remaining = formatQuantity(item.remainingQuantity, unit);
          const progressUnavailable = item.progressAvailable === false || (remaining === null && text(item.progressWarning));
          const station = text(item.stationLabel);
          const status = text(item.productionStatus) ?? text(item.status);
          const reason = text(item.inclusionReason) ?? text(item.reason);
          return <div key={`${text(item.orderLineItemId) ?? text(item.productionJobId) ?? text(item.jobId) ?? "line"}-${index}`} className="px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"><div className="min-w-0"><p className="font-medium text-foreground">{productionLineLabel(item)}</p><p className="mt-0.5 text-xs text-muted-foreground">{[station, status, productionDueLabel(item)].filter(Boolean).join(" · ") || "Production details unavailable"}</p></div>{jobLink ? <a href={jobLink.href} className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{jobLink.label}</a> : null}</div>
            {progressUnavailable ? <p className="mt-1 text-xs text-muted-foreground">{ordered ? `Ordered: ${ordered} · ` : ""}Print progress unavailable{item.progressWarning ? ` · ${String(item.progressWarning)}` : ""}</p> : (ordered || completed || remaining) ? <p className="mt-1 text-xs text-muted-foreground">{[ordered ? `Ordered: ${ordered}` : null, completed ? `Completed: ${completed}` : null, remaining ? `Remaining: ${remaining}` : null].filter(Boolean).join(" · ")}</p> : null}
            {reason ? <p className="mt-1 text-xs text-muted-foreground">{reason}</p> : null}
          </div>;
        })}</div>
      </section>;
    })}</div> : null}
    <SourceActions sources={sources.filter((source) => !linkedHrefs.has(source.href))} />
  </div>;
}

export function ResultCards({
  cards,
  context,
  onCancelPlan,
  onConfirmPlan,
  onCreatePlan,
  onCanonicalInteraction,
  executionPlans,
  cancellingPlanId,
  confirmingPlanId,
  diagnosticsEnabled = false,
  correlationId: persistedCorrelationId = null,
  diagnosticReference = null,
  presentation: serverPresentation,
  responseState,
  onRetry,
  onSubmitSuggestion,
  conversationId,
}: {
  cards: AssistantStructuredCard[];
  context: AssistantContextEnvelope;
  onCancelPlan: (planId: string, expectedPlanVersion: number) => Promise<unknown>;
  onConfirmPlan: (input: { planId: string; expectedPlanVersion: number; confirmationToken: string; context: AssistantContextEnvelope }) => Promise<unknown>;
  onCreatePlan: (turnId: string) => Promise<unknown>;
  onCanonicalInteraction?: (input: { proposalId: string; action: "accept_recommendation" | "dismiss_recommendation" | "apply_candidate"; actionId: string; newProductName?: string }) => Promise<unknown>;
  executionPlans: Record<string, { turnId: string; plan: unknown; confirmationToken: string | null }>;
  cancellingPlanId?: string;
  confirmingPlanId?: string;
  diagnosticsEnabled?: boolean;
  correlationId?: string | null;
  diagnosticReference?: string | null;
  presentation?: AssistantResponsePresentation;
  responseState?: AssistantResponseState;
  onRetry?: () => void;
  onSubmitSuggestion?: (prompt: string) => void;
  conversationId?: string | null;
}) {
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const [technicalDiagnostics, setTechnicalDiagnostics] = React.useState<any[] | null>(null);
  const [technicalDiagnosticsError, setTechnicalDiagnosticsErrorState] = React.useState<string | null>(null);
  const [technicalDiagnosticsLoading, setTechnicalDiagnosticsLoading] = React.useState(false);
  const [technicalDiagnosticsCopyStatus, setTechnicalDiagnosticsCopyStatus] = React.useState<"copied" | "failed" | null>(null);
  const publicDiagnosticReference = cards.flatMap((card: any) => [card.summary, card.body, ...(Array.isArray(card.details?.errors) ? card.details.errors : [])]).find((value) => typeof value === "string" && /\b(?:aip|pic)-[0-9a-f-]{36}\b/i.test(value))?.match(/\b(?:aip|pic)-[0-9a-f-]{36}\b/i)?.[0] ?? null;
  const correlationId = diagnosticReference ?? publicDiagnosticReference ?? persistedCorrelationId;
  const diagnosticLookupReference = correlationId;
  const setTechnicalDiagnosticsError = (message: string | null) => setTechnicalDiagnosticsErrorState(message ? (message.includes("Reference:") ? message : `${message} Reference: ${diagnosticLookupReference ?? "Unavailable"}`) : null);
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => Promise.race([
    globalThis.fetch(input, init),
    new Promise<Response>((_, reject) => window.setTimeout(() => reject(new Error(`Diagnostic record could not be loaded. Reference: ${diagnosticLookupReference ?? "Unavailable"}`)), 10_000)),
  ])) as typeof globalThis.fetch;
  const [genericCreateErrors, setGenericCreateErrors] = React.useState<Record<string, string>>({});
  const [genericConfirmErrors, setGenericConfirmErrors] = React.useState<Record<string, string>>({});
  const presentation = responsePresentationForCards(serverPresentation);
  // Defense in depth for turns persisted before the response-contract fix.
  const visibleCards = cards.filter((card) => (card as { kind: string }).kind !== "response_presentation");
  const latestCanonicalRevision = new Map<string, { revision: number; fingerprint: string }>();
  for (const card of visibleCards) {
    const canonical = toCanonicalProductIntentCard(card);
    if (!canonical?.proposalId) continue;
    const current = latestCanonicalRevision.get(canonical.proposalId);
    if (!current || canonical.revision > current.revision) latestCanonicalRevision.set(canonical.proposalId, { revision: canonical.revision, fingerprint: canonical.fingerprint });
  }
  if (!visibleCards.length) return null;
  const diagnosticCards = visibleCards.filter((card: any) => ["tool_warning", "provider_unavailable", "permission_denied", "not_found", "partial_result"].includes(card.kind)
    || (card.kind === "product_validation_errors" && Array.isArray(card.details?.errors) && card.details.errors.some((value: unknown) => typeof value === "string" && /\bpic-[0-9a-f-]{36}\b/i.test(value))));
  const createGenericPlan = async (turnId: string) => {
    try {
      await onCreatePlan(turnId);
      setGenericCreateErrors((current) => { const { [turnId]: _removed, ...remaining } = current; return remaining; });
    } catch (error) {
      setGenericCreateErrors((current) => ({ ...current, [turnId]: actionErrorMessage(error, "The server could not prepare this plan.") }));
    }
  };
  const confirmGenericPlan = async (input: { planId: string; expectedPlanVersion: number; confirmationToken: string; context: AssistantContextEnvelope }) => {
    try {
      const result = await onConfirmPlan(input);
      setGenericConfirmErrors((current) => { const { [input.planId]: _removed, ...remaining } = current; return remaining; });
      return result;
    } catch (error) {
      setGenericConfirmErrors((current) => ({ ...current, [input.planId]: actionErrorMessage(error, "The server did not confirm this plan.") }));
      return undefined;
    }
  };
  return <div className="mt-3 space-y-3">{visibleCards.map((card, index) => {
    const configurableProposal = toConfigurableProductProposal(card);
    if (configurableProposal) {
      const created = executionPlans[configurableProposal.turnId];
      if (created) {
        const planCard = { kind: "action_plan", title: configurableProposal.title, plan: { ...(created.plan as object), confirmationToken: created.confirmationToken } };
        const plan = toAssistantPlanCardModel(planCard);
        return plan ? <AssistantPlanCard key={`plan-${plan.id}-${index}`} card={planCard} context={context} onCancel={onCancelPlan} onConfirm={onConfirmPlan} cancelling={cancellingPlanId === plan.id} confirming={confirmingPlanId === plan.id} /> : null;
      }
      return <ConfigurableProductConfirmationCardView key={`configurable-${configurableProposal.turnId}-${index}`} confirmation={configurableProposal.confirmation} onCreatePlan={() => void onCreatePlan(configurableProposal.turnId)} />;
    }
    const configurableBlocked = toConfigurableProductConfirmation((card as any)?.details?.configurableProduct);
    if (configurableBlocked && !configurableBlocked.ready) return <ConfigurableProductConfirmationCardView key={`configurable-blocked-${index}`} confirmation={configurableBlocked} />;
    const canonicalProductIntent = toCanonicalProductIntentCard(card);
    if (canonicalProductIntent) return <CanonicalProductIntentCardView key={`canonical-product-intent-${canonicalProductIntent.revision}-${index}`} card={canonicalProductIntent} onInteraction={onCanonicalInteraction} />;
    const canonicalProductIntentProposal = toCanonicalProductIntentProposal(card);
    if (canonicalProductIntentProposal) {
      const created = executionPlans[canonicalProductIntentProposal.turnId];
      if (created) {
        const planCard = { kind: "action_plan", title: canonicalProductIntentProposal.title, plan: { ...(created.plan as object), confirmationToken: created.confirmationToken } };
        const plan = toAssistantPlanCardModel(planCard);
        return plan ? <AssistantPlanCard key={`plan-${plan.id}-${index}`} card={planCard} context={context} onCancel={onCancelPlan} onConfirm={onConfirmPlan} cancelling={cancellingPlanId === plan.id} confirming={confirmingPlanId === plan.id} /> : null;
      }
      const current = latestCanonicalRevision.get(canonicalProductIntentProposal.proposalId);
      const stale = Boolean(current && (current.revision !== canonicalProductIntentProposal.revision || current.fingerprint !== canonicalProductIntentProposal.fingerprint));
      return <CanonicalProductIntentReviewProposalCard key={`canonical-product-intent-proposal-${canonicalProductIntentProposal.turnId}-${index}`} proposal={canonicalProductIntentProposal} onCreatePlan={onCreatePlan} stale={stale} />;
    }
    const productCard = toAssistantProductManagementCard(card);
    if (productCard) return <AssistantProductManagementCardView key={`product-${productCard.kind}-${index}`} card={productCard} />;
    const pricingProposal = toAssistantProductPricingProposal(card);
    if (pricingProposal) {
      const created = executionPlans[pricingProposal.turnId];
      if (created) {
        const planCard = { kind: "action_plan", title: pricingProposal.title, plan: { ...(created.plan as object), confirmationToken: created.confirmationToken } };
        const plan = toAssistantPlanCardModel(planCard);
        return plan ? <AssistantPlanCard key={`plan-${plan.id}-${index}`} card={planCard} context={context} onCancel={onCancelPlan} onConfirm={onConfirmPlan} cancelling={cancellingPlanId === plan.id} confirming={confirmingPlanId === plan.id} /> : null;
      }
      return <AssistantProductPricingProposalCard key={`proposal-${pricingProposal.turnId}-${index}`} proposal={pricingProposal} onCreatePlan={onCreatePlan} />;
    }
    const productProposal = toAssistantProductDraftProposal(card);
    if (productProposal) {
      const created = executionPlans[productProposal.turnId];
      if (created) {
        const planCard = { kind: "action_plan", title: productProposal.title, plan: { ...(created.plan as object), confirmationToken: created.confirmationToken } };
        const plan = toAssistantPlanCardModel(planCard);
        return plan ? <AssistantPlanCard key={`plan-${plan.id}-${index}`} card={planCard} context={context} onCancel={onCancelPlan} onConfirm={onConfirmPlan} cancelling={cancellingPlanId === plan.id} confirming={confirmingPlanId === plan.id} /> : null;
      }
      return <AssistantProductDraftProposalCard key={`proposal-${productProposal.turnId}-${index}`} proposal={productProposal} onCreatePlan={onCreatePlan} />;
    }
    const quoteDraftProposal = toAssistantQuoteDraftProposal(card);
    if (quoteDraftProposal) {
      const created = executionPlans[quoteDraftProposal.turnId];
      if (created) {
        const planCard = { kind: "action_plan", title: quoteDraftProposal.title, plan: { ...(created.plan as object), confirmationToken: created.confirmationToken } };
        const plan = toAssistantPlanCardModel(planCard);
        return plan ? <AssistantPlanCard key={`plan-${plan.id}-${index}`} card={planCard} context={context} onCancel={onCancelPlan} onConfirm={onConfirmPlan} cancelling={cancellingPlanId === plan.id} confirming={confirmingPlanId === plan.id} /> : null;
      }
      return <AssistantQuoteDraftProposalCard key={`proposal-${quoteDraftProposal.turnId}-${index}`} proposal={quoteDraftProposal} onCreatePlan={onCreatePlan} />;
    }
    const proposal = toAssistantQuoteNoteProposal(card);
    if (proposal) {
      const created = executionPlans[proposal.turnId];
      if (created) {
        const planCard = { kind: "action_plan", title: proposal.title, plan: { ...(created.plan as object), confirmationToken: created.confirmationToken } };
        const plan = toAssistantPlanCardModel(planCard);
        return plan ? <AssistantPlanCard key={`plan-${plan.id}-${index}`} card={planCard} context={context} onCancel={onCancelPlan} onConfirm={onConfirmPlan} cancelling={cancellingPlanId === plan.id} confirming={confirmingPlanId === plan.id} /> : null;
      }
      return <AssistantQuoteNoteProposalCard key={`proposal-${proposal.turnId}-${index}`} proposal={proposal} onCreatePlan={onCreatePlan} />;
    }
    const genericProposal = toGenericActionProposal(card, visibleCards);
    if (genericProposal) {
      const created = executionPlans[genericProposal.turnId];
      if (created) {
        const planCard = { kind: "action_plan", title: genericProposal.title, plan: { ...(created.plan as object), confirmationToken: created.confirmationToken } };
        const plan = toAssistantPlanCardModel(planCard);
        return plan ? <AssistantPlanCard key={`plan-${plan.id}-${index}`} card={planCard} context={context} onCancel={onCancelPlan} onConfirm={confirmGenericPlan} cancelling={cancellingPlanId === plan.id} confirming={confirmingPlanId === plan.id} allowGenericConfirmation genericActionLabel={genericProposal.humanAction} confirmationError={genericConfirmErrors[plan.id]} /> : null;
      }
      return <AssistantGenericActionProposalCard key={`proposal-${genericProposal.turnId}-${index}`} proposal={genericProposal} onCreatePlan={createGenericPlan} error={genericCreateErrors[genericProposal.turnId]} />;
    }
    const plan = toAssistantPlanCardModel(card);
    if (plan) return <AssistantPlanCard key={`plan-${plan.id}-${index}`} card={card} context={context} onCancel={onCancelPlan} onConfirm={onConfirmPlan} cancelling={cancellingPlanId === plan.id} confirming={confirmingPlanId === plan.id} />;
    if (card.kind === "notice" || card.kind === "tool_status" || card.kind === "source" || diagnosticCards.includes(card)) return null;
    if (card.kind === "customer_resolution") return <CustomerResolutionSelectionCard key={`${card.kind}-${index}`} card={card} />;
    if (card.kind === "order_option_selection") return <OrderOptionSelectionCard key={`${card.kind}-${index}`} card={card} conversationId={conversationId ?? null} context={context} />;
    if (["production_queue_summary", "station_comparison", "attention_summary", "urgent_job_list"].includes(card.kind)) return <ProductionReportingDetails key={`${card.kind}-${index}`} details={card.details} sources={card.sourceLinks} />;
    if (card.kind === "customer_product_sales") return <CustomerProductSalesDetails key={`${card.kind}-${index}`} details={card.details} sources={card.sourceLinks} />;
    if (card.kind === "order_summary") return <OperationalOrderSummaryDetails key={`${card.kind}-${index}`} details={card.details} sources={card.sourceLinks} onSubmitSuggestion={onSubmitSuggestion} />;
    if (presentation === "collection" && card.kind === "search_results") return <CollectionRows key={`${card.kind}-${index}`} details={card.details} sources={card.sourceLinks} />;
    if (presentation === "analytical" && card.kind === "operational_metrics") return <AnalyticalDetails key={`${card.kind}-${index}`} details={card.details} />;
    if (["conversational", "record_summary"].includes(presentation) && ["current_context", "customer_summary", "order_summary", "product_summary"].includes(card.kind)) return <SourceActions key={`${card.kind}-${index}`} sources={card.sourceLinks} />;
    return <section key={`${card.kind}-${index}`} className="rounded-xl border border-border/70 bg-card/45 px-3 py-3 text-sm shadow-sm">
      <p className="font-medium text-foreground">{card.title}</p>
      <SourceActions sources={card.sourceLinks} />
      <SuggestedPromptChips details={card.details} onSubmit={onSubmitSuggestion} />
      {card.freshness ? <p className="mt-2 text-xs text-muted-foreground">Updated {new Date(card.freshness).toLocaleString()}</p> : null}
    </section>;
  })}
  {responseState?.retryable && onRetry ? <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button> : null}
  {diagnosticsEnabled && responseState?.diagnosticsAvailable && diagnosticCards.length ? <div className="pt-1"><Button type="button" variant="ghost" size="sm" className="h-7 px-1 text-xs text-muted-foreground" onClick={() => { const open = !diagnosticsOpen; setDiagnosticsOpen(open); if (open && correlationId && !technicalDiagnostics && !technicalDiagnosticsLoading) { setTechnicalDiagnosticsLoading(true); setTechnicalDiagnosticsError(null); fetch(`/api/assistant/diagnostics/${encodeURIComponent(correlationId)}`, { credentials: "include" }).then(async (response) => { const body = await response.json(); if (!response.ok || !body.success) { const code = body?.error?.code; throw new Error(response.status === 403 ? "You do not have permission to view technical diagnostics." : code === "DIAGNOSTIC_NOT_FOUND" ? "No diagnostic record was persisted for this reference." : "Technical diagnostics could not be loaded."); } setTechnicalDiagnostics(Array.isArray(body.data) ? body.data : [body.data]); }).catch((error) => setTechnicalDiagnosticsError(error instanceof Error ? error.message : "Technical diagnostics could not be loaded.")).finally(() => setTechnicalDiagnosticsLoading(false)); } }} aria-expanded={diagnosticsOpen}>{diagnosticsOpen ? "Hide diagnostics" : "Technical diagnostics"}</Button>{diagnosticsOpen ? <div className="mt-1 rounded-md border border-border/60 bg-muted/20 p-2 text-xs text-muted-foreground"><p>Reference: {correlationId ?? "Unavailable"}</p>{technicalDiagnosticsLoading ? <p>Loading technical diagnostics…</p> : null}{technicalDiagnosticsError ? <p>{technicalDiagnosticsError}</p> : null}{technicalDiagnostics?.map((item, index) => { const runtime = item.operatorRuntime; const shape = runtime?.providerDecisionShape; const deployment = item.deployment; return <div key={`${item.referenceId}-${index}`} className="mt-2 border-t border-border/40 pt-2"><p className="font-medium text-foreground">{item.diagnosticType}: {item.stage}</p><p>Provider/model: {item.provider ?? "Unavailable"} / {item.model ?? "Unavailable"}</p>{deployment ? <p>Build: SHA {deployment.gitSha ?? "Unavailable"}; {deployment.buildId ?? "no build ID"}; {deployment.operatorArchitectureVersion ?? "operator version unavailable"}</p> : null}<p>Parse / repair: {item.parseMethod} / {item.repairResult}</p>{runtime ? <><p>Operator: step {runtime.step}; tool {runtime.toolName ?? "none"}; argument validation {runtime.argumentValidationSucceeded ? "succeeded" : "failed"}; handler {runtime.handlerEntered ? "entered" : "not entered"}; observation {runtime.observationReturned ? "returned" : "not returned"}; continuation {runtime.continuationStarted ? "started" : "not started"}; final result {runtime.finalResultAccepted ? "accepted" : "not accepted"}; failure {runtime.failureKind ?? "None"}</p><p>Tool observations: {(runtime.toolObservations ?? []).map((observation: any) => `${observation.toolName}:${observation.status}`).join(", ") || "none"}; first failed {runtime.firstFailedTool ? `${runtime.firstFailedTool.toolName}:${runtime.firstFailedTool.status}` : "none"}</p></> : null}{shape ? <><p>Response shape: items {shape.responseItemCount ?? "unknown"} [{(shape.responseItemTypes ?? []).join(", ") || "none"}]; function calls {shape.functionCallCount ?? "unknown"}/{shape.functionCallItemCount ?? "unknown"}; text fragments {shape.outputTextItemCount ?? "unknown"} [{(shape.outputTextLengths ?? []).join(", ") || "none"}]</p><p>Decision shape: {shape.decisionDiscriminator ?? "none"}; parsed {shape.structuredDecisionPresent ? "yes" : "no"}; terminal {shape.terminalClassification ?? "none"}; parser {shape.parseClassification ?? "none"}; markers {shape.textBeginsKnownTransportMarker ? "start" : ""}{shape.textEndsKnownTransportMarker ? " end" : ""}{shape.finalTextRemainingAfterTransportStripping ? " text-after-strip" : ""}</p></> : null}<p>Validation schema: {item.validationSchema ?? "None"}</p><p>Validation paths: {(item.validationIssuePaths ?? []).join(", ") || "None"}</p><p>Validation codes: {(item.validationIssueCodes ?? []).join(", ") || "None"}</p><p>Capability: {item.selectedCapability ?? "None"}</p><p>Persistence: {item.persistenceResult}</p></div>; })}{technicalDiagnostics?.length ? <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void navigator.clipboard?.writeText(technicalDiagnostics.map((item) => `Reference: ${item.referenceId}\nCorrelation: ${item.correlationId}\nType: ${item.diagnosticType}\nStage: ${item.stage}\nError: ${item.errorCode ?? "None"}\nProvider/model: ${item.provider ?? "Unavailable"} / ${item.model ?? "Unavailable"}\nBuild SHA: ${item.deployment?.gitSha ?? "Unavailable"}\nParse/repair: ${item.parseMethod} / ${item.repairResult}\nOperator failure: ${item.operatorRuntime?.failureKind ?? "None"}\nSelected tool: ${item.operatorRuntime?.toolName ?? "None"}\nArgument validation: ${item.operatorRuntime?.argumentValidationSucceeded ? "succeeded" : "failed"}\nTool observations: ${(item.operatorRuntime?.toolObservations ?? []).map((observation: any) => `${observation.toolName}:${observation.status}`).join(", ") || "None"}\nFirst failed tool: ${item.operatorRuntime?.firstFailedTool ? `${item.operatorRuntime.firstFailedTool.toolName}:${item.operatorRuntime.firstFailedTool.status}` : "None"}\nResponse items: ${item.operatorRuntime?.providerDecisionShape?.responseItemCount ?? "None"}\nResponse types: ${(item.operatorRuntime?.providerDecisionShape?.responseItemTypes ?? []).join(", ") || "None"}\nFunction calls: ${item.operatorRuntime?.providerDecisionShape?.functionCallCount ?? "None"}\nText fragments: ${(item.operatorRuntime?.providerDecisionShape?.outputTextLengths ?? []).join(", ") || "None"}\nDecision discriminator: ${item.operatorRuntime?.providerDecisionShape?.decisionDiscriminator ?? "None"}\nValidation schema: ${item.validationSchema ?? "None"}\nValidation paths: ${(item.validationIssuePaths ?? []).join(", ") || "None"}\nValidation codes: ${(item.validationIssueCodes ?? []).join(", ") || "None"}\nCapability: ${item.selectedCapability ?? "None"}\nSpecialist: ${item.specialistName ?? "None"}\nPersistence: ${item.persistenceResult}\nCreated: ${item.createdAt}`).join("\n\n") )}>Copy diagnostics</Button> : null}</div> : null}</div> : null}
  </div>;
}

export function AssistantLauncher() {
  const { capabilities, capabilityError, capabilityLoading, toggle } = useAssistantWorkspace();
  const enabled = capabilities?.enabled && capabilities.conversationsEnabled;
  const reason = capabilityError || capabilities?.unavailableReason || "The assistant is not enabled for this organization.";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-muted-foreground hover:text-foreground"
      onClick={toggle}
      disabled={capabilityLoading || !enabled}
      aria-label={enabled ? "Open PrintersHero assistant" : "PrintersHero assistant unavailable"}
      title={enabled ? "Open assistant (Ctrl/Cmd+J)" : reason}
    >
      <Bot className="h-4 w-4" />
      <span className="sr-only">{enabled ? "Open assistant" : reason}</span>
    </Button>
  );
}

function PresentationControls() {
  const { presentation, priorPresentation, setPresentation, minimize } = useAssistantWorkspace();
  const choices: Array<{ value: Exclude<AssistantPresentation, "minimized">; label: string; icon: React.ElementType }> = [
    { value: "floating", label: "Float", icon: Expand },
    { value: "dock_left", label: "Dock left", icon: PanelLeft },
    { value: "dock_right", label: "Dock right", icon: PanelRight },
    { value: "dock_bottom", label: "Dock bottom", icon: PanelBottom },
    { value: "fullscreen", label: "Full screen", icon: Maximize2 },
  ];
  const current = presentation === "minimized" ? priorPresentation : presentation;
  return (
    <div className="flex items-center gap-0.5">
      <div className="hidden rounded-md border bg-muted/30 p-0.5 sm:flex">
        {choices.map(({ value, label, icon: Icon }) => (
          <Button key={value} type="button" size="icon" variant={current === value ? "secondary" : "ghost"} className="h-7 w-7" title={label} aria-label={label} onClick={() => setPresentation(value)}>
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
      </div>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Minimize assistant" aria-label="Minimize assistant" onClick={minimize}>
        <Minus className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function AssistantComposer({
  value,
  onChange,
  onRequestSend,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onRequestSend: () => void;
  disabled: boolean;
  placeholder: string;
}) {
  const canSend = Boolean(value.trim()) && !disabled;
  return <div className="flex items-end gap-2">
    <Textarea
      id="assistant-message"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        if (event.shiftKey) {
          event.preventDefault();
          const start = event.currentTarget.selectionStart ?? value.length;
          const end = event.currentTarget.selectionEnd ?? start;
          onChange(`${value.slice(0, start)}\n${value.slice(end)}`);
          return;
        }
        if (!event.nativeEvent.isComposing) {
          event.preventDefault();
          if (canSend) onRequestSend();
        }
      }}
      placeholder={placeholder}
      maxLength={8_000}
      rows={2}
      disabled={disabled}
      className="!min-h-12 max-h-48 resize-y py-2 text-sm leading-5"
      aria-label="Message the assistant"
    />
    <Button type="submit" size="icon" disabled={!canSend} aria-label="Send message"><Send className="h-4 w-4" /></Button>
  </div>;
}

/** Assistant content is trusted text from the server, not raw HTML. Preserve
 * intentional provider line breaks while leaving the existing text-only
 * rendering boundary intact. */
export function AssistantMessageContent({ content }: { content: string }) {
  return <div data-testid="assistant-message-content" className="whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground sm:text-base">{content}</div>;
}

function ConversationContent() {
  const { capabilities, presentation, context, refreshContext, activeConversationId, setActiveConversationId, draft, setDraft, executionPlans, saveExecutionPlan, updateExecutionPlan } = useAssistantWorkspace();
  const enabled = Boolean(capabilities?.enabled && capabilities.conversationsEnabled);
  const toolsEnabled = Boolean(capabilities?.toolsEnabled);
  const conversations = useAssistantConversations(enabled);
  const archivedConversations = useAssistantConversations(enabled, "archived");
  const createConversation = useCreateAssistantConversation();
  const updateConversation = useUpdateAssistantConversation();
  const archiveConversations = useArchiveAssistantConversations();
  const detail = useAssistantConversation(activeConversationId, enabled);
  const sendTurn = useSendAssistantTurn();
  const cancelPlan = useCancelAssistantPlan();
  const confirmPlan = useConfirmAssistantQuoteInternalNote();
  const createExecutionPlan = useCreateAssistantExecutionPlan();
  const canonicalInteraction = useCanonicalProductIntentInteraction();
  const [optimisticUserMessage, setOptimisticUserMessage] = React.useState<AssistantMessage | null>(null);
  React.useEffect(() => {
    if (!activeConversationId && conversations.data?.[0]) setActiveConversationId(conversations.data[0].id);
  }, [activeConversationId, conversations.data]);

  const createNew = async () => {
    const conversation = await createConversation.mutateAsync();
    setActiveConversationId(conversation.id);
    setDraft("");
  };

  const submitCurrentDraft = async () => {
    const message = draft.trim();
    if (!message || sendTurn.isPending || !toolsEnabled) return;
    setOptimisticUserMessage({ id: `pending-${Date.now()}`, role: "user", content: message, structuredCards: [], provider: null, model: null, correlationId: null, createdAt: new Date().toISOString() });
    let conversationId = activeConversationId;
    if (!conversationId) {
      const conversation = await createConversation.mutateAsync();
      conversationId = conversation.id;
      setActiveConversationId(conversationId);
    }
    try {
      await sendTurn.mutateAsync({ conversationId, message, context });
      setDraft("");
    } catch {
      setOptimisticUserMessage(null);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void submitCurrentDraft();
  };

  const submitSuggestedPrompt = async (prompt: string) => {
    const message = prompt.trim();
    if (!message || sendTurn.isPending || !toolsEnabled) return;
    // Suggestions intentionally travel through the same normal-message path
    // as typed text. They cannot call a tool, confirm a plan, or bypass the
    // server's tenant, authorization, and planning checks.
    setOptimisticUserMessage({ id: `pending-${Date.now()}`, role: "user", content: message, structuredCards: [], provider: null, model: null, correlationId: null, createdAt: new Date().toISOString() });
    let conversationId = activeConversationId;
    if (!conversationId) {
      const conversation = await createConversation.mutateAsync();
      conversationId = conversation.id;
      setActiveConversationId(conversationId);
    }
    try {
      await sendTurn.mutateAsync({ conversationId, message, context });
      setDraft("");
    } catch {
      setOptimisticUserMessage(null);
    }
  };

  const createPlanFromProposal = async (turnId: string) => {
    if (!activeConversationId) return;
    const result = await createExecutionPlan.mutateAsync({ conversationId: activeConversationId, turnId, context });
    saveExecutionPlan({ turnId, plan: result.plan, confirmationToken: result.confirmationToken });
  };
  const applyCanonicalInteraction = async (input: { proposalId: string; action: "accept_recommendation" | "dismiss_recommendation" | "apply_candidate"; actionId: string; newProductName?: string }) => {
    if (!activeConversationId) return;
    const result = await canonicalInteraction.mutateAsync({ conversationId: activeConversationId, ...input });
    if (result.navigation?.href) window.location.assign(result.navigation.href);
    return result;
  };

  const confirmQuoteNotePlan = async (input: { planId: string; expectedPlanVersion: number; confirmationToken: string; context: AssistantContextEnvelope }) => {
    const result = await confirmPlan.mutateAsync(input);
    const data = result && typeof result === "object" ? result as { plan?: unknown; result?: unknown } : null;
    if (data?.plan) updateExecutionPlan(input.planId, data.result ? { ...(data.plan as object), executionResult: data.result } : data.plan);
    return result;
  };

  const retry = async (message: string) => {
    if (!activeConversationId || sendTurn.isPending) return;
    await sendTurn.mutateAsync({ conversationId: activeConversationId, message, context });
  };
  const persistedMessages = detail.data?.messages ?? [];
  const optimisticMessagePersisted = Boolean(optimisticUserMessage && persistedMessages.some((message) => message.role === "user" && message.content === optimisticUserMessage.content));
  const messages = optimisticUserMessage && !optimisticMessagePersisted ? [...persistedMessages, optimisticUserMessage] : persistedMessages;
  React.useEffect(() => {
    if (optimisticMessagePersisted) setOptimisticUserMessage(null);
  }, [optimisticMessagePersisted]);
  const latestMessage = messages.at(-1) ?? null;
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant") ?? null;
  const conversationScroll = useAssistantConversationScroll({
    conversationId: activeConversationId,
    latestMessageId: latestMessage?.id ?? null,
    latestAssistantMessageId: latestAssistantMessage?.id ?? null,
    pendingUserMessageId: optimisticUserMessage?.id ?? null,
    completionKey: sendTurn.isError ? "send-error" : sendTurn.isPending ? "sending" : latestMessage?.id ?? "",
  });
  const conversationItems = visibleAssistantConversations(conversations.data, activeConversationId);
  // These are real client request lifecycles. The server does not publish
  // safe per-tool progress, so ordinary Operator turns remain truthfully
  // generic rather than inventing stages or exposing reasoning.
  const assistantWorking = resolveAssistantWorkingState({ turnPending: sendTurn.isPending, planPreparationPending: createExecutionPlan.isPending, planExecutionPending: confirmPlan.isPending });
  const fullComposerHelper = capabilities?.composerHelperText || capabilities?.unavailableReason || "Business questions are unavailable until AI configuration is complete.";
  const composerHelper = assistantComposerHelper(fullComposerHelper, presentation);

  if (!enabled) {
    return <WorkspaceNotice title="Assistant unavailable" description={capabilities?.unavailableReason || "The assistant is not enabled for this organization."} />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <AssistantConversationSidebar
        conversations={conversationItems}
        archivedConversations={archivedConversations.data ?? []}
        activeConversationId={activeConversationId}
        creating={createConversation.isPending}
        updatingConversationId={updateConversation.isPending ? updateConversation.variables.conversationId : null}
        archivedLoading={archivedConversations.isLoading}
        onCreate={() => void createNew()}
        onSelect={setActiveConversationId}
        onRename={(conversationId, title) => updateConversation.mutateAsync({ conversationId, patch: { title } })}
        onArchive={(conversationId) => updateConversation.mutateAsync({ conversationId, patch: { status: "archived" } })}
        onArchiveSelected={(conversationIds) => archiveConversations.mutateAsync({ conversationIds })}
        onRestore={(conversationId) => updateConversation.mutateAsync({ conversationId, patch: { status: "active" } })}
        onArchiveComplete={(conversationIds) => {
          if (!activeConversationId || !conversationIds.includes(activeConversationId)) return;
          setActiveConversationId(conversationItems.find((conversation) => !conversationIds.includes(conversation.id))?.id ?? null);
        }}
      />
      {/* Legacy sidebar markup remains intentionally removed in favor of the metadata-aware conversation sidebar.
        <div className="space-y-1 overflow-y-auto">
          {conversations.isLoading ? <p className="px-2 py-3 text-xs text-muted-foreground">Loading chats…</p> : null}
          {conversationItems.map((conversation) => (
            <button key={conversation.id} type="button" onClick={() => setActiveConversationId(conversation.id)} className={cn("w-full rounded px-2 py-2 text-left text-xs hover:bg-muted", activeConversationId === conversation.id && "bg-muted font-medium")}>
              <span className="line-clamp-2">{assistantConversationLabel(conversation.title)}</span>
            </button>
          ))}
        </div>
      */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
          <span className="truncate">Context: {context.pageTitle}{context.entityType ? ` · ${context.entityType}${context.entityId ? ` ${context.entityId}` : ""}` : ""}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={refreshContext} title="Refresh page context">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={conversationScroll.containerRef} onScroll={conversationScroll.onScroll} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite" data-testid="assistant-message-history">
          {detail.isLoading ? <p className="text-sm text-muted-foreground">Loading conversation…</p> : null}
          {!messages.length && !detail.isLoading ? (
            <div className="mx-auto mt-8 max-w-sm text-center">
              <Bot className="mx-auto mb-3 h-8 w-8 text-primary" />
              <h3 className="text-sm font-medium">PrintersHero assistant</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Ask about the record you’re viewing, your production work, or what needs attention.</p>
            </div>
          ) : messages.map((message, index) => {
            const previousUserMessage = [...messages.slice(0, index)].reverse().find((candidate) => candidate.role === "user")?.content;
            if (message.role === "user") return <article key={message.id} ref={message.id === latestMessage?.id ? conversationScroll.latestUserRef : undefined} className="ml-auto max-w-[85%]"><div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-6 text-primary-foreground shadow-sm">{message.content}</div><time className="mt-1 block text-right text-[11px] text-muted-foreground">{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></article>;
            return <article key={message.id} ref={message.id === latestAssistantMessage?.id ? conversationScroll.latestAssistantRef : undefined} className="max-w-3xl"><AssistantMessageContent content={message.content} /><ResultCards cards={message.structuredCards ?? []} presentation={message.presentation} responseState={message.responseState} context={context} conversationId={activeConversationId} onCancelPlan={(planId, expectedPlanVersion) => cancelPlan.mutateAsync({ planId, expectedPlanVersion })} onConfirmPlan={confirmQuoteNotePlan} onCreatePlan={createPlanFromProposal} onCanonicalInteraction={applyCanonicalInteraction} executionPlans={executionPlans} cancellingPlanId={cancelPlan.isPending ? cancelPlan.variables.planId : undefined} confirmingPlanId={confirmPlan.isPending ? confirmPlan.variables.planId : undefined} diagnosticsEnabled={Boolean(capabilities?.diagnosticsEnabled)} correlationId={message.correlationId} onRetry={previousUserMessage ? () => void retry(previousUserMessage) : undefined} onSubmitSuggestion={(prompt) => void submitSuggestedPrompt(prompt)} /><time className="mt-2 block text-[11px] text-muted-foreground">{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></article>;
          })}
          <AssistantWorkingIndicator active={assistantWorking.active} label={assistantWorking.label} />
          {sendTurn.isError ? <p role="status" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Your message wasn’t sent. Try again.</p> : null}
          </div>
          {conversationScroll.showJumpToLatest ? <Button type="button" variant="secondary" size="sm" className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md" onClick={() => conversationScroll.scrollToLatest("assistant", true)}>Jump to latest</Button> : null}
        </div>
        <form className="shrink-0 border-t bg-background/95 p-3 sm:px-4" onSubmit={(event) => void submit(event)} data-testid="assistant-composer">
          <label className="sr-only" htmlFor="assistant-message">Message the assistant</label>
          <AssistantComposer value={draft} onChange={setDraft} onRequestSend={() => void submitCurrentDraft()} disabled={sendTurn.isPending || !toolsEnabled} placeholder={toolsEnabled ? "Ask about this workspace" : "Business questions unavailable"} />
          <p className={cn("mt-2 text-xs leading-5 text-muted-foreground", composerHelper.compact && "truncate")} title={composerHelper.compact ? composerHelper.fullText : undefined} aria-label={composerHelper.compact ? composerHelper.fullText : undefined}>{composerHelper.text}</p>
        </form>
      </section>
    </div>
  );
}

function WorkspaceNotice({ title, description }: { title: string; description: string }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"><Bot className="h-8 w-8 text-muted-foreground" /><h3 className="text-sm font-medium">{title}</h3><p className="max-w-sm text-sm text-muted-foreground">{description}</p></div>;
}

function WorkspacePanel({ className }: { className?: string }) {
  return <section className={cn("flex min-h-0 flex-col overflow-hidden border bg-background shadow-xl", className)} aria-label="PrintersHero assistant workspace">
    <header className="flex h-11 shrink-0 items-center justify-between border-b px-3"><div className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-primary" /> Assistant</div><PresentationControls /></header>
    <ConversationContent />
  </section>;
}

export function AssistantDock({ side }: { side: "left" | "right" | "bottom" }) {
  const { layout, setDockSize, persistLayout } = useAssistantWorkspace();
  const horizontal = side === "bottom";
  const resizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = horizontal ? event.clientY : event.clientX;
    const initial = layout.dockSize;
    const move = (moveEvent: PointerEvent) => {
      const delta = (horizontal ? moveEvent.clientY : moveEvent.clientX) - start;
      setDockSize(initial + (side === "right" || side === "bottom" ? -delta : delta));
    };
    const finish = () => { persistLayout(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true });
  };
  return <div className={cn("relative flex min-h-0 min-w-0 shrink-0 overflow-hidden", horizontal ? "h-[var(--assistant-dock-size)] w-full flex-col" : "h-full w-[var(--assistant-dock-size)]")} style={{ ["--assistant-dock-size" as string]: `${layout.dockSize}px` }}>
    <div onPointerDown={resizeStart} className={cn("z-10 shrink-0 touch-none bg-border hover:bg-primary/50", horizontal ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize", side === "left" && "order-last", side === "bottom" && "order-first")} aria-label="Resize assistant workspace" role="separator" />
    <WorkspacePanel className="min-h-0 flex-1 border-0 shadow-none" />
  </div>;
}

export function AssistantOverlay() {
  const { capabilities, capabilityLoading, presentation, layout, setFloatingBounds, persistLayout, isMobile } = useAssistantWorkspace();
  const enabled = capabilities?.enabled && capabilities.conversationsEnabled;
  const [dragging, setDragging] = React.useState(false);
  const panelRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const handleResize = () => setFloatingBounds(layout.floatingBounds);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [layout.floatingBounds, setFloatingBounds]);
  if (capabilityLoading || !enabled || presentation === "minimized" || ["dock_left", "dock_right", "dock_bottom"].includes(presentation)) return null;
  if (presentation === "fullscreen" || isMobile) return <div className="fixed inset-0 z-[70] bg-background"><WorkspacePanel className="h-full border-0 shadow-none" /></div>;
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const pointerOrigin = { x: event.clientX, y: event.clientY };
    const boundsOrigin = { ...layout.floatingBounds };
    setDragging(true);
    const move = (moveEvent: PointerEvent) => setFloatingBounds({
      ...boundsOrigin,
      x: boundsOrigin.x + moveEvent.clientX - pointerOrigin.x,
      y: boundsOrigin.y + moveEvent.clientY - pointerOrigin.y,
    });
    const finish = () => { setDragging(false); persistLayout(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true });
  };
  return <section ref={panelRef} className={cn("fixed z-[70] flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-2xl", dragging && "select-none")} style={{ left: layout.floatingBounds.x, top: layout.floatingBounds.y, width: layout.floatingBounds.width, height: layout.floatingBounds.height }} aria-label="PrintersHero assistant workspace">
    <div className="flex h-11 shrink-0 cursor-move items-center justify-between border-b px-3" onPointerDown={startDrag}><div className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-primary" /> Assistant</div><PresentationControls /></div>
    <ConversationContent />
    <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" onPointerDown={(event) => { event.stopPropagation(); const pointerOrigin = { x: event.clientX, y: event.clientY }; const boundsOrigin = { ...layout.floatingBounds }; const move = (moveEvent: PointerEvent) => setFloatingBounds({ ...boundsOrigin, width: boundsOrigin.width + moveEvent.clientX - pointerOrigin.x, height: boundsOrigin.height + moveEvent.clientY - pointerOrigin.y }); const finish = () => { persistLayout(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true }); }} />
  </section>;
}
