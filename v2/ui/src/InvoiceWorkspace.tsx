import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoiceApi, money, newBusinessRequestId, type ApiError, type InvoiceRead } from "./api";

const keys = {
  list: (scope: string, organizationId: string, query: string, lifecycle: string) => ["v2", scope, organizationId, "billing", "invoices", query, lifecycle] as const,
  detail: (scope: string, organizationId: string, invoiceId: string) => ["v2", scope, organizationId, "billing", "invoice", invoiceId] as const,
};
const errorText = (error: unknown) => (error as ApiError)?.message ?? "The Billing service is unavailable.";
const customerName = (invoice: Pick<InvoiceRead, "customerPresentation">) => invoice.customerPresentation?.customerDisplayName ?? invoice.customerPresentation?.companyName ?? "Customer unavailable";

/** Billing owns the invoice. The Order number is shown only as source context. */
export const InvoiceWorkspace = ({ organizationId, sessionScope, canView, canIssue, csrfReady }: Readonly<{ organizationId: string; sessionScope: string; canView: boolean; canIssue: boolean; csrfReady: boolean }>) => {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<"" | InvoiceRead["lifecycle"]>("");
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const list = useQuery({ queryKey: keys.list(sessionScope, organizationId, query, lifecycle), queryFn: () => invoiceApi.list(organizationId, { ...(query ? { q: query } : {}), ...(lifecycle ? { lifecycle } : {}) }), enabled: Boolean(organizationId && sessionScope && canView) });
  useEffect(() => { if (!selected && list.data?.items[0]) setSelected(list.data.items[0].invoiceId); }, [list.data, selected]);
  const detail = useQuery({ queryKey: keys.detail(sessionScope, organizationId, selected), queryFn: () => invoiceApi.get(organizationId, selected), enabled: Boolean(selected && organizationId && sessionScope && canView) });
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "billing"] }); };
  const issue = useMutation({
    mutationFn: () => invoiceApi.issue(organizationId, detail.data!.invoiceId, newBusinessRequestId()),
    onSuccess: async () => { setNotice("Invoice issued as an immutable Billing checkpoint."); await refresh(); },
    onError: async (error) => { setNotice(errorText(error)); const apiError = error as unknown as ApiError; if (apiError.code === "CONFLICT" || apiError.code === "STALE_STATE") await refresh(); },
  });
  if (!organizationId) return <section className="v2-invoices"><div className="v2-proof-empty">Enter an authenticated organization in Sales before opening Invoices.</div></section>;
  if (!canView) return <section className="v2-invoices"><div className="v2-proof-empty">You do not have permission to view Invoices.</div></section>;
  const invoice = detail.data;
  return <section className="v2-invoices">
    <aside className="v2-invoice-list"><header><h1>Invoices</h1><input aria-label="Search invoices" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(""); }} placeholder="Order or customer" /><select aria-label="Invoice lifecycle" value={lifecycle} onChange={(event) => { setLifecycle(event.target.value as "" | InvoiceRead["lifecycle"]); setSelected(""); }}><option value="">All lifecycles</option><option value="draft">Draft</option><option value="issued">Issued</option><option value="void">Void</option></select></header><div>{list.data?.items.map((item) => <button key={item.invoiceId} className={item.invoiceId === selected ? "active" : ""} onClick={() => setSelected(item.invoiceId)}><b>Order {item.sourceOrderNumber}</b><span>{customerName(item)}</span><small>{item.lifecycle} · {money(item.total)}</small></button>)}{list.isSuccess && !list.data?.items.length && <p className="v2-proof-empty">No Billing Invoices match this view.</p>}</div></aside>
    <main className="v2-invoice-main">{invoice ? <InvoiceDetail invoice={invoice} canIssue={canIssue} csrfReady={csrfReady} busy={issue.isPending} onIssue={() => { if (window.confirm("Issue this Draft Invoice? Issuance freezes the Billing snapshot and future Sales synchronization will be rejected.")) issue.mutate(); }} /> : <div className="v2-proof-empty">Loading authenticated Billing record…</div>}</main>
    <aside className="v2-invoice-rail">{invoice && <><section><small>Billing status</small><h2>{invoice.lifecycle}</h2><p>{invoice.lifecycle === "draft" ? "This Invoice tracks the current Sales Order until it is issued." : invoice.lifecycle === "issued" ? "Issued facts are frozen in Billing's immutable checkpoint." : "Void is a reserved lifecycle; no void operation is available."}</p></section><section><small>Source context</small><dl><div><dt>Order</dt><dd>{invoice.sourceOrderNumber}</dd></div><div><dt>PO</dt><dd>{invoice.purchaseOrderNumber ?? "—"}</dd></div><div><dt>Terms</dt><dd>{invoice.termsCode ?? "—"}</dd></div><div><dt>Issued</dt><dd>{invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleString() : "Not issued"}</dd></div></dl></section>{notice && <p className="v2-invoice-notice">{notice}</p>}</>}</aside>
  </section>;
};

const InvoiceDetail = ({ invoice, canIssue, csrfReady, busy, onIssue }: Readonly<{ invoice: InvoiceRead; canIssue: boolean; csrfReady: boolean; busy: boolean; onIssue: () => void }>) => <>
  <header className="v2-invoice-header"><div><span>Billing record · Source Order {invoice.sourceOrderNumber ?? "unavailable"}</span><h1>Invoice</h1><p>{customerName(invoice)}{invoice.customerPresentation?.contactDisplayName ? ` · ${invoice.customerPresentation.contactDisplayName}` : ""}</p></div><div><span className={`v2-invoice-state ${invoice.lifecycle}`}>{invoice.lifecycle}</span>{invoice.lifecycle === "draft" && canIssue && <button className="v2-invoice-issue" disabled={!csrfReady || busy} onClick={onIssue}>Issue Invoice</button>}</div></header>
  <section className="v2-invoice-document"><div className="v2-invoice-document-title"><h2>Commercial snapshot</h2><p>{invoice.lifecycle === "draft" ? "Current Billing projection from Sales." : "Issued Billing checkpoint; this document no longer follows Sales changes."}</p></div><table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead><tbody>{invoice.lines.map((line) => <tr key={line.sourceOrderLineId}><td>{line.description}</td><td>{line.quantity}</td><td>{money(line.sellingUnitAmount)}</td><td>{money(line.lineAmount)}</td></tr>)}</tbody></table><dl className="v2-invoice-totals"><div><dt>Subtotal</dt><dd>{money(invoice.subtotal)}</dd></div><div><dt>Tax</dt><dd>{money(invoice.taxTotal)}</dd></div><div className="total"><dt>Total</dt><dd>{money(invoice.total)}</dd></div></dl></section>
  {invoice.lifecycle === "issued" && <section className="v2-invoice-checkpoint"><h2>Issued checkpoint</h2><p>Issued {invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleString() : "at an unavailable timestamp"}. Customer presentation, commercial totals, tax evidence, and lines are frozen by Billing.</p></section>}
</>;
