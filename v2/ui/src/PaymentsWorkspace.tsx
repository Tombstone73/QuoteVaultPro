import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { manualPaymentMethods, previewPaymentTender, type PaymentWorkspaceAmount, type PaymentWorkspaceFact, type PaymentWorkspaceInvoice, type PaymentWorkspaceQuery, type PaymentWorkspaceRecordInput } from "../../src/modules/billing/paymentWorkspace";
import type { PaymentsRecordResult, PaymentsWorkspaceClient } from "./paymentsWorkspaceApi";
import { bindPaymentRequestRecovery, readPaymentRequestRecovery } from "./paymentRequestRecovery";

type Props = Readonly<{
  organizationId: string; sessionScope: string; client: PaymentsWorkspaceClient;
  verifiedUserId?: string;
  canPaymentView: boolean; canInvoiceView: boolean; canPaymentRecord: boolean; csrfReady: boolean;
  initialQuery?: PaymentWorkspaceQuery;
  onRequestStateChange?: (locked: boolean) => void;
  openLegacyLedger?: () => void; openCustomer?: (id: string) => void; openOrder?: (id: string) => void; openInvoice?: (id: string) => void;
}>;
const formatMoney = (amount: PaymentWorkspaceAmount) => `${amount.currency} ${(amount.cents / 100).toFixed(2)}`;
const inputMoney = (text: string): number | undefined => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text.trim())) return undefined;
  const [whole, fraction = ""] = text.trim().split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : undefined;
};
const errorInfo = (error: unknown) => {
  const value = error as { code?: string; message?: string } | undefined;
  return { code: value?.code ?? "UNKNOWN", message: value?.message ?? "Payments could not be loaded. Retry the request." };
};
const actorLabel = (actor: PaymentWorkspaceFact["actor"]) => {
  if (actor.kind === "service") return `Service${actor.subjectId ? ` ${actor.subjectId}` : " (identity unavailable)"}`;
  if (actor.kind === "staff") return `Staff${actor.staffActorUserId || actor.subjectId ? ` ${actor.staffActorUserId ?? actor.subjectId}` : " (identity unavailable)"}`;
  if (actor.kind === "delegated_ai") return `Delegated AI${actor.staffActorUserId ? ` for Staff ${actor.staffActorUserId}` : " (Staff unavailable)"}`;
  if (actor.kind === "portal") return `Portal${actor.subjectId ? ` ${actor.subjectId}` : " (identity unavailable)"}`;
  return "Recorded actor unavailable";
};

/** Client scope may change, but verified same-identity submitted intent survives teardown. */
export function PaymentsWorkspace(props: Props) {
  return <PaymentWorkspaceBody key={JSON.stringify([props.verifiedUserId ?? null, props.sessionScope, props.organizationId])} {...props} />;
}
function PaymentWorkspaceBody({ organizationId, sessionScope, client, verifiedUserId, canPaymentView, canInvoiceView, canPaymentRecord, csrfReady, initialQuery, onRequestStateChange, openLegacyLedger, openCustomer, openOrder, openInvoice }: Props) {
  const cache = useQueryClient();
  const [recovered] = useState(() => readPaymentRequestRecovery(verifiedUserId, organizationId));
  const binding = useRef<ReturnType<typeof bindPaymentRequestRecovery>>();
  const active = useRef(false);
  const unknown = useRef(Boolean(recovered && !recovered.receipt));
  useLayoutEffect(() => {
    binding.current = bindPaymentRequestRecovery(verifiedUserId, organizationId); active.current = true;
    return () => { active.current = false; binding.current?.release(); };
  }, [verifiedUserId, organizationId]);
  const [query, setQuery] = useState<PaymentWorkspaceQuery>(initialQuery ?? { period: "today" });
  const [customerSearch, setCustomerSearch] = useState("");
  const [editor, setEditor] = useState(Boolean(recovered && !recovered.receipt));
  const [entryCustomer, setEntryCustomer] = useState(recovered?.form.customerId ?? "");
  const [invoicePage, setInvoicePage] = useState(recovered?.form.invoicePage ?? 1);
  const [selected, setSelected] = useState<readonly Readonly<{ invoice: PaymentWorkspaceInvoice; appliedText: string }>[]>(recovered && !recovered.receipt ? recovered.form.selected : []);
  const [method, setMethod] = useState<(typeof manualPaymentMethods)[number]>(recovered?.input.method ?? "cash");
  const [tenderText, setTenderText] = useState(recovered && !recovered.receipt ? recovered.form.tenderText : "");
  const [attempt, setAttempt] = useState<PaymentWorkspaceRecordInput | undefined>(recovered && !recovered.receipt ? recovered.input : undefined);
  const [receipt, setReceipt] = useState<PaymentsRecordResult | undefined>(recovered?.receipt);
  const [notice, setNotice] = useState(recovered && !recovered.receipt ? "The original submitted payment has an unconfirmed outcome. Retry the exact request; do not start another payment." : "");
  const reportingKey = JSON.stringify([initialQuery?.period ?? "today", initialQuery?.fromDate, initialQuery?.toDate]);
  const reportingKeyRef = useRef(reportingKey);
  useEffect(() => {
    if (reportingKeyRef.current === reportingKey) return;
    reportingKeyRef.current = reportingKey;
    setQuery((current) => ({ ...current, period: initialQuery?.period ?? "today", fromDate: initialQuery?.fromDate, toDate: initialQuery?.toDate, page: 1 }));
  }, [reportingKey, initialQuery?.period, initialQuery?.fromDate, initialQuery?.toDate]);
  const scope = ["v2", sessionScope, organizationId, "payment-workspace"];
  const canRead = Boolean(organizationId && sessionScope && canPaymentView);
  const canRecord = Boolean(canRead && canInvoiceView && canPaymentRecord);
  const payments = useQuery({ queryKey: [...scope, "page", query], queryFn: () => client.page(organizationId, query), enabled: canRead });
  const customers = useQuery({ queryKey: [...scope, "customers", customerSearch], queryFn: () => client.customers(organizationId, customerSearch), enabled: canRead });
  const invoices = useQuery({ queryKey: [...scope, "invoices", entryCustomer, invoicePage], queryFn: () => client.invoices(organizationId, { customerId: entryCustomer, page: invoicePage, pageSize: 25 }), enabled: Boolean(canRecord && editor && entryCustomer) });
  useEffect(() => {
    if (canRecord) return;
    const invoiceScope = ["v2", sessionScope, organizationId, "payment-workspace", "invoices"];
    void cache.cancelQueries({ queryKey: invoiceScope });
    cache.removeQueries({ queryKey: invoiceScope });
    // An uncertain submitted request must retain its original identity and
    // locked form. Only unsubmitted state may be discarded on authority loss.
    if (attempt) return;
    setEditor(false); setEntryCustomer(""); setInvoicePage(1); setSelected([]);
    setTenderText(""); setMethod("cash"); setNotice("");
  }, [canRecord, attempt, cache, sessionScope, organizationId]);
  const mutation = useMutation({
    mutationFn: (input: PaymentWorkspaceRecordInput) => client.record(organizationId, input),
    onSuccess: (value, input) => {
      if (!active.current || binding.current?.settle(input, value) === "superseded") return;
      unknown.current = false;
      setReceipt(value); setEditor(false); setSelected([]); setTenderText(""); setAttempt(undefined);
      setNotice("Payment recorded. Change due is cash receipt evidence only, not a credit or refund.");
      void cache.invalidateQueries({ queryKey: scope });
    },
    onError: (error, input) => {
      if (!active.current) return;
      const failure = errorInfo(error);
      const outcome = binding.current?.settle(input, undefined, failure.code);
      if (outcome === "superseded") return;
      if (outcome === "initial_no_write" || (outcome === "local" && failure.code === "STALE_STATE" && !unknown.current)) {
        setAttempt(undefined); setSelected([]); setTenderText("");
        setNotice("Invoice balances changed. Selection cleared; refresh balances and explicitly confirm new allocations.");
        void invoices.refetch();
      } else {
        unknown.current = true;
        setNotice(`${failure.message} The original request is retained. Retry it before starting another payment.`);
      }
    },
  });
  useEffect(() => {
    onRequestStateChange?.(Boolean(attempt || mutation.isPending));
  }, [attempt, mutation.isPending, onRequestStateChange]);
  const currency = selected[0]?.invoice.collectibleBalance.currency;
  const allocations = selected.map(({ invoice, appliedText }) => ({ invoiceId: invoice.invoiceId, amount: { currency: invoice.collectibleBalance.currency, cents: inputMoney(appliedText) ?? 0 } }));
  const tender = { tendered: { currency: currency ?? "USD", cents: inputMoney(tenderText) ?? 0 }, expectedBalances: selected.map(({ invoice }) => ({ invoiceId: invoice.invoiceId, collectibleBalance: invoice.collectibleBalance })) };
  let preview: ReturnType<typeof previewPaymentTender> | undefined;
  let previewError = "";
  try { if (selected.length) preview = previewPaymentTender(allocations, method, tender); }
  catch (error) { previewError = errorInfo(error).message; }
  const filter = (changes: Partial<PaymentWorkspaceQuery>) => setQuery((current) => ({ ...current, ...changes, page: 1 }));
  const choosePeriod = (period: PaymentWorkspaceQuery["period"]) => setQuery((current) => ({ period, customerId: current.customerId, method: current.method, pageSize: current.pageSize, ...(period === "custom" ? { fromDate: payments.data?.window.todayDate, toDate: payments.data?.window.todayDate } : {}) }));
  const submit = () => {
    if (!canRecord || !csrfReady || mutation.isPending) return;
    if (attempt) { mutation.mutate(attempt); return; }
    if (!preview) return;
    const input: PaymentWorkspaceRecordInput = { businessRequestId: crypto.randomUUID(), occurredAt: new Date().toISOString(), method, allocations, tender };
    binding.current?.begin(input, { customerId: entryCustomer, invoicePage, selected, tenderText }); unknown.current = false;
    setAttempt(input); mutation.mutate(input);
  };
  if (!organizationId || !sessionScope) return <section className="v2-finance-workspace"><p>Select an authenticated organization before opening Payments.</p></section>;
  if (!canPaymentView) return <section className="v2-finance-workspace"><p>You do not have permission to view payments.</p></section>;
  const window = payments.data?.window;
  const time = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short", timeZone: window?.timeZone ?? "UTC" }).format(new Date(date));
  const locked = Boolean(attempt || mutation.isPending);
  return <section className="v2-finance-workspace space-y-4" aria-label="Payments workspace">
    <header className="v2-finance-heading"><div><span>Finance</span><h1>Payments</h1><p>V2 payment facts only. One row per recorded payment, with its Invoice allocations.</p></div><div className="v2-finance-actions">
      {openLegacyLedger && <button className="v2-quiet-button" onClick={openLegacyLedger}>Native + legacy allocation ledger</button>}
      {canRecord && <button className="v2-invoice-issue" disabled={!csrfReady || editor} onClick={() => { setEditor(true); setReceipt(undefined); setNotice(""); }}>Record manual payment</button>}
    </div></header>
    <div className="v2-finance-actions flex flex-wrap gap-3" aria-label="Payment filters">
      <label>Period <select aria-label="Payment period" value={query.period} onChange={(event) => choosePeriod(event.target.value as PaymentWorkspaceQuery["period"])}><option value="today">Today</option><option value="month">Month</option><option value="custom">Custom</option></select></label>
      {query.period === "custom" && <><label>From <input type="date" aria-label="From date" value={query.fromDate ?? ""} onChange={(event) => filter({ fromDate: event.target.value })} /></label><label>Through <input type="date" aria-label="Through date" value={query.toDate ?? ""} onChange={(event) => filter({ toDate: event.target.value })} /></label></>}
      <label>Find Customer <input aria-label="Find Customer" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} /></label>
      <label>Customer <select aria-label="Payment Customer" value={query.customerId ?? ""} onChange={(event) => filter({ customerId: event.target.value || undefined })}><option value="">All Customers</option>{customers.data?.map((customer) => <option key={customer.customerId} value={customer.customerId}>{customer.customerName}</option>)}</select></label>
      <label>Method <select aria-label="Filter payment method" value={query.method ?? ""} onChange={(event) => filter({ method: event.target.value as PaymentWorkspaceQuery["method"] || undefined })}><option value="">All methods</option>{[...manualPaymentMethods, "card", "ach"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <button className="v2-quiet-button" disabled={payments.isFetching} onClick={() => void payments.refetch()}>Refresh payments</button>
    </div>
    {customers.error && <p role="alert" className="notice error">Customer filter unavailable: {errorInfo(customers.error).message}</p>}
    {window && <p className="muted">{window.timeZone}{window.timeZoneSource === "default_utc" ? " (UTC fallback; no organization timezone configured)" : " (organization timezone)"}. Occurred window: {time(window.startInclusive)} inclusive to {time(window.endExclusive)} exclusive. Recorded facts known as of {time(window.asOf)}.</p>}
    {payments.isPending && <p role="status">Loading payment facts...</p>}
    {payments.error && <p role="alert" className="notice error">{errorInfo(payments.error).message}</p>}
    {payments.data && !payments.error && <>
      <div className="v2-finance-metrics grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Payment summary">
        <div><small>Unique payments</small><strong>{payments.data.summary.paymentCount}</strong></div>
        {payments.data.summary.byCurrency.map((total) => <div key={total.currency}><small>{total.currency}: {total.paymentCount} payments</small><strong>{formatMoney({ currency: total.currency, cents: total.amountCents })}</strong><p>Applied {formatMoney({ currency: total.currency, cents: total.appliedCents })}</p><p>Refunded from these payments {formatMoney({ currency: total.currency, cents: total.refundedCents })}</p><p>Net after refunds {formatMoney({ currency: total.currency, cents: total.netCents })}</p></div>)}
      </div>
      <p className="muted">Refund amounts include successful lifetime refunds of these payments known at the server read time, not only refunds that occurred in this period. Currencies are never combined.</p>
      {!payments.data.items.length ? <p>No V2 payments match this period and filters.</p> : <div className="v2-finance-grid-wrap overflow-x-auto"><table className="v2-finance-grid"><thead><tr><th>Occurred / Recorded</th><th>Customer</th><th>Order / Invoice allocations</th><th>Payment / Applied</th><th>Refunded / Net</th><th>Method / Source</th><th>Recorded actor</th><th>Refund state</th></tr></thead><tbody>{payments.data.items.map((payment) => <tr key={payment.paymentId}>
        <td><time dateTime={payment.occurredAt}>{time(payment.occurredAt)}</time><br /><small>Recorded {time(payment.recordedAt)}</small></td>
        <td>{[...new Map(payment.allocations.map((entry) => [entry.customerId ?? "unknown", entry])).values()].map((entry) => <div key={entry.customerId ?? "unknown"}>{entry.customerId && openCustomer ? <button className="v2-finance-link" onClick={() => openCustomer(entry.customerId!)}>{entry.customerName ?? "Customer name unavailable"}</button> : entry.customerName ?? "Customer unavailable"}</div>)}{!payment.allocations.length && "Customer unavailable"}</td>
        <td>{payment.allocations.map((entry) => <div key={entry.allocationId}>{entry.orderId && openOrder ? <button className="v2-finance-link" onClick={() => openOrder(entry.orderId!)}>Order {entry.orderNumber ?? entry.orderId}</button> : `Order ${entry.orderNumber ?? "unavailable"}`}<br />{openInvoice && canInvoiceView ? <button className="v2-finance-link" onClick={() => openInvoice(entry.invoiceId)}>Invoice {entry.invoiceNumber ?? entry.invoiceId}</button> : `Invoice ${entry.invoiceNumber ?? entry.invoiceId}`}<br /><small>Applied {formatMoney(entry.amount)}; refunded {formatMoney(entry.refundedAmount)}</small></div>)}{!payment.allocations.length && "Allocation details unavailable"}</td>
        <td>{formatMoney(payment.amount)}<br /><small>Applied {formatMoney(payment.appliedAmount)}</small></td><td>{formatMoney(payment.refundedAmount)}<br /><small>Net {formatMoney(payment.netAmount)}</small></td><td>{payment.method}<br /><small>{payment.source}</small></td><td>{actorLabel(payment.actor)}</td><td>{payment.refundState.replaceAll("_", " ")}</td>
      </tr>)}</tbody></table></div>}
      <div className="v2-finance-actions"><span>{payments.data.totalMatching} payments; page {payments.data.page}</span><button className="v2-quiet-button" disabled={payments.data.page <= 1 || payments.isFetching} onClick={() => setQuery((current) => ({ ...current, page: payments.data!.page - 1 }))}>Previous payments</button><button className="v2-quiet-button" disabled={!payments.data.hasNextPage || payments.isFetching} onClick={() => setQuery((current) => ({ ...current, page: payments.data!.page + 1 }))}>Next payments</button></div>
    </>}
    {notice && <p role="status" className="v2-invoice-notice">{notice}</p>}
    {receipt && <section className="v2-finance-detail" aria-label="Recorded payment receipt"><h2>Recorded payment receipt</h2><p>Payment {receipt.payment.payment.paymentId}: {formatMoney(receipt.payment.payment.amount)}</p>{receipt.tenderReceipt && <dl className="v2-invoice-totals">{Object.entries({ "Selected balance": receipt.tenderReceipt.selectedBalance, Tendered: receipt.tenderReceipt.tendered, Applied: receipt.tenderReceipt.applied, "Change due": receipt.tenderReceipt.changeDue }).map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{formatMoney(amount)}</dd></div>)}</dl>}</section>}
    {editor && canRecord && <section className="v2-finance-detail space-y-3" aria-label="Manual payment entry"><h2>Manual multi-invoice payment</h2><p>Use one Customer and one currency. Invoice balances are server-derived and revalidated under Billing's locks.</p>
      <label>Customer account <select aria-label="Entry Customer" disabled={locked} value={entryCustomer} onChange={(event) => { setEntryCustomer(event.target.value); setInvoicePage(1); setSelected([]); setTenderText(""); }}><option value="">Choose Customer</option>{customers.data?.map((customer) => <option key={customer.customerId} value={customer.customerId}>{customer.customerName}</option>)}</select></label>
      {entryCustomer && invoices.isPending && <p role="status">Loading authoritative Invoice balances...</p>}
      {invoices.error && <p role="alert" className="notice error">{errorInfo(invoices.error).message}</p>}
      {invoices.data && <><div className="overflow-x-auto"><table className="v2-finance-grid"><thead><tr><th>Select</th><th>Order / Invoice</th><th>Collectible balance</th><th>Applied amount</th></tr></thead><tbody>{invoices.data.items.map((invoice) => {
        const selection = selected.find((entry) => entry.invoice.invoiceId === invoice.invoiceId);
        return <tr key={invoice.invoiceId}><td><input type="checkbox" aria-label={`Select Invoice ${invoice.invoiceNumber ?? invoice.invoiceId}`} checked={Boolean(selection)} disabled={locked || (!selection && (selected.length >= 25 || Boolean(currency && currency !== invoice.collectibleBalance.currency)))} onChange={(event) => { const checked = event.target.checked; setSelected((current) => checked ? [...current, { invoice, appliedText: (invoice.collectibleBalance.cents / 100).toFixed(2) }] : current.filter((entry) => entry.invoice.invoiceId !== invoice.invoiceId)); }} /></td><td>Order {invoice.orderNumber}<br />Invoice {invoice.invoiceNumber ?? invoice.invoiceId}</td><td>{formatMoney(invoice.collectibleBalance)}</td><td>{selection && <input aria-label={`Applied to Invoice ${invoice.invoiceNumber ?? invoice.invoiceId}`} inputMode="decimal" disabled={locked} value={selection.appliedText} onChange={(event) => { const appliedText = event.target.value; setSelected((current) => current.map((entry) => entry.invoice.invoiceId === invoice.invoiceId ? { ...entry, appliedText } : entry)); }} />}</td></tr>;
      })}</tbody></table></div>{!invoices.data.items.length && <p>No collectible V2 Invoices for this Customer.</p>}<div className="v2-finance-actions"><button className="v2-quiet-button" disabled={locked || invoices.isFetching || invoicePage <= 1} onClick={() => setInvoicePage((page) => page - 1)}>Previous Invoices</button><button className="v2-quiet-button" disabled={locked || invoices.isFetching || !invoices.data.hasNextPage} onClick={() => setInvoicePage((page) => page + 1)}>Next Invoices</button><button className="v2-quiet-button" disabled={locked || invoices.isFetching} onClick={() => { setSelected([]); setTenderText(""); void invoices.refetch(); }}>Refresh balances and clear selection</button></div></>}
      {selected.length > 0 && <p>{selected.length} selected. Allocations on other picker pages remain selected.</p>}
      <div className="v2-finance-actions"><label>Manual method <select aria-label="Manual method" disabled={locked} value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>{manualPaymentMethods.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Tendered <input aria-label="Tendered" inputMode="decimal" disabled={locked} value={tenderText} onChange={(event) => setTenderText(event.target.value)} /></label></div>
      <dl className="v2-invoice-totals" aria-label="Tender preview"><div><dt>Selected balance</dt><dd>{currency ? formatMoney({ currency, cents: selected.reduce((total, entry) => total + entry.invoice.collectibleBalance.cents, 0) }) : "Select Invoices"}</dd></div><div><dt>Tendered</dt><dd>{preview ? formatMoney(preview.tendered) : "Enter exact amount"}</dd></div><div><dt>Applied</dt><dd>{preview ? formatMoney(preview.applied) : "Confirm allocations"}</dd></div><div><dt>Change due</dt><dd>{preview ? formatMoney(preview.changeDue) : "Not yet validated"}</dd></div></dl>
      {previewError && <p role="alert">{previewError}</p>}
      <p>Cash change is not customer credit or a refund. Noncash excess is rejected. Card and ACH remain in their existing provider workflow; no provider is called here.</p>
      {attempt && !mutation.isPending && <p>The response was not confirmed. Editing is locked; retry the exact original request to recover its recorded receipt.</p>}
      <div className="v2-finance-actions"><button className="v2-invoice-issue" disabled={!csrfReady || mutation.isPending || (!attempt && !preview)} onClick={submit}>{mutation.isPending ? "Recording..." : attempt ? "Retry original payment" : "Record Payment"}</button><button className="v2-quiet-button" disabled={locked} onClick={() => { setEditor(false); setSelected([]); setTenderText(""); }}>Cancel entry</button></div>
    </section>}
  </section>;
}
