import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  money,
  newBusinessRequestId,
  quoteApi,
  type ApiError,
  type QuoteRead,
  type QuoteResult,
} from "./api";
import type { AppearancePreference, ThemeId } from "./theme";

const errorText = (error: unknown) => {
  const e = error as ApiError;
  if (e?.code === "STALE_STATE")
    return "This Quote changed elsewhere. Reload it before saving your draft.";
  if (e?.code === "FORBIDDEN")
    return "You do not have permission for that Quote action.";
  if (e?.code === "NOT_FOUND")
    return "The Quote, customer, contact, or Product is unavailable in this organization.";
  return e?.message ?? "The Quote service is unavailable.";
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
  setTheme: (v: ThemeId) => void;
  appearance: AppearancePreference;
  setAppearance: (v: AppearancePreference) => void;
}) => {
  const [page, setPage] = useState<"quote" | "lab">("quote");
  const [org, setOrg] = useState("");
  const organizationRef = useRef(org);
  useEffect(() => {
    organizationRef.current = org;
  }, [org]);
  const [quoteId, setQuoteId] = useState("");
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const quote = useQuery({
    queryKey: ["quote", org, quoteId],
    queryFn: () => quoteApi.get(org, quoteId),
    enabled: Boolean(org && quoteId),
  });
  const bootstrap = useQuery({
    queryKey: ["ui-bootstrap", org],
    queryFn: () => quoteApi.bootstrap(org),
    enabled: Boolean(org),
    staleTime: 0,
  });
  const load = (id: string) => {
    setQuoteId(id);
    setNotice("");
  };
  const applyQuoteResult = (result: QuoteResult, organizationId: string) => {
    const id = result.quote.quote.quoteId;
    queryClient.setQueryData(["quote", organizationId, id], result.quote);
    if (organizationRef.current === organizationId) setQuoteId(id);
  };
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
              onChange={(e) => setTheme(e.target.value as ThemeId)}
            >
              <option value="printershero">PrintersHero default</option>
              <option value="corporate">Clean corporate</option>
              <option value="industrial">Industrial dark</option>
            </select>
            <select
              aria-label="Appearance"
              value={appearance}
              onChange={(e) =>
                setAppearance(e.target.value as AppearancePreference)
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
            org={org}
            setOrg={setOrg}
            quote={quote.data}
            error={quote.error}
            loading={quote.isFetching}
            load={load}
            reload={() =>
              queryClient.invalidateQueries({
                queryKey: ["quote", org, quoteId],
              })
            }
            notice={notice}
            setNotice={setNotice}
            applyQuoteResult={applyQuoteResult}
            canOverridePrice={bootstrap.data?.capabilities.quoteOverridePrice === true}
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
        <label>
          <input type="checkbox" /> Checkbox
        </label>
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
    <div className="card">
      <h2>Table, loading, empty</h2>
      <div className="skeleton" />
      <table className="table">
        <tbody>
          <tr>
            <td>Selected row treatment</td>
            <td className="price">$125.00</td>
          </tr>
        </tbody>
      </table>
      <p className="muted">No additional records — empty state.</p>
    </div>
  </section>
);
const QuoteWorkspace = ({
  org,
  setOrg,
  quote,
  error,
  loading,
  load,
  reload,
  notice,
  setNotice,
  applyQuoteResult,
  canOverridePrice,
  csrfReady,
}: {
  org: string;
  setOrg: (s: string) => void;
  quote?: QuoteRead;
  error: unknown;
  loading: boolean;
  load: (s: string) => void;
  reload: () => void;
  notice: string;
  setNotice: (s: string) => void;
  applyQuoteResult: (result: QuoteResult, organizationId: string) => void;
  canOverridePrice: boolean;
  csrfReady: boolean;
}) => {
  const [open, setOpen] = useState("");
  const [customer, setCustomer] = useState("");
  const [contact, setContact] = useState("");
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [po, setPo] = useState("");
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
    setPo(quote?.quote.purchaseOrderNumber ?? "");
  }, [quote?.quote.quoteId]);
  const create = useMutation({
    mutationFn: () =>
      quoteApi.create(org, requestId("create", { org, customer, contact, product, quantity, po }), {
        customerContact: {
          organizationId: org,
          customerId: customer,
          contactId: contact || undefined,
        },
        purchaseOrderNumber: po || undefined,
        lines: [{ productId: product, quantity: Number(quantity) }],
    }),
    onSuccess: (r) => {
      completeRequest("create");
      applyQuoteResult(r, org);
      setNotice("Quote created from authoritative Pricing.");
    },
  });
  const save = useMutation({
    mutationFn: () =>
      quoteApi.patch(org, quote!.quote.quoteId, requestId("save", {
        org,
        quoteId: quote!.quote.quoteId,
        revision: quote!.revision,
        po,
      }), {
        expectedRevision: quote!.revision,
        patch: { purchaseOrderNumber: po.trim() || null },
      }),
    onSuccess: (r) => {
      completeRequest("save");
      setNotice("Quote saved.");
      applyQuoteResult(r, org);
    },
  });
  const action = useMutation({
    mutationFn: (a: "send" | "accept") =>
      quoteApi.action(
        org,
        quote!.quote.quoteId,
        a,
        requestId(`action:${a}`, {
          org,
          quoteId: quote!.quote.quoteId,
          action: a,
          revision: quote!.revision,
        }),
        quote!.revision,
      ),
    onSuccess: (r) => {
      completeRequest("action:send");
      completeRequest("action:accept");
      setNotice("Quote lifecycle updated.");
      applyQuoteResult(r, org);
    },
  });
  const err = error || create.error || save.error || action.error;
  return (
    <section className="lab">
      <div className="card grid">
        <label className="field">
          Organization ID
          <input
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="Authenticated route scope"
          />
        </label>
        <label className="field">
          Open Quote ID
          <input
            value={open}
            onChange={(e) => setOpen(e.target.value)}
            placeholder="Known Quote ID"
          />
        </label>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() => load(open)}
            disabled={!org || !open}
          >
            Open Quote
          </button>
        </div>
      </div>
      {err && (
        <div className="notice error">
          {errorText(err)}{" "}
          {(err as ApiError).code === "STALE_STATE" && (
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
            M1.7 has no customer/product lookup yet; these authoritative IDs are
            deliberate proof inputs.
          </p>
          <div className="grid">
            <label className="field">
              Customer ID
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </label>
            <label className="field">
              Contact ID
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </label>
            <label className="field">
              Product ID
              <input
                value={product}
                onChange={(e) => setProduct(e.target.value)}
              />
            </label>
            <label className="field">
              Quantity
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label className="field">
              PO
              <input value={po} onChange={(e) => setPo(e.target.value)} />
            </label>
          </div>
          <div className="actions">
            <button
              className="button"
              disabled={create.isPending || !org || !customer || !product || !csrfReady}
              onClick={() => create.mutate()}
            >
              Create Quote
            </button>
          </div>
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
            <label className="field">
              PO
              <input
                value={po}
                onChange={(e) => setPo(e.target.value)}
              />
            </label>
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
              <p className="muted">Selling-price overrides are unavailable for this authenticated permission set.</p>
            )}
            {loading ? (
              <div className="skeleton" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Qty</th>
                    <th>Calculated</th>
                    <th>Selling</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.quote.lines.map((line) => (
                    <tr key={line.lineId}>
                      <td>
                        {line.description}
                        {line.sellingPriceDecision.kind !== "calculated" && (
                          <div className="override">
                            Selling-price decision:{" "}
                            {line.sellingPriceDecision.kind}
                          </div>
                        )}
                      </td>
                      <td>{line.quantity}</td>
                      <td>{money(line.calculatedLineAmount)}</td>
                      <td className="price">{money(line.sellingLineAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
