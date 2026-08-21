import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { newBusinessRequestId, orderApi, quoteApi, type QuoteResult, type Selection } from "./api";
import { QuoteLineEditor } from "./QuoteLineEditor";
import { emptyQuoteLineDraft, type QuoteLineMutationInput } from "./quoteFormModel";
import { useQuoteFormContacts, useQuoteFormCustomers, useQuoteFormProducts } from "./quoteFormQueries";

type EntryMode = "quote" | "order";

const lineSummary = (line: QuoteLineMutationInput, products: readonly Selection[]): string => {
  const product = products.find((candidate) => candidate.productId === line.productId)?.displayName ?? line.description ?? "Product";
  const size = line.dimensions ? `${line.dimensions.width} × ${line.dimensions.height} ${line.dimensions.unit}` : "No dimensions";
  return `${product} · ${size}`;
};

/**
 * Shared pre-persistence composition only. Sales remains the authority that
 * resolves ProductVersion/configuration and Pricing when the document is made.
 */
export const SalesEntryWorkspace = ({
  mode,
  organizationId,
  sessionScope,
  canCreate,
  canOverridePrice,
  csrfReady,
  onQuoteCreated,
  onOrderCreated,
  onCancel,
}: Readonly<{
  mode: EntryMode;
  organizationId: string;
  sessionScope: string;
  canCreate: boolean;
  canOverridePrice: boolean;
  csrfReady: boolean;
  onQuoteCreated?: (result: QuoteResult) => void;
  onOrderCreated?: (orderId: string) => void;
  onCancel: () => void;
}>) => {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [contactId, setContactId] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [requestedDueDate, setRequestedDueDate] = useState("");
  const [commercialNotes, setCommercialNotes] = useState("");
  const [lines, setLines] = useState<readonly QuoteLineMutationInput[]>([]);
  const [lineVersion, setLineVersion] = useState(0);
  const customerRef = useRef<HTMLSelectElement>(null);
  const requestId = useRef("");
  const customers = useQuoteFormCustomers(sessionScope, organizationId);
  const contacts = useQuoteFormContacts(sessionScope, organizationId, customerId);
  const products = useQuoteFormProducts(sessionScope, organizationId);

  useEffect(() => { customerRef.current?.focus(); }, []);
  useEffect(() => {
    if (!customerId || contactId || contacts.data?.length !== 1) return;
    const only = contacts.data[0]?.contactId;
    if (only) setContactId(only);
  }, [contactId, contacts.data, customerId]);

  const payload = () => ({
    customerContact: { organizationId, customerId, ...(contactId ? { contactId } : {}) },
    ...(purchaseOrderNumber.trim() ? { purchaseOrderNumber: purchaseOrderNumber.trim() } : {}),
    ...(requestedDueDate ? { requestedDueDate } : {}),
    ...(commercialNotes.trim() ? { terms: { commercialNotes: commercialNotes.trim() } } : {}),
    lines,
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!requestId.current) requestId.current = newBusinessRequestId();
      const input = payload();
      return mode === "quote"
        ? quoteApi.create(organizationId, requestId.current, input)
        : orderApi.create(organizationId, requestId.current, input);
    },
    onSuccess: (result) => {
      requestId.current = "";
      void queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "sales"] });
      if (mode === "quote") onQuoteCreated?.(result as QuoteResult);
      else onOrderCreated?.((result as Awaited<ReturnType<typeof orderApi.create>>).order.order.orderId);
    },
  });
  const action = mode === "quote" ? "Create Quote" : "Create Order";
  const disabled = !canCreate || !csrfReady || !customerId || lines.length === 0 || create.isPending;

  return <section className="lab v2-sales-entry" aria-label={`New ${mode}`}>
    <header className="v2-sales-entry-header">
      <div><button className="link-button" type="button" onClick={onCancel}>← {mode === "quote" ? "Quotes" : "Orders"}</button><h1>New {mode === "quote" ? "Quote" : "Order"}</h1><p>{mode === "quote" ? "Build a draft commercial proposal." : "Create a confirmed commercial Order without a Quote."}</p></div>
    </header>
    <div className="v2-sales-entry-meta">
      <label className="field">Customer<select ref={customerRef} aria-label="Customer" value={customerId} onChange={(event) => { setCustomerId(event.target.value); setContactId(""); }}><option value="">Select Customer</option>{(customers.data ?? []).map((customer) => customer.customerId ? <option key={customer.customerId} value={customer.customerId}>{customer.displayName}</option> : null)}</select></label>
      <label className="field">Contact<select aria-label="Contact" value={contactId} disabled={!customerId} onChange={(event) => setContactId(event.target.value)}><option value="">Select Contact</option>{(contacts.data ?? []).map((contact) => contact.contactId ? <option key={contact.contactId} value={contact.contactId}>{contact.displayName}</option> : null)}</select></label>
      <label className="field">PO #<input aria-label="PO #" value={purchaseOrderNumber} onChange={(event) => setPurchaseOrderNumber(event.target.value)} /></label>
      <label className="field">Requested Due<input aria-label="Requested Due" type="date" value={requestedDueDate} onChange={(event) => setRequestedDueDate(event.target.value)} /></label>
    </div>
    <section className="v2-sales-entry-items">
      <header><div><h2>Items</h2><p>Add each configured Product before creating the {mode}.</p></div><span>{lines.length} added</span></header>
      {lines.length > 0 && <ol className="v2-sales-entry-list">{lines.map((line, index) => <li key={`${line.productId}:${index}`}><div><b>{lineSummary(line, products.data ?? [])}</b><small>Quantity {line.quantity} · {line.selling?.kind === "calculated" ? "Server-calculated price" : "Price override requested"}</small></div><button type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button></li>)}</ol>}
      <div className="v2-sales-entry-composer"><h3>Add Item</h3><QuoteLineEditor organizationId={organizationId} sessionScope={sessionScope} draftKey={`${mode}:new:${lineVersion}`} initialDraft={emptyQuoteLineDraft()} products={products.data ?? []} canOverridePrice={canOverridePrice} csrfReady={csrfReady} busy={create.isPending} submitLabel="Add Item" onSubmit={(line) => { setLines((current) => [...current, line]); setLineVersion((current) => current + 1); }} /></div>
    </section>
    <label className="field v2-sales-entry-notes">Commercial notes<textarea value={commercialNotes} onChange={(event) => setCommercialNotes(event.target.value)} /></label>
    {create.error && <p className="notice error">{(create.error as Error).message}</p>}
    <footer><p>Pricing, ProductVersion, material requirements, routing, and Billing facts are resolved by the server when this {mode} is created.</p><button className="button" type="button" disabled={disabled} onClick={() => create.mutate()}>{create.isPending ? `${action}…` : action}</button></footer>
  </section>;
};
