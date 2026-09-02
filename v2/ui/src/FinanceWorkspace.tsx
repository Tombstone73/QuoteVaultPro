import React, {
  useEffect,
  useMemo,
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
} from "./api";

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
const errorText = (error: unknown) =>
  (error as ApiError)?.message ?? "The finance service is unavailable.";
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

const StripeCardConfirmation = ({ onSubmitted, onError }: Readonly<{ onSubmitted:()=>void; onError:(message:string)=>void }>) => {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  return <form onSubmit={async (event) => { event.preventDefault(); if (!stripe || !elements) return; setSubmitting(true); const result = await stripe.confirmPayment({ elements, redirect:"if_required" }); setSubmitting(false); if (result.error) return onError(result.error.message ?? "Card confirmation could not be completed."); onSubmitted(); }}>
    <PaymentElement />
    <button className="v2-invoice-issue" disabled={!stripe || submitting}>{submitting ? "Confirming…" : "Confirm card payment"}</button>
  </form>;
};
const StripePaymentElement = ({ publishableKey, stripeAccountId, clientSecret, onSubmitted, onError }: Readonly<{ publishableKey:string; stripeAccountId:string; clientSecret:string; onSubmitted:()=>void; onError:(message:string)=>void }>) => {
  const stripePromise = useMemo(() => loadStripe(publishableKey,{stripeAccount:stripeAccountId}), [publishableKey,stripeAccountId]);
  return <Elements stripe={stripePromise} options={{ clientSecret }}><StripeCardConfirmation onSubmitted={onSubmitted} onError={onError} /></Elements>;
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

export const FinanceWorkspace = ({
  mode,
  organizationId,
  sessionScope,
  invoiceId,
  onSelectInvoice,
  backToInvoices,
  canInvoiceView,
  canInvoiceSend,
  canPaymentView,
  canPaymentRecord,
  canRefundIssue,
  csrfReady,
  openOrder,
  openCustomer,
}: Readonly<{
  mode: "invoices" | "ledger";
  organizationId: string;
  sessionScope: string;
  invoiceId: string;
  onSelectInvoice: (invoiceId: string) => void;
  backToInvoices: () => void;
  canInvoiceView: boolean;
  canInvoiceSend: boolean;
  canPaymentView: boolean;
  canPaymentRecord: boolean;
  canRefundIssue: boolean;
  csrfReady: boolean;
  openOrder: (orderId: string) => void;
  openCustomer: (customerId: string) => void;
}>) => {
  const client = useQueryClient();
  const [selected, setSelected] = useState(invoiceId);
  const [selectedSource, setSelectedSource] = useState<"v2" | "legacy">("v2");
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
  const [emailRequestId, setEmailRequestId] = useState("");
  const [emailInvoiceIds, setEmailInvoiceIds] = useState<readonly string[]>([]);
  const [emailAdmission, setEmailAdmission] = useState<Awaited<ReturnType<typeof invoiceApi.emailSelected>> | null>(null);
  const [emailAdmissionError, setEmailAdmissionError] = useState("");
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
    if (!selected && overview.data?.items[0] && !invoiceId)
      { setSelected(overview.data.items[0].invoiceId); setSelectedSource(overview.data.items[0].source); }
  }, [invoiceId, overview.data, selected]);
  const selectInvoice = (id: string, source: "v2" | "legacy" = "v2") => {
    setSelected(id);
    setSelectedSource(source);
    if (source === "v2") onSelectInvoice(id);
  };
  const returnToInvoices = () => {
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
  const ledgerQuery: FinancialLedgerQuery = { page: ledgerPage, pageSize: ledgerPageSize, ...(ledgerSearch ? { q: ledgerSearch } : {}), ...(ledgerKind ? { kind: ledgerKind } : {}), ...(ledgerSource ? { recordSource: ledgerSource } : {}), sort: ledgerSort, direction: ledgerSortDirection };
  const ledger = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "finance", "ledger", ledgerQuery],
    queryFn: () => financeApi.ledger(organizationId, ledgerQuery),
    enabled: Boolean(mode === "ledger" && canPaymentView),
  });
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: ["v2", sessionScope, organizationId, "finance"],
    });
    await client.invalidateQueries({
      queryKey: ["v2", sessionScope, organizationId, "billing"],
    });
  };
  const closeDialog = () => {
    setDialog("");
    setAmount("");
    setPaymentId("");
    setProviderRequestId("");
  };
  const payment = useMutation({
    mutationFn: () => {
      const parsed = centsFromInput(amount);
      if (!parsed || !detail.data)
        throw new Error(
          "Enter a positive amount with no more than two decimal places.",
        );
      return financeApi.recordPayment(
        organizationId,
        detail.data.invoice.invoiceId,
        newBusinessRequestId(),
        {
          amountCents: parsed,
          currency: detail.data.invoice.currency,
          method,
          occurredAt: new Date().toISOString(),
        },
      );
    },
    onSuccess: async () => {
      setNotice("Payment recorded as an immutable financial fact.");
      closeDialog();
      await refresh();
    },
    onError: (error) => setNotice(errorText(error)),
  });
  const refund = useMutation({
    mutationFn: () => {
      const parsed = centsFromInput(amount);
      if (!parsed || !detail.data || !paymentId)
        throw new Error(
          "Choose an original Payment and enter a positive exact amount.",
        );
      return financeApi.recordRefund(
        organizationId,
        detail.data.invoice.invoiceId,
        newBusinessRequestId(),
        {
          paymentId,
          amountCents: parsed,
          currency: detail.data.invoice.currency,
          occurredAt: new Date().toISOString(),
        },
      );
    },
    onSuccess: async () => {
      setNotice(
        "Refund recorded as a separate immutable financial fact; the original Payment remains unchanged.",
      );
      closeDialog();
      await refresh();
    },
    onError: (error) => setNotice(errorText(error)),
  });
  const stripePayment = useMutation({
    mutationFn: () => {
      const parsed = centsFromInput(amount);
      if (!parsed || !detail.data || !providerRequestId) throw new Error("Enter a positive amount with no more than two decimal places.");
      return financeApi.beginStripePayment(organizationId, detail.data.invoice.invoiceId, providerRequestId, { amountCents: parsed, currency: detail.data.invoice.currency });
    },
    onError: (error) => setNotice(errorText(error)),
  });
  const stripeRefund = useMutation({
    mutationFn: () => {
      const parsed = centsFromInput(amount);
      if (!parsed || !detail.data || !paymentId || !providerRequestId) throw new Error("Choose a Stripe Payment and enter a positive exact amount.");
      return financeApi.beginStripeRefund(organizationId, detail.data.invoice.invoiceId, providerRequestId, { paymentId, amountCents: parsed, currency: detail.data.invoice.currency });
    },
    onSuccess: async () => { setNotice("Refund submitted to Stripe. The signed provider event will record the canonical V2 Refund."); closeDialog(); await refresh(); },
    onError: (error) => setNotice(errorText(error)),
  });
  const emailSelected = useMutation({
    mutationFn: () => {
      if (!emailRequestId || !emailInvoiceIds.length)
        throw new Error("Invoice email selection is unavailable. Close this dialog and preview the selection again.");
      return invoiceApi.emailSelected(organizationId, emailRequestId, emailInvoiceIds);
    },
    onSuccess: (result) => {
      setEmailAdmission(result);
      setEmailAdmissionError("");
      setNotice(`${result.queuedInvoices} invoices queued in ${result.queuedMessages} customer email${result.queuedMessages === 1 ? "" : "s"}; ${result.skipped} skipped.`);
      setSelectedInvoiceIds(new Set());
    },
    onError: (error) => {
      const message = errorText(error);
      setEmailAdmissionError(message);
      setNotice(message);
    },
  });
  const emailPreview = useMutation({ mutationFn: (invoiceIds: readonly string[]) => invoiceApi.emailPreview(organizationId, invoiceIds) });
  const beginInvoiceEmail = () => {
    const invoiceIds = [...selectedInvoiceIds];
    setEmailRequestId(newBusinessRequestId());
    setEmailInvoiceIds(invoiceIds);
    setEmailAdmission(null);
    setEmailAdmissionError("");
    setDialog("invoiceEmail");
    emailPreview.mutate(invoiceIds);
  };
  const closeEmailDialog = () => {
    if (emailSelected.isPending) return;
    setDialog("");
    setEmailAdmissionError("");
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
        <p className="v2-proof-empty">
          Loading authenticated financial history…
        </p>
      </section>
    );
  const invoice = detail.data?.invoice,
    settlement = detail.data?.settlement;
  const refundablePayments = (detail.data?.history ?? []).filter((payment) =>
    payment.kind === "payment" && payment.amount.cents > (detail.data?.history ?? [])
      .filter((refund) => refund.kind === "refund" && refund.paymentId === payment.id)
      .reduce((total, refund) => total + refund.amount.cents, 0),
  );
  const paymentEligible = invoice?.source !== "legacy" && invoice?.lifecycle !== "void" && (settlement?.balance.cents ?? 0) > 0;
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
      value: (row) => row.sourceOrderNumber,
      render: (row) => (
        <button
          className="v2-finance-link"
          onClick={() => selectInvoice(row.invoiceId, row.source)}
        >
          Order {row.sourceOrderNumber}
        </button>
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
              <h2>Order {invoice.sourceOrderNumber ?? "Invoice"}</h2>
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
              {paymentEligible && canPaymentRecord && (
                <button
                  className="v2-invoice-issue"
                  disabled={!csrfReady}
                  onClick={() => {
                    setAmount(centsForInput(settlement.balance.cents));
                    setDialog("payment");
                  }}
                >
                  Take Payment
                </button>
              )}
              {paymentEligible && canPaymentRecord && (
                <button className="v2-quiet-button" disabled={!csrfReady} onClick={() => { setAmount(centsForInput(settlement.balance.cents)); setProviderRequestId(newBusinessRequestId()); setDialog("stripePayment"); }}>Pay by Card</button>
              )}
              {invoice.source !== "legacy" && invoice.lifecycle !== "void" && canRefundIssue && refundablePayments.length > 0 && (
                <button
                  className="v2-quiet-button"
                  disabled={
                    !csrfReady ||
                    !refundablePayments.length
                  }
                  onClick={() => setDialog("refund")}
                >
                  Record Refund
                </button>
              )}
              {invoice.source !== "legacy" && invoice.lifecycle !== "void" && canRefundIssue && refundablePayments.some((entry) => entry.source === "provider") && (
                <button className="v2-quiet-button" disabled={!csrfReady} onClick={() => { setPaymentId(""); setAmount(""); setProviderRequestId(newBusinessRequestId()); setDialog("stripeRefund"); }}>Refund to Card</button>
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
          {notice && <p className="v2-invoice-notice">{notice}</p>}
        </article>
      )}
      {dialog && invoice && (
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
                >
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="external">External</option>
                </select>
              </label>
            ) : dialog !== "stripePayment" ? (
              <label>
                Original Payment
                <select
                  aria-label="Original Payment"
                  value={paymentId}
                  onChange={(event) => setPaymentId(event.target.value)}
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
            {dialog === "stripePayment" && !stripePayment.data && <button
              className="v2-invoice-issue"
              disabled={!csrfReady || stripePayment.isPending}
              onClick={() => stripePayment.mutate()}
            >{stripePayment.isPending ? "Preparing card payment…" : "Continue to card"}</button>}
            {dialog === "stripePayment" && stripePayment.data && <StripePaymentElement publishableKey={stripePayment.data.publishableKey} stripeAccountId={stripePayment.data.stripeAccountId} clientSecret={stripePayment.data.clientSecret} onSubmitted={() => { setNotice("Payment submitted. Waiting for the signed Stripe confirmation before updating this Invoice."); closeDialog(); void refresh(); }} onError={(message) => setNotice(message)} />}
            <button
              className="v2-invoice-issue"
              disabled={!csrfReady || payment.isPending || refund.isPending || stripeRefund.isPending || dialog === "stripePayment"}
              onClick={() =>
                dialog === "payment" ? payment.mutate() : dialog === "refund" ? refund.mutate() : stripeRefund.mutate()
              }
            >
              {dialog === "payment" ? "Record Payment" : dialog === "refund" ? "Record Refund" : "Submit Stripe Refund"}
            </button>
          </div>
        </div>
      )}
      {dialog === "invoiceEmail" && (
        <div className="v2-finance-modal" role="dialog" aria-modal="true" aria-label="Send selected invoices"><div><header><h2>Send selected invoices</h2><button disabled={emailSelected.isPending} onClick={closeEmailDialog}>Close</button></header>{emailAdmission ? <><p role="status">{emailAdmission.queuedInvoices} invoices queued in {emailAdmission.queuedMessages} customer email{emailAdmission.queuedMessages === 1 ? "" : "s"}; {emailAdmission.skipped} skipped{emailAdmission.replayed ? ". Existing batch reused." : "."}</p><p>Delivery continues through the throttled worker. No duplicate admission was created.</p></> : <>{emailPreview.isPending ? <p>Resolving canonical billing recipients…</p> : emailPreview.data ? <p>{emailPreview.data.selected} invoices selected · {emailPreview.data.recipientCount} recipients · {emailPreview.data.skipped} skipped for missing or invalid billing email.</p> : <p>Recipient preview is unavailable. Retry before queuing delivery.</p>}<p>Customer messages are admitted to the throttled delivery worker. They are not sent from this page.</p>{emailAdmissionError && <p className="notice error" role="alert">{emailAdmissionError}</p>}<button className="v2-invoice-issue" disabled={!csrfReady || !emailRequestId || !emailInvoiceIds.length || emailSelected.isPending || emailPreview.isPending || !emailPreview.data} onClick={() => emailSelected.mutate()}>{emailSelected.isPending ? "Queuing…" : "Queue email delivery"}</button></>}</div></div>
      )}
    </section>
  );
};
