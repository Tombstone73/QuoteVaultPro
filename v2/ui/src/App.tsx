import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  money,
  newBusinessRequestId,
  quoteApi,
  clearV2ApiSessionState,
  type ApiError,
  type QuoteRead,
  type QuoteResult,
} from "./api";
import {
  applyAuthoritativeQuoteResult,
  clearV2SessionQueryState,
  reconcileForbiddenQuoteMutation,
} from "./quoteCache";
import { QuoteLineEditor } from "./QuoteLineEditor";
import { OrderWorkspace } from "./OrderWorkspace";
import { LifecycleBadge, SalesTotals } from "./SalesDocumentParts";
import {
  clearContactForCustomerChange,
  draftFromQuoteLine,
  emptyQuoteLineDraft,
  type QuoteLineMutationInput,
} from "./quoteFormModel";
import {
  quoteKeys,
  salesKeys,
  useQuoteFormContacts,
  useQuoteFormCustomers,
  useQuoteFormProducts,
  useSalesOrders,
  useSalesQuotes,
} from "./quoteFormQueries";
import { SelectionField } from "./SelectionField";
import { AppearanceWorkspace } from "./AppearanceWorkspace";
import type { VisualAppearance } from "./appearance";
import { V2VisualShell, type V2VisualPage } from "./VisualShell";
import { ProofingWorkspace } from "./ProofingWorkspace";
import { PrepressWorkspace } from "./PrepressWorkspace";

const errorText = (error: unknown) => {
  const value = error as ApiError;
  if (value?.code === "STALE_STATE")
    return "This Quote changed elsewhere. Reload it before saving your draft.";
  if (value?.code === "FORBIDDEN")
    return "You do not have permission for that Quote action.";
  if (value?.code === "NOT_FOUND")
    return "The Quote, customer, contact, or Product is unavailable in this organization.";
  return value?.message ?? "The Quote service is unavailable.";
};

const Status = LifecycleBadge;

export const App = ({
  appearance,
  setAppearance,
}: {
  appearance: VisualAppearance;
  setAppearance: (patch: Partial<VisualAppearance>) => void;
}) => {
  const [page, setPage] = useState<V2VisualPage>("quotes");
  const [organizationId, setOrganizationId] = useState("");
  const [sessionScope, setSessionScope] = useState("");
  const sessionScopeRef = useRef(sessionScope);
  const organizationRef = useRef(organizationId);
  useEffect(() => {
    organizationRef.current = organizationId;
  }, [organizationId]);
  const [quoteId, setQuoteId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const quote = useQuery({
    queryKey: quoteKeys.quote(sessionScope, organizationId, quoteId),
    queryFn: () => quoteApi.get(organizationId, quoteId),
    enabled: Boolean(sessionScope && organizationId && quoteId),
  });
  const bootstrap = useQuery({
    queryKey: quoteKeys.bootstrap(sessionScope, organizationId),
    queryFn: () => quoteApi.bootstrap(organizationId),
    enabled: Boolean(organizationId),
    staleTime: 0,
  });
  useEffect(() => {
    const nextScope = bootstrap.data?.sessionScope;
    if (!nextScope) return;
    if (sessionScopeRef.current && sessionScopeRef.current !== nextScope) {
      clearV2SessionQueryState(queryClient);
      setOrganizationId("");
      setQuoteId("");
      setOrderId("");
      setNotice("");
    }
    sessionScopeRef.current = nextScope;
    setSessionScope(nextScope);
  }, [bootstrap.data?.sessionScope, queryClient]);
  const applyQuoteResult = (result: QuoteResult, resultOrganizationId: string, resultSessionScope: string) => {
    if (!resultSessionScope || sessionScopeRef.current !== resultSessionScope) return;
    const id = applyAuthoritativeQuoteResult(
      queryClient,
      resultSessionScope,
      resultOrganizationId,
      result,
    );
    void queryClient.invalidateQueries({ queryKey: ["v2", resultSessionScope, resultOrganizationId, "sales", "quotes"] });
    if (organizationRef.current === resultOrganizationId) setQuoteId(id);
  };
  const reconcileAuthority = () =>
    reconcileForbiddenQuoteMutation(
      queryClient,
      sessionScope,
      organizationId,
      quoteId || undefined,
    );
  useEffect(() => {
    const resetForTrustedSessionChange = () => {
      clearV2SessionQueryState(queryClient);
      clearV2ApiSessionState();
      sessionScopeRef.current = "";
      setSessionScope("");
      setOrganizationId("");
      setQuoteId("");
      setOrderId("");
      setNotice("");
    };
    window.addEventListener(
      "v2:session-context-changed",
      resetForTrustedSessionChange,
    );
    return () =>
      window.removeEventListener(
        "v2:session-context-changed",
        resetForTrustedSessionChange,
      );
  }, [queryClient]);
  useEffect(() => {
    const refreshTrustedBootstrap = () => {
      if (organizationRef.current)
        void queryClient.invalidateQueries({
          queryKey: quoteKeys.bootstrap(sessionScopeRef.current, organizationRef.current),
        });
    };
    window.addEventListener("focus", refreshTrustedBootstrap);
    return () => window.removeEventListener("focus", refreshTrustedBootstrap);
  }, [queryClient]);

  const navigate = (nextPage: V2VisualPage) => {
    setPage(nextPage);
    if (nextPage === "quotes") setOrderId("");
    if (nextPage === "orders") setQuoteId("");
  };
  return (
    <V2VisualShell page={page} onNavigate={navigate} appearance={appearance} setAppearance={setAppearance}>
      {page === "appearance" ? <AppearanceWorkspace appearance={appearance} setAppearance={setAppearance} /> : page === "proofing" ? <ProofingWorkspace organizationId={organizationId} sessionScope={sessionScope} canView={bootstrap.data?.capabilities.proofView === true} /> : page === "prepress" ? <PrepressWorkspace organizationId={organizationId} sessionScope={sessionScope} canView={bootstrap.data?.capabilities.prepressView === true} canWork={bootstrap.data?.capabilities.prepressWork === true} canComplete={bootstrap.data?.capabilities.prepressComplete === true} /> : <>
        {page === "orders" ? (
          <OrdersPage
            organizationId={organizationId}
            setOrganizationId={(next) => { setOrganizationId(next); setOrderId(""); }}
            sessionScope={sessionScope}
            orderId={orderId}
            setOrderId={setOrderId}
            bootstrap={bootstrap.data}
          />
        ) : (
          <QuotesPage
            organizationId={organizationId}
            setOrganizationId={(nextOrganizationId) => { setOrganizationId(nextOrganizationId); setQuoteId(""); }}
            sessionScope={sessionScope}
            quoteId={quoteId}
            setQuoteId={setQuoteId}
            quote={quote.data}
          error={quote.error ?? bootstrap.error}
            loading={quote.isFetching}
            load={(id) => {
              setQuoteId(id);
              setNotice("");
            }}
            reload={() =>
              queryClient.invalidateQueries({
                queryKey: quoteKeys.quote(sessionScope, organizationId, quoteId),
              })
            }
            notice={notice}
            setNotice={setNotice}
            applyQuoteResult={applyQuoteResult}
            reconcileAuthority={reconcileAuthority}
            canOverridePrice={
              bootstrap.data?.capabilities.quoteOverridePrice === true
            }
            canEdit={bootstrap.data?.capabilities.quoteEdit === true}
            canSend={bootstrap.data?.capabilities.quoteSend === true}
            canConvert={bootstrap.data?.capabilities.quoteConvert === true}
            csrfReady={bootstrap.isSuccess}
            openOrder={(id) => { setOrderId(id); setPage("orders"); }}
          />
        )}
      </>}
    </V2VisualShell>
  );
};

const Lab = () => (
  <section className="lab">
    <div className="card">
      <h2>Controls</h2>
      <div className="lab-row">
        <button className="button">Primary action</button>
        <button className="button secondary">Secondary</button>
        <button className="button danger">Destructive</button>
        <button className="button" disabled>
          Disabled
        </button>
        <input aria-label="Sample input" placeholder="Input" />
        <select aria-label="Sample select">
          <option>Selection</option>
        </select>
      </div>
    </div>
    <div className="card">
      <h2>Status and states</h2>
      <div className="lab-row">
        <Status value="sent" />
        <Status value="accepted" />
        <span className="badge">Informational</span>
        <span className="notice">Warning state</span>
        <span className="notice error">Validation error</span>
      </div>
    </div>
  </section>
);

const SalesList = ({
  kind,
  items,
  onOpen,
}: Readonly<{
  kind: "Quote" | "Order";
  items: readonly Readonly<{ number: string; customerDisplayName: string; lifecycle: string; sellingTotalCents: number; currency: string; requestedDueDate?: string; updatedAt: string; quoteId?: string; orderId?: string; draftInvoice?: unknown; routing?: string }> [];
  onOpen: (id: string) => void;
}>) => <div className="card"><h2>{kind}s</h2>{items.length === 0 ? <p className="muted">No {kind.toLowerCase()}s match this organization and filter.</p> : <table className="table"><thead><tr><th>Number</th><th>Customer</th><th>Status</th><th>Due date</th><th>Total</th><th>Updated</th>{kind === "Order" && <><th>Invoice</th><th>Routing</th></>}</tr></thead><tbody>{items.map((item) => <tr key={item.quoteId ?? item.orderId} onClick={() => onOpen(item.quoteId ?? item.orderId ?? "")} className="clickable-row"><td><button className="link-button">{item.number}</button></td><td>{item.customerDisplayName}</td><td><LifecycleBadge value={item.lifecycle} /></td><td>{item.requestedDueDate ?? "—"}</td><td>{money({ cents: item.sellingTotalCents, currency: item.currency })}</td><td>{new Date(item.updatedAt).toLocaleString()}</td>{kind === "Order" && <><td>{item.draftInvoice ? "Draft" : "—"}</td><td>{item.routing === "routed" ? "Routed" : "No route"}</td></>}</tr>)}</tbody></table>}</div>;

const SalesPagination = ({ cursor, nextCursor, setCursor }: Readonly<{ cursor: string; nextCursor?: string; setCursor: (value: string) => void }>) => (
  <div className="actions list-pagination">
    {cursor && <button className="button secondary" onClick={() => setCursor("")}>First page</button>}
    {nextCursor && <button className="button secondary" onClick={() => setCursor(nextCursor)}>Next page</button>}
  </div>
);

const QuotesPage = (props: WorkspaceProps & Readonly<{ quoteId: string; setQuoteId: (value: string) => void; canEdit: boolean; canSend: boolean; canConvert: boolean; openOrder: (value: string) => void }>) => {
  const [search, setSearch] = useState(""); const [lifecycle, setLifecycle] = useState(""); const [cursor, setCursor] = useState("");
  const list = useSalesQuotes(props.sessionScope, props.organizationId, { q: search, ...(lifecycle ? { lifecycle } : {}), ...(cursor ? { cursor } : {}) });
  return <section className="lab v2-sales-workspace">
    <div className="card grid"><label className="field">Sales organization<input value={props.organizationId} onChange={(event) => { setCursor(""); props.setOrganizationId(event.target.value); }} placeholder="Authenticated route scope" /></label><label className="field">Search Quotes<input value={search} onChange={(event) => { setCursor(""); setSearch(event.target.value); }} placeholder="Number or Customer" /></label><label className="field">Lifecycle<select value={lifecycle} onChange={(event) => { setCursor(""); setLifecycle(event.target.value); }}><option value="">All</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="converted">Converted</option></select></label></div>
    {props.organizationId && !props.quoteId && <><SalesList kind="Quote" items={list.data?.items ?? []} onOpen={props.setQuoteId} /><SalesPagination cursor={cursor} nextCursor={list.data?.nextCursor} setCursor={setCursor} /></>}
    <QuoteWorkspace {...props} />
  </section>;
};

const OrdersPage = ({ organizationId, setOrganizationId, sessionScope, orderId, setOrderId, bootstrap }: Readonly<{ organizationId: string; setOrganizationId: (value: string) => void; sessionScope: string; orderId: string; setOrderId: (value: string) => void; bootstrap?: import("./api").UiBootstrap }>) => {
  const [search, setSearch] = useState(""); const [lifecycle, setLifecycle] = useState(""); const [cursor, setCursor] = useState("");
  const list = useSalesOrders(sessionScope, organizationId, { q: search, ...(lifecycle ? { lifecycle } : {}), ...(cursor ? { cursor } : {}) });
  if (orderId) return <OrderWorkspace organizationId={organizationId} sessionScope={sessionScope} orderId={orderId} canEdit={bootstrap?.capabilities.orderEdit === true} canOverridePrice={bootstrap?.capabilities.orderOverridePrice === true} canViewInvoice={bootstrap?.capabilities.invoiceView === true} csrfReady={Boolean(bootstrap)} onBack={() => setOrderId("")} />;
  return <section className="lab v2-sales-workspace"><div className="card grid"><label className="field">Organization ID<input value={organizationId} onChange={(event) => { setCursor(""); setOrganizationId(event.target.value); }} placeholder="Authenticated route scope" /></label><label className="field">Search Orders<input value={search} onChange={(event) => { setCursor(""); setSearch(event.target.value); }} placeholder="Number or Customer" /></label><label className="field">Lifecycle<select value={lifecycle} onChange={(event) => { setCursor(""); setLifecycle(event.target.value); }}><option value="">All</option><option value="open">Open</option><option value="cancelled">Cancelled</option></select></label></div>{organizationId && <><SalesList kind="Order" items={list.data?.items ?? []} onOpen={setOrderId} /><SalesPagination cursor={cursor} nextCursor={list.data?.nextCursor} setCursor={setCursor} /></>}</section>;
};

type WorkspaceProps = Readonly<{
  organizationId: string;
  setOrganizationId: (value: string) => void;
  sessionScope: string;
  quote?: QuoteRead;
  error: unknown;
  loading: boolean;
  load: (quoteId: string) => void;
  reload: () => void;
  notice: string;
  setNotice: (value: string) => void;
  applyQuoteResult: (
    result: QuoteResult,
    organizationId: string,
    sessionScope: string,
  ) => void;
  reconcileAuthority: () => Promise<void>;
  canOverridePrice: boolean;
  canEdit?: boolean;
  canSend?: boolean;
  canConvert?: boolean;
  csrfReady: boolean;
  openOrder?: (orderId: string) => void;
}>;

const QuoteWorkspace = ({
  organizationId,
  setOrganizationId,
  sessionScope,
  quote,
  error,
  loading,
  load,
  reload,
  notice,
  setNotice,
  applyQuoteResult,
  reconcileAuthority,
  canOverridePrice,
  canEdit = true,
  canSend = true,
  canConvert = false,
  csrfReady,
  openOrder,
}: WorkspaceProps) => {
  const queryClient = useQueryClient();
  const [openQuoteId, setOpenQuoteId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [contactId, setContactId] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [requestedDueDate, setRequestedDueDate] = useState("");
  const [commercialNotes, setCommercialNotes] = useState("");
  const [headerCustomerId, setHeaderCustomerId] = useState("");
  const [headerContactId, setHeaderContactId] = useState("");
  const [editingLineId, setEditingLineId] = useState("");
  const [addEditorVersion, setAddEditorVersion] = useState(0);
  const customers = useQuoteFormCustomers(sessionScope, organizationId);
  const contacts = useQuoteFormContacts(
    sessionScope,
    organizationId,
    quote ? headerCustomerId : customerId,
  );
  const products = useQuoteFormProducts(sessionScope, organizationId);
  const requestIds = useRef<Record<string, { id: string; payload: string }>>({});

  const requestId = (operation: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    const existing = requestIds.current[operation];
    if (!existing || existing.payload !== serialized)
      requestIds.current[operation] = {
        id: newBusinessRequestId(),
        payload: serialized,
      };
    return requestIds.current[operation]!.id;
  };
  const completeRequest = (operation: string) => {
    delete requestIds.current[operation];
  };

  useEffect(() => {
    setPurchaseOrderNumber(quote?.quote.purchaseOrderNumber ?? "");
    setRequestedDueDate(quote?.quote.requestedDueDate ?? "");
    setCommercialNotes(quote?.quote.terms.commercialNotes ?? "");
    setHeaderCustomerId(quote?.quote.customerContact.customerId ?? "");
    setHeaderContactId(quote?.quote.customerContact.contactId ?? "");
    setEditingLineId("");
  }, [quote?.quote.quoteId]);

  const handleMutationError = (mutationError: unknown) => {
    const code = (mutationError as ApiError)?.code;
    if (code === "FORBIDDEN")
      void reconcileAuthority();
    if (code === "STALE_STATE") {
      setNotice(
        "This Quote changed elsewhere. Current server state is refreshing; review your retained draft before resubmitting.",
      );
      void reload();
    }
  };

  const create = useMutation({
    mutationFn: (line: QuoteLineMutationInput) => {
      const payload = {
        organizationId,
        customerId,
        contactId,
        purchaseOrderNumber,
        requestedDueDate,
        commercialNotes,
        line,
      };
      return quoteApi.create(
        organizationId,
        requestId("create", payload),
        {
          customerContact: {
            organizationId,
            customerId,
            ...(contactId ? { contactId } : {}),
          },
          ...(purchaseOrderNumber.trim()
            ? { purchaseOrderNumber: purchaseOrderNumber.trim() }
            : {}),
          ...(requestedDueDate ? { requestedDueDate } : {}),
          ...(commercialNotes.trim()
            ? { terms: { commercialNotes: commercialNotes.trim() } }
            : {}),
          lines: [line],
        },
      );
    },
    onSuccess: (result) => {
      completeRequest("create");
      applyQuoteResult(result, organizationId, sessionScope);
      setNotice("Quote created from authoritative Product resolution and Pricing.");
    },
    onError: handleMutationError,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        organizationId,
        quoteId: quote!.quote.quoteId,
        revision: quote!.revision,
        purchaseOrderNumber,
        requestedDueDate,
        commercialNotes,
        headerCustomerId,
        headerContactId,
      };
      return quoteApi.patch(
        organizationId,
        quote!.quote.quoteId,
        requestId("save", payload),
        {
          expectedRevision: quote!.revision,
          patch: {
            customerContact: {
              organizationId,
              customerId: headerCustomerId,
              ...(headerContactId ? { contactId: headerContactId } : {}),
            },
            purchaseOrderNumber: purchaseOrderNumber.trim() || null,
            requestedDueDate: requestedDueDate || null,
            terms: { commercialNotes },
          },
        },
      );
    },
    onSuccess: (result) => {
      completeRequest("save");
      applyQuoteResult(result, organizationId, sessionScope);
      setNotice("Quote saved.");
    },
    onError: handleMutationError,
  });

  const lineChange = useMutation({
    mutationFn: (lineChanges: unknown[]) => {
      const payload = {
        organizationId,
        quoteId: quote!.quote.quoteId,
        revision: quote!.revision,
        lineChanges,
      };
      return quoteApi.patch(
        organizationId,
        quote!.quote.quoteId,
        requestId("line-change", payload),
        { expectedRevision: quote!.revision, lineChanges },
      );
    },
    onSuccess: (result) => {
      completeRequest("line-change");
      applyQuoteResult(result, organizationId, sessionScope);
      setEditingLineId("");
      setAddEditorVersion((value) => value + 1);
      setNotice("Quote line repriced by the authoritative server.");
    },
    onError: handleMutationError,
  });

  const action = useMutation({
    mutationFn: (kind: "send" | "accept") =>
      quoteApi.action(
        organizationId,
        quote!.quote.quoteId,
        kind,
        requestId(`action:${kind}`, {
          organizationId,
          quoteId: quote!.quote.quoteId,
          kind,
          revision: quote!.revision,
        }),
        quote!.revision,
      ),
    onSuccess: (result) => {
      completeRequest("action:send");
      completeRequest("action:accept");
      applyQuoteResult(result, organizationId, sessionScope);
      setNotice("Quote lifecycle updated.");
    },
    onError: handleMutationError,
  });

  const convert = useMutation({
    mutationFn: () => {
      const checkpoint = quote!.checkpoints.find((item) => item.kind === "quote_accepted");
      if (!checkpoint) throw new Error("An accepted Quote checkpoint is required before conversion.");
      const payload = { organizationId, quoteId: quote!.quote.quoteId, checkpointId: checkpoint.checkpointId, revision: quote!.revision };
      return quoteApi.convert(organizationId, quote!.quote.quoteId, requestId("convert", payload), checkpoint.checkpointId, quote!.revision);
    },
    onSuccess: (result) => {
      completeRequest("convert");
      setNotice(`Quote converted to Order ${result.orderNumber}.`);
      void reload();
      void queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "sales"] });
    },
    onError: handleMutationError,
  });

  const mutationError =
    error || create.error || save.error || action.error || lineChange.error || convert.error;
  const changeOrganization = (nextOrganizationId: string) => {
    if (nextOrganizationId === organizationId) return;
    requestIds.current = {};
    setCustomerId("");
    setContactId("");
    setHeaderCustomerId("");
    setHeaderContactId("");
    setOpenQuoteId("");
    setEditingLineId("");
    setOrganizationId(nextOrganizationId);
  };

  return (
    <section className="lab v2-sales-workspace v2-quote-workspace">
      <div className="card grid">
        <label className="field">
          Organization ID
          <input
            value={organizationId}
            onChange={(event) => changeOrganization(event.target.value)}
            placeholder="Authenticated route scope"
          />
        </label>
        <label className="field">
          Open Quote ID
          <input
            value={openQuoteId}
            onChange={(event) => setOpenQuoteId(event.target.value)}
            placeholder="Known Quote ID"
          />
        </label>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() => load(openQuoteId)}
            disabled={!organizationId || !openQuoteId}
          >
            Open Quote
          </button>
        </div>
      </div>
      {Boolean(mutationError) && (
        <div className="notice error">
          {errorText(mutationError)}{" "}
          {(mutationError as ApiError).code === "STALE_STATE" && (
            <button className="button secondary" onClick={reload}>
              Reload current Quote
            </button>
          )}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      {!quote ? (
        <div className="card">
          <h2>Create Quote</h2>
          <p className="muted">
            Select authoritative CRM and Product records. Product configuration is
            projected and resolved by the server before Sales persists the line.
          </p>
          <div className="grid">
            <SelectionField
              label="Customer"
              value={customerId}
              options={customers.data ?? []}
              identity="customerId"
              emptyLabel="Select Customer"
              onChange={(value) => {
                const next = clearContactForCustomerChange(value);
                setCustomerId(next.customerId);
                setContactId(next.contactId);
              }}
            />
            <SelectionField
              label="Contact"
              value={contactId}
              options={contacts.data ?? []}
              identity="contactId"
              emptyLabel="Select Contact"
              disabled={!customerId}
              onChange={setContactId}
            />
            <label className="field">
              PO
              <input
                value={purchaseOrderNumber}
                onChange={(event) => setPurchaseOrderNumber(event.target.value)}
              />
            </label>
            <label className="field">
              Requested due date
              <input
                type="date"
                value={requestedDueDate}
                onChange={(event) => setRequestedDueDate(event.target.value)}
              />
            </label>
            <label className="field">
              Commercial notes
              <textarea
                value={commercialNotes}
                onChange={(event) => setCommercialNotes(event.target.value)}
              />
            </label>
          </div>
          <h3>Initial commercial line</h3>
          <QuoteLineEditor
            organizationId={organizationId}
            sessionScope={sessionScope}
            draftKey={`create:${organizationId}`}
            initialDraft={emptyQuoteLineDraft()}
            products={products.data ?? []}
            canOverridePrice={canOverridePrice}
            csrfReady={csrfReady}
            busy={create.isPending}
            submitLabel="Create Quote"
            onSubmit={(line) => {
              if (!customerId) {
                setNotice("Select a Customer before creating the Quote.");
                return;
              }
              create.mutate(line);
            }}
          />
        </div>
      ) : (
        <div className="lab">
          <div className="card v2-sales-document-card">
            <div className="header v2-document-header">
              <div>
                <h2>{quote.number.display}</h2>
                <p className="muted">Revision {quote.revision}</p>
              </div>
              <div className="actions v2-document-status">
                <Status value={quote.quote.deliveryState} />
                <Status value={quote.quote.acceptanceState} />
              </div>
            </div>
            <div className="v2-document-tabs" aria-label="Quote workspace sections">
              <span className="active">Items</span><span>Artwork</span><span>Notes</span><span>History</span>
            </div>
            <div className="grid v2-document-meta">
              <SelectionField
                label="Customer"
                value={headerCustomerId}
                options={customers.data ?? []}
                identity="customerId"
                emptyLabel="Select Customer"
                onChange={(value) => {
                  const next = clearContactForCustomerChange(value);
                  setHeaderCustomerId(next.customerId);
                  setHeaderContactId(next.contactId);
                }}
              />
              <SelectionField
                label="Contact"
                value={headerContactId}
                options={contacts.data ?? []}
                identity="contactId"
                emptyLabel="Select Contact"
                disabled={!headerCustomerId}
                onChange={setHeaderContactId}
              />
              <label className="field">
                PO
                <input
                  value={purchaseOrderNumber}
                  onChange={(event) => setPurchaseOrderNumber(event.target.value)}
                />
              </label>
              <label className="field">
                Requested due date
                <input
                  type="date"
                  value={requestedDueDate}
                  onChange={(event) => setRequestedDueDate(event.target.value)}
                />
              </label>
              <label className="field">
                Commercial notes
                <textarea
                  value={commercialNotes}
                  onChange={(event) => setCommercialNotes(event.target.value)}
                />
              </label>
            </div>
            <div className="actions v2-document-actions">
              <button
                className="button secondary"
                disabled={!canEdit || save.isPending || !csrfReady || Boolean(quote.quote.convertedOrderId)}
                onClick={() => save.mutate()}
              >
                Save
              </button>
              {quote.quote.deliveryState === "not_sent" && canSend && (
                <button
                  className="button"
                  disabled={action.isPending || !csrfReady}
                  onClick={() => action.mutate("send")}
                >
                  Send Quote
                </button>
              )}
              {quote.quote.deliveryState === "sent" && canSend &&
                quote.quote.acceptanceState === "not_accepted" && (
                  <button
                    className="button"
                    disabled={action.isPending || !csrfReady}
                    onClick={() => action.mutate("accept")}
                  >
                    Accept Quote
                  </button>
                )}
              {quote.quote.acceptanceState === "accepted" && !quote.quote.convertedOrderId && canConvert && (
                <button className="button" disabled={convert.isPending || !csrfReady} onClick={() => {
                  if (window.confirm(`Convert Quote ${quote.number.display} to an Order? This creates the Order, Draft Invoice, and required Routing from the accepted Quote.`)) convert.mutate();
                }}>Convert to Order</button>
              )}
              {quote.quote.convertedOrderId && <button className="button" onClick={() => openOrder?.(quote.quote.convertedOrderId!)}>Open converted Order</button>}
            </div>
          </div>
          <div className="card">
            <h2>Commercial lines</h2>
            {!canOverridePrice && (
              <p className="muted">
                Existing selling-price differences remain visible. Override editing
                is unavailable for this authenticated permission set.
              </p>
            )}
            {loading ? (
              <div className="skeleton" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Qty</th>
                    <th>Calculated unit / total</th>
                    <th>Selling unit / total</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.quote.lines.map((line) => (
                    <Fragment key={line.lineId}>
                      <tr>
                        <td>
                          {line.description}
                          {line.sellingPriceDecision.kind !== "calculated" && (
                            <div className="override">
                              Selling-price decision: {line.sellingPriceDecision.kind}
                              {line.sellingPriceDecision.reason
                                ? ` — ${line.sellingPriceDecision.reason}`
                                : ""}
                            </div>
                          )}
                        </td>
                        <td>{line.quantity}</td>
                        <td>
                          {money(line.calculatedUnitAmount)} /{" "}
                          {money(line.calculatedLineAmount)}
                        </td>
                        <td className="price">
                          {money(line.sellingUnitAmount)} /{" "}
                          {money(line.sellingLineAmount)}
                        </td>
                        <td>
                          <button
                            className="button secondary"
                            disabled={!canEdit || Boolean(quote.quote.convertedOrderId) || lineChange.isPending || !csrfReady}
                            onClick={() => setEditingLineId(line.lineId)}
                          >
                            Edit configuration
                          </button>
                          <button
                            className="button danger"
                            disabled={!canEdit || Boolean(quote.quote.convertedOrderId) || lineChange.isPending || !csrfReady}
                            onClick={() =>
                              lineChange.mutate([
                                { kind: "remove", lineId: line.lineId },
                              ])
                            }
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                      {editingLineId === line.lineId && (
                        <tr className="editor-row">
                          <td colSpan={5}>
                            <h3>Edit {line.description}</h3>
                            <p className="muted">
                              The draft starts from this Quote line’s persisted
                              configuration. Current Product defaults are not applied
                              silently.
                            </p>
                            <QuoteLineEditor
                              organizationId={organizationId}
                              sessionScope={sessionScope}
                              draftKey={`edit:${line.lineId}:${quote.revision}`}
                              initialDraft={draftFromQuoteLine(line)}
                              initializeFromPersistedLine
                              products={products.data ?? []}
                              canOverridePrice={canOverridePrice}
                              csrfReady={csrfReady}
                              busy={lineChange.isPending}
                              submitLabel="Save and reprice line"
                              onSubmit={(input) =>
                                lineChange.mutate([
                                  {
                                    kind: "update",
                                    lineId: line.lineId,
                                    line: input,
                                  },
                                ])
                              }
                              onCancel={() => setEditingLineId("")}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
            {!quote.quote.convertedOrderId && <><h3>Add commercial line</h3>
            <QuoteLineEditor
              organizationId={organizationId}
              sessionScope={sessionScope}
              draftKey={`add:${quote.quote.quoteId}:${addEditorVersion}`}
              initialDraft={emptyQuoteLineDraft()}
              products={products.data ?? []}
              canOverridePrice={canOverridePrice}
              csrfReady={csrfReady}
              busy={lineChange.isPending || !canEdit}
              submitLabel="Add line and price"
              onSubmit={(input) =>
                lineChange.mutate([{ kind: "add", line: input }])
              }
            /></>}
            <div className="totals">
              Calculated total: {money(quote.totals.calculatedLineAmount)} · Selling
              total: {money(quote.totals.sellingLineAmount)}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
