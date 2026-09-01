import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoiceApi, money, type InvoiceRead } from "./api";

const keys = {
  list: (scope: string, organizationId: string, query: string, lifecycle: string) => ["v2", scope, organizationId, "billing", "invoices", query, lifecycle] as const,
  detail: (scope: string, organizationId: string, invoiceId: string) => ["v2", scope, organizationId, "billing", "invoice", invoiceId] as const,
};
const customerName = (invoice: Pick<InvoiceRead, "customerPresentation">) => invoice.customerPresentation?.customerDisplayName ?? invoice.customerPresentation?.companyName ?? "Customer unavailable";

/** Billing owns the invoice. The Order number is shown only as source context. */
export const InvoiceWorkspace = ({ organizationId, sessionScope, canView }: Readonly<{ organizationId: string; sessionScope: string; canView: boolean }>) => {
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<"" | InvoiceRead["lifecycle"]>("");
  const [selected, setSelected] = useState("");
  const list = useQuery({ queryKey: keys.list(sessionScope, organizationId, query, lifecycle), queryFn: () => invoiceApi.list(organizationId, { ...(query ? { q: query } : {}), ...(lifecycle ? { lifecycle } : {}) }), enabled: Boolean(organizationId && sessionScope && canView) });
  useEffect(() => { if (!selected && list.data?.items[0]) setSelected(list.data.items[0].invoiceId); }, [list.data, selected]);
  const detail = useQuery({ queryKey: keys.detail(sessionScope, organizationId, selected), queryFn: () => invoiceApi.get(organizationId, selected), enabled: Boolean(selected && organizationId && sessionScope && canView) });
  if (!organizationId) return <section className="v2-invoices"><div className="v2-proof-empty">Enter an authenticated organization in Sales before opening Invoices.</div></section>;
  if (!canView) return <section className="v2-invoices"><div className="v2-proof-empty">You do not have permission to view Invoices.</div></section>;
  const invoice = detail.data;
  return <section className="v2-invoices">
    <aside className="v2-invoice-list"><header><h1>Invoices</h1><input aria-label="Search invoices" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(""); }} placeholder="Order or customer" /><select aria-label="Invoice lifecycle" value={lifecycle} onChange={(event) => { setLifecycle(event.target.value as "" | InvoiceRead["lifecycle"]); setSelected(""); }}><option value="">All lifecycles</option><option value="draft">Order-backed</option><option value="issued">Issued</option><option value="void">Void</option></select></header><div>{list.data?.items.map((item) => <button key={item.invoiceId} className={item.invoiceId === selected ? "active" : ""} onClick={() => setSelected(item.invoiceId)}><b>Order {item.sourceOrderNumber}</b><span>{customerName(item)}</span><small>{item.lifecycle === "draft" ? "order-backed" : item.lifecycle} · {money(item.total)}</small></button>)}{list.isSuccess && !list.data?.items.length && <p className="v2-proof-empty">No Billing Invoices match this view.</p>}</div></aside>
    <main className="v2-invoice-main">{invoice ? <InvoiceDetail invoice={invoice} organizationId={organizationId} /> : <div className="v2-proof-empty">Loading authenticated Billing record…</div>}</main>
    <aside className="v2-invoice-rail">{invoice && <><section><small>Billing status</small><h2>{invoice.lifecycle === "draft" ? "Order-backed" : invoice.lifecycle}</h2><p>{invoice.lifecycle === "draft" ? "This payable Invoice follows the current Sales Order. Payment and Refund history remains immutable." : invoice.lifecycle === "issued" ? "Issued facts are frozen in Billing's immutable checkpoint." : "Void is a reserved lifecycle; no void operation is available."}</p></section><section><small>Source context</small><dl><div><dt>Order</dt><dd>{invoice.sourceOrderNumber}</dd></div><div><dt>PO</dt><dd>{invoice.purchaseOrderNumber ?? "—"}</dd></div><div><dt>Terms</dt><dd>{invoice.termsCode ?? "—"}</dd></div><div><dt>Issued</dt><dd>{invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleString() : "Not issued"}</dd></div></dl></section></>}</aside>
  </section>;
};

const InvoiceDetail = ({ invoice, organizationId }: Readonly<{ invoice: InvoiceRead; organizationId: string }>) => <>
  <header className="v2-invoice-header"><div><span>Billing record · Source Order {invoice.sourceOrderNumber ?? "unavailable"}</span><h1>Invoice</h1><p>{customerName(invoice)}{invoice.customerPresentation?.contactDisplayName ? ` · ${invoice.customerPresentation.contactDisplayName}` : ""}</p></div><div><span className={`v2-invoice-state ${invoice.lifecycle}`}>{invoice.lifecycle === "draft" ? "Order-backed" : invoice.lifecycle}</span><button type="button" onClick={() => window.open(`/v2/organizations/${encodeURIComponent(organizationId)}/invoices/${encodeURIComponent(invoice.invoiceId)}/document.pdf`, "_blank", "noopener,noreferrer")}>Preview PDF</button></div></header>
  <section className="v2-invoice-document"><div className="v2-invoice-document-title"><h2>Commercial snapshot</h2><p>{invoice.lifecycle === "draft" ? "Current payable Billing projection from Sales." : "Issued Billing checkpoint; this document no longer follows Sales changes."}</p></div><table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead><tbody>{invoice.lines.map((line) => <tr key={line.sourceOrderLineId}><td>{line.description}</td><td>{line.quantity}</td><td>{money(line.sellingUnitAmount)}</td><td>{money(line.lineAmount)}</td></tr>)}</tbody></table><dl className="v2-invoice-totals"><div><dt>Subtotal</dt><dd>{money(invoice.subtotal)}</dd></div><div><dt>Tax</dt><dd>{money(invoice.taxTotal)}</dd></div><div className="total"><dt>Total</dt><dd>{money(invoice.total)}</dd></div></dl></section>
  {invoice.lifecycle === "issued" && <section className="v2-invoice-checkpoint"><h2>Issued checkpoint</h2><p>Issued {invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleString() : "at an unavailable timestamp"}. Customer presentation, commercial totals, tax evidence, and lines are frozen by Billing.</p></section>}
</>;
