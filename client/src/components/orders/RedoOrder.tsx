import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { REDO_REASONS, createRedoOrderSchema, type CreateRedoOrderRequest } from "@shared/orderRedo";
import type { Order, OrderLineItem } from "@/hooks/useOrders";
import { apiFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ORDER_DETAIL_SECONDARY_ACTION_CLASS } from "./orderDetailActionStyles";

type SourceLine = Pick<OrderLineItem, "id" | "description" | "quantity" | "updatedAt"> & { parentLineItemId?: string | null };
type SourceOrder = Pick<Order, "id" | "orderNumber" | "updatedAt"> & { displayNumber?: string | null; lineItems: SourceLine[] };
const orderPath = (id: string) => "/orders/" + id;

export function RedoOrderIdentification({ order }: { order: Order & { lineItems?: Array<{ id: string; lineItemRole?: string; workflowState?: string; description: string; productionNotes?: string | null }> } }) {
  return <>
    {order.redoRootOrderId ? <section aria-label="Replacement order" className="my-4 rounded-lg border-2 border-amber-500 bg-amber-500/10 p-5 space-y-2">
      <h2 className="text-xl font-bold">REDO / REPLACEMENT ORDER</h2>
      {order.redoOriginal ? <p>Redo of Order <Link className="font-semibold text-blue-600 underline" to={orderPath(order.redoOriginal.id)}>#{order.redoOriginal.displayNumber || order.redoOriginal.orderNumber}</Link></p> : <p>Original order reference unavailable. Refresh to review.</p>}
      {order.redoSource && order.redoSource.id !== order.redoRootOrderId ? <p>Immediate source: <Link className="text-blue-600 underline" to={orderPath(order.redoSource.id)}>Order #{order.redoSource.displayNumber || order.redoSource.orderNumber}</Link></p> : null}
      <p>Reason: {order.redoReason}{order.redoExplanation ? " — " + order.redoExplanation : ""}</p>
      <p>Promised date: {order.promisedDate?.slice(0,10)} · Status: {order.status} · {order.state}</p>
      <p className="font-semibold">NO CUSTOMER CHARGE</p>
      {order.lineItems?.filter(line => line.lineItemRole !== "parent" && line.workflowState === "new").map(line => <p key={line.id} className="font-semibold">Action needed for {line.description}: {line.productionNotes || "Review requirements and use Save & Route Jobs."}</p>)}
    </section> : null}
    {order.relatedRedos?.length ? <section aria-label="Related replacement orders" className="my-4 rounded-lg border p-4 space-y-2">
      <h2 className="font-semibold">RELATED REDO ORDERS</h2>
      <ul className="space-y-2">{order.relatedRedos.map(redo => <li key={redo.id}>
        <Link className="font-semibold text-blue-600 underline" to={orderPath(redo.id)}>Order #{redo.displayNumber || redo.orderNumber}</Link>
        {" · "}{redo.redoReason}{" · Promised: "}{redo.promisedDate?.slice(0,10)}{" · "}{redo.status}{" / "}{redo.state}
      </li>)}</ul>
    </section> : null}
  </>;
}

export function RedoOrderAction({ order, authorized, disabled = false }: { order: SourceOrder; authorized: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<string>(""), [explanation, setExplanation] = useState(""), [date, setDate] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false), submitted = useRef<CreateRedoOrderRequest | null>(null);
  const navigate = useNavigate(), client = useQueryClient();
  if (!authorized) return null;
  const locked = busy || submitted.current !== null;
  function selectGroup(line: SourceLine, selected: boolean) {
    setQuantities(previous => {
      const next = { ...previous };
      const apply = (item: SourceLine) => { if (selected) next[item.id] = ""; else delete next[item.id]; for (const child of order.lineItems.filter(candidate => candidate.parentLineItemId === item.id)) apply(child); };
      apply(line); return next;
    });
  }
  async function submit() {
    if (pending.current) return;
    setError("");
    let payload = submitted.current;
    if (!payload) {
      const parsed = createRedoOrderSchema.safeParse({ requestKey: crypto.randomUUID(), expectedUpdatedAt: order.updatedAt,
        lines: order.lineItems.filter(line => line.id in quantities).map(line => ({ sourceLineItemId: line.id, quantity: Number(quantities[line.id]), expectedUpdatedAt: line.updatedAt })),
        reason, explanation, promisedDate: date, disposition: "no_customer_charge", confirmed });
      if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(". ")); return; }
      payload = parsed.data;
      const selected = new Map(payload.lines.map(line => [line.sourceLineItemId, line.quantity]));
      for (const line of order.lineItems.filter(line => selected.has(line.id))) {
        const parent = order.lineItems.find(candidate => candidate.id === line.parentLineItemId);
        if (selected.get(line.id)! > line.quantity || (line.parentLineItemId && (!parent || !selected.has(parent.id) || selected.get(parent.id)! * line.quantity !== selected.get(line.id)! * parent.quantity))) {
          setError("Use quantities no greater than the source and keep product groups in the same whole-piece proportions."); return;
        }
      }
      submitted.current = payload;
    }
    pending.current = true; setBusy(true);
    try {
      const response = await apiFetch(orderPath(order.id).replace("/orders/", "/api/orders/") + "/redo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok || !result.order?.id) {
        if (response.status >= 400 && response.status < 500) submitted.current = null;
        throw new Error(result.message || "Unable to create replacement order.");
      }
      // Fresh read proves the relation, financial disposition and quantities persisted.
      const read = await apiFetch("/api/orders/" + result.order.id, { cache: "no-store" });
      const saved = await read.json();
      if (!read.ok || saved.redoSourceOrderId !== order.id || saved.redoDisposition !== payload.disposition || Number(saved.total) !== 0 || saved.promisedDate?.slice(0,10) !== payload.promisedDate || !payload.lines.every(line => saved.lineItems?.some((item: any) => item.redoSourceLineItemId === line.sourceLineItemId && item.quantity === line.quantity))) throw new Error("Replacement created but readback is unconfirmed. Retry safely to open the same order.");
      await client.invalidateQueries({ queryKey: ["orders"] });
      submitted.current = null; setOpen(false); setQuantities({}); setReason(""); setExplanation(""); setDate(""); setConfirmed(false); navigate(orderPath(saved.id));
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to create replacement. Retry with the same details."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    <Button type="button" variant="outline" size="sm" className={ORDER_DETAIL_SECONDARY_ACTION_CLASS} onClick={() => setOpen(true)} disabled={disabled}>Create Redo Order</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Redo Order</DialogTitle><DialogDescription>Replacement for Order #{order.displayNumber || order.orderNumber}. Select only the work to reproduce and enter replacement quantities. Product groups must stay together in proportion.</DialogDescription></DialogHeader>
        <fieldset disabled={locked} className="space-y-4">
          <legend className="sr-only">Replacement details</legend>
          {order.lineItems.map(line => <div key={line.id} className="flex items-center gap-3 rounded border p-2">
            <label className="flex-1"><input type="checkbox" checked={line.id in quantities} disabled={!!line.parentLineItemId} onChange={event => selectGroup(line, event.target.checked)} /> {line.description} (source: {line.quantity})</label>
            {line.id in quantities ? <label className="text-sm">Replacement quantity<Input aria-label={"Replacement quantity: " + line.description} type="number" min="1" max={line.quantity} step="1" value={quantities[line.id]} onChange={event => setQuantities(current => ({ ...current, [line.id]: event.target.value }))} /></label> : null}
          </div>)}
          <div><Label htmlFor="redo-reason">Reason</Label><select id="redo-reason" value={reason} onChange={event => setReason(event.target.value)} className="w-full rounded border bg-background p-2"><option value="">Select reason</option>{REDO_REASONS.map(value => <option key={value}>{value}</option>)}</select></div>
          <div><Label htmlFor="redo-explanation">Additional explanation{reason === "Other" ? " (required)" : ""}</Label><Input id="redo-explanation" maxLength={2000} value={explanation} onChange={event => setExplanation(event.target.value)} /></div>
          <div><Label htmlFor="redo-date">Promised date</Label><Input id="redo-date" type="date" required value={date} onChange={event => setDate(event.target.value)} /></div>
          <div><Label htmlFor="redo-disposition">Financial disposition</Label><select id="redo-disposition" className="w-full rounded border bg-background p-2" value="no_customer_charge" disabled><option value="no_customer_charge">NO CUSTOMER CHARGE</option></select><p className="text-sm text-muted-foreground">Creates a separate zero-charge order and draft invoice. No original payment or fulfillment changes. Charging review is not available here.</p></div>
          <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I confirm the selected replacement work, promised date, and no customer charge.</label>
        </fieldset>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        {submitted.current && !busy ? <p className="text-sm">The outcome needs confirmation. Retry uses the same request and cannot create another order.</p> : null}
        <Button type="button" disabled={busy || (!submitted.current && !confirmed)} onClick={() => void submit()}>{busy ? "Creating…" : submitted.current ? "Retry and confirm replacement" : "Confirm Create Redo Order"}</Button>
      </DialogContent>
    </Dialog>
  </>;
}
