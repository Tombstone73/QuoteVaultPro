import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiCall, toFulfillmentError } from '@/hooks/useFulfillment';
import { apiFetchBlob } from '@/lib/queryClient';

type Row = { purchaseId: string; purchasedAt: string; shipDate: string | null; shipmentReference: string;
  trackingNumbers: string[]; providerShipmentId: string | null; serviceName: string;
  status: string; currency: string; carrierCostCents: number; confirmedCreditsCents: number; adjustmentsCents: number;
  netCarrierCostCents: number; customerShippingChargeCents: number; customerShippingChargeAtPurchaseCents: number;
  issuedInvoiceShippingCents: number;
  differenceCents: number | null; voidAcceptedAt: string | null; externalCanceledAt: string | null;
  orders: Array<{ orderId: string; orderNumber: string; customerName: string; attributedHere: boolean }> };
type Totals = { customerShippingChargeCents: number; issuedInvoiceShippingCents: number;
  carrierByCurrency: Array<{ currency: string; carrierCostCents: number; confirmedCreditsCents: number;
    adjustmentsCents: number; netCarrierCostCents: number; differenceCents: number | null }> };
type Report = { rows: Row[]; totals: Totals };
const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const money = (cents: number, currency = 'USD') => `${currency} ${(cents / 100).toFixed(2)}`;

export default function UpsShippingProfitabilityPage() {
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = () => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const load = async () => {
    setBusy(true); setError(null);
    try { setReport(await apiCall<Report>(`/api/reports/ups-shipping-profitability?${query()}`)); }
    catch (failure) { setError(toFulfillmentError(failure).message); }
    finally { setBusy(false); }
  };
  const downloadCsv = async () => {
    setBusy(true); setError(null);
    try { const blob = await apiFetchBlob(`/api/reports/ups-shipping-profitability?${query()}&format=csv`);
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
      link.download = `ups-shipping-profitability-${from}-${to}.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (failure) { setError(toFulfillmentError(failure).message); }
    finally { setBusy(false); }
  };
  return <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <Link to="/reports" className="text-sm text-primary underline">Back to reports</Link>
    <header><h1 className="text-2xl font-semibold">UPS shipping profitability</h1>
      <p className="mt-1 max-w-4xl text-sm text-muted-foreground">Live UPS labels only. Sandbox and historically unverified labels are excluded from costs and totals. Recorded label cost is an expense estimate until UPS final billing. The current agreed Order shipping charge is attributed once to its latest active live label, or its latest historical live label if none is active; it is not cash collected. Issued Invoice shipping is shown separately. No shipping-specific payment allocation is inferred.</p></header>
    <section className="flex flex-wrap items-end gap-3 rounded border bg-card p-4">
      <label className="grid gap-1 text-sm">From<input type="date" className="rounded border bg-background p-2" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">Through<input type="date" className="rounded border bg-background p-2" value={to} onChange={event => setTo(event.target.value)} /></label>
      <button type="button" className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={busy || !from || !to} onClick={() => void load()}>{busy ? 'Loading…' : 'Run report'}</button>
      <button type="button" className="rounded border px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy || !from || !to} onClick={() => void downloadCsv()}>Download CSV</button>
    </section>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {report && <><section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div className="rounded border bg-card p-3"><p className="text-xs text-muted-foreground">Customer shipping charge (agreed)</p><p className="font-semibold">{money(report.totals.customerShippingChargeCents)}</p></div>
      {report.totals.carrierByCurrency.map(group => ([
        ['Recorded carrier cost', group.carrierCostCents], ['Confirmed credits', group.confirmedCreditsCents],
        ['Carrier adjustments', group.adjustmentsCents], ['Net carrier cost', group.netCarrierCostCents],
      ] as const).map(([label, value]) => <div key={`${group.currency}:${label}`} className="rounded border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{money(value, group.currency)}</p></div>))}
      {report.totals.carrierByCurrency.find(group => group.currency === 'USD') && <div className="rounded border bg-card p-3"><p className="text-xs text-muted-foreground">USD charge less net cost</p><p className="font-semibold">{money(report.totals.carrierByCurrency.find(group => group.currency === 'USD')!.differenceCents ?? 0)}</p></div>}
    </section>
      <p className="text-sm">Issued Invoice shipping total: {money(report.totals.issuedInvoiceShippingCents)}. Draft Invoice projections are excluded. The CSV also retains the customer charge recorded at label purchase for comparison with the current Order charge.</p>
      <div className="overflow-x-auto rounded border"><table className="min-w-full text-left text-sm"><thead className="bg-muted"><tr>{['Shipment / UPS reference', 'Customer / Orders', 'Service / status', 'Carrier cost', 'Credits / adjustments', 'Customer charge', 'Issued Invoice shipping', 'Difference'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.purchaseId} className="border-t align-top"><td className="p-3">{row.shipmentReference}<span className="block text-xs text-muted-foreground">Label: {row.purchasedAt.slice(0, 10)} · Shipment: {row.shipDate ?? 'not dispatched'}</span><span className="block text-xs text-muted-foreground">UPS {row.providerShipmentId ?? row.purchaseId}</span>{row.trackingNumbers.map(number => <span key={number} className="block text-xs">Tracking {number}</span>)}</td>
        <td className="p-3">{row.orders.map(order => <div key={order.orderId}>{order.customerName} · <Link to={`/orders/${order.orderId}`} className="underline">{order.orderNumber}</Link>{order.attributedHere ? '' : ' (charge attributed elsewhere)'}</div>)}</td>
        <td className="p-3">UPS · {row.serviceName}<span className="block text-xs">{row.status.replaceAll('_', ' ')}{row.voidAcceptedAt ? ' · UPS void accepted' : ''}{row.externalCanceledAt ? ' · external cancellation reported' : ''}</span></td>
        <td className="p-3">{money(row.carrierCostCents, row.currency)}</td><td className="p-3">{money(row.confirmedCreditsCents, row.currency)} credit<br />{money(row.adjustmentsCents, row.currency)} adjustment</td>
        <td className="p-3">{money(row.customerShippingChargeCents)}</td><td className="p-3">{money(row.issuedInvoiceShippingCents)}</td><td className="p-3">{row.differenceCents === null ? 'Currency conversion required' : money(row.differenceCents)}</td></tr>)}
      {!report.rows.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No purchased UPS labels in this date range.</td></tr>}</tbody></table></div></>}
  </main>;
}
