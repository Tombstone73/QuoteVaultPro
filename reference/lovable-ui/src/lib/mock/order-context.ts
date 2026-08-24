/**
 * Read-only aggregation of other modules for the Sales workspace.
 *
 * CONTEXT SUMMARY → DIRECT RECORD ACTION → OWNING MODULE.
 * Nothing here mutates or owns Artwork, Proofing, Production, Fulfillment or Billing state —
 * it only summarises what those modules already hold so Sales can link straight to the record.
 */

import type { ArtSide, LineArt, LineItem, SalesDoc } from "./data";
import { fulfillOrders } from "./fulfillment";
import { proofJobs } from "./proofing";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

/* ------------------------------------------------------------------ artwork */

export function lineArt(l: LineItem, kind: "line" | "production" = "line"): LineArt[] {
  return (l.art ?? []).filter((a) => a.kind === kind);
}

/** Sidedness cue shared with Design / Prepress / Production: one tile per side. */
export function lineSides(l: LineItem): ArtSide[] {
  const doubled = l.options.some((o) => o.label === "Sides" && o.value === "Double");
  return doubled ? ["Front", "Back"] : ["Single"];
}

export function artForSide(l: LineItem, side: ArtSide, kind: "line" | "production" = "line") {
  const files = lineArt(l, kind);
  return files.find((a) => a.side === side) ?? (side === "Single" ? files[0] : undefined);
}

export function lineHasAllArt(l: LineItem): boolean {
  return lineSides(l).every((s) => !!artForSide(l, s));
}

export interface ArtworkSummary {
  lines: number;
  ready: number;
  missing: number;
  tone: Tone;
  label: string;
}

export function artworkSummary(doc: SalesDoc): ArtworkSummary {
  const lines = doc.lines.length;
  const ready = doc.lines.filter(lineHasAllArt).length;
  const missing = lines - ready;
  return {
    lines,
    ready,
    missing,
    tone: missing === 0 ? "ok" : ready === 0 ? "bad" : "warn",
    label: missing === 0 ? "All lines have art" : `${missing} missing art`,
  };
}

/* ----------------------------------------------------------------- proofing */

export interface ProofingSummary {
  jobId?: string | undefined;
  counts: { label: string; n: number }[];
  tone: Tone;
  label: string;
}

export function proofingSummary(doc: SalesDoc): ProofingSummary {
  const jobs = proofJobs.filter((j) => j.order === doc.number);
  if (jobs.length === 0) {
    const pending = doc.lines.filter((l) => l.artworkStatus === "Proof Pending").length;
    const approved = doc.lines.filter(
      (l) => l.artworkStatus === "Approved" || l.artworkStatus === "Production Ready",
    ).length;
    return {
      counts: [
        { label: "Approved", n: approved },
        { label: "Awaiting customer", n: pending },
      ],
      tone: pending > 0 ? "warn" : "ok",
      label: pending > 0 ? `${pending} awaiting customer` : "No open proofs",
    };
  }
  const by = (pred: (s: string) => boolean) => jobs.filter((j) => pred(j.status)).length;
  const approved = by((s) => s === "Approved");
  const revision = by((s) => s === "Revision Requested");
  const waiting = by((s) => s === "Sent" || s === "Viewed" || s === "Awaiting Customer");
  const flagged =
    jobs.find((j) => j.status === "Revision Requested") ??
    jobs.find((j) => j.status !== "Approved") ??
    jobs[0];
  return {
    jobId: flagged?.id,
    counts: [
      { label: "Approved", n: approved },
      { label: "Awaiting customer", n: waiting },
      { label: "Revision requested", n: revision },
    ].filter((c) => c.n > 0),
    tone: revision > 0 ? "bad" : waiting > 0 ? "warn" : "ok",
    label:
      revision > 0
        ? `${revision} revision requested`
        : waiting > 0
          ? `${waiting} awaiting customer`
          : "All approved",
  };
}

/* --------------------------------------------------------------- production */

export interface ProductionSummary {
  total: number;
  complete: number;
  active: number;
  waiting: number;
  stations: string[];
  tone: Tone;
  label: string;
}

export function productionSummary(doc: SalesDoc): ProductionSummary {
  const total = doc.lines.length;
  const complete = doc.lines.filter((l) => l.routeStep === "Fulfillment").length;
  const active = doc.lines.filter(
    (l) => l.routeStep === "Production" || l.routeStep === "Finishing",
  ).length;
  const waiting = total - complete - active;
  const stations = [
    ...new Set(
      doc.lines
        .filter((l) => l.routeStep === "Production" || l.routeStep === "Finishing")
        .map((l) => l.station)
        .filter(Boolean),
    ),
  ] as string[];
  return {
    total,
    complete,
    active,
    waiting,
    stations,
    tone: active > 0 ? "info" : complete === total ? "ok" : "neutral",
    label:
      active > 0
        ? `${active} in production`
        : complete === total
          ? "Production complete"
          : `${waiting} not started`,
  };
}

/* -------------------------------------------------------------- fulfillment */

export interface FulfillContext {
  method: string;
  ordered: number;
  fulfilled: number;
  remaining: number;
  visits: number;
  latest?: string | undefined;
  status: string;
  tone: Tone;
  lines: { id: string; item: string; done: number; qty: number }[];
}

export function fulfillmentContext(doc: SalesDoc): FulfillContext {
  const record = fulfillOrders.find((o) => o.order === doc.number);
  const lines = record
    ? record.lines.map((l) => ({ id: l.id, item: l.item, done: l.done, qty: l.qty }))
    : doc.lines.map((l) => ({ id: l.id, item: l.description, done: l.pickedUp ?? 0, qty: l.qty }));
  const ordered = lines.reduce((a, l) => a + l.qty, 0);
  const fulfilled = lines.reduce((a, l) => a + l.done, 0);
  const remaining = ordered - fulfilled;
  const visits = record?.visits ?? [];
  const last = visits[visits.length - 1];
  const status = remaining === 0 ? "Fulfilled" : fulfilled > 0 ? "Partial" : "Not started";
  return {
    method: record?.method ?? doc.shipMethod ?? "Customer Pickup",
    ordered,
    fulfilled,
    remaining,
    visits: visits.length,
    latest: last ? `${last.what} — ${last.date}` : undefined,
    status,
    tone: remaining === 0 ? "ok" : fulfilled > 0 ? "warn" : "neutral",
    lines,
  };
}
