import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import {
  financeApi,
  invoiceApi,
  money,
  newBusinessRequestId,
  type ApiError,
  type FinancialHistoryEntry,
  type FinancialInvoiceQuery,
  type FinancialInvoiceListItem,
  type FinancialLedgerEntry,
  type FinancialLedgerQuery,
  type InvoiceRead,
  type UiBootstrap,
} from "./api";
import {
  clearFinanceRequestRecovery,
  persistFinanceRequestRecovery,
  readFinanceRequestRecovery,
  sameFinanceRequest,
  sameFinanceRequestBody,
  type FinanceRequestRecovery,
  type FinanceRequestRecoveryIdentity,
  type ManualPaymentRequest,
  type ManualRefundRequest,
  type PendingFinanceRequest,
  type StripePaymentRequest,
  type StripeRefundRequest,
} from "./financeRequestRecovery";

const useFinanceLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

type GridColumn<T> = Readonly<{
  id: string;
  label: string;
  serverSort?: string;
  value: (row: T) => string | number;
  render: (row: T) => ReactNode;
}>;
type GridPreference = Readonly<{
  order: string[];
  widths: Record<string, number>;
  sorting?: { id: string; direction: "asc" | "desc" };
}>;
type InvoiceEmailSelection = Readonly<{
  organizationId: string;
  sessionScope: string;
  requestId: string;
  invoiceIds: readonly string[];
}>;
type FinanceDialogContext = Readonly<{ organizationId: string; sessionScope: string; invoiceId: string }>;
type StripePaymentResult = Awaited<ReturnType<typeof financeApi.beginStripePayment>>;
type StripeSubmissionBinding = Readonly<{ organizationId: string; verifiedUserId?: string; sessionScope: string; authorityLease: number; grantEpoch: number }>;
type StripePaymentSubmission = Readonly<{ request: StripePaymentRequest; binding: StripeSubmissionBinding }>;
type BoundStripePaymentResult = Readonly<{ request: StripePaymentRequest; binding: StripeSubmissionBinding; result: StripePaymentResult }>;
type FinanceAuthorityFence = Readonly<{ lease: number; grantEpoch: number; verifiedUserId?: string; sessionScope: string; canPaymentRecord: boolean; canRefundIssue: boolean }>;
const financeAuthorityFences = new Map<string, FinanceAuthorityFence>();
let nextFinanceAuthorityLease = 0;
const errorText = (error: unknown) =>
  (error as ApiError)?.message ?? "The finance service is unavailable.";
const invoiceLabel = (invoice: Pick<InvoiceRead, "source" | "lifecycle" | "sourceOrderNumber">, persistedNumber: string | null | undefined) =>
  persistedNumber ? `Invoice ${persistedNumber}`
    : invoice.source !== "legacy" && invoice.lifecycle === "draft" && invoice.sourceOrderNumber
      ? `Order ${invoice.sourceOrderNumber}` : "Invoice number unavailable";
const preferenceKey = (scope: string, org: string, grid: string) =>
  `printershero:v2:finance-grid:${scope}:${org}:${grid}`;
const centsFromInput = (text: string): number | null => {
  const normalized = text.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
};
const centsForInput = (cents: number) =>
  `${Math.trunc(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, "0")}`;
const amounts = (value: readonly Readonly<{ currency: string; cents: number }>[]) =>
  value.length ? value.map((amount) => money(amount)).join(" · ") : "—";

export const submitStripeConfirmationIfAuthorized = async (
  confirm: () => Promise<Readonly<{ error?: Readonly<{ message?: string }> | null }>>,
  authorized: () => boolean,
  onSubmitted: () => void,
  onError: (message: string) => void,
): Promise<boolean> => {
  if (!authorized()) return false;
  const result = await confirm();
  if (!authorized()) return false;
  if (result.error) { onError(result.error.message ?? "Card confirmation could not be completed."); return false; }
  onSubmitted();
  return true;
};

const StripeCardConfirmation = ({ onSubmitted, onError, authorized }: Readonly<{ onSubmitted:()=>void; onError:(message:string)=>void; authorized:()=>boolean }>) => {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const authorizationRef = useRef(authorized);
  authorizationRef.current = authorized;
  return <form onSubmit={async (event) => {
    event.preventDefault();
    if (!stripe || !elements || submitting || !authorizationRef.current()) return;
    setSubmitting(true);
    try {
      await submitStripeConfirmationIfAuthorized(
        () => stripe.confirmPayment({ elements, redirect: "if_required" }),
        () => authorizationRef.current(), onSubmitted, onError,
      );
    } catch (error) {
      if (authorizationRef.current()) onError(error instanceof Error ? error.message : "Card confirmation could not be completed.");
    } finally { setSubmitting(false); }
  }}>
    <PaymentElement />
    <button className="v2-invoice-issue" disabled={!stripe || submitting || !authorizationRef.current()}>{submitting ? "Confirming…" : "Confirm card payment"}</button>
  </form>;
};
const StripePaymentElement = ({ publishableKey, stripeAccountId, clientSecret, onSubmitted, onError, authorized }: Readonly<{ publishableKey:string; stripeAccountId:string; clientSecret:string; onSubmitted:()=>void; onError:(message:string)=>void; authorized:()=>boolean }>) => {
  const stripePromise = useMemo(() => loadStripe(publishableKey,{stripeAccount:stripeAccountId}), [publishableKey,stripeAccountId]);
  return <Elements stripe={stripePromise} options={{ clientSecret }}><StripeCardConfirmation onSubmitted={onSubmitted} onError={onError} authorized={authorized} /></Elements>;
};
export const invoiceDocumentPath = (organizationId: string, invoiceId: string) =>
  `/v2/organizations/${encodeURIComponent(organizationId)}/invoices/${encodeURIComponent(invoiceId)}/document.pdf`;
const sortRows = <T,>(
  rows: readonly T[],
  column: GridColumn<T> | undefined,
  direction: "asc" | "desc",
) =>
  !column
    ? rows
    : [...rows].sort((left, right) => {
        const a = column.value(left),
          b = column.value(right);
        const result =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b));
        return direction === "asc" ? result : -result;
      });

/** Browser-local display preferences only. Financial facts and settlement always re-query the PostgreSQL read model. */
const FinanceGrid = <T,>({
  grid,
  scope,
  organizationId,
  rows,
  columns,
  selectable,
  selectedIds,
  onSelectedIdsChange,
  serverSorting,
  onServerSortingChange,
}: Readonly<{
  grid: string;
  scope: string;
  organizationId: string;
  rows: readonly T[];
  columns: readonly GridColumn<T>[];
  selectable?: (row: T) => string | undefined;
  selectedIds?: ReadonlySet<string>;
  onSelectedIdsChange?: (ids: ReadonlySet<string>) => void;
  serverSorting?: Readonly<{ id: string; direction: "asc" | "desc" }>;
  onServerSortingChange?: (next: Readonly<{ id: string; direction: "asc" | "desc" }>) => void;
}>) => {
  const key = preferenceKey(scope, organizationId, grid);
  const [preference, setPreference] = useState<GridPreference>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "") as GridPreference;
    } catch {
      return { order: columns.map((column) => column.id), widths: {} };
    }
  });
  const [sorting, setSorting] = useState<{
    id: string;
    direction: "asc" | "desc";
  }>(preference.sorting ?? { id: "", direction: "asc" });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(preference));
  }, [key, preference]);
  const visible = useMemo(
    () =>
      [...columns].sort(
        (a, b) =>
          (preference.order.indexOf(a.id) < 0
            ? columns.length
            : preference.order.indexOf(a.id)) -
          (preference.order.indexOf(b.id) < 0
            ? columns.length
            : preference.order.indexOf(b.id)),
      ),
    [columns, preference.order],
  );
  const activeSorting = serverSorting ?? sorting;
  const sorted = serverSorting ? rows : sortRows(
    rows,
    visible.find((column) => column.id === activeSorting.id),
    activeSorting.direction,
  );
  const beginResize = (event: MouseEvent, columnId: string) => {
    event.preventDefault();
    const start = event.clientX,
      width =
        event.currentTarget.parentElement?.getBoundingClientRect().width ?? 150;
    const move = (next: globalThis.MouseEvent) =>
      setPreference((current) => ({
        ...current,
        widths: {
          ...current.widths,
          [columnId]: Math.max(90, Math.round(width + next.clientX - start)),
        },
      }));
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  };
  const selectableRows = selectable ? sorted.map(selectable).filter((id): id is string => Boolean(id)) : [];
  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((id) => selectedIds?.has(id));
  const toggle = (id: string, checked: boolean) => { const next = new Set(selectedIds); if (checked) next.add(id); else next.delete(id); onSelectedIdsChange?.(next); };
  return (
    <div className="v2-finance-grid-wrap">
      <p className="v2-finance-grid-help">
        Click a header to sort · drag a header to reorder · drag the header edge
        to resize. Your layout is remembered in this browser.
      </p>
      <table className="v2-finance-grid">
        <thead>
          <tr>
            {selectable && <th className="v2-finance-select"><input aria-label="Select visible invoices" type="checkbox" checked={allVisibleSelected} onChange={(event) => { const next = new Set(selectedIds); for (const id of selectableRows) { if (event.currentTarget.checked) next.add(id); else next.delete(id); } onSelectedIdsChange?.(next); }} /></th>}
            {visible.map((column) => (
              <th
                key={column.id}
                draggable
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/plain", column.id)
                }
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const from = event.dataTransfer.getData("text/plain");
                  if (!from || from === column.id) return;
                  setPreference((current) => {
                    const order = current.order.filter((id) => id !== from);
                    const target = order.indexOf(column.id);
                    order.splice(target < 0 ? order.length : target, 0, from);
                    return { ...current, order };
                  });
                }}
                style={{ width: preference.widths[column.id] }}
              >
                <button
                  type="button"
                  disabled={Boolean(serverSorting && !column.serverSort)}
                  onClick={() => {
                    if (serverSorting) {
                      if (!column.serverSort) return;
                      onServerSortingChange?.({ id: column.serverSort, direction: serverSorting.id === column.serverSort && serverSorting.direction === "asc" ? "desc" : "asc" });
                      return;
                    }
                    setSorting((current) => {
                      const next = current.id === column.id ? { id: column.id, direction: current.direction === "asc" ? ("desc" as const) : ("asc" as const) } : { id: column.id, direction: "asc" as const };
                      setPreference((saved) => ({ ...saved, sorting: next }));
                      return next;
                    });
                  }}
                >
                  {column.label}
                  {activeSorting.id === (column.serverSort ?? column.id)
                    ? activeSorting.direction === "asc"
                      ? " ↑"
                      : " ↓"
                    : ""}
                </button>
                <span
                  className="v2-finance-resize"
                  onMouseDown={(event) => beginResize(event, column.id)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, rowIndex) => (
            <tr key={String((row as { id?: string }).id ?? rowIndex)}>
              {selectable && <td className="v2-finance-select">{selectable(row) ? <input aria-label="Select invoice" type="checkbox" checked={selectedIds?.has(selectable(row)!) === true} onChange={(event) => toggle(selectable(row)!, event.currentTarget.checked)} /> : null}</td>}
              {visible.map((column) => (
                <td key={column.id}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const HistoryTable = ({
  history,
}: Readonly<{ history: readonly FinancialHistoryEntry[] }>) => (
  <table className="v2-finance-history">
    <thead>
      <tr>
        <th>Date</th>
        <th>Type</th>
        <th>Method</th>
        <th>Amount</th>
        <th>Balance after</th>
      </tr>
    </thead>
    <tbody>
      {history.map((entry) => (
        <tr key={entry.id}>
          <td>{new Date(entry.occurredAt).toLocaleString()}</td>
          <td>{entry.kind === "payment" ? "Payment" : "Refund"}</td>
          <td>{entry.method ?? "—"}</td>
          <td className={entry.kind === "refund" ? "refund" : "payment"}>
            {entry.kind === "refund" ? "−" : "+"}
            {money(entry.amount)}
          </td>
          <td>{money(entry.balanceAfter)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

type FinanceWorkspaceProps = Readonly<{
  mode: "invoices" | "ledger";
  organizationId: string;
  sessionScope: string;
  invoiceId: string;
  onSelectInvoice: (invoiceId: string) => void;
  backToInvoices: () => void;
  canInvoiceView: boolean;
  canInvoiceIssue?: boolean;
  canInvoiceSend: boolean;
  canPaymentView: boolean;
  canPaymentRecord: boolean;
  canRefundIssue: boolean;
  csrfReady: boolean;
  openOrder: (orderId: string) => void;
  openCustomer: (customerId: string) => void;
}>;

export const FinanceWorkspace = (props: FinanceWorkspaceProps) => {
  const client = useQueryClient();
  const bootstrap = client.getQueryData<UiBootstrap>(["v2", props.sessionScope, props.organizationId, "ui-bootstrap"]);
  const verifiedUserId = bootstrap?.organizationId === props.organizationId && bootstrap.sessionScope === props.sessionScope && bootstrap.userId
    ? bootstrap.userId : undefined;
  return <FinanceWorkspaceBody key={JSON.stringify([verifiedUserId ?? null, props.organizationId, props.sessionScope])} verifiedUserId={verifiedUserId} {...props} />;
};

type FinanceWorkspaceBodyProps = FinanceWorkspaceProps & Readonly<{ verifiedUserId?: string }>;
type FinanceRequestRecoveryState = FinanceRequestRecovery | Readonly<{ status: "loading" }>;
const FinanceWorkspaceBody = ({
  verifiedUserId,
  mode,
  organizationId,
  sessionScope,
  invoiceId,
  onSelectInvoice,
  backToInvoices,
  canInvoiceView,
  canInvoiceIssue = false,
  canInvoiceSend,
  canPaymentView,
  canPaymentRecord,
  canRefundIssue,
  csrfReady,
  openOrder,
  openCustomer,
}: FinanceWorkspaceBodyProps) => {
  const client = useQueryClient();
  const recoveryIdentity: FinanceRequestRecoveryIdentity = { organizationId, ...(verifiedUserId ? { verifiedUserId } : {}), sessionScope };
  const [financeRecovery, setFinanceRecovery] = useState<FinanceRequestRecoveryState>({ status: "loading" });
  const financeRecoveryRef = useRef<FinanceRequestRecoveryState>(financeRecovery);
  financeRecoveryRef.current = financeRecovery;
  const financeRequests = financeRecovery.status === "stored" ? financeRecovery.requests : [];
  const financeRecoveryAvailable = financeRecovery.status === "empty" || financeRecovery.status === "stored";
  const [authorityLease] = useState(() => ++nextFinanceAuthorityLease);
  const grantEpoch = useRef(0);
  const previousPaymentRecordGrant = useRef<boolean | undefined>(undefined);
  const [financialDialogContext, setFinancialDialogContext] = useState<FinanceDialogContext | null>(null);
  const [stripeResponse, setStripeResponse] = useState<BoundStripePaymentResult | null>(null);
  const [stripeElementVisible, setStripeElementVisible] = useState(false);
  const [selected, setSelected] = useState(invoiceId);
  const [selectedSource, setSelectedSource] = useState<"v2" | "legacy">("v2");
  const [autoSelectInvoice, setAutoSelectInvoice] = useState(true);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"payment" | "refund" | "stripePayment" | "stripeRefund" | "invoiceEmail" | "">("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "check" | "external">("check");
  const [paymentId, setPaymentId] = useState("");
  const [providerRequestId, setProviderRequestId] = useState("");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<"" | FinancialInvoiceListItem["lifecycle"]>("");
  const [settlementFilter, setSettlementFilter] = useState<"" | NonNullable<FinancialInvoiceListItem["settlement"]>>("");
  const [invoiceSort, setInvoiceSort] = useState<NonNullable<FinancialInvoiceQuery["sort"]>>("updated");
  const [invoiceSortDirection, setInvoiceSortDirection] = useState<"asc" | "desc">("desc");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState(25);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerKind, setLedgerKind] = useState<"" | "payment" | "refund">("");
  const [ledgerSource, setLedgerSource] = useState<"" | "v2" | "legacy">("");
  const [ledgerSort, setLedgerSort] = useState<NonNullable<FinancialLedgerQuery["sort"]>>("occurred_at");
  const [ledgerSortDirection, setLedgerSortDirection] = useState<"asc" | "desc">("desc");
  const [emailSelection, setEmailSelection] = useState<InvoiceEmailSelection | null>(null);
  const isEmailDialog = dialog === "invoiceEmail";
  const isFinancialDialog = dialog === "payment" || dialog === "refund" || dialog === "stripePayment" || dialog === "stripeRefund";
  const currentContextRef = useRef({ organizationId, sessionScope, verifiedUserId, authorityLease, grantEpoch: grantEpoch.current, invoiceId: selected, requestedInvoiceId: invoiceId, dialog, dialogContext: financialDialogContext, canPaymentRecord, canRefundIssue });
  currentContextRef.current = { organizationId, sessionScope, verifiedUserId, authorityLease, grantEpoch: grantEpoch.current, invoiceId: selected, requestedInvoiceId: invoiceId, dialog, dialogContext: financialDialogContext, canPaymentRecord, canRefundIssue };
  useEffect(() => {
    const recovered = readFinanceRequestRecovery(recoveryIdentity);
    financeRecoveryRef.current = recovered;
    setFinanceRecovery(recovered);
  }, [organizationId, sessionScope, verifiedUserId]);
  useFinanceLayoutEffect(() => {
    if (!organizationId) return;
    if (previousPaymentRecordGrant.current !== undefined && previousPaymentRecordGrant.current !== canPaymentRecord) grantEpoch.current++;
    previousPaymentRecordGrant.current = canPaymentRecord;
    currentContextRef.current.grantEpoch = grantEpoch.current;
    financeAuthorityFences.set(organizationId, { lease: authorityLease, grantEpoch: grantEpoch.current, verifiedUserId, sessionScope, canPaymentRecord, canRefundIssue });
    return () => {
      if (financeAuthorityFences.get(organizationId)?.lease === authorityLease) financeAuthorityFences.delete(organizationId);
    };
  }, [authorityLease, organizationId, verifiedUserId, sessionScope, canPaymentRecord, canRefundIssue]);
  const emailContextCurrent = Boolean(emailSelection && organizationId && sessionScope && canInvoiceSend && canPaymentView
    && emailSelection.organizationId === organizationId && emailSelection.sessionScope === sessionScope);
  const invoiceQuery: FinancialInvoiceQuery = { page, pageSize, ...(search ? { q: search } : {}), ...(lifecycleFilter ? { lifecycle: lifecycleFilter } : {}), ...(settlementFilter ? { settlement: settlementFilter } : {}), sort: invoiceSort, direction: invoiceSortDirection };
  const overview = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "finance", "overview", invoiceQuery],
    queryFn: () => financeApi.overview(organizationId, invoiceQuery),
    enabled: Boolean(organizationId && sessionScope && canPaymentView),
  });
  // A deep Invoice URL is canonical V2 selection context. Do not let the
  // initial empty parent prop race and clear a just-clicked V2 row.
  useEffect(() => { if (invoiceId) { setSelected(invoiceId); setSelectedSource("v2"); } }, [invoiceId]);
  useEffect(() => {
    if (autoSelectInvoice && !selected && overview.data?.items[0] && !invoiceId)
      { setSelected(overview.data.items[0].invoiceId); setSelectedSource(overview.data.items[0].source); }
  }, [autoSelectInvoice, invoiceId, overview.data, selected]);
  const selectInvoice = (id: string, source: "v2" | "legacy" = "v2") => {
    setSelected(id);
    setSelectedSource(source);
    if (source === "v2") onSelectInvoice(id);
  };
  const returnToInvoices = () => {
    setAutoSelectInvoice(false);
    setSelected("");
    setSelectedSource("v2");
    backToInvoices();
  };
  const detail = useQuery({
    queryKey: [
      "v2",
      sessionScope,
      organizationId,
      "finance",
      "invoice",
      selectedSource,
      selected,
    ],
    queryFn: () => selectedSource === "legacy" ? financeApi.legacyInvoice(organizationId, selected) : financeApi.invoice(organizationId, selected),
    enabled: Boolean(selected && canPaymentView),
  });
  const invoice = detail.data?.invoice,
    settlement = detail.data?.settlement;
  const refundablePayments = (detail.data?.history ?? []).filter((payment) =>
    payment.kind === "payment" && payment.amount.cents > (detail.data?.history ?? [])
      .filter((refund) => refund.kind === "refund" && refund.paymentId === payment.id)
      .reduce((total, refund) => total + refund.amount.cents, 0),
  );
  const paymentEligible = invoice?.source !== "legacy" && invoice?.lifecycle !== "void" && (settlement?.balance.cents ?? 0) > 0;
  const ledgerQuery: FinancialLedgerQuery = { page: ledgerPage, pageSize: ledgerPageSize, ...(ledgerSearch ? { q: ledgerSearch } : {}), ...(ledgerKind ? { kind: ledgerKind } : {}), ...(ledgerSource ? { recordSource: ledgerSource } : {}), sort: ledgerSort, direction: ledgerSortDirection };
  const ledger = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "finance", "ledger", ledgerQuery],
    queryFn: () => financeApi.ledger(organizationId, ledgerQuery),
    enabled: Boolean(mode === "ledger" && canPaymentView),
  });
  const refresh = async (targetOrganizationId = organizationId, targetSessionScope = sessionScope) => {
    await client.invalidateQueries({
      queryKey: ["v2", targetSessionScope, targetOrganizationId, "finance"],
    });
    await client.invalidateQueries({
      queryKey: ["v2", targetSessionScope, targetOrganizationId, "billing"],
    });
  };
  const updateFinanceRecovery = (recovery: FinanceRequestRecoveryState) => {
    financeRecoveryRef.current = recovery;
    setFinanceRecovery(recovery);
  };
  const persistFinanceRequestBeforePost = (request: PendingFinanceRequest): PendingFinanceRequest | undefined => {
    const current = financeRecoveryRef.current;
    if (current.status !== "empty" && current.status !== "stored") {
      setNotice(current.status === "loading" ? "Finance request recovery is still loading; no request was sent." : "Finance request recovery is unavailable or inconsistent; no request was sent.");
      return undefined;
    }
    const saved = persistFinanceRequestRecovery(recoveryIdentity, request);
    if (saved.status !== "stored") {
      updateFinanceRecovery(saved);
      setNotice(saved.status === "blocked" || saved.status === "unavailable" ? saved.reason : "Finance request recovery could not be verified; no request was sent.");
      return undefined;
    }
    updateFinanceRecovery(saved);
    const persisted = saved.requests.find((entry) => sameFinanceRequest(entry, request));
    if (!persisted || !sameFinanceRequestBody(persisted, request)) {
      setNotice("The stored finance request does not exactly match this operation; no request was sent.");
      return undefined;
    }
    return persisted;
  };
  const clearFinanceRequest = (request: PendingFinanceRequest) => {
    if (!clearFinanceRequestRecovery(recoveryIdentity, request)) {
      updateFinanceRecovery({ status: "blocked", reason: "The completed finance request could not be cleared from recovery storage; new requests are blocked." });
      return false;
    }
    updateFinanceRecovery(readFinanceRequestRecovery(recoveryIdentity));
    return true;
  };
  const dialogContextIsCurrent = (dialogKind: "payment" | "refund" | "stripePayment" | "stripeRefund", targetInvoiceId: string) => {
    const current = currentContextRef.current;
    return current.organizationId && current.sessionScope && current.invoiceId === targetInvoiceId
      && (!current.requestedInvoiceId || current.requestedInvoiceId === targetInvoiceId)
      && current.dialog === dialogKind && current.dialogContext?.organizationId === current.organizationId
      && current.dialogContext.sessionScope === current.sessionScope && current.dialogContext.invoiceId === targetInvoiceId;
  };
  const requestCanRun = (request: PendingFinanceRequest, dialogKind: "payment" | "refund" | "stripePayment" | "stripeRefund") => {
    const current = currentContextRef.current;
    const recovery = financeRecoveryRef.current;
    const storedRequest = recovery.status === "stored" ? recovery.requests.find((entry) => sameFinanceRequest(entry, request)) : undefined;
    const durableRequest = readFinanceRequestRecovery(recoveryIdentity);
    const isRefund = request.kind === "refund" || request.kind === "stripeRefund";
    const authorized = isRefund ? current.canRefundIssue : current.canPaymentRecord;
    const fence = financeAuthorityFences.get(request.organizationId);
    const activeIdentity = Boolean(fence && fence.lease === current.authorityLease && fence.verifiedUserId === request.verifiedUserId
      && fence.sessionScope === current.sessionScope && current.verifiedUserId === request.verifiedUserId
      && (request.verifiedUserId !== undefined || request.submittedSessionScope === current.sessionScope)
      && (isRefund ? fence.canRefundIssue : fence.canPaymentRecord));
    return Boolean(authorized && storedRequest && sameFinanceRequestBody(storedRequest, request)
      && durableRequest.status === "stored" && durableRequest.requests.some((entry) => sameFinanceRequest(entry, request) && sameFinanceRequestBody(entry, request))
      && current.organizationId === request.organizationId && activeIdentity
      && dialogContextIsCurrent(dialogKind, request.invoiceId));
  };
  const stripeSubmissionAuthorized = (submission: StripePaymentSubmission) => {
    const { request, binding } = submission;
    const current = currentContextRef.current;
    const fence = financeAuthorityFences.get(request.organizationId);
    return Boolean(requestCanRun(request, "stripePayment") && fence && fence.lease === binding.authorityLease
      && fence.grantEpoch === binding.grantEpoch && fence.verifiedUserId === binding.verifiedUserId
      && fence.sessionScope === binding.sessionScope && fence.canPaymentRecord
      && current.authorityLease === binding.authorityLease && current.grantEpoch === binding.grantEpoch
      && current.organizationId === binding.organizationId && current.verifiedUserId === binding.verifiedUserId
      && current.sessionScope === binding.sessionScope && current.canPaymentRecord);
  };
  const stripeResponseAuthorized = (bound: BoundStripePaymentResult) => {
    const current = currentContextRef.current;
    const fence = financeAuthorityFences.get(bound.request.organizationId);
    return Boolean(requestCanRun(bound.request, "stripePayment")
      && fence && fence.lease === bound.binding.authorityLease && fence.grantEpoch === bound.binding.grantEpoch
      && fence.verifiedUserId === bound.request.verifiedUserId && fence.sessionScope === bound.binding.sessionScope && fence.canPaymentRecord
      && current.authorityLease === bound.binding.authorityLease && current.grantEpoch === bound.binding.grantEpoch
      && current.organizationId === bound.request.organizationId
      && current.verifiedUserId === bound.request.verifiedUserId && current.sessionScope === bound.binding.sessionScope
      && current.invoiceId === bound.request.invoiceId && current.canPaymentRecord && current.dialog === "stripePayment"
      && current.dialogContext?.organizationId === bound.request.organizationId && current.dialogContext.sessionScope === bound.binding.sessionScope
      && current.dialogContext.invoiceId === bound.request.invoiceId);
  };
  const closeDialog = () => {
    setDialog("");
    setFinancialDialogContext(null);
    setStripeResponse(null);
    setStripeElementVisible(false);
    setAmount("");
    setPaymentId("");
    setProviderRequestId("");
  };
  const openFinancialDialog = (next: "payment" | "refund" | "stripePayment" | "stripeRefund", targetInvoiceId: string) => {
    setFinancialDialogContext({ organizationId, sessionScope, invoiceId: targetInvoiceId });
    setStripeResponse(null);
    setStripeElementVisible(false);
    setDialog(next);
  };
  const payment = useMutation({
    retry: false,
    mutationFn: (request: ManualPaymentRequest) => {
      if (request.kind !== "payment" || !requestCanRun(request, "payment")) throw new Error("The original Payment request is not active in this authenticated Invoice context.");
      return financeApi.recordPayment(request.organizationId, request.invoiceId, request.businessRequestId, request.input);
    },
    onSuccess: async (_result, request) => {
      const cleared = clearFinanceRequest(request);
      const current = currentContextRef.current;
      if (current.organizationId === request.organizationId && current.verifiedUserId === request.verifiedUserId) {
        setNotice(cleared ? "Payment recorded as an immutable financial fact." : "Payment recorded, but its recovery entry could not be cleared. No replacement request is allowed.");
        if (current.dialogContext?.invoiceId === request.invoiceId && current.dialog === "payment") closeDialog();
        await refresh(request.organizationId, current.sessionScope);
      }
    },
    onError: (error, request) => {
      const current = currentContextRef.current;
      if (current.organizationId === request.organizationId && current.verifiedUserId === request.verifiedUserId)
        setNotice(`Payment outcome is unconfirmed. Retry the exact original request; do not create another Payment. ${errorText(error)}`);
    },
  });
  const issueInvoice = useMutation({
    mutationFn: () => {
      if (!detail.data || detail.data.invoice.source === "legacy" || detail.data.invoice.lifecycle !== "draft")
        throw new Error("Only a current order-backed invoice can be issued.");
      return invoiceApi.issue(organizationId, detail.data.invoice.invoiceId, newBusinessRequestId());
    },
    onSuccess: async () => {
      setNotice("Invoice issued. Its commercial content is now immutable.");
      await refresh();
    },
    onError: (error) => setNotice(errorText(error)),
  });
  const refund = useMutation({
    retry: false,
    mutationFn: (request: ManualRefundRequest) => {
      if (request.kind !== "refund" || !requestCanRun(request, "refund")) throw new Error("The original Refund request is not active in this authenticated Invoice context.");
      return financeApi.recordRefund(request.organizationId, request.invoiceId, request.businessRequestId, request.input);
    },
    onSuccess: async (_result, request) => {
      const cleared = clearFinanceRequest(request);
      const current = currentContextRef.current;
      if (current.organizationId === request.organizationId && current.verifiedUserId === request.verifiedUserId) {
        setNotice(cleared ? "Refund recorded as a separate immutable financial fact; the original Payment remains unchanged." : "Refund recorded, but its recovery entry could not be cleared. No replacement request is allowed.");
        if (current.dialogContext?.invoiceId === request.invoiceId && current.dialog === "refund") closeDialog();
        await refresh(request.organizationId, current.sessionScope);
      }
    },
    onError: (error, request) => {
      const current = currentContextRef.current;
      if (current.organizationId === request.organizationId && current.verifiedUserId === request.verifiedUserId)
        setNotice(`Refund outcome is unconfirmed. Retry the exact original request; do not create another Refund. ${errorText(error)}`);
    },
  });
  const stripePayment = useMutation({
    retry: false,
    mutationFn: async ({ request, binding }: StripePaymentSubmission) => {
      if (request.kind !== "stripePayment" || request.submitted || !stripeSubmissionAuthorized({ request, binding })) throw new Error("The original card intent is not active in this authenticated Invoice context.");
      const result = await financeApi.beginStripePayment(request.organizationId, request.invoiceId, request.businessRequestId, request.input);
      if (!result.providerOperationId || !result.paymentIntentId || !result.clientSecret || !result.publishableKey || !result.stripeAccountId
        || result.amountCents !== request.input.amountCents || result.currency !== request.input.currency)
        throw new Error("Stripe returned an initiation response that does not match this card intent. The intent remains held for operator review.");
      return result;
    },
    onSuccess: (result, submission) => {
      const { request, binding } = submission;
      const recovery = financeRecoveryRef.current;
      const currentRequest = recovery.status === "stored" ? recovery.requests.find((entry) => sameFinanceRequest(entry, request)) : undefined;
      if (!sameFinanceRequest(currentRequest, request) || !stripeSubmissionAuthorized(submission)) return;
      setStripeResponse({ request, binding, result });
      setStripeElementVisible(false);
    },
    onError: (error, submission) => {
      const { request } = submission;
      const current = currentContextRef.current;
      if (current.organizationId !== request.organizationId || current.verifiedUserId !== request.verifiedUserId || !requestCanRun(request, "stripePayment")) return;
      const message = errorText(error);
      const terminal = /already confirmed in Billing|terminally failed|was canceled and its Invoice reservation was released|Card payments in USD must be at least/u.test(message);
      if (terminal) {
        const cleared = clearFinanceRequest(request);
        setNotice(cleared ? `The original card operation is terminal. ${message}` : "The terminal card operation could not be cleared from recovery storage; new requests remain blocked.");
        if (cleared) void refresh(request.organizationId, current.sessionScope);
      } else setNotice(`Card intent outcome is unconfirmed. Retry only this original intent; a replacement intent is blocked. ${message}`);
    },
  });
  const resetStripePaymentMutation = useRef(stripePayment.reset);
  resetStripePaymentMutation.current = stripePayment.reset;
  useEffect(() => () => resetStripePaymentMutation.current(), []);
  const beginStripeRequest = (request: StripePaymentRequest) => {
    if (!financeRecoveryAvailable) return;
    const persisted = persistFinanceRequestBeforePost(request);
    if (persisted?.kind !== "stripePayment") return;
    const fence = financeAuthorityFences.get(request.organizationId);
    if (!fence || !fence.canPaymentRecord || fence.verifiedUserId !== verifiedUserId || fence.sessionScope !== sessionScope) return;
    const submission: StripePaymentSubmission = {
      request: persisted,
      binding: { organizationId, verifiedUserId, sessionScope, authorityLease, grantEpoch: fence.grantEpoch },
    };
    if (stripeSubmissionAuthorized(submission)) stripePayment.mutate(submission);
  };
  const stripeRefund = useMutation({
    retry: false,
    mutationFn: (request: StripeRefundRequest) => {
      if (request.kind !== "stripeRefund" || request.submitted || !requestCanRun(request, "stripeRefund")) throw new Error("The original Stripe Refund request is not active in this authenticated Invoice context.");
      return financeApi.beginStripeRefund(request.organizationId, request.invoiceId, request.businessRequestId, request.input);
    },
    onSuccess: async (_result, request) => {
      const recovery = financeRecoveryRef.current;
      const current = recovery.status === "stored" ? recovery.requests.find((entry) => sameFinanceRequest(entry, request)) : undefined;
      if (!sameFinanceRequest(current, request) || !requestCanRun(request, "stripeRefund")) return;
      if (recovery.status === "stored") updateFinanceRecovery({ status: "stored", requests: recovery.requests.map((entry) => sameFinanceRequest(entry, request) ? Object.freeze({ ...request, submitted: true }) : entry) });
      setNotice("Refund submitted to Stripe. The signed provider event will record the canonical V2 Refund.");
      closeDialog();
      await refresh(request.organizationId, currentContextRef.current.sessionScope);
    },
    onError: (error, request) => {
      if (requestCanRun(request, "stripeRefund")) setNotice(`Stripe Refund outcome is unconfirmed. Retry only this original request. ${errorText(error)}`);
    },
  });
  const emailPreview = useMutation({
    mutationFn: (selection: InvoiceEmailSelection) => invoiceApi.emailPreview(selection.organizationId, selection.invoiceIds),
    retry: false,
  });
  // Only the successful read for this captured intent can authorize admission.
  const emailPreviewReady = emailContextCurrent && emailPreview.variables === emailSelection && emailPreview.isSuccess;
  const emailSelected = useMutation({
    mutationFn: (selection: InvoiceEmailSelection) => {
      if (!isEmailDialog || !emailPreviewReady || !csrfReady || selection !== emailSelection || !selection.requestId || !selection.invoiceIds.length)
        throw new Error("Invoice email selection is unavailable. Close this dialog and preview the selection again.");
      return invoiceApi.emailSelected(selection.organizationId, selection.requestId, selection.invoiceIds);
    },
    retry: false,
  });
  const emailAdmission = emailSelected.variables === emailSelection ? emailSelected.data : undefined;
  const emailAdmissionError = emailSelected.variables === emailSelection && emailSelected.isError ? errorText(emailSelected.error) : "";
  const hadPaymentRecordGrant = useRef(canPaymentRecord);
  useFinanceLayoutEffect(() => {
    if (hadPaymentRecordGrant.current && !canPaymentRecord) {
      setStripeResponse(null);
      setStripeElementVisible(false);
      if (dialog === "stripePayment") { setDialog(""); setFinancialDialogContext(null); }
      stripePayment.reset();
    }
    hadPaymentRecordGrant.current = canPaymentRecord;
  }, [canPaymentRecord, dialog, stripePayment]);
  useEffect(() => {
    if (!stripeResponse) return;
    if (!stripeResponseAuthorized(stripeResponse)) {
      setStripeResponse(null);
      setStripeElementVisible(false);
    }
  }, [stripeResponse, organizationId, sessionScope, verifiedUserId, canPaymentRecord, invoiceId, selected, dialog]);
  useEffect(() => {
    setEmailSelection(null);
    setSelectedInvoiceIds(new Set());
    setDialog((current) => current === "invoiceEmail" ? "" : current);
    emailPreview.reset();
    emailSelected.reset();
  }, [organizationId, sessionScope, canInvoiceSend, canPaymentView]);
  const beginInvoiceEmail = () => {
    if (!organizationId || !sessionScope || !canInvoiceSend || !canPaymentView || !selectedInvoiceIds.size || emailSelected.isPending) return;
    const selection = { organizationId, sessionScope, requestId: newBusinessRequestId(), invoiceIds: [...selectedInvoiceIds] };
    setEmailSelection(selection);
    emailSelected.reset();
    setDialog("invoiceEmail");
    emailPreview.mutate(selection);
  };
  const retryEmailPreview = () => {
    if (!isEmailDialog || !emailContextCurrent || !emailSelection || emailPreview.isPending || emailSelected.isPending) return;
    emailPreview.mutate(emailSelection);
  };
  const queueInvoiceEmail = () => {
    if (!isEmailDialog || !emailPreviewReady || !csrfReady || !emailSelection || emailSelected.isPending) return;
    emailSelected.mutate(emailSelection, {
      onSuccess: (result) => {
        setNotice(`${result.queuedInvoices} invoices queued in ${result.queuedMessages} customer email${result.queuedMessages === 1 ? "" : "s"}; ${result.skipped} skipped.`);
        setSelectedInvoiceIds(new Set());
      },
      onError: (error) => setNotice(errorText(error)),
    });
  };
  const closeEmailDialog = () => {
    if (emailSelected.isPending) return;
    setDialog("");
  };
  const requestMatchesInvoice = (request: PendingFinanceRequest | undefined, targetInvoiceId = invoice?.invoiceId) =>
    Boolean(request && targetInvoiceId && request.organizationId === organizationId
      && request.verifiedUserId === verifiedUserId && (request.verifiedUserId !== undefined || request.submittedSessionScope === sessionScope)
      && request.invoiceId === targetInvoiceId);
  const requestForInvoice = <TKind extends PendingFinanceRequest["kind"],>(kind: TKind, targetInvoiceId = invoice?.invoiceId, paymentTargetId?: string): Extract<PendingFinanceRequest, { kind: TKind }> | undefined =>
    financeRequests.find((request) => request.kind === kind && requestMatchesInvoice(request, targetInvoiceId)
      && (paymentTargetId === undefined || ((request.kind === "refund" || request.kind === "stripeRefund") && request.input.paymentId === paymentTargetId))) as Extract<PendingFinanceRequest, { kind: TKind }> | undefined;
  const requestForRefundAllocation = (targetInvoiceId: string, paymentTargetId: string) =>
    financeRequests.find((request) => (request.kind === "refund" || request.kind === "stripeRefund")
      && requestMatchesInvoice(request, targetInvoiceId) && request.input.paymentId === paymentTargetId);
  const openPaymentDialog = () => {
    if (!invoice || !financeRecoveryAvailable) return;
    const existing = requestForInvoice("payment");
    if (existing?.kind === "payment") {
      setAmount(centsForInput(existing.input.amountCents));
      setMethod(existing.input.method);
    } else {
      setAmount(centsForInput(settlement?.balance.cents ?? 0));
      setMethod("check");
    }
    openFinancialDialog("payment", invoice.invoiceId);
  };
  const submitPayment = () => {
    if (!invoice || !financeRecoveryAvailable || !csrfReady || !canPaymentRecord || !dialogContextIsCurrent("payment", invoice.invoiceId)) return;
    const existing = requestForInvoice("payment");
    if (existing?.kind === "payment") {
      const persisted = persistFinanceRequestBeforePost(existing);
      if (persisted?.kind === "payment") payment.mutate(persisted);
      return;
    }
    const amountCents = centsFromInput(amount);
    if (!amountCents) { setNotice("Enter a positive amount with no more than two decimal places."); return; }
    const request: ManualPaymentRequest = Object.freeze({
      kind: "payment", organizationId, ...(verifiedUserId ? { verifiedUserId } : {}), submittedSessionScope: sessionScope, invoiceId: invoice.invoiceId, businessRequestId: newBusinessRequestId(),
      input: Object.freeze({ amountCents, currency: invoice.currency, method, occurredAt: new Date().toISOString() }),
    });
    const persisted = persistFinanceRequestBeforePost(request);
    if (persisted?.kind === "payment") payment.mutate(persisted);
  };
  const openRefundDialog = () => {
    if (!invoice || !financeRecoveryAvailable) return;
    const existing = requestForInvoice("refund");
    if (existing?.kind === "refund") {
      setAmount(centsForInput(existing.input.amountCents));
      setPaymentId(existing.input.paymentId);
    } else {
      setAmount("");
      setPaymentId("");
    }
    openFinancialDialog("refund", invoice.invoiceId);
  };
  const submitRefund = () => {
    if (!invoice || !financeRecoveryAvailable || !csrfReady || !canRefundIssue || !dialogContextIsCurrent("refund", invoice.invoiceId)) return;
    const existing = requestForInvoice("refund");
    if (existing?.kind === "refund") {
      const persisted = persistFinanceRequestBeforePost(existing);
      if (persisted?.kind === "refund") refund.mutate(persisted);
      return;
    }
    const amountCents = centsFromInput(amount);
    if (!amountCents || !paymentId) { setNotice("Choose an original Payment and enter a positive exact amount."); return; }
    if (requestForRefundAllocation(invoice.invoiceId, paymentId)) { setNotice("An unresolved Refund already reserves this original Payment allocation."); return; }
    const request: ManualRefundRequest = Object.freeze({
      kind: "refund", organizationId, ...(verifiedUserId ? { verifiedUserId } : {}), submittedSessionScope: sessionScope, invoiceId: invoice.invoiceId, businessRequestId: newBusinessRequestId(),
      input: Object.freeze({ paymentId, amountCents, currency: invoice.currency, occurredAt: new Date().toISOString() }),
    });
    const persisted = persistFinanceRequestBeforePost(request);
    if (persisted?.kind === "refund") refund.mutate(persisted);
  };
  const openStripeRefundDialog = () => {
    if (!invoice || !financeRecoveryAvailable) return;
    const existing = requestForInvoice("stripeRefund", invoice.invoiceId, paymentId || undefined);
    if (existing?.kind === "stripeRefund") {
      setPaymentId(existing.input.paymentId);
      setAmount(centsForInput(existing.input.amountCents));
      setProviderRequestId(existing.businessRequestId);
    } else {
      setPaymentId("");
      setAmount("");
      setProviderRequestId("");
    }
    openFinancialDialog("stripeRefund", invoice.invoiceId);
  };
  const submitStripeRefund = () => {
    if (!invoice || !financeRecoveryAvailable || !csrfReady || !canRefundIssue || !dialogContextIsCurrent("stripeRefund", invoice.invoiceId)) return;
    const existing = requestForInvoice("stripeRefund", invoice.invoiceId, paymentId);
    if (existing?.kind === "stripeRefund") {
      if (!existing.submitted) {
        const persisted = persistFinanceRequestBeforePost(existing);
        if (persisted?.kind === "stripeRefund") stripeRefund.mutate(persisted);
      }
      return;
    }
    const amountCents = centsFromInput(amount);
    if (!amountCents || !paymentId) { setNotice("Choose a Stripe Payment and enter a positive exact amount."); return; }
    if (requestForRefundAllocation(invoice.invoiceId, paymentId)) { setNotice("An unresolved Refund already reserves this original Payment allocation."); return; }
    const requestId = providerRequestId || newBusinessRequestId();
    const request: StripeRefundRequest = Object.freeze({
      kind: "stripeRefund", organizationId, ...(verifiedUserId ? { verifiedUserId } : {}), submittedSessionScope: sessionScope,
      invoiceId: invoice.invoiceId, businessRequestId: requestId,
      input: Object.freeze({ paymentId, amountCents, currency: invoice.currency }), submitted: false,
    });
    const persisted = persistFinanceRequestBeforePost(request);
    if (persisted?.kind === "stripeRefund") stripeRefund.mutate(persisted);
  };
  const openStripePaymentDialog = () => {
    if (!invoice || !financeRecoveryAvailable) return;
    const existing = requestForInvoice("stripePayment");
    if (existing?.kind === "stripePayment") {
      setAmount(centsForInput(existing.input.amountCents));
      setProviderRequestId(existing.businessRequestId);
    } else {
      setAmount(centsForInput(settlement?.balance.cents ?? 0));
      setProviderRequestId(newBusinessRequestId());
    }
    openFinancialDialog("stripePayment", invoice.invoiceId);
  };
  const submitStripePayment = () => {
    if (!invoice || !financeRecoveryAvailable || !csrfReady || !canPaymentRecord || !dialogContextIsCurrent("stripePayment", invoice.invoiceId)) return;
    const existing = requestForInvoice("stripePayment");
    if (existing?.kind === "stripePayment") {
      if (!existing.submitted) beginStripeRequest(existing);
      return;
    }
    const amountCents = centsFromInput(amount);
    if (!amountCents || !providerRequestId) { setNotice("Enter a positive amount with no more than two decimal places."); return; }
    const request: StripePaymentRequest = Object.freeze({
      kind: "stripePayment", organizationId, ...(verifiedUserId ? { verifiedUserId } : {}), submittedSessionScope: sessionScope, invoiceId: invoice.invoiceId, businessRequestId: providerRequestId,
      input: Object.freeze({ amountCents, currency: invoice.currency }), submitted: false,
    });
    beginStripeRequest(request);
  };
  const markStripePaymentSubmitted = (bound: BoundStripePaymentResult) => {
    const recovery = financeRecoveryRef.current;
    const current = recovery.status === "stored" ? recovery.requests.find((entry) => sameFinanceRequest(entry, bound.request)) : undefined;
    const request = bound.request;
    if (!sameFinanceRequest(current, request) || !requestCanRun(request, "stripePayment") || !stripeResponseAuthorized(bound)) return;
    const submitted = Object.freeze({ ...request, submitted: true });
    if (recovery.status === "stored") updateFinanceRecovery({ status: "stored", requests: recovery.requests.map((entry) => sameFinanceRequest(entry, request) ? submitted : entry) });
    setNotice("Card confirmation was submitted. Wait for the signed provider event before starting another financial request.");
    closeDialog();
    void refresh(request.organizationId, currentContextRef.current.sessionScope);
  };
  const resetInvoicePage = (message = "Selection cleared because the invoice search or filters changed.") => {
    setPage(1);
    if (selectedInvoiceIds.size) {
      setSelectedInvoiceIds(new Set());
      setNotice(message);
    }
  };
  if (!organizationId)
    return (
      <section className="v2-finance-workspace">
        <p className="v2-proof-empty">
          Enter an authenticated organization in Sales before opening Finance.
        </p>
      </section>
    );
  if (!canPaymentView)
    return (
      <section className="v2-finance-workspace">
        <p className="v2-proof-empty">
          You do not have permission to view financial history.
        </p>
      </section>
    );
  if (mode === "invoices" && selected && !detail.data)
    return (
      <section className="v2-finance-workspace">
        <button className="v2-finance-link" onClick={returnToInvoices}>All invoices</button>
        {detail.isError ? (
          <>
            <p className="notice error" role="alert">{errorText(detail.error)}</p>
            <button className="v2-quiet-button" disabled={detail.isFetching} onClick={() => void detail.refetch()}>Retry invoice</button>
          </>
        ) : (
          <p className="v2-proof-empty" role="status">Loading authenticated financial history…</p>
        )}
      </section>
    );
  const currentInvoiceFinanceRequests = financeRequests.filter((request) => requestMatchesInvoice(request));
  const manualPaymentForCurrentInvoice = requestForInvoice("payment");
  const manualRefundForCurrentInvoice = requestForInvoice("refund");
  const stripePaymentForCurrentInvoice = requestForInvoice("stripePayment");
  const stripeRefundForCurrentInvoice = requestForInvoice("stripeRefund");
  const currentDialogFinanceRequest = dialog === "payment" ? manualPaymentForCurrentInvoice
    : dialog === "refund" ? requestForInvoice("refund", invoice?.invoiceId, paymentId || undefined)
      : dialog === "stripePayment" ? stripePaymentForCurrentInvoice : requestForInvoice("stripeRefund", invoice?.invoiceId, paymentId || undefined);
  const financeRequestBlocksCurrentAction = dialog === "stripePayment" ? Boolean(stripePaymentForCurrentInvoice?.submitted)
    : dialog === "stripeRefund" ? Boolean(requestForInvoice("stripeRefund", invoice?.invoiceId, paymentId || undefined)?.submitted) : false;
  const financialDialogContextCurrent = Boolean(financialDialogContext && financialDialogContext.organizationId === organizationId
    && financialDialogContext.sessionScope === sessionScope && financialDialogContext.invoiceId === selected
    && financialDialogContext.invoiceId === invoice?.invoiceId && (!invoiceId || financialDialogContext.invoiceId === invoiceId));
  const stripeResponseForCurrentDialog = stripePaymentForCurrentInvoice && stripeResponse
    && sameFinanceRequest(stripeResponse.request, stripePaymentForCurrentInvoice)
    && stripeResponse.request.verifiedUserId === verifiedUserId && stripeResponseAuthorized(stripeResponse)
    && stripeResponse.result.amountCents === stripePaymentForCurrentInvoice.input.amountCents
    && stripeResponse.result.currency === stripePaymentForCurrentInvoice.input.currency
    && financialDialogContextCurrent && dialog === "stripePayment" ? stripeResponse : null;
  const invoiceColumns: readonly GridColumn<FinancialInvoiceListItem>[] = [
    {
      id: "source",
      label: "Source",
      value: (row) => row.source,
      render: (row) => <span className="badge">{row.source === "legacy" ? "Legacy (read-only)" : "V2"}</span>,
    },
    {
      id: "invoice",
      label: "Invoice",
      serverSort: "invoice_number",
      value: (row) => row.persistedInvoiceNumber ?? "",
      render: (row) => (
        <button
          className="v2-finance-link"
          onClick={() => selectInvoice(row.invoiceId, row.source)}
        >
          {invoiceLabel(row, row.persistedInvoiceNumber)}
        </button>
      ),
    },
    {
      id: "order",
      label: "Source Order",
      value: (row) => row.sourceOrderNumber,
      render: (row) => row.sourceOrderId ? <button className="v2-finance-link" onClick={() => openOrder(row.sourceOrderId)}>Order {row.sourceOrderNumber}</button> : "Order unavailable",
    },
    {
      id: "customer",
      label: "Customer",
      serverSort: "customer",
      value: (row) => row.customerName ?? "",
      render: (row) => row.customerId ? <button className="v2-finance-link" onClick={() => openCustomer(row.customerId!)}>{row.customerName ?? "Customer"}</button> : row.customerName ?? "Customer unavailable",
    },
    {
      id: "issued",
      label: "Issued",
      serverSort: "issued_at",
      value: (row) => row.issuedAt ?? "",
      render: (row) =>
        row.issuedAt ? new Date(row.issuedAt).toLocaleDateString() : "—",
    },
    {
      id: "updated",
      label: "Updated",
      serverSort: "updated",
      value: (row) => row.updatedAt,
      render: (row) => new Date(row.updatedAt).toLocaleDateString(),
    },
    {
      id: "due",
      label: "Due",
      value: () => "",
      render: () => "—",
    },
    {
      id: "status",
      label: "Invoice status",
      value: (row) => row.lifecycle,
      render: (row) => row.source === "v2" && row.lifecycle === "draft" ? "order-backed" : row.lifecycle,
    },
    {
      id: "settlement",
      label: "Settlement",
      value: (row) => row.settlement ?? "",
      render: (row) => row.settlement?.replace("_", " ") ?? "—",
    },
    {
      id: "total",
      label: "Total",
      serverSort: "total",
      value: (row) => row.gross.cents,
      render: (row) => money(row.gross),
    },
    {
      id: "paid",
      label: "Paid",
      value: (row) => row.paid.cents,
      render: (row) => money(row.paid),
    },
    {
      id: "refunded",
      label: "Refunded",
      value: (row) => row.refunded.cents,
      render: (row) => money(row.refunded),
    },
    {
      id: "balance",
      label: "Balance",
      serverSort: "balance",
      value: (row) => row.balance.cents,
      render: (row) => money(row.balance),
    },
  ];
  const ledgerColumns: readonly GridColumn<FinancialLedgerEntry>[] = [
    {
      id: "source",
      label: "Source",
      serverSort: "source",
      value: (row) => row.recordSource,
      render: (row) => <span className="badge">{row.recordSource === "legacy" ? "Legacy (read-only)" : "V2"}</span>,
    },
    {
      id: "date",
      label: "Date",
      serverSort: "occurred_at",
      value: (row) => row.occurredAt,
      render: (row) => new Date(row.occurredAt).toLocaleString(),
    },
    {
      id: "type",
      label: "Type",
      serverSort: "kind",
      value: (row) => row.kind,
      render: (row) => (row.kind === "payment" ? "Payment" : "Refund"),
    },
    {
      id: "invoice",
      label: "Invoice",
      serverSort: "invoice_number",
      value: (row) => row.sourceOrderNumber,
      render: (row) => (
        <button
          className="v2-finance-link"
          onClick={() => {
            selectInvoice(row.invoiceId, row.recordSource);
          }}
        >{`Order ${row.sourceOrderNumber}`}</button>
      ),
    },
    {
      id: "customer",
      label: "Customer",
      serverSort: "customer",
      value: (row) => row.customerName ?? "",
      render: (row) => row.customerId ? <button className="v2-finance-link" onClick={() => openCustomer(row.customerId!)}>{row.customerName ?? "Customer"}</button> : row.customerName ?? "Customer unavailable",
    },
    {
      id: "order",
      label: "Order",
      serverSort: "invoice_number",
      value: (row) => row.sourceOrderNumber,
      render: (row) => <button className="v2-finance-link" onClick={() => openOrder(row.sourceOrderId)}>Order {row.sourceOrderNumber}</button>,
    },
    {
      id: "method",
      label: "Method",
      serverSort: "method",
      value: (row) => row.method ?? "",
      render: (row) => row.method ?? "—",
    },
    {
      id: "amount",
      label: "Amount",
      serverSort: "amount",
      value: (row) => row.amount.cents * (row.kind === "refund" ? -1 : 1),
      render: (row) => (
        <span className={row.kind === "refund" ? "refund" : "payment"}>
          {row.kind === "refund" ? "−" : "+"}
          {money(row.amount)}
        </span>
      ),
    },
    {
      id: "balance",
      label: "Balance after",
      serverSort: "balance",
      value: (row) => row.balanceAfter.cents,
      render: (row) => money(row.balanceAfter),
    },
  ];
  if (mode === "ledger")
    return (
      <section className="v2-finance-workspace">
        <header className="v2-finance-heading">
          <div>
            <span>Finance</span>
            <h1>Payments</h1>
            <p>
              Global transaction ledger derived from immutable Payment and
              Refund facts.
            </p>
          </div>
        </header>
        <div className="v2-finance-actions" aria-label="Ledger page controls">
          <label>Search <input aria-label="Search ledger" value={ledgerSearch} onChange={(event) => { setLedgerSearch(event.target.value); setLedgerPage(1); }} placeholder="Invoice, Order, customer" /></label>
          <label>Type <select aria-label="Ledger type" value={ledgerKind} onChange={(event) => { setLedgerKind(event.target.value as typeof ledgerKind); setLedgerPage(1); }}><option value="">All</option><option value="payment">Payments</option><option value="refund">Refunds</option></select></label>
          <label>Source <select aria-label="Ledger source" value={ledgerSource} onChange={(event) => { setLedgerSource(event.target.value as typeof ledgerSource); setLedgerPage(1); }}><option value="">All</option><option value="v2">V2</option><option value="legacy">Legacy</option></select></label>
          <label>Rows <select value={ledgerPageSize} onChange={(event) => { setLedgerPageSize(Number(event.target.value)); setLedgerPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
        </div>
        <FinanceGrid
          grid="ledger"
          scope={sessionScope}
          organizationId={organizationId}
          rows={ledger.data?.items ?? []}
          columns={ledgerColumns}
          serverSorting={{ id: ledgerSort, direction: ledgerSortDirection }}
          onServerSortingChange={(next) => { setLedgerSort(next.id as NonNullable<FinancialLedgerQuery["sort"]>); setLedgerSortDirection(next.direction); setLedgerPage(1); }}
        />
        <div className="v2-finance-actions"><span>{ledger.data ? `${ledger.data.totalMatching} transactions · page ${ledger.data.page}` : "Loading transactions…"}</span><button className="v2-quiet-button" disabled={ledgerPage <= 1 || ledger.isFetching} onClick={() => setLedgerPage((value) => value - 1)}>Previous</button><button className="v2-quiet-button" disabled={!ledger.data?.hasNextPage || ledger.isFetching} onClick={() => setLedgerPage((value) => value + 1)}>Next</button></div>
      </section>
    );
  return (
    <section className="v2-finance-workspace">
      <header className="v2-finance-heading">
        <div>
          <span>Finance</span>
          <h1>Invoices</h1>
          <p>
            Current Order-backed invoices with derived settlement. Payments and
            Refunds never rewrite immutable financial history.
          </p>
        </div>
        {canInvoiceSend && selectedInvoiceIds.size > 0 && <div className="v2-finance-actions"><span>{selectedInvoiceIds.size} selected</span><button className="v2-invoice-issue" onClick={beginInvoiceEmail}>Send selected</button><button className="v2-quiet-button" onClick={() => setSelectedInvoiceIds(new Set())}>Clear selection</button></div>}
      </header>
      <div className="v2-finance-actions" aria-label="Invoice list controls">
        <label>Search <input value={search} onChange={(event) => { setSearch(event.target.value); resetInvoicePage(); }} placeholder="Invoice, Order, customer, PO…" /></label>
        <label>Lifecycle <select value={lifecycleFilter} onChange={(event) => { setLifecycleFilter(event.target.value as typeof lifecycleFilter); resetInvoicePage(); }}><option value="">All</option><option value="draft">Order-backed</option><option value="issued">Issued</option><option value="void">Void</option></select></label>
        <label>Settlement <select value={settlementFilter} onChange={(event) => { setSettlementFilter(event.target.value as typeof settlementFilter); resetInvoicePage(); }}><option value="">All</option><option value="unpaid">Unpaid</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option><option value="credit_due">Credit due</option></select></label>
        <label>Rows <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); resetInvoicePage(); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </div>
      {overview.data?.summary && <div className="v2-finance-metrics"><div><small>Outstanding A/R</small><strong>{amounts(overview.data.summary.outstanding)}</strong></div><div><small>Open invoices</small><strong>{overview.data.summary.openInvoiceCount}</strong></div><div><small>Unpaid</small><strong>{overview.data.summary.unpaid.count}</strong></div><div><small>Partially paid</small><strong>{overview.data.summary.partiallyPaid.count}</strong></div><div><small>Credit due</small><strong>{overview.data.summary.creditDue.count}</strong></div></div>}
      {overview.error && <p className="notice error">{errorText(overview.error)}</p>}
      <div className="v2-finance-overview">
        <FinanceGrid
          grid="invoices"
          scope={sessionScope}
          organizationId={organizationId}
          rows={overview.data?.items ?? []}
          columns={invoiceColumns}
          selectable={canInvoiceSend ? (row) => row.source === "v2" && row.lifecycle !== "void" ? row.invoiceId : undefined : undefined}
          selectedIds={selectedInvoiceIds}
          onSelectedIdsChange={setSelectedInvoiceIds}
          serverSorting={{ id: invoiceSort, direction: invoiceSortDirection }}
          onServerSortingChange={(next) => { setInvoiceSort(next.id as NonNullable<FinancialInvoiceQuery["sort"]>); setInvoiceSortDirection(next.direction); resetInvoicePage("Selection cleared because invoice sorting changed."); }}
        />
      </div>
      <div className="v2-finance-actions"><span>{overview.data ? `${overview.data.totalMatching} matching invoices · page ${overview.data.page}` : "Loading invoices…"}</span><button className="v2-quiet-button" disabled={page <= 1 || overview.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="v2-quiet-button" disabled={!overview.data?.hasNextPage || overview.isFetching} onClick={() => setPage((value) => value + 1)}>Next</button></div>
      {invoice && settlement && (
        <article className="v2-finance-detail">
          <header>
            <div>
               <button className="v2-finance-link" onClick={returnToInvoices}>← All invoices</button>
              <span className={`v2-invoice-state ${invoice.lifecycle}`}>
                {invoice.lifecycle === "draft" ? "Order-backed" : invoice.lifecycle}
              </span>
              <h2>{invoiceLabel(invoice, detail.data?.persistedInvoiceNumber)}</h2>
              <p>{invoice.sourceOrderNumber ? `Source Order ${invoice.sourceOrderNumber}` : "Source Order unavailable"}</p>
              <p>
                <button className="v2-finance-link" onClick={() => invoice.customerId && openCustomer(invoice.customerId)} disabled={!invoice.customerId}>
                  {invoice.customerPresentation?.customerDisplayName ??
                    invoice.customerPresentation?.companyName ??
                    "Customer unavailable"}
                </button>
              </p>
              <button
                className="v2-finance-link"
                onClick={() => openOrder(invoice.sourceOrderId)}
              >
                Open source Order
              </button>
            </div>
            <div className="v2-finance-actions">
              {invoice.source !== "legacy" && canInvoiceView && (
                <button
                  className="v2-quiet-button"
                  onClick={() =>
                    window.open(
                      invoiceDocumentPath(organizationId, invoice.invoiceId),
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  Preview PDF
                </button>
              )}
              {!isEmailDialog && invoice.source !== "legacy" && invoice.lifecycle === "draft" && canInvoiceIssue && (
                <button className="v2-invoice-issue" disabled={!csrfReady || issueInvoice.isPending} onClick={() => issueInvoice.mutate()}>
                  {issueInvoice.isPending ? "Issuing…" : "Issue Invoice"}
                </button>
              )}
              {!isEmailDialog && paymentEligible && canPaymentRecord && (
                <button
                  className="v2-invoice-issue"
                  disabled={!financeRecoveryAvailable || !csrfReady}
                  onClick={openPaymentDialog}
                >
                  {manualPaymentForCurrentInvoice ? "Resume original Payment" : "Take Payment"}
                </button>
              )}
              {!isEmailDialog && paymentEligible && canPaymentRecord && (
                <button className="v2-quiet-button" disabled={!financeRecoveryAvailable || !csrfReady} onClick={openStripePaymentDialog}>
                  {stripePaymentForCurrentInvoice ? "Resume original card intent" : "Pay by Card"}
                </button>
              )}
              {!isEmailDialog && invoice.source !== "legacy" && invoice.lifecycle !== "void" && canRefundIssue && refundablePayments.length > 0 && (
                <button
                  className="v2-quiet-button"
                  disabled={!financeRecoveryAvailable || !csrfReady || !refundablePayments.length}
                  onClick={openRefundDialog}
                >
                  {manualRefundForCurrentInvoice ? "Resume original Refund" : "Record Refund"}
                </button>
              )}
              {!isEmailDialog && invoice.source !== "legacy" && invoice.lifecycle !== "void" && canRefundIssue && refundablePayments.some((entry) => entry.source === "provider") && (
                <button className="v2-quiet-button" disabled={!financeRecoveryAvailable || !csrfReady} onClick={openStripeRefundDialog}>
                  {stripeRefundForCurrentInvoice ? "Resume original Stripe Refund" : "Refund to Card"}
                </button>
              )}
            </div>
          </header>
          <section className="v2-invoice-document">
            <div className="v2-invoice-document-title">
              <h2>Invoice</h2>
              <p>
                {invoice.source === "legacy" ? "Legacy financial record; read-only in V2." : invoice.lifecycle === "issued"
                  ? "Issued Billing checkpoint; commercial content is immutable."
                  : "Current payable Billing projection from the source Order. Payments and Refunds remain immutable."}
              </p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <tr key={line.sourceOrderLineId}>
                    <td>{line.description}</td>
                    <td>{line.quantity}</td>
                    <td>{money(line.sellingUnitAmount)}</td>
                    <td>{money(line.lineAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="v2-invoice-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(invoice.subtotal)}</dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>{money(invoice.taxTotal)}</dd>
              </div>
              <div className="total">
                <dt>Total</dt>
                <dd>{money(invoice.total)}</dd>
              </div>
            </dl>
          </section>
          <div className="v2-finance-metrics">
            <div>
              <small>Total</small>
              <strong>{money(settlement.gross)}</strong>
            </div>
            <div>
              <small>Paid</small>
              <strong>{money(settlement.paid)}</strong>
            </div>
            <div>
              <small>Refunded</small>
              <strong>{money(settlement.refunded)}</strong>
            </div>
            <div>
              <small>{settlement.balance.cents < 0 ? "Credit / refund due" : "Balance"}</small>
              <strong>{money(settlement.balance.cents < 0 ? { ...settlement.balance, cents: Math.abs(settlement.balance.cents) } : settlement.balance)}</strong>
            </div>
          </div>
          <section>
            <h3>Financial History</h3>
            <p>
              Each balance is derived server-side from immutable allocation
              facts.
            </p>
            <HistoryTable history={detail.data?.history ?? []} />
          </section>
          {currentInvoiceFinanceRequests.map((request) => <p className="v2-invoice-notice" role="status" key={`${request.kind}:${request.businessRequestId}`}>
            {request.kind === "stripePayment"
              ? request.submitted ? "Card confirmation is awaiting the signed provider event. Resume only this intent after re-authentication; do not create a replacement." : "A card intent is unresolved. Resume only this exact intent; replacement requests are blocked."
              : request.kind === "stripeRefund"
                ? request.submitted ? "Stripe Refund is awaiting the signed provider event. Resume only this intent after re-authentication." : "A Stripe Refund intent is unresolved. Resume only this exact request."
                : `An original ${request.kind === "payment" ? "Payment" : "Refund"} request is unresolved. Retry its exact submitted identity before repeating the same financial action.`}
          </p>)}
          {(financeRecovery.status === "blocked" || financeRecovery.status === "unavailable") && <p className="v2-invoice-notice" role="alert">{financeRecovery.reason}</p>}
          {notice && <p className="v2-invoice-notice">{notice}</p>}
        </article>
      )}
      {isFinancialDialog && invoice && financialDialogContextCurrent && (
        <div
          className="v2-finance-modal"
          role="dialog"
          aria-modal="true"
          aria-label={dialog === "payment" ? "Take Payment" : dialog === "refund" ? "Record Refund" : dialog === "stripePayment" ? "Pay by Card" : "Refund to Card"}
        >
          <div>
            <header>
              <h2>{dialog === "payment" ? "Take Payment" : dialog === "refund" ? "Record Refund" : dialog === "stripePayment" ? "Pay by Card" : "Refund to Card"}</h2>
              <button onClick={closeDialog}>Close</button>
            </header>
            <label>
              Amount
              <input
                aria-label="Amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                disabled={Boolean(currentDialogFinanceRequest) || payment.isPending || refund.isPending || stripePayment.isPending || stripeRefund.isPending}
              />
            </label>
            {dialog === "payment" ? (
              <label>
                Method
                <select
                  aria-label="Payment method"
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as typeof method)
                  }
                  disabled={Boolean(manualPaymentForCurrentInvoice) || payment.isPending}
                >
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="external">External</option>
                </select>
              </label>
            ) : dialog === "refund" || dialog === "stripeRefund" ? (
              <label>
                Original Payment
                <select
                  aria-label="Original Payment"
                  value={paymentId}
                  onChange={(event) => setPaymentId(event.target.value)}
                  disabled={Boolean(manualRefundForCurrentInvoice || stripeRefundForCurrentInvoice) || refund.isPending || stripeRefund.isPending}
                >
                  <option value="">Select a Payment</option>
                  {refundablePayments
                    .filter((entry) => dialog !== "stripeRefund" || entry.source === "provider")
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {money(entry.amount)} · {entry.method ?? "payment"}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <p className="muted">
              {dialog === "payment"
                ? "Manual methods only. Card and ACH collection remain deferred; no raw card data is accepted."
                : dialog === "refund" ? "A Refund is a new immutable fact. It does not alter the original Payment." : dialog === "stripePayment" ? "Stripe confirmation never records a V2 Payment directly. The signed webhook completes the financial fact." : "Stripe will process the refund; its signed event records the separate V2 Refund."}
            </p>
            {dialog === "stripePayment" && stripePaymentForCurrentInvoice?.submitted && <p role="status">Card confirmation was submitted. Wait for the signed provider event; the intent cannot be replaced or resubmitted here.</p>}
            {dialog === "stripeRefund" && stripeRefundForCurrentInvoice?.submitted && <p role="status">Stripe Refund was submitted. Wait for its signed provider event before starting another financial request.</p>}
            {dialog === "stripePayment" && stripeResponseForCurrentDialog && !stripeElementVisible && <>
              <p role="status">Stripe returned the initiation result for this exact Invoice, amount, currency, and request identity.</p>
              <button className="v2-invoice-issue" disabled={!csrfReady || !canPaymentRecord || !stripeResponseAuthorized(stripeResponseForCurrentDialog)} onClick={() => setStripeElementVisible(true)}>Enter card details</button>
            </>}
            {dialog === "stripePayment" && stripeResponseForCurrentDialog && stripeElementVisible && <StripePaymentElement
              publishableKey={stripeResponseForCurrentDialog.result.publishableKey}
              stripeAccountId={stripeResponseForCurrentDialog.result.stripeAccountId}
              clientSecret={stripeResponseForCurrentDialog.result.clientSecret}
              authorized={() => stripeResponseForCurrentDialog ? stripeResponseAuthorized(stripeResponseForCurrentDialog) : false}
              onSubmitted={() => markStripePaymentSubmitted(stripeResponseForCurrentDialog)}
              onError={(message) => setNotice(message)}
            />}
            {dialog === "stripePayment" && !stripeResponseForCurrentDialog && !stripePaymentForCurrentInvoice?.submitted && <button
              className="v2-invoice-issue"
              disabled={!financeRecoveryAvailable || !csrfReady || stripePayment.isPending || !canPaymentRecord}
              onClick={submitStripePayment}
            >{stripePayment.isPending ? "Checking original card intent…" : stripePaymentForCurrentInvoice ? "Retry original card intent" : "Continue to card"}</button>}
            {dialog !== "stripePayment" && <button
              className="v2-invoice-issue"
              disabled={!financeRecoveryAvailable || !csrfReady || payment.isPending || refund.isPending || stripeRefund.isPending || financeRequestBlocksCurrentAction}
              onClick={() => {
                if (dialog === "payment") submitPayment();
                else if (dialog === "refund") submitRefund();
                else if (dialog === "stripeRefund") submitStripeRefund();
              }}
            >
              {dialog === "payment" ? manualPaymentForCurrentInvoice ? "Retry original Payment" : "Record Payment"
                : dialog === "refund" ? manualRefundForCurrentInvoice ? "Retry original Refund" : "Record Refund"
                  : stripeRefundForCurrentInvoice ? "Retry original Stripe Refund" : "Submit Stripe Refund"}
            </button>}
          </div>
        </div>
      )}
      {isEmailDialog && emailContextCurrent && (
        <div className="v2-finance-modal" role="dialog" aria-modal="true" aria-label="Send selected invoices">
          <div>
            <header><h2>Send selected invoices</h2><button disabled={emailSelected.isPending} onClick={closeEmailDialog}>Close</button></header>
            {emailAdmission ? <>
              <p role="status">{emailAdmission.queuedInvoices} invoices queued in {emailAdmission.queuedMessages} customer email{emailAdmission.queuedMessages === 1 ? "" : "s"}; {emailAdmission.skipped} skipped{emailAdmission.replayed ? ". Existing batch reused." : "."}</p>
              <p>Delivery continues through the throttled worker. No duplicate admission was created.</p>
            </> : <>
              {emailPreview.isPending ? <p>Resolving canonical billing recipients…</p>
                : emailPreviewReady && emailPreview.data ? <p>{emailPreview.data.selected} invoices selected · {emailPreview.data.recipientCount} recipients · {emailPreview.data.skipped} skipped for missing or invalid billing email.</p>
                : <>
                  <p>Recipient preview is unavailable. Retry before queuing delivery.</p>
                  {emailPreview.isError && <p className="notice error" role="alert">{errorText(emailPreview.error)}</p>}
                  <button className="v2-quiet-button" onClick={retryEmailPreview}>Retry recipient preview (read only)</button>
                </>}
              <p>Customer messages are admitted to the throttled delivery worker. They are not sent from this page.</p>
              {emailAdmissionError && <p className="notice error" role="alert">{emailAdmissionError}</p>}
              <button className="v2-invoice-issue" disabled={!csrfReady || !emailPreviewReady || !emailSelection?.requestId || !emailSelection.invoiceIds.length || emailSelected.isPending} onClick={queueInvoiceEmail}>{emailSelected.isPending ? "Queuing…" : "Queue email delivery"}</button>
            </>}
          </div>
        </div>
      )}
    </section>
  );
};
