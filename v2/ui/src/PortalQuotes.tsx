import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";

type Money = Readonly<{ cents: number; currency: string }>;
type Summary = Readonly<{ quoteId: string; number: string; createdAt: string; requestedDueDate?: string; status: string;
  total: Money; checkpointId: string; evidenceStatus: "modern" | "historical"; convertedOrderId?: string }>;
type Detail = Summary & Readonly<{ history: readonly Summary[];
  lines: readonly Readonly<{ lineId: string; description: string; quantity: number; unitPrice: Money; lineTotal: Money }>[] }>;
const money = (value: Money) => new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency }).format(value.cents / 100);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
const read = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path, { credentials: "include", cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 403 ? "Quote access is unavailable." : "Published Quote could not be loaded.");
  return body.data as T;
};
const Header = ({ title }: { title: string }) => <header className="portal-page-header"><div><h1>{title}</h1><p>Explicitly sent proposals. Internal changes are not published until sent.</p></div><a className="portal-quiet" href="/portal/quotes">All quotes</a></header>;
const ErrorNotice = ({ retry }: { retry: () => void }) => <div className="portal-notice warning" role="alert">Published Quote access is unavailable. <button onClick={retry}>Retry published Quote read</button></div>;

export const PortalQuotes = ({ sessionScope }: { sessionScope: string }) => {
  const query = useQuery({ queryKey: ["v2", "portal", sessionScope, "quotes", "published"],
    queryFn: () => read<{ items: readonly Summary[] }>("/v2/portal/quotes"), enabled: Boolean(sessionScope), retry: false, placeholderData: undefined });
  if (query.isError) return <><Header title="Quotes" /><ErrorNotice retry={() => void query.refetch()} /></>;
  if (query.isPending || query.isFetching || query.isPlaceholderData || !sessionScope) return <p role="status">Loading published quotes...</p>;
  const items = query.data.items;
  return <><Header title="Quotes" /><section className="portal-section"><h2>Published quotes</h2>{items.length ? <div className="portal-list">{items.map(item => <a key={item.quoteId} href={`/portal/quotes/${encodeURIComponent(item.quoteId)}`}><div><strong>{item.number}</strong><small>Sent {date(item.createdAt)}{item.requestedDueDate ? ` | Due ${date(item.requestedDueDate)}` : ""}</small></div><div><span className="portal-badge">{item.status}</span><strong>{money(item.total)}</strong></div></a>)}</div> : <p>No published quotes. Your account representative can send a proposal when it is ready.</p>}</section></>;
};

export const PortalQuoteDetail = ({ quoteId, sessionScope }: { quoteId: string; sessionScope: string }) => {
  const [checkpointId, setCheckpointId] = useState("");
  const query = useQuery({ queryKey: ["v2", "portal", sessionScope, "quotes", quoteId, checkpointId],
    queryFn: () => read<Detail>(`/v2/portal/quotes/${encodeURIComponent(quoteId)}${checkpointId ? `?checkpointId=${encodeURIComponent(checkpointId)}` : ""}`),
    enabled: Boolean(sessionScope && quoteId), retry: false, placeholderData: undefined });
  if (query.isError) return <><Header title="Quote not available" /><ErrorNotice retry={() => void query.refetch()} /></>;
  if (query.isPending || query.isFetching || query.isPlaceholderData || !sessionScope) return <p role="status">Loading published Quote...</p>;
  const quote = query.data;
  return <><Header title={quote.number} /><p>Sent {date(quote.createdAt)}</p>{quote.evidenceStatus === "historical" && <div className="portal-notice warning">Historical commercial snapshot. Original delivery or PDF evidence may be incomplete.</div>}
    <a className="portal-quiet" href={`/v2/portal/quotes/${encodeURIComponent(quoteId)}/document.pdf?checkpointId=${encodeURIComponent(quote.checkpointId)}`} target="_blank" rel="noreferrer">View Published PDF Or Historical Preview</a>
    <section className="portal-section"><h2>Quote details</h2>{quote.lines.map(line => <article className="portal-line" key={line.lineId}><div><strong>{line.description}</strong><small>Quantity {line.quantity} | {money(line.unitPrice)} each</small></div><strong>{money(line.lineTotal)}</strong></article>)}<dl className="portal-total"><dt>Total</dt><dd>{money(quote.total)}</dd></dl></section>
    <section className="portal-section"><h2>Sent revision history</h2><button onClick={() => setCheckpointId("")}>Latest published revision</button>{quote.history.map(item => <button key={item.checkpointId} onClick={() => setCheckpointId(item.checkpointId)} aria-pressed={quote.checkpointId === item.checkpointId}>Sent {date(item.createdAt)} | {money(item.total)}</button>)}</section>
    <div className="portal-notice">{quote.convertedOrderId ? "This published Quote was converted to an Order." : "Quote acceptance is completed through your account representative."}</div></>;
};
