import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { artworkApi, newBusinessRequestId, orderApi, quoteApi, type OrderResult, type QuoteResult, type Selection } from "./api";
import type { DraftLineArtwork } from "./ArtworkLineIntake";
import { CustomerLookup } from "./CustomerLookup";
import { QuoteLineEditor } from "./QuoteLineEditor";
import { defaultContactForCustomer, emptyQuoteLineDraft, type QuoteLineMutationInput } from "./quoteFormModel";
import { useQuoteFormContacts, useQuoteFormProducts } from "./quoteFormQueries";

type EntryMode = "quote" | "order";

type ComposedSalesLine = Readonly<{ clientLineKey: string; input: QuoteLineMutationInput; artwork: readonly DraftLineArtwork[] }>;
type PendingArtworkUpload = Readonly<DraftLineArtwork & { orderId: string; orderLineId: string }>;

const lineSummary = (line: ComposedSalesLine, products: readonly Selection[]): string => {
  const product = products.find((candidate) => candidate.productId === line.input.productId)?.displayName ?? line.input.description ?? "Product";
  const size = line.input.dimensions ? `${line.input.dimensions.width} × ${line.input.dimensions.height} ${line.input.dimensions.unit}` : "No dimensions";
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
  const [lines, setLines] = useState<readonly ComposedSalesLine[]>([]);
  const [failedUploads, setFailedUploads] = useState<readonly PendingArtworkUpload[]>([]);
  const [createdOrderId, setCreatedOrderId] = useState("");
  const [lineVersion, setLineVersion] = useState(0);
  const requestId = useRef("");
  const contacts = useQuoteFormContacts(sessionScope, organizationId, customerId);
  const products = useQuoteFormProducts(sessionScope, organizationId);

  useEffect(() => {
    const next = defaultContactForCustomer(customerId, contactId, contacts.data ?? []);
    if (next !== contactId) setContactId(next);
  }, [contactId, contacts.data, customerId]);

  const payload = () => ({
    customerContact: { organizationId, customerId, ...(contactId ? { contactId } : {}) },
    ...(purchaseOrderNumber.trim() ? { purchaseOrderNumber: purchaseOrderNumber.trim() } : {}),
    ...(requestedDueDate ? { requestedDueDate } : {}),
    ...(commercialNotes.trim() ? { terms: { commercialNotes: commercialNotes.trim() } } : {}),
    lines: lines.map((line) => mode === "order" ? { ...line.input, clientLineKey: line.clientLineKey } : line.input),
  });
  const uploadOrderArtwork = async (result: OrderResult): Promise<readonly PendingArtworkUpload[]> => {
    const orderId = result.order.order.orderId;
    const correlations = new Map((result.lineCorrelations ?? []).map((entry) => [entry.clientLineKey, entry.orderLineId]));
    const uploads = lines.flatMap((line) => line.artwork.map((artwork) => ({ line, artwork })));
    const failures: PendingArtworkUpload[] = [];
    for (const { line, artwork } of uploads) {
      const orderLineId = correlations.get(line.clientLineKey);
      if (!orderLineId) {
        failures.push({ ...artwork, orderId, orderLineId: "" });
        continue;
      }
      try {
        await artworkApi.upload(organizationId, artwork.uploadRequestId, { orderId, orderLineId, purpose: artwork.purpose, ...(artwork.side ? { side: artwork.side } : {}), file: artwork.file });
      } catch {
        failures.push({ ...artwork, orderId, orderLineId });
      }
    }
    return failures;
  };
  const create = useMutation({
    mutationFn: async () => {
      if (!requestId.current) requestId.current = newBusinessRequestId();
      const input = payload();
      return mode === "quote"
        ? quoteApi.create(organizationId, requestId.current, input)
        : orderApi.create(organizationId, requestId.current, input);
    },
    onSuccess: async (result) => {
      requestId.current = "";
      void queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "sales"] });
      if (mode === "quote") onQuoteCreated?.(result as QuoteResult);
      else {
        const created = result as Awaited<ReturnType<typeof orderApi.create>>;
        const failures = await uploadOrderArtwork(created);
        if (!failures.length) onOrderCreated?.(created.order.order.orderId);
        else { setCreatedOrderId(created.order.order.orderId); setFailedUploads(failures); }
      }
    },
  });
  const action = mode === "quote" ? "Create Quote" : "Create Order";
  const disabled = !canCreate || !csrfReady || !customerId || lines.length === 0 || create.isPending;

  return <section className="lab v2-sales-entry" aria-label={`New ${mode}`}>
    <header className="v2-sales-entry-header">
      <div><button className="link-button" type="button" onClick={onCancel}>← {mode === "quote" ? "Quotes" : "Orders"}</button><h1>New {mode === "quote" ? "Quote" : "Order"}</h1><p>{mode === "quote" ? "Build a draft commercial proposal." : "Create a confirmed commercial Order without a Quote."}</p></div>
    </header>
    <div className="v2-sales-entry-meta">
      <CustomerLookup organizationId={organizationId} sessionScope={sessionScope} customerId={customerId} onChange={(customer) => { setCustomerId(customer?.customerId ?? ""); setContactId(""); }} />
      <label className="field">Contact<select aria-label="Contact" value={contactId} disabled={!customerId} onChange={(event) => setContactId(event.target.value)}><option value="">Select Contact</option>{(contacts.data ?? []).map((contact) => contact.contactId ? <option key={contact.contactId} value={contact.contactId}>{contact.displayName}</option> : null)}</select></label>
      <label className="field">PO #<input aria-label="PO #" value={purchaseOrderNumber} onChange={(event) => setPurchaseOrderNumber(event.target.value)} /></label>
      <label className="field">Requested Due<input aria-label="Requested Due" type="date" value={requestedDueDate} onChange={(event) => setRequestedDueDate(event.target.value)} /></label>
    </div>
    <section className="v2-sales-entry-items">
      <header><div><h2>Items</h2><p>Add each configured Product before creating the {mode}.</p></div><span>{lines.length} added</span></header>
      {lines.length > 0 && <ol className="v2-sales-entry-list">{lines.map((line, index) => <li key={line.clientLineKey}><div><b>{lineSummary(line, products.data ?? [])}</b><small>Quantity {line.input.quantity} · {line.input.selling?.kind === "calculated" ? "Server-calculated price" : "Price override requested"}{line.artwork.length ? ` · Artwork: ${line.artwork.length} file${line.artwork.length === 1 ? "" : "s"} selected` : ""}</small></div><button type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button></li>)}</ol>}
      <div className="v2-sales-entry-composer"><h3>Add Item</h3><QuoteLineEditor organizationId={organizationId} sessionScope={sessionScope} draftKey={`${mode}:new:${lineVersion}`} initialDraft={emptyQuoteLineDraft()} products={products.data ?? []} canOverridePrice={canOverridePrice} csrfReady={csrfReady} busy={create.isPending} submitLabel="Add Item" enableArtworkIntake onSubmit={(input, artwork) => { setLines((current) => [...current, { clientLineKey: newBusinessRequestId().replace(/[^A-Za-z0-9_-]/gu, ""), input, artwork }]); setLineVersion((current) => current + 1); }} /></div>
    </section>
    {mode === "quote" && <p className="notice">Artwork is optional. QuoteLine Artwork is not yet a canonical domain target, so selected PDFs can supply dimensions here and are uploaded after an Order line exists.</p>}
    {createdOrderId && failedUploads.length > 0 && <section className="notice error" role="alert"><p>Order created, but {failedUploads.length} Artwork upload{failedUploads.length === 1 ? "" : "s"} failed. The Order remains valid.</p>{failedUploads.map((upload) => <div key={upload.clientArtworkKey}><span>{upload.file.name}</span><button type="button" onClick={() => { if (!upload.orderLineId) return; void artworkApi.upload(organizationId, upload.uploadRequestId, { orderId: upload.orderId, orderLineId: upload.orderLineId, purpose: upload.purpose, ...(upload.side ? { side: upload.side } : {}), file: upload.file }).then(() => setFailedUploads((current) => current.filter((item) => item.clientArtworkKey !== upload.clientArtworkKey))).catch(() => undefined); }}>Retry upload</button></div>)}<button type="button" onClick={() => onOrderCreated?.(createdOrderId)}>Open Order</button></section>}
    <label className="field v2-sales-entry-notes">Commercial notes<textarea value={commercialNotes} onChange={(event) => setCommercialNotes(event.target.value)} /></label>
    {create.error && <p className="notice error">{(create.error as Error).message}</p>}
    <footer><p>Pricing, ProductVersion, material requirements, routing, and Billing facts are resolved by the server when this {mode} is created.</p><button className="button" type="button" disabled={disabled} onClick={() => create.mutate()}>{create.isPending ? `${action}…` : action}</button></footer>
  </section>;
};
