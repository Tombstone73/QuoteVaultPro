import React, { useEffect, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
type Money = { cents: number; currency: string };
type Invoice = any;

type Session = { portal: { displayName: string; customerId: string }; returnTo: string; csrfToken: string; sessionScope: string };
const format = (value: Money) => new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency }).format(value.cents / 100);
const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? "Request failed."), { status: response.status });
  return body.data as T;
};
const invoiceRoute = () => window.location.pathname.match(/^\/portal\/invoices\/([A-Za-z0-9_-]+)$/)?.[1] ?? null;
const token = () => new URLSearchParams(window.location.search).get("token") ?? "";
const paymentRequest = () => crypto.randomUUID();

const CardForm = ({ clientSecret, publishableKey, stripeAccountId, onDone, onError }: { clientSecret: string; publishableKey: string; stripeAccountId: string; onDone: () => void; onError: (message: string) => void }) => {
  const stripePromise = useMemo(() => loadStripe(publishableKey, { stripeAccount: stripeAccountId }), [publishableKey, stripeAccountId]);
  return <Elements stripe={stripePromise} options={{ clientSecret }}><CardConfirmation onDone={onDone} onError={onError} /></Elements>;
};
const CardConfirmation = ({ onDone, onError }: { onDone: () => void; onError: (message: string) => void }) => {
  const stripe = useStripe(); const elements = useElements(); const [busy, setBusy] = useState(false);
  return <form onSubmit={async (event) => { event.preventDefault(); if (!stripe || !elements) return; setBusy(true); const result = await stripe.confirmPayment({ elements, redirect: "if_required" }); setBusy(false); if (result.error) return onError(result.error.message ?? "Card payment could not be confirmed."); onDone(); }}><PaymentElement /><button className="button" disabled={!stripe || busy}>{busy ? "Confirming…" : "Confirm card payment"}</button></form>;
};

const CredentialCard = ({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) => <main className="v2-auth"><section className="v2-auth-card"><p className="eyebrow">PrintersHero</p><h1>{title}</h1>{children}</section></main>;

const PortalSetup = ({ kind }: Readonly<{ kind: "setup" | "reset" }>) => {
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState(""); const [error, setError] = useState(""); const [complete, setComplete] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    if (password !== confirmation) return setError("Passwords do not match.");
    try { await request(`/v2/portal/auth/${kind === "setup" ? "setup" : "reset-password"}`, { method: "POST", body: JSON.stringify({ token: token(), password }) }); setComplete(true); setPassword(""); setConfirmation(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This link is unavailable."); }
  };
  if (complete) return <CredentialCard title={kind === "setup" ? "Account ready" : "Password updated"}><p>{kind === "setup" ? "Your customer portal account is ready. Sign in to continue." : "Your password has been updated. Sign in to continue."}</p><a className="button" href="/portal/invoices">Sign in</a></CredentialCard>;
  return <CredentialCard title={kind === "setup" ? "Create your portal account" : "Set a new password"}><p>{kind === "setup" ? "Choose a password for your secure customer portal." : "Choose a new password for your secure customer portal."}</p><form onSubmit={submit}><label>Password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /></label><label>Confirm password<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required /></label>{error && <p className="notice error">{error}</p>}<button className="button">{kind === "setup" ? "Create account" : "Update password"}</button></form></CredentialCard>;
};

const ForgotPassword = () => {
  const [email, setEmail] = useState(""); const [submitted, setSubmitted] = useState(false);
  return <CredentialCard title="Reset your password"><p>Enter your email and we will send reset instructions if it belongs to an eligible customer portal account.</p>{submitted ? <p className="notice">If eligible, password-reset instructions have been sent.</p> : <form onSubmit={async (event) => { event.preventDefault(); await request("/v2/portal/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }).catch(() => undefined); setSubmitted(true); }}><label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button className="button">Send reset instructions</button></form>}<a href="/portal/invoices">Back to sign in</a></CredentialCard>;
};

export const PortalApp = () => {
  if (window.location.pathname === "/portal/setup") return <PortalSetup kind="setup" />;
  if (window.location.pathname === "/portal/reset-password") return <PortalSetup kind="reset" />;
  if (window.location.pathname === "/portal/forgot-password") return <ForgotPassword />;
  return <PortalInvoices />;
};

const PortalInvoices = () => {
  const invoiceId = invoiceRoute(); const [session, setSession] = useState<Session | null>(null); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [invoice, setInvoice] = useState<Invoice | null>(null); const [items, setItems] = useState<any[]>([]); const [error, setError] = useState(""); const [payment, setPayment] = useState<any | null>(null);
  const destination = invoiceId ? `/portal/invoices/${invoiceId}` : "/portal/invoices";
  const refresh = async () => { try { setError(""); if (invoiceId) setInvoice(await request(`/v2/portal/invoices/${encodeURIComponent(invoiceId)}`)); else setItems((await request<{ items: any[] }>("/v2/portal/invoices")).items); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load invoices."); } };
  useEffect(() => { void request<Session>("/v2/portal/auth/session").then((value) => { setSession(value); if (window.location.pathname === "/portal") history.replaceState(null, "", value.returnTo); }).catch(() => setSession(null)); }, []);
  useEffect(() => { if (session) void refresh(); }, [session, invoiceId]);
  const login = async (event: React.FormEvent) => { event.preventDefault(); try { const next = await request<Session>("/v2/portal/auth/login", { method: "POST", body: JSON.stringify({ email, password, returnTo: destination }) }); setSession(next); history.replaceState(null, "", next.returnTo); setPassword(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); } };
  if (!session) return <CredentialCard title="Customer portal"><p>Sign in to securely view your current invoices and payments.</p><form onSubmit={login}><label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="notice error">{error}</p>}<button className="button">Sign in</button></form><a href="/portal/forgot-password">Forgot password?</a></CredentialCard>;
  if (!invoiceId) return <main className="v2-finance-workspace"><header className="v2-finance-heading"><div><span>Customer portal</span><h1>Your invoices</h1><p>Current balances are calculated from your Invoice and payment history.</p></div></header>{error ? <p className="notice error">{error}</p> : <div className="v2-finance-overview"><table className="v2-finance-grid"><thead><tr><th>Invoice</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead><tbody>{items.map((item) => <tr key={item.invoiceId}><td><a href={`/portal/invoices/${encodeURIComponent(item.invoiceId)}`}>{item.sourceOrderNumber}</a></td><td>{item.settlement?.replace("_", " ") ?? item.lifecycle}</td><td>{format(item.gross)}</td><td>{format(item.paid)}</td><td>{format(item.balance)}</td></tr>)}</tbody></table></div>}</main>;
  const detail = invoice; const balance: Money = detail?.settlement?.balance ?? { cents: 0, currency: detail?.invoice?.currency ?? "USD" }; const payable = Boolean(balance.cents > 0 && detail?.invoice?.lifecycle !== "void");
  const begin = async () => { try { setError(""); setPayment(await request(`/v2/portal/invoices/${encodeURIComponent(invoiceId)}/stripe/payment-intents`, { method: "POST", headers: { "x-v2-csrf-token": session.csrfToken }, body: JSON.stringify({ businessRequestId: paymentRequest() }) })); } catch (reason) { setError(reason instanceof Error ? reason.message : "Card payment is unavailable."); } };
  if (!detail) return <main className="v2-finance-workspace">Loading invoice…</main>;
  return <main className="v2-finance-workspace"><header className="v2-finance-heading"><div><a href="/portal/invoices">← All invoices</a><span>Customer portal</span><h1>Invoice {detail.invoice.invoiceNumber?.display ?? detail.invoice.sourceOrderNumber}</h1><p>{detail.invoice.customerPresentation?.customerDisplayName ?? "Your invoice"}{detail.invoice.termsCode ? ` · Terms: ${detail.invoice.termsCode}` : ""}</p></div><div className="v2-finance-actions"><a className="v2-quiet-button" href={`/v2/portal/invoices/${encodeURIComponent(invoiceId)}/document.pdf`} target="_blank" rel="noreferrer">View PDF</a>{payable && !payment && <button className="v2-invoice-issue" onClick={() => void begin()}>Pay by card</button>}</div></header>{error && <p className="notice error">{error}</p>}<section className="v2-invoice-document"><table><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody>{detail.invoice.lines.map((line: any) => <tr key={line.sourceOrderLineId}><td>{line.description}</td><td>{line.quantity}</td><td>{format(line.lineAmount)}</td></tr>)}</tbody></table><dl className="v2-invoice-totals"><div><dt>Subtotal</dt><dd>{format(detail.invoice.subtotal)}</dd></div><div><dt>Tax</dt><dd>{format(detail.invoice.taxTotal)}</dd></div><div className="total"><dt>Total</dt><dd>{format(detail.invoice.total)}</dd></div></dl></section><section className="v2-finance-metrics"><div><small>Paid</small><strong>{format(detail.settlement.paid)}</strong></div><div><small>Refunded</small><strong>{format(detail.settlement.refunded)}</strong></div><div><small>{balance.cents < 0 ? "Credit due" : "Amount due"}</small><strong>{format({ ...balance, cents: Math.abs(balance.cents) })}</strong></div></section>{payment && <section className="v2-finance-detail"><h2>Pay invoice</h2><p>Your invoice updates only after Stripe’s signed confirmation is received.</p><CardForm {...payment} onDone={() => { setPayment(null); void refresh(); }} onError={setError} /></section>}<section><h2>Payment history</h2>{detail.history.map((entry: any) => <p key={entry.id}>{entry.kind === "refund" ? "Refund" : "Payment"} · {format(entry.amount)}</p>)}</section></main>;
};
