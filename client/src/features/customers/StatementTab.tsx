/**
 * StatementTab
 *
 * Customer account statement: open jobs, completed jobs, invoices, and optionally quotes.
 *
 * Fetches from GET /api/customers/:id/statement
 *
 * Philosophy:
 * - Backend owns ALL totals and section data.
 * - Frontend only renders the backend response.
 * - No client-side accounting math.
 * - This is a job/account statement, not a line-item ledger.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  Briefcase,
  CheckCircle2,
  Receipt,
  DollarSign,
  AlertTriangle,
  CreditCard,
  RotateCcw,
  Search,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  AlertCircle,
  FileText,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/config/routes";
import type { CustomerWithRelations } from "@/hooks/useCustomer";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CustomerIdentity {
  customerId: string;
  companyName: string;
  primaryContact: { firstName: string; lastName: string; email: string | null; phone: string | null } | null;
  email: string | null;
  phone: string | null;
  billingAddress: {
    street1: string | null;
    street2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
}

interface OrderStatementRow {
  orderId: string;
  orderNumber: string;
  poNumber: string | null;
  date: string;
  dueDate: string | null;
  completedAt: string | null;
  status: string;
  description: string | null;
  total: string;
  invoiceStatus: string | null;
  invoiceNumber: number | null;
  balanceDue: string | null;
  linkId: string;
}

interface InvoiceStatementRow {
  invoiceId: string;
  invoiceNumber: number;
  issueDate: string;
  dueDate: string | null;
  status: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  customerPoNumber: string | null;
  relatedOrderNumber: number | null;
  orderId: string | null;
  linkId: string;
}

interface QuoteStatementRow {
  quoteId: string;
  quoteNumber: number | null;
  createdAt: string;
  status: string;
  total: string;
  description: string | null;
  linkId: string;
}

interface StatementSummary {
  openOrderCount: number;
  completedOrderCount: number;
  openOrderTotal: string;
  completedOrderTotal: string;
  invoicedTotal: string;
  paidTotal: string;
  outstandingBalance: string;
  creditTotal: string;
  refundTotal: string;
}

interface StatementResponse {
  customer: CustomerIdentity;
  filtersEcho: {
    dateFrom: string | null;
    dateTo: string | null;
    status: string;
    search: string;
    includeInvoices: boolean;
    includeQuotes: boolean;
  };
  sections: {
    openOrders: OrderStatementRow[];
    completedOrders: OrderStatementRow[];
    invoices: InvoiceStatementRow[] | null;
    quotes: QuoteStatementRow[] | null;
  };
  summary: StatementSummary;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(val: string | number | null | undefined): string {
  const n = typeof val === "string" ? parseFloat(val) : (val ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return format(new Date(iso), "MMM d, yyyy"); } catch { return "—"; }
}

const DATE_PRESETS = [
  { label: "All time",    value: "all" },
  { label: "This month",  value: "month" },
  { label: "Last 3 mo",   value: "3mo" },
  { label: "Last 6 mo",   value: "6mo" },
  { label: "This year",   value: "year" },
  { label: "Last year",   value: "lastyear" },
] as const;

function presetToDates(preset: string): { dateFrom: string | null; dateTo: string | null } {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  if (preset === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: iso(from), dateTo: iso(now) };
  }
  if (preset === "3mo") {
    const from = new Date(now); from.setMonth(now.getMonth() - 3);
    return { dateFrom: iso(from), dateTo: iso(now) };
  }
  if (preset === "6mo") {
    const from = new Date(now); from.setMonth(now.getMonth() - 6);
    return { dateFrom: iso(from), dateTo: iso(now) };
  }
  if (preset === "year") {
    const from = new Date(now.getFullYear(), 0, 1);
    return { dateFrom: iso(from), dateTo: iso(now) };
  }
  if (preset === "lastyear") {
    const prev = now.getFullYear() - 1;
    return { dateFrom: `${prev}-01-01`, dateTo: `${prev}-12-31` };
  }
  return { dateFrom: null, dateTo: null }; // "all"
}

const STATUS_LABELS: Record<string, string> = {
  open:               "Open",
  production_complete: "In Production",
  closed:             "Closed",
  new:                "New",
  in_production:      "In Production",
  on_hold:            "On Hold",
  ready_for_shipment: "Ready",
  completed:          "Completed",
  canceled:           "Canceled",
};

const INVOICE_STATUS_STYLES: Record<string, string> = {
  draft:         "bg-slate-500/15 text-slate-400 border-slate-500/30",
  billed:        "bg-blue-500/15 text-blue-400 border-blue-500/30",
  sent:          "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  paid:          "bg-green-500/15 text-green-400 border-green-500/30",
  partially_paid:"bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  overdue:       "bg-red-500/15 text-red-400 border-red-500/30",
  void:          "bg-slate-700/30 text-slate-500 border-slate-700/30",
};

const ORDER_STATE_STYLES: Record<string, string> = {
  open:                "bg-blue-500/15 text-blue-400 border-blue-500/30",
  production_complete: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  closed:              "bg-green-500/15 text-green-400 border-green-500/30",
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  subtext,
  icon: Icon,
  variant = "default",
}: {
  label: string;
  value: string;
  subtext?: string;
  icon: React.ElementType;
  variant?: "default" | "accent" | "success" | "warning" | "danger";
}) {
  const variantStyles = {
    default: "text-titan-text-primary",
    accent:  "text-blue-400",
    success: "text-green-400",
    warning: "text-yellow-400",
    danger:  "text-red-400",
  };
  const iconStyles = {
    default: "bg-slate-700/50 text-slate-300",
    accent:  "bg-blue-500/20 text-blue-400",
    success: "bg-green-500/20 text-green-400",
    warning: "bg-yellow-500/20 text-yellow-400",
    danger:  "bg-red-500/20 text-red-400",
  };
  return (
    <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg p-4 min-w-[140px] flex-1">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-titan-xs font-medium text-titan-text-secondary uppercase tracking-wider">{label}</div>
        <div className={cn("w-7 h-7 rounded-titan-md flex items-center justify-center shrink-0", iconStyles[variant])}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div className={cn("text-titan-lg font-bold leading-tight", variantStyles[variant])}>{value}</div>
      {subtext && <div className="text-titan-xs text-titan-text-secondary mt-0.5">{subtext}</div>}
    </div>
  );
}

function StatusBadge({ status, styleMap }: { status: string; styleMap: Record<string, string> }) {
  const style = styleMap[status] || "bg-slate-700/30 text-slate-400 border-slate-700/30";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-titan-xs font-semibold border", style)}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function SectionHeader({
  title,
  count,
  total,
  icon: Icon,
  expanded,
  onToggle,
}: {
  title: string;
  count: number;
  total?: string | null;
  icon: React.ElementType;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 bg-titan-bg-card-elevated border border-titan-border-subtle rounded-titan-lg hover:bg-slate-800/60 transition-colors"
    >
      <div className="flex items-center gap-3">
        <Icon className="w-4 h-4 text-titan-text-secondary" />
        <span className="text-titan-sm font-semibold text-titan-text-primary">{title}</span>
        <span className="text-titan-xs bg-slate-700/60 text-titan-text-secondary px-2 py-0.5 rounded-full">{count}</span>
        {total && (
          <span className="text-titan-xs font-semibold text-titan-text-primary">{total}</span>
        )}
      </div>
      {expanded ? (
        <ChevronDown className="w-4 h-4 text-titan-text-secondary" />
      ) : (
        <ChevronRight className="w-4 h-4 text-titan-text-secondary" />
      )}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-titan-sm text-titan-text-secondary">{message}</p>
    </div>
  );
}

function OpenOrdersSection({
  rows,
  statusFilter,
}: {
  rows: OrderStatementRow[];
  statusFilter: string;
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);

  if (statusFilter === "completed") return null;

  return (
    <div className="space-y-2">
      <SectionHeader
        title="Open Jobs"
        count={rows.length}
        total={rows.length > 0 ? formatCurrency(rows.reduce((s, r) => s + parseFloat(r.total || "0"), 0)) : null}
        icon={Briefcase}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <div className="border border-titan-border-subtle rounded-titan-lg overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState message="No open jobs for this customer." />
          ) : (
            <table className="w-full text-titan-sm">
              <thead>
                <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Order</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">PO #</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Description</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Due</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Total</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-titan-border-subtle">
                {rows.map((row) => (
                  <tr
                    key={row.orderId}
                    className="hover:bg-titan-bg-card-elevated/50 cursor-pointer transition-colors"
                    onClick={() => navigate(ROUTES.orders.detail(row.linkId))}
                  >
                    <td className="px-4 py-3 font-medium text-blue-400">
                      <div className="flex items-center gap-1.5">
                        ORD-{row.orderNumber}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-titan-text-secondary">{row.poNumber || "—"}</td>
                    <td className="px-4 py-3 text-titan-text-secondary max-w-[200px] truncate">{row.description || "—"}</td>
                    <td className="px-4 py-3 text-titan-text-secondary">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-titan-text-secondary">{formatDate(row.dueDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} styleMap={ORDER_STATE_STYLES} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-titan-text-primary">{formatCurrency(row.total)}</td>
                    <td className="px-4 py-3">
                      {row.invoiceStatus ? (
                        <StatusBadge status={row.invoiceStatus} styleMap={INVOICE_STATUS_STYLES} />
                      ) : (
                        <span className="text-titan-text-secondary text-titan-xs">Not billed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function CompletedOrdersSection({
  rows,
  statusFilter,
}: {
  rows: OrderStatementRow[];
  statusFilter: string;
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  if (statusFilter === "open") return null;

  return (
    <div className="space-y-2">
      <SectionHeader
        title="Completed Jobs"
        count={rows.length}
        total={rows.length > 0 ? formatCurrency(rows.reduce((s, r) => s + parseFloat(r.total || "0"), 0)) : null}
        icon={CheckCircle2}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <div className="border border-titan-border-subtle rounded-titan-lg overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState message="No completed jobs match your filters." />
          ) : (
            <table className="w-full text-titan-sm">
              <thead>
                <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Order</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">PO #</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Description</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Completed</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Total</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Invoice</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-titan-border-subtle">
                {rows.map((row) => (
                  <tr
                    key={row.orderId}
                    className="hover:bg-titan-bg-card-elevated/50 cursor-pointer transition-colors"
                    onClick={() => navigate(ROUTES.orders.detail(row.linkId))}
                  >
                    <td className="px-4 py-3 font-medium text-blue-400">
                      <div className="flex items-center gap-1.5">
                        ORD-{row.orderNumber}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-titan-text-secondary">{row.poNumber || "—"}</td>
                    <td className="px-4 py-3 text-titan-text-secondary max-w-[200px] truncate">{row.description || "—"}</td>
                    <td className="px-4 py-3 text-titan-text-secondary">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-titan-text-secondary">{formatDate(row.completedAt)}</td>
                    <td className="px-4 py-3 font-semibold text-titan-text-primary">{formatCurrency(row.total)}</td>
                    <td className="px-4 py-3">
                      {row.invoiceStatus ? (
                        <StatusBadge status={row.invoiceStatus} styleMap={INVOICE_STATUS_STYLES} />
                      ) : (
                        <span className="text-titan-text-secondary text-titan-xs">Not billed</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.balanceDue != null ? (
                        <span className={cn(
                          "font-semibold",
                          parseFloat(row.balanceDue) > 0 ? "text-red-400" : "text-green-400",
                        )}>
                          {formatCurrency(row.balanceDue)}
                        </span>
                      ) : (
                        <span className="text-titan-text-secondary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function InvoicesSection({ rows, includeInvoices }: { rows: InvoiceStatementRow[] | null; includeInvoices: boolean }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);

  if (!includeInvoices) {
    return (
      <div className="border border-dashed border-titan-border-subtle rounded-titan-lg px-4 py-3 text-titan-sm text-titan-text-secondary text-center">
        Invoices hidden.
      </div>
    );
  }
  if (!rows) return null;

  return (
    <div className="space-y-2">
      <SectionHeader
        title="Invoices"
        count={rows.length}
        total={rows.length > 0 ? formatCurrency(rows.reduce((s, r) => s + parseFloat(r.total || "0"), 0)) : null}
        icon={Receipt}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <div className="border border-titan-border-subtle rounded-titan-lg overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState message="No invoices match your filters." />
          ) : (
            <table className="w-full text-titan-sm">
              <thead>
                <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Invoice</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">PO #</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Issued</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Due</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Order</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Total</th>
                  <th className="text-right px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Paid</th>
                  <th className="text-right px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-titan-border-subtle">
                {rows.map((inv) => (
                  <tr
                    key={inv.invoiceId}
                    className="hover:bg-titan-bg-card-elevated/50 cursor-pointer transition-colors"
                    onClick={() => navigate(ROUTES.invoices.detail(inv.linkId))}
                  >
                    <td className="px-4 py-3 font-medium text-blue-400">
                      <div className="flex items-center gap-1.5">
                        INV-{inv.invoiceNumber}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-titan-text-secondary">{inv.customerPoNumber || "—"}</td>
                    <td className="px-4 py-3 text-titan-text-secondary">{formatDate(inv.issueDate)}</td>
                    <td className="px-4 py-3 text-titan-text-secondary">{formatDate(inv.dueDate)}</td>
                    <td className="px-4 py-3 text-titan-text-secondary">
                      {inv.relatedOrderNumber ? `ORD-${inv.relatedOrderNumber}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.status} styleMap={INVOICE_STATUS_STYLES} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-titan-text-primary">{formatCurrency(inv.total)}</td>
                    <td className="px-4 py-3 text-right text-green-400">{formatCurrency(inv.amountPaid)}</td>
                    <td className={cn(
                      "px-4 py-3 text-right font-semibold",
                      parseFloat(inv.balanceDue) > 0 ? "text-red-400" : "text-green-400",
                    )}>
                      {formatCurrency(inv.balanceDue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function QuotesSection({ rows, includeQuotes }: { rows: QuoteStatementRow[] | null; includeQuotes: boolean }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  if (!includeQuotes) {
    return (
      <div className="border border-dashed border-titan-border-subtle rounded-titan-lg px-4 py-3 text-titan-sm text-titan-text-secondary text-center">
        Quotes hidden.
      </div>
    );
  }
  if (!rows) return null;

  return (
    <div className="space-y-2">
      <SectionHeader
        title="Quotes"
        count={rows.length}
        total={null}
        icon={FileText}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <div className="border border-titan-border-subtle rounded-titan-lg overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState message="No quotes match your filters." />
          ) : (
            <table className="w-full text-titan-sm">
              <thead>
                <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Quote</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Description</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-2.5 text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wider">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-titan-border-subtle">
                {rows.map((q) => (
                  <tr
                    key={q.quoteId}
                    className="hover:bg-titan-bg-card-elevated/50 cursor-pointer transition-colors"
                    onClick={() => navigate(ROUTES.quotes.detail(q.linkId))}
                  >
                    <td className="px-4 py-3 font-medium text-blue-400">
                      <div className="flex items-center gap-1.5">
                        {q.quoteNumber != null ? `Q-${q.quoteNumber}` : "Draft"}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-titan-text-secondary max-w-[200px] truncate">{q.description || "—"}</td>
                    <td className="px-4 py-3 text-titan-text-secondary">{formatDate(q.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-titan-xs font-semibold border bg-amber-500/15 text-amber-400 border-amber-500/30">
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-titan-text-primary">{formatCurrency(q.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function StatementTab({
  customerId,
}: {
  customerId: string;
  customer?: CustomerWithRelations;
}) {
  // ── Filters ─────────────────────────────────────────────────────────────────
  const [datePreset, setDatePreset]           = useState("all");
  const [statusFilter, setStatusFilter]       = useState<"open" | "completed" | "all">("all");
  const [search, setSearch]                   = useState("");
  const [includeInvoices, setIncludeInvoices] = useState(true);
  const [includeQuotes, setIncludeQuotes]     = useState(false);

  const { dateFrom, dateTo } = presetToDates(datePreset);

  // ── Build query string ────────────────────────────────────────────────────
  const params = new URLSearchParams();
  if (dateFrom)        params.set("dateFrom", dateFrom);
  if (dateTo)          params.set("dateTo", dateTo);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search)          params.set("search", search);
  if (!includeInvoices) params.set("includeInvoices", "false");
  if (includeQuotes)   params.set("includeQuotes", "true");

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
  } = useQuery<StatementResponse>({
    queryKey: ["/api", "customers", customerId, "statement", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${customerId}/statement?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Statement fetch failed: ${res.status}`);
      return res.json() as Promise<StatementResponse>;
    },
    staleTime: 30_000,
  });

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-titan-text-secondary gap-3">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-titan-sm">Loading statement…</span>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="flex items-center justify-center py-12 gap-3 text-red-400">
        <AlertCircle className="w-5 h-5" />
        <span className="text-titan-sm">
          {isError ? (error as Error).message : "No statement data returned."}
        </span>
      </div>
    );
  }

  const { sections, summary } = data;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-4">

      {/* ── Filter Bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg p-3">
        {/* Date preset */}
        <Select value={datePreset} onValueChange={setDatePreset} disabled={isFetching}>
          <SelectTrigger className="w-[130px] h-9 text-sm bg-titan-bg-card-elevated border-titan-border-subtle text-titan-text-primary rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-titan-bg-card border-titan-border">
            {DATE_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-titan-text-primary">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "open" | "completed" | "all")} disabled={isFetching}>
          <SelectTrigger className="w-[140px] h-9 text-sm bg-titan-bg-card-elevated border-titan-border-subtle text-titan-text-primary rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-titan-bg-card border-titan-border">
            <SelectItem value="all" className="text-titan-text-primary">All Jobs</SelectItem>
            <SelectItem value="open" className="text-titan-text-primary">Open Only</SelectItem>
            <SelectItem value="completed" className="text-titan-text-primary">Completed Only</SelectItem>
          </SelectContent>
        </Select>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-titan-text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={isFetching}
            placeholder="Order #, PO #, Invoice #, description…"
            className="pl-9 h-9 text-sm bg-titan-bg-card-elevated border-titan-border-subtle text-titan-text-primary placeholder:text-titan-text-muted rounded-lg"
          />
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="stmt-include-invoices"
              checked={includeInvoices}
              onCheckedChange={setIncludeInvoices}
              disabled={isFetching}
            />
            <Label htmlFor="stmt-include-invoices" className="text-titan-xs text-titan-text-secondary cursor-pointer">
              Invoices
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="stmt-include-quotes"
              checked={includeQuotes}
              onCheckedChange={setIncludeQuotes}
              disabled={isFetching}
            />
            <Label htmlFor="stmt-include-quotes" className="text-titan-xs text-titan-text-secondary cursor-pointer">
              Quotes
            </Label>
          </div>
        </div>

        {/* Reset filters */}
        {(datePreset !== "all" || statusFilter !== "all" || search || !includeInvoices || includeQuotes) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDatePreset("all");
              setStatusFilter("all");
              setSearch("");
              setIncludeInvoices(true);
              setIncludeQuotes(false);
            }}
            className="h-9 text-xs text-titan-text-muted hover:text-titan-text-primary"
          >
            Reset filters
          </Button>
        )}
      </div>

      {/* ── Summary Cards ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <SummaryCard
          label="Open Jobs"
          value={String(summary.openOrderCount)}
          subtext={formatCurrency(summary.openOrderTotal)}
          icon={Briefcase}
          variant="accent"
        />
        <SummaryCard
          label="Completed"
          value={String(summary.completedOrderCount)}
          subtext={formatCurrency(summary.completedOrderTotal)}
          icon={CheckCircle2}
          variant="success"
        />
        <SummaryCard
          label="Invoiced"
          value={formatCurrency(summary.invoicedTotal)}
          icon={Receipt}
          variant="accent"
        />
        <SummaryCard
          label="Paid"
          value={formatCurrency(summary.paidTotal)}
          icon={DollarSign}
          variant="success"
        />
        <SummaryCard
          label="Outstanding"
          value={formatCurrency(summary.outstandingBalance)}
          icon={AlertTriangle}
          variant={parseFloat(summary.outstandingBalance) > 0 ? "warning" : "default"}
        />
        {parseFloat(summary.creditTotal) > 0 && (
          <SummaryCard
            label="Credits"
            value={formatCurrency(summary.creditTotal)}
            icon={CreditCard}
          />
        )}
        {parseFloat(summary.refundTotal) > 0 && (
          <SummaryCard
            label="Refunds"
            value={formatCurrency(summary.refundTotal)}
            icon={RotateCcw}
            variant="warning"
          />
        )}
      </div>

      {/* ── Sections ─────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <OpenOrdersSection rows={sections.openOrders} statusFilter={statusFilter} />
        <CompletedOrdersSection rows={sections.completedOrders} statusFilter={statusFilter} />
        <InvoicesSection rows={sections.invoices} includeInvoices={includeInvoices} />
        <QuotesSection rows={sections.quotes} includeQuotes={includeQuotes} />
      </div>
    </div>
  );
}
