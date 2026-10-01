import { useQuery } from "@tanstack/react-query";
import React from "react";
import { actionCenterApi } from "./api";
import type { PaymentsWorkspaceClient } from "./paymentsWorkspaceApi";

/**
 * Staff landing context consumes server-owned action and Billing projections,
 * never operational counts or financial totals derived from React workspaces.
 */
export const CommandCenter = ({ organizationId, sessionScope, canPaymentView = false, paymentsClient, openPayments }: Readonly<{
  organizationId: string;
  sessionScope: string;
  canPaymentView?: boolean;
  paymentsClient?: Pick<PaymentsWorkspaceClient, "summary">;
  openPayments?: (period: "today" | "month") => void;
}>) => {
  const actions = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "action-center"],
    queryFn: () => actionCenterApi.summary(organizationId),
    enabled: Boolean(organizationId && sessionScope),
  });
  if (!organizationId || !sessionScope) return <section className="v2-command-center"><p className="v2-proof-empty">Enter an authenticated organization to load its canonical action summary.</p></section>;
  return <section className="v2-command-center">
    <header><div><p>Workspace overview</p><h1>Command Center</h1><span>What needs staff attention now. Counts are bounded, tenant-scoped V2 domain projections.</span></div></header>
    {actions.isLoading && <p className="v2-proof-empty">Loading action summary…</p>}
    {actions.isError && <p className="v2-proof-empty">The action summary is unavailable. Open the permitted workspaces from navigation.</p>}
    {actions.data && <div className="v2-command-grid">
      {actions.data.items.map((item) => <article key={item.kind}>
        <header><h2>{item.label}</h2><a href={item.href}>Open workspace</a></header>
        <p><b>{item.count}</b><span>{item.count === 1 ? "item needs attention" : "items need attention"}</span></p>
      </article>)}
      {!actions.data.items.length && <p className="v2-proof-empty">No permitted operational action categories are available for this account.</p>}
    </div>}
    {canPaymentView && paymentsClient && <div className="v2-command-grid" aria-label="Payment metrics">
      <PaymentSummaryCard organizationId={organizationId} sessionScope={sessionScope} client={paymentsClient} period="today" openPayments={openPayments} />
      <PaymentSummaryCard organizationId={organizationId} sessionScope={sessionScope} client={paymentsClient} period="month" openPayments={openPayments} />
    </div>}
  </section>;
};

function PaymentSummaryCard({ organizationId, sessionScope, client, period, openPayments }: Readonly<{
  organizationId: string; sessionScope: string; client: Pick<PaymentsWorkspaceClient, "summary">; period: "today" | "month";
  openPayments?: (period: "today" | "month") => void;
}>) {
  const summary = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "payment-workspace", "summary", { period }],
    queryFn: () => client.summary(organizationId, { period }),
  });
  const value = summary.isError ? undefined : summary.data;
  const time = (timestamp: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short", timeZone: value!.window.timeZone }).format(new Date(timestamp));
  return <article aria-label={period === "today" ? "Payments Today" : "Payments This Month"}>
    <header><h2><a href={`/payments?period=${period}`} onClick={(event) => {
      if (!openPayments || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); openPayments(period);
    }}>{period === "today" ? "Payments Today" : "Payments This Month"}</a></h2></header>
    {summary.isPending && <p role="status">Loading payment summary...</p>}
    {summary.isError && <p role="alert">Payment summary unavailable. No financial total is available.</p>}
    {value && <>
      <p><b>{value.summary.paymentCount}</b><span>{value.summary.paymentCount === 1 ? "recorded payment" : "recorded payments"}</span></p>
      {value.summary.byCurrency.map((total) => <p key={total.currency}><strong>{total.currency} {(total.amountCents / 100).toFixed(2)}</strong><span>{total.paymentCount} payments</span></p>)}
      {!value.summary.byCurrency.length && <p>No V2 payments in this window.</p>}
      <small>{value.window.timeZone} ({value.window.timeZoneSource === "default_utc" ? "UTC fallback; no organization timezone configured" : "organization timezone"}). Occurred window: {time(value.window.startInclusive)} inclusive to {time(value.window.endExclusive)} exclusive. Recorded facts known as of {time(value.window.asOf)}.</small>
      <small>V2 payment facts only. Currencies are separate; no Invoice-status-derived totals.</small>
    </>}
  </article>;
}
