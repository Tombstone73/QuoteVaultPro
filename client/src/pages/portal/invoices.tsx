import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileText, Loader2, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTableColumnConfig, type ColumnConfig } from "@/hooks/useTableColumnConfig";
import { portalInvoicePdfUrl, usePortalInvoices, usePortalSession, type PortalInvoiceDto } from "@/hooks/usePortal";

export type PortalInvoiceInfoColumnId = "po" | "job" | "issued" | "due" | "amountDue" | "total" | "status";
export type PortalInvoiceSortKey = "invoice" | PortalInvoiceInfoColumnId;
export type PortalInvoiceSortPreference = { key: PortalInvoiceSortKey; direction: "asc" | "desc" };

export const DEFAULT_PORTAL_INVOICE_COLUMNS: ColumnConfig[] = [
  { id: "po", label: "PO #", visible: true, order: 0, required: true },
  { id: "job", label: "Job / Order", visible: true, order: 1, required: true },
  { id: "issued", label: "Issued", visible: true, order: 2, required: true },
  { id: "due", label: "Due", visible: true, order: 3, required: true },
  { id: "amountDue", label: "Amount Due", visible: true, order: 4, required: true },
  { id: "total", label: "Total", visible: true, order: 5, required: true },
  { id: "status", label: "Status", visible: true, order: 6, required: true },
];
export const DEFAULT_PORTAL_INVOICE_SORT: PortalInvoiceSortPreference = { key: "issued", direction: "desc" };
const VALID_SORT_KEYS = new Set<PortalInvoiceSortKey>(["invoice", "po", "job", "issued", "due", "amountDue", "total", "status"]);
const naturalCollator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

export const portalInvoiceSortStorageKey = (userId: string, customerId: string) => `portalInvoiceSort:user_${userId}:customer_${customerId}`;
export function readPortalInvoiceSortPreference(userId: string, customerId: string): PortalInvoiceSortPreference {
  try {
    const raw = localStorage.getItem(portalInvoiceSortStorageKey(userId, customerId));
    const value = raw ? JSON.parse(raw) : null;
    if (value && VALID_SORT_KEYS.has(value.key) && (value.direction === "asc" || value.direction === "desc")) return value;
  } catch {}
  return DEFAULT_PORTAL_INVOICE_SORT;
}
export function persistPortalInvoiceSortPreference(userId: string, customerId: string, preference: PortalInvoiceSortPreference) {
  try { localStorage.setItem(portalInvoiceSortStorageKey(userId, customerId), JSON.stringify(preference)); } catch {}
}
export function clearPortalInvoiceSortPreference(userId: string, customerId: string) {
  try { localStorage.removeItem(portalInvoiceSortStorageKey(userId, customerId)); } catch {}
}

function formatCurrency(amount: number, currency = "USD") {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount || 0)); }
  catch { return `$${Number(amount || 0).toFixed(2)}`; }
}
function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "paid") return "default";
  if (status === "overdue") return "destructive";
  if (status === "void") return "secondary";
  return "outline";
}
function invoiceLabel(invoice: PortalInvoiceDto) { return invoice.displayNumber || String(invoice.invoiceNumber); }
function jobOrOrderLabel(invoice: PortalInvoiceDto) { return invoice.jobLabel || (invoice.orderNumber ? `Order ${invoice.orderNumber}` : "—"); }
function timestamp(value: string | null) { const parsed = value ? new Date(value).getTime() : NaN; return Number.isFinite(parsed) ? parsed : null; }
function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function compareNullable<T>(left: T | null, right: T | null, compare: (a: T, b: T) => number, direction: "asc" | "desc") {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const result = compare(left, right);
  return direction === "asc" ? result : -result;
}

export function comparePortalInvoices(left: PortalInvoiceDto, right: PortalInvoiceDto, preference: PortalInvoiceSortPreference) {
  const text = (a: string, b: string) => naturalCollator.compare(a, b);
  const numeric = (a: number, b: number) => a - b;
  const direction = preference.direction;
  switch (preference.key) {
    case "invoice": {
      const byNumber = compareNullable(finiteNumber(left.numberCore) ?? finiteNumber(left.invoiceNumber), finiteNumber(right.numberCore) ?? finiteNumber(right.invoiceNumber), numeric, direction);
      return byNumber || compareNullable(invoiceLabel(left) || null, invoiceLabel(right) || null, text, direction);
    }
    case "po": return compareNullable(left.customerPoNumber?.trim() || null, right.customerPoNumber?.trim() || null, text, direction);
    case "job": return compareNullable(left.jobLabel?.trim() || (left.orderNumber ? `Order ${left.orderNumber}` : null), right.jobLabel?.trim() || (right.orderNumber ? `Order ${right.orderNumber}` : null), text, direction);
    case "issued": return compareNullable(timestamp(left.issueDate), timestamp(right.issueDate), numeric, direction);
    case "due": return compareNullable(timestamp(left.dueDate), timestamp(right.dueDate), numeric, direction);
    case "amountDue": return compareNullable(finiteNumber(left.amountDue), finiteNumber(right.amountDue), numeric, direction);
    case "total": return compareNullable(finiteNumber(left.total), finiteNumber(right.total), numeric, direction);
    case "status": {
      const byCanonical = compareNullable(left.status?.trim() || null, right.status?.trim() || null, text, direction);
      return byCanonical || compareNullable(left.paymentStatusLabel?.trim() || null, right.paymentStatusLabel?.trim() || null, text, direction);
    }
  }
}
export function sortPortalInvoices(invoices: PortalInvoiceDto[], preference: PortalInvoiceSortPreference) {
  return invoices.map((invoice, serverIndex) => ({ invoice, serverIndex }))
    .sort((a, b) => comparePortalInvoices(a.invoice, b.invoice, preference) || a.serverIndex - b.serverIndex)
    .map(({ invoice }) => invoice);
}
export function nextPortalInvoiceSort(current: PortalInvoiceSortPreference, key: PortalInvoiceSortKey): PortalInvoiceSortPreference {
  return { key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" };
}

function InvoiceActions({ invoice, mobile = false }: { invoice: PortalInvoiceDto; mobile?: boolean }) {
  const mobileClass = mobile ? "min-h-11 flex-1" : undefined;
  return <div className={`flex gap-2 ${mobile ? "w-full" : "justify-end"}`}>
    <Button asChild variant="outline" size="sm" className={mobileClass}><Link to={`/portal/invoices/${invoice.id}`}>View invoice</Link></Button>
    {invoice.pdfAvailable ? <Button asChild variant="ghost" size={mobile ? "sm" : "icon"} className={mobileClass} title="Download invoice PDF">
      <a href={portalInvoicePdfUrl(invoice.id, true)} target="_blank" rel="noreferrer" aria-label={`Download PDF for invoice ${invoiceLabel(invoice)}`}><Download className="h-4 w-4" />{mobile ? <span>Download</span> : null}</a>
    </Button> : null}
  </div>;
}

export function PortalInvoiceMobileCard({ invoice }: { invoice: PortalInvoiceDto }) {
  const job = jobOrOrderLabel(invoice);
  return <article className="border-b px-4 py-4 last:border-b-0 2xl:hidden">
    <div className="flex flex-wrap items-start justify-between gap-2"><Link to={`/portal/invoices/${invoice.id}`} className="font-semibold text-foreground hover:underline">Invoice {invoiceLabel(invoice)}</Link><Badge variant={statusVariant(invoice.status)}>{invoice.paymentStatusLabel}</Badge></div>
    <div className="mt-3 min-w-0 space-y-1 text-sm"><p className="break-words font-medium text-foreground" title={job}>{job}</p><p className="break-words text-muted-foreground">PO # {invoice.customerPoNumber || "—"}</p>{invoice.jobLabel && invoice.orderNumber ? <p className="text-muted-foreground">Order {invoice.orderNumber}</p> : null}</div>
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <div><dt className="text-muted-foreground">Issued</dt><dd className="mt-0.5 font-medium text-foreground">{formatDate(invoice.issueDate)}</dd></div><div><dt className="text-muted-foreground">Due</dt><dd className="mt-0.5 font-medium text-foreground">{formatDate(invoice.dueDate)}</dd></div>
      <div><dt className="text-muted-foreground">Amount due</dt><dd className="mt-0.5 font-semibold text-foreground">{formatCurrency(invoice.amountDue, invoice.currency)}</dd></div><div><dt className="text-muted-foreground">Total</dt><dd className="mt-0.5 font-medium text-foreground">{formatCurrency(invoice.total, invoice.currency)}</dd></div>
    </dl><div className="mt-4"><InvoiceActions invoice={invoice} mobile /></div>
  </article>;
}

const columnMeta: Record<PortalInvoiceInfoColumnId, { width: string; numeric?: boolean }> = {
  po: { width: "w-[10%]" }, job: { width: "w-[16%]" }, issued: { width: "w-[10%]" }, due: { width: "w-[10%]" }, amountDue: { width: "w-[11%]", numeric: true }, total: { width: "w-[10%]", numeric: true }, status: { width: "w-[10%]" },
};
function SortableHeader({ sortKey, label, preference, onSort, numeric = false }: { sortKey: PortalInvoiceSortKey; label: string; preference: PortalInvoiceSortPreference; onSort: (key: PortalInvoiceSortKey) => void; numeric?: boolean }) {
  const active = preference.key === sortKey;
  const Icon = active ? (preference.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return <th scope="col" aria-sort={active ? (preference.direction === "asc" ? "ascending" : "descending") : "none"} className={numeric ? "text-right" : undefined}>
    <button type="button" onClick={() => onSort(sortKey)} className={`flex w-full items-center gap-1.5 px-3 py-3 text-left font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${numeric ? "justify-end text-right" : ""}`}><span>{label}</span><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></button>
  </th>;
}
function InvoiceInfoCell({ column, invoice }: { column: PortalInvoiceInfoColumnId; invoice: PortalInvoiceDto }): ReactNode {
  const job = jobOrOrderLabel(invoice);
  switch (column) {
    case "po": return <td className="px-3 py-3 align-middle"><p className="truncate text-foreground" title={invoice.customerPoNumber || undefined}>{invoice.customerPoNumber || "—"}</p></td>;
    case "job": return <td className="min-w-0 px-3 py-3 align-middle"><p className="truncate font-medium text-foreground" title={job}>{job}</p>{invoice.jobLabel && invoice.orderNumber ? <p className="mt-0.5 truncate text-xs text-muted-foreground" title={`Order ${invoice.orderNumber}`}>Order {invoice.orderNumber}</p> : null}</td>;
    case "issued": return <td className="whitespace-nowrap px-3 py-3 align-middle text-foreground">{formatDate(invoice.issueDate)}</td>;
    case "due": return <td className="whitespace-nowrap px-3 py-3 align-middle text-foreground">{formatDate(invoice.dueDate)}</td>;
    case "amountDue": return <td className="whitespace-nowrap px-3 py-3 text-right align-middle font-semibold text-foreground">{formatCurrency(invoice.amountDue, invoice.currency)}</td>;
    case "total": return <td className="whitespace-nowrap px-3 py-3 text-right align-middle text-foreground">{formatCurrency(invoice.total, invoice.currency)}</td>;
    case "status": return <td className="px-3 py-3 align-middle"><Badge variant={statusVariant(invoice.status)}>{invoice.paymentStatusLabel}</Badge></td>;
  }
}

export function PortalInvoiceDesktopTable({ invoices, columns = DEFAULT_PORTAL_INVOICE_COLUMNS, preference = DEFAULT_PORTAL_INVOICE_SORT, onSort = () => undefined }: { invoices: PortalInvoiceDto[]; columns?: ColumnConfig[]; preference?: PortalInvoiceSortPreference; onSort?: (key: PortalInvoiceSortKey) => void }) {
  const infoColumns = columns.map((column) => column.id as PortalInvoiceInfoColumnId);
  return <div className="hidden 2xl:block"><table className="w-full min-w-[72rem] table-fixed" aria-label="Customer invoices">
    <colgroup><col className="w-[10%]" />{infoColumns.map((column) => <col key={column} className={columnMeta[column].width} />)}<col className="w-[13%]" /></colgroup>
    <thead><tr className="border-b bg-muted/30 text-left text-xs font-medium text-muted-foreground"><SortableHeader sortKey="invoice" label="Invoice" preference={preference} onSort={onSort} />{infoColumns.map((column) => <SortableHeader key={column} sortKey={column} label={DEFAULT_PORTAL_INVOICE_COLUMNS.find((item) => item.id === column)?.label || column} preference={preference} onSort={onSort} numeric={columnMeta[column].numeric} />)}<th scope="col" className="px-3 py-3 text-right">Actions</th></tr></thead>
    <tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-b text-sm last:border-b-0 hover:bg-muted/20"><td className="px-4 py-3 align-middle"><Link to={`/portal/invoices/${invoice.id}`} className="font-semibold text-foreground hover:underline">{invoiceLabel(invoice)}</Link></td>{infoColumns.map((column) => <InvoiceInfoCell key={column} column={column} invoice={invoice} />)}<td className="px-3 py-3 align-middle"><InvoiceActions invoice={invoice} /></td></tr>)}</tbody>
  </table></div>;
}

function PortalInvoicesContent({ invoices, userId, portalCustomerId }: { invoices: PortalInvoiceDto[]; userId: string; portalCustomerId: string }) {
  const columnConfig = useTableColumnConfig(`portal_invoices:user_${userId}:customer_${portalCustomerId}`, DEFAULT_PORTAL_INVOICE_COLUMNS);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [preference, setPreference] = useState<PortalInvoiceSortPreference>(() => readPortalInvoiceSortPreference(userId, portalCustomerId));
  const sortedInvoices = useMemo(() => sortPortalInvoices(invoices, preference), [invoices, preference]);
  const updateSort = (key: PortalInvoiceSortKey) => { const next = nextPortalInvoiceSort(preference, key); setPreference(next); persistPortalInvoiceSortPreference(userId, portalCustomerId, next); };
  const reset = () => { columnConfig.reset(); clearPortalInvoiceSortPreference(userId, portalCustomerId); setPreference(DEFAULT_PORTAL_INVOICE_SORT); };
  return <><Card>
    <div className="hidden items-center justify-end border-b px-3 py-2 2xl:flex"><Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setColumnsOpen(true)}><Settings2 className="h-4 w-4" aria-hidden="true" />Columns</Button></div>
    <CardContent className="p-0"><PortalInvoiceDesktopTable invoices={sortedInvoices} columns={columnConfig.columns} preference={preference} onSort={updateSort} /><div className="2xl:hidden">{sortedInvoices.map((invoice) => <PortalInvoiceMobileCard key={invoice.id} invoice={invoice} />)}</div></CardContent>
  </Card><Dialog open={columnsOpen} onOpenChange={setColumnsOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Invoice columns</DialogTitle><DialogDescription>Choose the order of the informational columns. Invoice and Actions stay anchored.</DialogDescription></DialogHeader>
    <div className="space-y-2">{columnConfig.columns.map((column) => <div key={column.id} className="flex items-center gap-2 rounded-md border px-3 py-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{column.label}</span><Button type="button" size="sm" variant="ghost" className="h-8 px-2" disabled={!columnConfig.canMoveColumn(column.id, "up")} onClick={() => columnConfig.moveColumn(column.id, "up")} aria-label={`Move ${column.label} up`}><ArrowUp className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Up</Button><Button type="button" size="sm" variant="ghost" className="h-8 px-2" disabled={!columnConfig.canMoveColumn(column.id, "down")} onClick={() => columnConfig.moveColumn(column.id, "down")} aria-label={`Move ${column.label} down`}><ArrowDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Down</Button></div>)}</div>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={reset}>Reset to default</Button><Button type="button" onClick={() => setColumnsOpen(false)}>Done</Button></div>
  </DialogContent></Dialog></>;
}

export default function PortalInvoicesPage() {
  const { data: invoices = [], isLoading: invoicesLoading, error: invoicesError } = usePortalInvoices();
  const { data: session, isLoading: sessionLoading, error: sessionError } = usePortalSession();
  if (invoicesLoading || sessionLoading) return <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const error = invoicesError || sessionError;
  return <div className="mx-auto w-full max-w-screen-2xl space-y-6"><div><h1 className="text-2xl font-semibold tracking-normal">Invoices</h1><p className="mt-1 text-sm text-muted-foreground">Review balances, payment history, and available invoice documents.</p></div>
    {error || !session ? <Card><CardContent className="py-10 text-center"><p className="font-medium text-destructive">Could not load invoices</p><p className="mt-1 text-sm text-muted-foreground">{(error as Error | undefined)?.message || "Portal session unavailable."}</p></CardContent></Card>
      : invoices.length === 0 ? <Card><CardContent className="flex flex-col items-center justify-center py-14 text-center"><FileText className="mb-3 h-9 w-9 text-muted-foreground" /><p className="font-medium">No invoices yet</p><p className="mt-1 text-sm text-muted-foreground">Invoices will appear here when they are ready for you.</p></CardContent></Card>
      : <PortalInvoicesContent key={`${session.userId}:${session.customerId}`} invoices={invoices} userId={session.userId} portalCustomerId={session.customerId} />}
  </div>;
}
