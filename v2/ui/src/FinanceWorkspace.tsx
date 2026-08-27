import React, {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  financeApi,
  invoiceApi,
  money,
  newBusinessRequestId,
  type ApiError,
  type FinancialHistoryEntry,
  type FinancialInvoiceListItem,
  type FinancialLedgerEntry,
} from "./api";

type GridColumn<T> = Readonly<{
  id: string;
  label: string;
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
}: Readonly<{
  grid: string;
  scope: string;
  organizationId: string;
  rows: readonly T[];
  columns: readonly GridColumn<T>[];
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
  const sorted = sortRows(
    rows,
    visible.find((column) => column.id === sorting.id),
    sorting.direction,
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
  return (
    <div className="v2-finance-grid-wrap">
      <p className="v2-finance-grid-help">
        Click a header to sort · drag a header to reorder · drag the header edge
        to resize. Your layout is remembered in this browser.
      </p>
      <table className="v2-finance-grid">
        <thead>
          <tr>
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
                  onClick={() =>
                    setSorting((current) => {
                      const next =
                        current.id === column.id
                          ? {
                              id: column.id,
                              direction:
                                current.direction === "asc"
                                  ? ("desc" as const)
                                  : ("asc" as const),
                            }
                          : { id: column.id, direction: "asc" as const };
                      setPreference((saved) => ({ ...saved, sorting: next }));
                      return next;
                    })
                  }
                >
                  {column.label}
                  {sorting.id === column.id
                    ? sorting.direction === "asc"
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
  canIssue,
  canInvoiceView,
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
  canIssue: boolean;
  canInvoiceView: boolean;
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
  const [dialog, setDialog] = useState<"payment" | "refund" | "">("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "check" | "external">("check");
  const [paymentId, setPaymentId] = useState("");
  const overview = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "finance", "overview"],
    queryFn: () => financeApi.overview(organizationId),
    enabled: Boolean(organizationId && sessionScope && canPaymentView),
  });
  useEffect(() => { setSelected(invoiceId); setSelectedSource("v2"); }, [invoiceId]);
  useEffect(() => {
    if (!selected && overview.data?.items[0] && !invoiceId)
      { setSelected(overview.data.items[0].invoiceId); setSelectedSource(overview.data.items[0].source); }
  }, [invoiceId, overview.data, selected]);
  const selectInvoice = (id: string, source: "v2" | "legacy" = "v2") => {
    setSelected(id);
    setSelectedSource(source);
    if (source === "v2") onSelectInvoice(id);
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
  const ledger = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "finance", "ledger"],
    queryFn: () => financeApi.ledger(organizationId),
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
  const issue = useMutation({
    mutationFn: () =>
      invoiceApi.issue(organizationId, selected, newBusinessRequestId()),
    onSuccess: async () => {
      setNotice("Invoice issued as an immutable Billing checkpoint.");
      await refresh();
    },
    onError: (error) => setNotice(errorText(error)),
  });
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
      value: (row) => row.customerName ?? "",
      render: (row) => row.customerId ? <button className="v2-finance-link" onClick={() => openCustomer(row.customerId!)}>{row.customerName ?? "Customer"}</button> : row.customerName ?? "Customer unavailable",
    },
    {
      id: "issued",
      label: "Issued",
      value: (row) => row.issuedAt ?? "",
      render: (row) =>
        row.issuedAt ? new Date(row.issuedAt).toLocaleDateString() : "—",
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
      render: (row) => row.lifecycle,
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
      value: (row) => row.balance.cents,
      render: (row) => money(row.balance),
    },
  ];
  const ledgerColumns: readonly GridColumn<FinancialLedgerEntry>[] = [
    {
      id: "source",
      label: "Source",
      value: (row) => row.recordSource,
      render: (row) => <span className="badge">{row.recordSource === "legacy" ? "Legacy (read-only)" : "V2"}</span>,
    },
    {
      id: "date",
      label: "Date",
      value: (row) => row.occurredAt,
      render: (row) => new Date(row.occurredAt).toLocaleString(),
    },
    {
      id: "type",
      label: "Type",
      value: (row) => row.kind,
      render: (row) => (row.kind === "payment" ? "Payment" : "Refund"),
    },
    {
      id: "invoice",
      label: "Invoice",
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
      value: (row) => row.customerName ?? "",
      render: (row) => row.customerId ? <button className="v2-finance-link" onClick={() => openCustomer(row.customerId!)}>{row.customerName ?? "Customer"}</button> : row.customerName ?? "Customer unavailable",
    },
    {
      id: "order",
      label: "Order",
      value: (row) => row.sourceOrderNumber,
      render: (row) => <button className="v2-finance-link" onClick={() => openOrder(row.sourceOrderId)}>Order {row.sourceOrderNumber}</button>,
    },
    {
      id: "method",
      label: "Method",
      value: (row) => row.method ?? "",
      render: (row) => row.method ?? "—",
    },
    {
      id: "amount",
      label: "Amount",
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
        <FinanceGrid
          grid="ledger"
          scope={sessionScope}
          organizationId={organizationId}
          rows={ledger.data?.items ?? []}
          columns={ledgerColumns}
        />
      </section>
    );
  return (
    <section className="v2-finance-workspace">
      <header className="v2-finance-heading">
        <div>
          <span>Finance</span>
          <h1>Invoices</h1>
          <p>
            Billing documents with derived settlement. Payments and Refunds
            never rewrite the issued Invoice.
          </p>
        </div>
      </header>
      <div className="v2-finance-overview">
        <FinanceGrid
          grid="invoices"
          scope={sessionScope}
          organizationId={organizationId}
          rows={overview.data?.items ?? []}
          columns={invoiceColumns}
        />
      </div>
      {invoice && settlement && (
        <article className="v2-finance-detail">
          <header>
            <div>
              <button className="v2-finance-link" onClick={backToInvoices}>← All invoices</button>
              <span className={`v2-invoice-state ${invoice.lifecycle}`}>
                {invoice.lifecycle}
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
              {invoice.source !== "legacy" && invoice.lifecycle === "draft" && canIssue && (
                <button
                  className="v2-invoice-issue"
                  disabled={!csrfReady || issue.isPending}
                  onClick={() => issue.mutate()}
                >
                  Issue Invoice
                </button>
              )}
              {invoice.source !== "legacy" && invoice.lifecycle === "issued" && canPaymentRecord && (
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
              {invoice.source !== "legacy" && invoice.lifecycle === "issued" && canRefundIssue && (
                <button
                  className="v2-quiet-button"
                  disabled={
                    !csrfReady ||
                    !detail.data?.history.some(
                      (entry) => entry.kind === "payment",
                    )
                  }
                  onClick={() => setDialog("refund")}
                >
                  Record Refund
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
                  : "Draft Billing projection from the source Order."}
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
              <small>Balance</small>
              <strong>{money(settlement.balance)}</strong>
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
          aria-label={dialog === "payment" ? "Take Payment" : "Record Refund"}
        >
          <div>
            <header>
              <h2>{dialog === "payment" ? "Take Payment" : "Record Refund"}</h2>
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
            ) : (
              <label>
                Original Payment
                <select
                  aria-label="Original Payment"
                  value={paymentId}
                  onChange={(event) => setPaymentId(event.target.value)}
                >
                  <option value="">Select a Payment</option>
                  {detail.data?.history
                    .filter((entry) => entry.kind === "payment")
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {money(entry.amount)} · {entry.method ?? "payment"}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <p className="muted">
              {dialog === "payment"
                ? "Manual methods only. Card and ACH collection remain deferred; no raw card data is accepted."
                : "A Refund is a new immutable fact. It does not alter the original Payment."}
            </p>
            <button
              className="v2-invoice-issue"
              disabled={!csrfReady || payment.isPending || refund.isPending}
              onClick={() =>
                dialog === "payment" ? payment.mutate() : refund.mutate()
              }
            >
              {dialog === "payment" ? "Record Payment" : "Record Refund"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
