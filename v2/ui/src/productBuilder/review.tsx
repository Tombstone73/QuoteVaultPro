import React from "react";
import { ArrowRight, CheckCircle2, CircleAlert, Info } from "lucide-react";
import { Chip } from "./referencePrimitives";

/** Facts supplied by the V2 Product Draft lifecycle/read model. The review
 * component deliberately does not derive lifecycle or readiness itself. */
export type ReviewLifecycle = Readonly<{
  activeVersion?: Readonly<{ label: string; publishedLabel?: string }>;
  draftVersion?: Readonly<{ label: string; statusLabel?: string }>;
  /** Immutable ProductVersion history from the canonical Product read model. */
  history?: readonly Readonly<{
    label: string;
    statusLabel: string;
    publishedLabel?: string;
    createdLabel: string;
  }>[];
  historyHasMore?: boolean;
}>;

export type ReviewChange = Readonly<{
  section: string;
  label: string;
  from?: string;
  to?: string;
}>;

export type ReviewFinding = Readonly<{
  severity: "error" | "warning" | "info";
  message: string;
}>;

export type ReviewValidation = Readonly<{
  /** `valid` is only appropriate when supplied by canonical server validation. */
  status: "valid" | "invalid" | "unknown";
  summary?: string;
}>;

export type ReviewSummaryProps = Readonly<{
  rows: readonly { label: string; value: string }[];
  lifecycle?: ReviewLifecycle;
  changes?: readonly ReviewChange[];
  findings?: readonly ReviewFinding[];
  validation?: ReviewValidation;
  /**
   * Transitional compatibility for the original adapter. It supplies no
   * validation provenance, so a zero count is shown as unverified rather
   * than being presented as a server-ready result.
   */
  errors?: number;
  /** @deprecated Supply lifecycle.activeVersion instead. */
  activeVersion?: string;
  /** @deprecated Supply lifecycle.draftVersion instead. */
  draftVersion?: string;
}>;

/** Direct port of the Lovable ReviewSummary presentation. V2 supplies every
 * lifecycle, change, and validation fact through this thin canonical digest. */
export function ReviewSummary({
  rows,
  lifecycle,
  changes = [],
  findings,
  validation,
  errors,
  activeVersion,
  draftVersion,
}: ReviewSummaryProps) {
  const active = lifecycle?.activeVersion ?? (activeVersion ? { label: activeVersion } : undefined);
  const draft = lifecycle?.draftVersion ?? (draftVersion ? { label: draftVersion } : undefined);
  const canonicalErrors = findings?.filter((finding) => finding.severity === "error").length;
  const errorCount = canonicalErrors ?? errors;
  const validationStatus = validation?.status ?? (errorCount && errorCount > 0 ? "invalid" : "unknown");
  const validationSummary = validation?.summary
    ?? (validationStatus === "invalid"
      ? `${errorCount ?? 0} blocking issue${errorCount === 1 ? "" : "s"} must be fixed before publishing.`
      : "Canonical validation has not been supplied.");

  return (
    <div className="space-y-3">
      <dl className="divide-y divide-border rounded-md border border-border">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,1fr)] gap-0.5 px-3 py-1.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
            <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-[0.8125rem]">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-md border border-border">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-[0.75rem] font-bold uppercase tracking-wide">
            {active ? `Changes vs ${active.label}` : "Draft lifecycle"}
          </span>
          {draft && <Chip>{draft.label}</Chip>}
          {draft?.statusLabel && <span className="text-[0.6875rem] text-muted-foreground">{draft.statusLabel}</span>}
          {active?.publishedLabel && <span className="ml-auto text-[0.6875rem] text-muted-foreground">{active.publishedLabel}</span>}
        </header>
        {changes.length > 0 ? (
          <ul className="divide-y divide-border">
            {changes.map((change, index) => (
              <li key={`${change.section}:${change.label}:${index}`} className="grid grid-cols-[minmax(0,1fr)] gap-1 px-3 py-1.5 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">{change.section}</span>
                <span className="min-w-0 truncate text-[0.8125rem]">{change.label}</span>
                {change.from !== undefined && change.to !== undefined && (
                  <span className="flex shrink-0 items-center gap-1.5 text-[0.75rem]">
                    <span className="num text-muted-foreground line-through">{change.from}</span>
                    <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
                    <span className="num font-medium">{change.to}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2 text-[0.75rem] text-muted-foreground">No canonical ProductVersion changes were supplied.</p>
        )}
      </div>

      {lifecycle?.history && lifecycle.history.length > 0 && (
        <div className="rounded-md border border-border">
          <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-[0.75rem] font-bold uppercase tracking-wide">Version history</span>
            <span className="text-[0.6875rem] text-muted-foreground">Immutable published history</span>
          </header>
          <ul className="divide-y divide-border">
            {lifecycle.history.map((version) => (
              <li key={version.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-1.5 text-[0.75rem]">
                <span className="min-w-0 truncate"><span className="font-medium">{version.statusLabel}</span> · {version.label}</span>
                <span className="text-right text-[0.6875rem] text-muted-foreground">{version.publishedLabel ?? version.createdLabel}</span>
              </li>
            ))}
          </ul>
          {lifecycle.historyHasMore && <p className="border-t border-border px-3 py-1.5 text-[0.6875rem] text-muted-foreground">Additional canonical historical versions are available.</p>}
        </div>
      )}

      <div
        aria-live="polite"
        className={`rounded-md border px-3 py-2 text-[0.75rem] ${validationStatus === "invalid" ? "border-late/50 bg-late/10 text-late" : validationStatus === "valid" ? "border-ok/50 bg-ok/10 text-ok" : "border-border bg-surface-2 text-muted-foreground"}`}
      >
        {validationStatus === "valid" ? (
          <span className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5" />{validationSummary}</span>
        ) : validationStatus === "invalid" ? (
          <span className="flex items-center gap-1.5"><CircleAlert className="size-3.5" />{validationSummary}</span>
        ) : (
          <span className="flex items-center gap-1.5"><Info className="size-3.5" />{validationSummary}</span>
        )}
        {findings && findings.length > 0 && (
          <ul className="mt-1.5 space-y-1 border-t border-current/20 pt-1.5">
            {findings.map((finding, index) => <li key={`${finding.severity}:${finding.message}:${index}`}>{finding.message}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
