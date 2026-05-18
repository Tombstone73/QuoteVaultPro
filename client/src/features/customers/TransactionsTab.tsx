/**
 * TransactionsTab
 *
 * Replaces the dead StatementTab. Fetches from GET /api/customers/:id/transactions
 * and renders a full transaction history view with:
 *   - Date range filter (preset)
 *   - Type filter
 *   - Search
 *   - Sort (newest/oldest)
 *   - Pagination
 *   - Summary cards: invoiced, paid, open balance, credits
 *   - Transaction table with deep-link rows
 *
 * Backend owns all totals/summaries — no client-side accounting math.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  FileText,
  ShoppingCart,
  Receipt,
  DollarSign,
  CreditCard,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface TransactionRow {
  id: string;
  date: string;
  type: "quote" | "order" | "invoice" | "payment" | "refund" | "credit" | "adjustment" | "charge";
  referenceNumber: string;
  description: string;
  status: string;
  amount: string;
  balanceImpact: string | null;
  method: string | null;
  linkType: "quote" | "order" | "invoice" | null;
  linkId: string | null;
}

interface TransactionSummary {
  invoicedTotal: string;
  paidTotal: string;
  refundedTotal: string;
  openBalance: string;
  creditsTotal: string;
}

interface TransactionPagination {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface TransactionsResponse {
  rows: TransactionRow[];
  summary: TransactionSummary;
  pagination: TransactionPagination;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

function formatDate(iso: string): string {
  try {
    return format(new Date(iso), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

const TYPE_LABELS: Record<string, string> = {
  quote: "Quote",
  order: "Order",
  invoice: "Invoice",
  payment: "Payment",
  refund: "Refund",
  credit: "Credit",
  adjustment: "Adjustment",
  charge: "Charge",
};

const TYPE_STYLES: Record<string, string> = {
  quote: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  order: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  invoice: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  payment: "bg-titan-success/15 text-titan-success border-titan-success/30",
  refund: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  credit: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  adjustment: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  charge: "bg-titan-error/15 text-titan-error border-titan-error/30",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  quote: FileText,
  order: ShoppingCart,
  invoice: Receipt,
  payment: DollarSign,
  refund: ArrowDown,
  credit: CreditCard,
  adjustment: CreditCard,
  charge: DollarSign,
};

// Map preset date range to ISO date strings
function presetToDates(preset: string): { dateFrom: string | null; dateTo: string | null } {
  const now = new Date();
  switch (preset) {
    case "30d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      return { dateFrom: from.toISOString().slice(0, 10), dateTo: null };
    }
    case "90d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 90);
      return { dateFrom: from.toISOString().slice(0, 10), dateTo: null };
    }
    case "ytd": {
      return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: null };
    }
    case "lastyear": {
      const y = now.getFullYear() - 1;
      return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` };
    }
    default:
      return { dateFrom: null, dateTo: null };
  }
}

// ── Summary Card ───────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon: Icon,
  variant = "default",
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  variant?: "default" | "success" | "warning" | "accent";
}) {
  const valueClass =
    variant === "success"
      ? "text-titan-success"
      : variant === "warning"
        ? "text-titan-warning"
        : variant === "accent"
          ? "text-titan-accent"
          : "text-titan-text-primary";

  return (
    <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg px-4 py-3 flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-titan-text-muted" />
        <span className="text-[10px] font-medium text-titan-text-muted uppercase tracking-wider truncate">
          {label}
        </span>
      </div>
      <div className={cn("text-lg font-bold leading-tight", valueClass)}>{value}</div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface TransactionsTabProps {
  customerId: string;
  customer: CustomerWithRelations;
}

export default function TransactionsTab({ customerId, customer }: TransactionsTabProps) {
  const navigate = useNavigate();

  // Filter state
  const [datePreset, setDatePreset] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Derive date range from preset
  const { dateFrom, dateTo } = useMemo(() => presetToDates(datePreset), [datePreset]);

  // Build query params
  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (search.trim()) p.set("search", search.trim());
    if (typeFilter !== "all") p.set("type", typeFilter);
    p.set("sort", sort);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return p.toString();
  }, [dateFrom, dateTo, search, typeFilter, sort, page]);

  const { data, isLoading, isError } = useQuery<TransactionsResponse>({
    queryKey: [`/api/customers/${customerId}/transactions`, queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${customerId}/transactions?${queryParams}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
    enabled: !!customerId,
    staleTime: 30_000,
  });

  // Reset page when filters change
  const handleFilterChange = (cb: () => void) => {
    cb();
    setPage(1);
  };

  // Deep-link helper
  const handleRowClick = (row: TransactionRow) => {
    if (!row.linkId || !row.linkType) return;
    switch (row.linkType) {
      case "quote":
        navigate(ROUTES.quotes.detail(row.linkId));
        break;
      case "order":
        navigate(ROUTES.orders.detail(row.linkId));
        break;
      case "invoice":
        navigate(ROUTES.invoices.detail(row.linkId));
        break;
    }
  };

  const summary = data?.summary;
  const pagination = data?.pagination;
  const rows = data?.rows ?? [];

  return (
    <div className="p-4 space-y-4">
      {/* Summary Cards */}
      <div className="flex gap-3 flex-wrap">
        <SummaryCard
          label="Invoiced"
          value={summary ? formatCurrency(summary.invoicedTotal) : "—"}
          icon={Receipt}
          variant="accent"
        />
        <SummaryCard
          label="Paid"
          value={summary ? formatCurrency(summary.paidTotal) : "—"}
          icon={DollarSign}
          variant="success"
        />
        {summary && parseFloat(summary.refundedTotal) > 0 && (
          <SummaryCard
            label="Refunded"
            value={formatCurrency(summary.refundedTotal)}
            icon={ArrowDown}
            variant="warning"
          />
        )}
        <SummaryCard
          label="Open Balance"
          value={summary ? formatCurrency(summary.openBalance) : "—"}
          icon={FileText}
          variant="warning"
        />
        <SummaryCard
          label="Credits"
          value={summary ? formatCurrency(summary.creditsTotal) : "—"}
          icon={CreditCard}
        />
      </div>

      {/* Filters Bar */}
      <div className="flex items-center gap-2 flex-wrap bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg p-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-titan-text-muted" />
          <Input
            placeholder="Search transactions…"
            value={search}
            onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
            disabled={isLoading}
            className="pl-9 h-9 text-sm bg-titan-bg-card-elevated border-titan-border-subtle text-titan-text-primary"
          />
        </div>

        {/* Date Range */}
        <Select
          value={datePreset}
          onValueChange={(v) => handleFilterChange(() => setDatePreset(v))}
          disabled={isLoading}
        >
          <SelectTrigger className="h-9 w-[140px] text-sm bg-titan-bg-card-elevated border-titan-border-subtle text-titan-text-primary">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-titan-bg-card border-titan-border">
            <SelectItem value="all" className="text-titan-text-primary">All time</SelectItem>
            <SelectItem value="30d" className="text-titan-text-primary">Last 30 days</SelectItem>
            <SelectItem value="90d" className="text-titan-text-primary">Last 90 days</SelectItem>
            <SelectItem value="ytd" className="text-titan-text-primary">This year</SelectItem>
            <SelectItem value="lastyear" className="text-titan-text-primary">Last year</SelectItem>
          </SelectContent>
        </Select>

        {/* Type Filter */}
        <Select
          value={typeFilter}
          onValueChange={(v) => handleFilterChange(() => setTypeFilter(v))}
          disabled={isLoading}
        >
          <SelectTrigger className="h-9 w-[140px] text-sm bg-titan-bg-card-elevated border-titan-border-subtle text-titan-text-primary">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-titan-bg-card border-titan-border">
            <SelectItem value="all" className="text-titan-text-primary">All types</SelectItem>
            <SelectItem value="quote" className="text-titan-text-primary">Quotes</SelectItem>
            <SelectItem value="order" className="text-titan-text-primary">Orders</SelectItem>
            <SelectItem value="invoice" className="text-titan-text-primary">Invoices</SelectItem>
            <SelectItem value="payment" className="text-titan-text-primary">Payments</SelectItem>
            <SelectItem value="refund" className="text-titan-text-primary">Refunds</SelectItem>
            <SelectItem value="credit" className="text-titan-text-primary">Credits</SelectItem>
            <SelectItem value="adjustment" className="text-titan-text-primary">Adjustments</SelectItem>
            <SelectItem value="charge" className="text-titan-text-primary">Charges</SelectItem>
          </SelectContent>
        </Select>

        {/* Sort Toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleFilterChange(() => setSort((s) => (s === "desc" ? "asc" : "desc")))}
          disabled={isLoading}
          className="h-9 gap-1.5 border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated text-xs"
        >
          {sort === "desc" ? (
            <>
              <ArrowDown className="w-3 h-3" />
              Newest
            </>
          ) : (
            <>
              <ArrowUp className="w-3 h-3" />
              Oldest
            </>
          )}
        </Button>

        {/* Reset filters */}
        {(search || typeFilter !== "all" || datePreset !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setTypeFilter("all");
              setDatePreset("all");
              setPage(1);
            }}
            className="h-9 text-xs text-titan-text-muted hover:text-titan-text-primary"
          >
            Reset filters
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-titan-text-secondary gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading transactions…</span>
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-16 text-titan-error gap-2">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">Failed to load transactions.</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-titan-text-secondary">
          <Receipt className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No transactions found for {customer.companyName}.</p>
          {(search || typeFilter !== "all" || datePreset !== "all") && (
            <Button
              variant="link"
              size="sm"
              className="mt-1 text-titan-accent text-xs"
              onClick={() => {
                setSearch("");
                setTypeFilter("all");
                setDatePreset("all");
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider w-[110px]">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider w-[100px]">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider w-[120px]">
                  Reference #
                </th>
                <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider w-[100px]">
                  Method
                </th>
                <th className="px-4 py-3 text-right text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider w-[110px]">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider w-[100px]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const TypeIcon = TYPE_ICONS[row.type] ?? Receipt;
                const typeLabelStr = TYPE_LABELS[row.type] ?? row.type;
                const typeStyle = TYPE_STYLES[row.type] ?? "bg-titan-bg-card-elevated text-titan-text-secondary border-titan-border-subtle";
                const isClickable = !!row.linkId;

                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-titan-border-subtle last:border-0 transition-colors",
                      isClickable && "cursor-pointer hover:bg-titan-bg-table-row",
                    )}
                    onClick={() => handleRowClick(row)}
                  >
                    <td className="px-4 py-3 text-titan-xs text-titan-text-secondary whitespace-nowrap">
                      {formatDate(row.date)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                          typeStyle,
                        )}
                      >
                        <TypeIcon className="w-3 h-3" />
                        {typeLabelStr}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="text-titan-xs font-mono text-titan-accent">
                          {row.referenceNumber}
                        </span>
                        {isClickable && (
                          <ExternalLink className="w-3 h-3 text-titan-text-muted/50 flex-shrink-0" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-titan-xs text-titan-text-primary truncate max-w-[220px] block">
                        {row.description}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-titan-xs text-titan-text-secondary capitalize">
                      {row.method
                        ? row.method.replace(/_/g, " ")
                        : <span className="text-titan-text-muted/50">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={cn(
                          "text-titan-xs font-semibold",
                          row.type === "payment" || row.type === "credit"
                            ? "text-titan-success"
                            : row.type === "refund" || row.type === "charge"
                              ? "text-titan-error"
                              : "text-titan-text-primary",
                        )}
                      >
                        {row.type === "payment" || row.type === "credit"
                          ? `+${formatCurrency(row.amount)}`
                          : row.type === "refund" || row.type === "charge"
                            ? `-${formatCurrency(row.amount)}`
                            : formatCurrency(row.amount)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] capitalize text-titan-text-secondary">
                        {row.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-titan-xs text-titan-text-muted">
            Showing {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              disabled={!pagination.hasPreviousPage}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-titan-text-secondary px-2">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              disabled={!pagination.hasNextPage}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
