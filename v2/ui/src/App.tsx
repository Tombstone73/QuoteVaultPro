import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  money,
  newBusinessRequestId,
  quoteApi,
  type ApiError,
  type QuoteRead,
  type QuoteResult,
} from "./api";
import {
  applyAuthoritativeQuoteResult,
  reconcileForbiddenQuoteMutation,
} from "./quoteCache";
import { QuoteLineEditor } from "./QuoteLineEditor";
import {
  clearContactForCustomerChange,
  draftFromQuoteLine,
  emptyQuoteLineDraft,
  type QuoteLineMutationInput,
} from "./quoteFormModel";
import {
  quoteKeys,
  useQuoteFormContacts,
  useQuoteFormCustomers,
  useQuoteFormProducts,
} from "./quoteFormQueries";
import { SelectionField } from "./SelectionField";
import type { AppearancePreference, ThemeId } from "./theme";

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

const Status = ({ value }: { value: string }) => (
  <span className={`badge ${value === "accepted" ? "success" : ""}`}>
    {value.replaceAll("_", " ")}
  </span>
);

export const App = ({
  theme,
  setTheme,
  appearance,
  setAppearance,
}: {
  theme: ThemeId;
  setTheme: (value: ThemeId) => void;
  appearance: AppearancePreference;
  setAppearance: (value: AppearancePreference) => void;
}) => {
  const [page, setPage] = useState<"quote" | "lab">("quote");
  const [organizationId, setOrganizationId] = useState("");
  const organizationRef = useRef(organizationId);
  useEffect(() => {
    organizationRef.current = organizationId;
  }, [organizationId]);
  const [quoteId, setQuoteId] = useState("");
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const quote = useQuery({
    queryKey: quoteKeys.quote(organizationId, quoteId),
    queryFn: () => quoteApi.get(organizationId, quoteId),
    enabled: Boolean(organizationId && quoteId),
  });
  const bootstrap = useQuery({
    queryKey: quoteKeys.bootstrap(organizationId),
    queryFn: () => quoteApi.bootstrap(organizationId),
    enabled: Boolean(organizationId),
    staleTime: 0,
  });
  const applyQuoteResult = (result: QuoteResult, resultOrganizationId: string) => {
    const id = applyAuthoritativeQuoteResult(
      queryClient,
      resultOrganizationId,
      result,
    );
    if (organizationRef.current === resultOrganizationId) setQuoteId(id);
  };
  const reconcileAuthority = () =>
    reconcileForbiddenQuoteMutation(
      queryClient,
      organizationId,
      quoteId || undefined,
    );

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">PrintersHero V2</div>
        <button
          aria-current={page === "quote" || undefined}
          onClick={() => setPage("quote")}
        >
          Sales / Quotes
        </button>
        <button
          aria-current={page === "lab" || undefined}
          onClick={() => setPage("lab")}
        >
          UI Lab
        </button>
      </nav>
      <main>
        <div className="header">
          <div>
            <h1>{page === "quote" ? "Quote workspace" : "UI system lab"}</h1>
            <p className="muted">
              M1.7.5 proof — semantic components and authenticated server state.
            </p>
          </div>
          <div className="actions">
            <select
              aria-label="Theme"
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemeId)}
            >
              <option value="printershero">PrintersHero default</option>
              <option value="corporate">Clean corporate</option>
              <option value="industrial">Industrial dark</option>
            </select>
            <select
              aria-label="Appearance"
              value={appearance}
              onChange={(event) =>
                setAppearance(event.target.value as AppearancePreference)
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
        {page === "lab" ? (
          <Lab />
        ) : (
          <QuoteWorkspace
            organizationId={organizationId}
            setOrganizationId={setOrganizationId}
            quote={quote.data}
            error={quote.error}
            loading={quote.isFetching}
            load={(id) => {
              setQuoteId(id);
              setNotice("");
            }}
            reload={() =>
              queryClient.invalidateQueries({
                queryKey: quoteKeys.quote(organizationId, quoteId),
              })
            }
            notice={notice}
            setNotice={setNotice}
            applyQuoteResult={applyQuoteResult}
            reconcileAuthority={reconcileAuthority}
            canOverridePrice={
              bootstrap.data?.capabilities.quoteOverridePrice === true
            }
            csrfReady={bootstrap.isSuccess}
          />
        )}
      </main>
    </div>
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

type WorkspaceProps = Readonly<{
  organizationId: string;
  setOrganizationId: (value: string) => void;
  quote?: QuoteRead;
  error: unknown;
  loading: boolean;
  load: (quoteId: string) => void;
  reload: () => void;
  notice: string;
  setNotice: (value: string) => void;
  applyQuoteResult: (result: QuoteResult, organizationId: string) => void;
  reconcileAuthority: () => Promise<void>;
  canOverridePrice: boolean;
  csrfReady: boolean;
}>;

const QuoteWorkspace = ({
  organizationId,
  setOrganizationId,
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
  csrfReady,
}: WorkspaceProps) => {
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
  const customers = useQuoteFormCustomers(organizationId);
  const contacts = useQuoteFormContacts(
    organizationId,
    quote ? headerCustomerId : customerId,
  );
  const products = useQuoteFormProducts(organizationId);
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

  const handleForbidden = (mutationError: unknown) => {
    if ((mutationError as ApiError)?.code === "FORBIDDEN")
      void reconcileAuthority();
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
      applyQuoteResult(result, organizationId);
      setNotice("Quote created from authoritative Product resolution and Pricing.");
    },
    onError: handleForbidden,
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
      applyQuoteResult(result, organizationId);
      setNotice("Quote saved.");
    },
    onError: handleForbidden,
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
      applyQuoteResult(result, organizationId);
      setEditingLineId("");
      setAddEditorVersion((value) => value + 1);
      setNotice("Quote line repriced by the authoritative server.");
    },
    onError: handleForbidden,
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
      applyQuoteResult(result, organizationId);
      setNotice("Quote lifecycle updated.");
    },
    onError: handleForbidden,
  });

  const mutationError =
    error || create.error || save.error || action.error || lineChange.error;

  return (
    <section className="lab">
      <div className="card grid">
        <label className="field">
          Organization ID
          <input
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
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
          <div className="card">
            <div className="header">
              <div>
                <h2>{quote.number.display}</h2>
                <p className="muted">Revision {quote.revision}</p>
              </div>
              <div className="actions">
                <Status value={quote.quote.deliveryState} />
                <Status value={quote.quote.acceptanceState} />
              </div>
            </div>
            <div className="grid">
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
            <div className="actions">
              <button
                className="button secondary"
                disabled={save.isPending || !csrfReady}
                onClick={() => save.mutate()}
              >
                Save
              </button>
              {quote.quote.deliveryState === "not_sent" && (
                <button
                  className="button"
                  disabled={action.isPending || !csrfReady}
                  onClick={() => action.mutate("send")}
                >
                  Send Quote
                </button>
              )}
              {quote.quote.deliveryState === "sent" &&
                quote.quote.acceptanceState === "not_accepted" && (
                  <button
                    className="button"
                    disabled={action.isPending || !csrfReady}
                    onClick={() => action.mutate("accept")}
                  >
                    Accept Quote
                  </button>
                )}
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
                            disabled={lineChange.isPending || !csrfReady}
                            onClick={() => setEditingLineId(line.lineId)}
                          >
                            Edit configuration
                          </button>
                          <button
                            className="button danger"
                            disabled={lineChange.isPending || !csrfReady}
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
            <h3>Add commercial line</h3>
            <QuoteLineEditor
              organizationId={organizationId}
              draftKey={`add:${quote.quote.quoteId}:${addEditorVersion}`}
              initialDraft={emptyQuoteLineDraft()}
              products={products.data ?? []}
              canOverridePrice={canOverridePrice}
              csrfReady={csrfReady}
              busy={lineChange.isPending}
              submitLabel="Add line and price"
              onSubmit={(input) =>
                lineChange.mutate([{ kind: "add", line: input }])
              }
            />
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
