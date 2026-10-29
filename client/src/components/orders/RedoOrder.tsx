import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { canonicalOrderConcurrencyTimestamp } from "@shared/orderConcurrencyTimestamp";
import { parseCurrencyDollarsToCents } from "@shared/currencyInput";
import { REDO_REASONS, createRedoOrderSchema, redoOrderPreviewSchema, redoOrderValidationMessages, type CreateRedoOrderRequest, type RedoOrderDetails, type RedoPricingPreview } from "@shared/orderRedo";
import type { Order, OrderLineItem } from "@/hooks/useOrders";
import { apiFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ORDER_DETAIL_SECONDARY_ACTION_CLASS } from "./orderDetailActionStyles";

type SourceLine = Pick<OrderLineItem, "id" | "description" | "quantity" | "updatedAt"> & { parentLineItemId?: string | null; lineItemRole?: string; parentPriceMode?: string; unitPrice?: string | number; totalPrice?: string | number };
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
      <p className="font-semibold">{order.redoDisposition === "charge_customer" ? "CHARGE CUSTOMER — separate replacement pricing" : "NO CUSTOMER CHARGE"}</p>
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

const money = (cents: number) => "$" + (cents / 100).toFixed(2);
const derivedGroup = (line: SourceLine) => line.lineItemRole === "parent" && (line.parentPriceMode ?? "sum_children") === "sum_children";

export function RedoOrderAction({ order, authorized, disabled = false }: { order: SourceOrder; authorized: boolean; disabled?: boolean }) {
  const [open,setOpen] = useState(false), [quantities,setQuantities] = useState<Record<string,string>>({}), [prices,setPrices] = useState<Record<string,string>>({});
  const [reason,setReason] = useState(""), [explanation,setExplanation] = useState(""), [date,setDate] = useState("");
  const [disposition,setDisposition] = useState<"no_customer_charge" | "charge_customer">("no_customer_charge");
  const [shippingDecision,setShippingDecision] = useState(""), [shippingAmount,setShippingAmount] = useState("");
  const [confirmed,setConfirmed] = useState(false), [busy,setBusy] = useState(false), [reviewBusy,setReviewBusy] = useState(false), [error,setError] = useState("");
  const [review,setReview] = useState<{inputKey:string;data:RedoPricingPreview} | null>(null);
  const pending = useRef(false), submitted = useRef<CreateRedoOrderRequest | null>(null), submittedReview = useRef<RedoPricingPreview | null>(null), intentKey = useRef<string | null>(null);
  const navigate = useNavigate(), client = useQueryClient();
  const inputKey = JSON.stringify({orderId:order.id,updatedAt:order.updatedAt,lineVersions:order.lineItems.map(line=>[line.id,line.updatedAt]),quantities,prices,reason,explanation,date,disposition,shippingDecision,shippingAmount});
  const currentReview = review?.inputKey === inputKey ? review.data : null;
  const paid = disposition === "charge_customer", locked = busy || reviewBusy || submitted.current !== null;
  if (!authorized) return null;
  function selectGroup(line: SourceLine,selected: boolean) {
    setQuantities(previous=>{ const next={...previous}; const apply=(item:SourceLine)=>{if(selected) next[item.id]="";else delete next[item.id];for(const child of order.lineItems.filter(candidate=>candidate.parentLineItemId===item.id))apply(child);};apply(line);return next; });
  }
  function details(): RedoOrderDetails | null {
    const selectedLines=order.lineItems.filter(line=>line.id in quantities), messages:string[]=[];
    if(!selectedLines.length)messages.push("Select at least one item to reproduce.");
    for(const line of selectedLines) {
      const quantity=Number(quantities[line.id]);
      if(!Number.isInteger(quantity)||quantity<=0)messages.push("Enter a replacement quantity for "+line.description+".");
      if(paid&&!derivedGroup(line)&&parseCurrencyDollarsToCents(prices[line.id]??"")===null)messages.push("Enter a valid replacement selling price for "+line.description+".");
    }
    if(!date)messages.push("Select a promised date.");
    if(messages.length){setError(messages.join(" "));return null;}
    if(!intentKey.current)intentKey.current=crypto.randomUUID();
    const parsed=redoOrderPreviewSchema.safeParse({ requestKey:intentKey.current,expectedUpdatedAt:canonicalOrderConcurrencyTimestamp(order.updatedAt),
      lines:selectedLines.map(line=>({sourceLineItemId:line.id,quantity:Number(quantities[line.id]),expectedUpdatedAt:canonicalOrderConcurrencyTimestamp(line.updatedAt),
        ...(paid&&!derivedGroup(line)?{priceOverrideTotalCents:parseCurrencyDollarsToCents(prices[line.id]??"")}:{})})),
      reason,explanation,promisedDate:date,disposition,
      ...(paid?{shipping:{decision:shippingDecision,amountCents:shippingDecision==="free"?0:parseCurrencyDollarsToCents(shippingAmount)}}:{}),
    });
    if(!parsed.success){setError(redoOrderValidationMessages(parsed.error,selectedLines.map(line=>line.description)).join(" "));return null;}
    const selected=new Map(parsed.data.lines.map(line=>[line.sourceLineItemId,line.quantity]));
    for(const line of selectedLines){const parent=order.lineItems.find(candidate=>candidate.id===line.parentLineItemId);
      if(selected.get(line.id)!>line.quantity||(line.parentLineItemId&&(!parent||!selected.has(parent.id)||selected.get(parent.id)!*line.quantity!==selected.get(line.id)!*parent.quantity))){setError("Use quantities no greater than the source and keep product groups in the same whole-piece proportions.");return null;}}
    return parsed.data;
  }
  async function reviewPrices(){
    if(pending.current)return;setError("");const request=details();if(!request)return;
    pending.current=true;setReviewBusy(true);setReview(null);setConfirmed(false);
    try{
      const response=await apiFetch("/api/orders/"+order.id+"/redo/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)});
      const result=await response.json();
      if(!response.ok||!result.preview?.reviewKey)throw new Error(result.code==="STALE_SOURCE"?"The source Order changed. Refresh the source Order before reviewing prices.":result.message||"Customer total requires review. Try again.");
      setReview({inputKey,data:result.preview});
    }catch(err){setError(err instanceof Error?err.message:"Unable to review customer total.");}
    finally{pending.current=false;setReviewBusy(false);}
  }
  async function submit(){
    if(pending.current)return;setError("");let payload=submitted.current;
    if(!payload){
      const request=details();if(!request)return;
      const parsed=createRedoOrderSchema.safeParse({...request,confirmed,...(paid&&currentReview?{pricingReview:currentReview.reviewKey}:{})});
      if(!parsed.success){setError(redoOrderValidationMessages(parsed.error,request.lines.map(line=>order.lineItems.find(item=>item.id===line.sourceLineItemId)?.description??"item")).join(" "));return;}
      payload=parsed.data;submitted.current=payload;submittedReview.current=currentReview;
    }
    pending.current=true;setBusy(true);
    try{
      const response=await apiFetch("/api/orders/"+order.id+"/redo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json();
      if(!response.ok||!result.order?.id){
        if(response.status>=400&&response.status<500){submitted.current=null;submittedReview.current=null;setReview(null);setConfirmed(false);}
        throw new Error(result.code==="STALE_SOURCE"?"The source Order or a selected item changed. Refresh the source Order, then review the replacement details again.":result.message||"Unable to create replacement order.");
      }
      const read=await apiFetch("/api/orders/"+result.order.id,{cache:"no-store"}),saved=await read.json(),expected=submittedReview.current;
      const expectedTotal=payload.disposition==="no_customer_charge"?0:expected?.totalCents;
      const chargedPricesMatch=payload.disposition!=="charge_customer"||!!expected&&expected.lines.every(line=>saved.lineItems?.some((item:any)=>item.redoSourceLineItemId===line.sourceLineItemId&&item.overridePriceCents===line.sellingTotalCents))&&Math.round(Number(saved.tax)*100)===expected.taxCents&&saved.shippingCents===expected.shippingCents&&Math.round(Number(saved.subtotal)*100)===expected.subtotalCents;
      if(!read.ok||saved.redoSourceOrderId!==order.id||saved.redoDisposition!==payload.disposition||Math.round(Number(saved.total)*100)!==expectedTotal||!chargedPricesMatch||saved.promisedDate?.slice(0,10)!==payload.promisedDate||!payload.lines.every(line=>saved.lineItems?.some((item:any)=>item.redoSourceLineItemId===line.sourceLineItemId&&item.quantity===line.quantity)))throw new Error("Replacement created but readback is unconfirmed. Retry safely to open the same order.");
      await client.invalidateQueries({queryKey:["orders"]});
      submitted.current=null;submittedReview.current=null;intentKey.current=null;setOpen(false);setQuantities({});setPrices({});setReason("");setExplanation("");setDate("");setConfirmed(false);setDisposition("no_customer_charge");setShippingDecision("");setShippingAmount("");setReview(null);navigate(orderPath(saved.id));
    }catch(err){setError(err instanceof Error?err.message:"Unable to create replacement. Retry with the same details.");}
    finally{pending.current=false;setBusy(false);}
  }
  return <>
    <Button type="button" variant="outline" size="sm" className={ORDER_DETAIL_SECONDARY_ACTION_CLASS} onClick={()=>setOpen(true)} disabled={disabled}>Create Redo Order</Button>
    <Dialog open={open} onOpenChange={value=>{if(!busy&&!reviewBusy)setOpen(value);}}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Redo Order</DialogTitle><DialogDescription>Replacement for Order #{order.displayNumber||order.orderNumber}. Select only the work to reproduce and enter replacement quantities. Product groups must stay together in proportion.</DialogDescription></DialogHeader>
        <fieldset disabled={locked} className="space-y-4" onChange={event=>{if(paid&&(event.target as HTMLElement).id!=="redo-confirm")setConfirmed(false);}}>
          <legend className="sr-only">Replacement details</legend>
          <div><Label htmlFor="redo-disposition">Financial disposition</Label><select id="redo-disposition" className="w-full rounded border bg-background p-2" value={disposition} onChange={event=>setDisposition(event.target.value as typeof disposition)}><option value="no_customer_charge">NO CUSTOMER CHARGE</option><option value="charge_customer">CHARGE CUSTOMER</option></select></div>
          {order.lineItems.map(line=><div key={line.id} className="rounded border p-3 space-y-2">
            <div className="flex items-center gap-3"><label className="flex-1"><input type="checkbox" checked={line.id in quantities} disabled={!!line.parentLineItemId} onChange={event=>selectGroup(line,event.target.checked)}/> {line.description} (source: {line.quantity})</label>
              {line.id in quantities?<label className="text-sm">Replacement quantity<Input aria-label={"Replacement quantity: "+line.description} type="number" min="1" max={line.quantity} step="1" value={quantities[line.id]} onChange={event=>setQuantities(current=>({...current,[line.id]:event.target.value}))}/></label>:null}</div>
            {paid&&line.id in quantities?<>
              <p className="text-sm text-muted-foreground">Original selling total: {line.totalPrice!=null?money(Math.round(Number(line.totalPrice)*100)):"Unavailable"} for {line.quantity} pieces. Reference only; replacement prices are entered separately.</p>
              {derivedGroup(line)?<p className="text-sm">Group total is calculated from its component prices during review.</p>:<label className="text-sm">Replacement selling total (before tax)<Input aria-label={"Replacement selling total: "+line.description} inputMode="decimal" value={prices[line.id]??""} onChange={event=>setPrices(current=>({...current,[line.id]:event.target.value}))}/></label>}
              {line.parentLineItemId?<p className="text-sm text-muted-foreground">Included in the parent product group; never added twice.</p>:null}
            </>:null}
          </div>)}
          {paid?<div><Label htmlFor="redo-shipping">Shipping charge decision</Label><select id="redo-shipping" value={shippingDecision} onChange={event=>setShippingDecision(event.target.value)} className="w-full rounded border bg-background p-2"><option value="">Choose shipping charge</option><option value="free">No shipping charge</option><option value="manual">Explicit shipping charge</option></select>{shippingDecision==="manual"?<label>Shipping charge<Input aria-label="Replacement shipping charge" inputMode="decimal" value={shippingAmount} onChange={event=>setShippingAmount(event.target.value)}/></label>:null}<p className="text-sm text-muted-foreground">The original shipping fee is never copied.</p></div>:null}
          <div><Label htmlFor="redo-reason">Reason</Label><select id="redo-reason" value={reason} onChange={event=>setReason(event.target.value)} className="w-full rounded border bg-background p-2"><option value="">Select reason</option>{REDO_REASONS.map(value=><option key={value}>{value}</option>)}</select></div>
          <div><Label htmlFor="redo-explanation">Additional explanation{reason==="Other"?" (required)":""}</Label><Input id="redo-explanation" maxLength={2000} value={explanation} onChange={event=>setExplanation(event.target.value)}/></div>
          <div><Label htmlFor="redo-date">Promised date</Label><Input id="redo-date" type="date" required value={date} onChange={event=>setDate(event.target.value)}/></div>
          <p className="text-sm text-muted-foreground">Creates a separate Order and unsent draft Invoice. No automatic finalization or payment. The original Invoice and payments remain unchanged.</p>
          {paid?<Button type="button" variant="outline" onClick={()=>void reviewPrices()} disabled={locked}>{reviewBusy?"Reviewing…":"Review customer total"}</Button>:null}
          {paid&&!currentReview?<p role="status">Customer total requires review, including tax and shipping. Review again after changing any details.</p>:null}
          {currentReview&&paid?<section aria-label="Reviewed replacement total" className="rounded border p-3"><p>Replacement subtotal: {money(currentReview.subtotalCents)}</p><p>Applicable tax: {money(currentReview.taxCents)}</p><p>Shipping: {money(currentReview.shippingCents)}</p><p className="font-semibold">Customer total: {money(currentReview.totalCents)}</p></section>:!paid?<p className="font-semibold">Customer total: $0.00 — NO CUSTOMER CHARGE</p>:null}
          <label className="flex gap-2"><input id="redo-confirm" type="checkbox" checked={confirmed} disabled={paid&&!currentReview} onChange={event=>setConfirmed(event.target.checked)}/>{paid?"I explicitly authorize the reviewed replacement customer charge of "+money(currentReview?.totalCents??0)+" and confirm the selected work and promised date.":"I confirm the selected replacement work, promised date, and no customer charge."}</label>
        </fieldset>
        {error?<p role="alert" className="text-destructive">{error}</p>:null}
        {submitted.current&&!busy?<p className="text-sm">The outcome needs confirmation. Retry uses the same request and cannot create another order.</p>:null}
        <Button type="button" disabled={busy||reviewBusy||(!submitted.current&&(!confirmed||(paid&&!currentReview)))} onClick={()=>void submit()}>{busy?"Creating…":submitted.current?"Retry and confirm replacement":"Confirm Create Redo Order"}</Button>
      </DialogContent>
    </Dialog>
  </>;
}
