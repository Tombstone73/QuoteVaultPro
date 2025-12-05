import { useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { formatDistanceToNow, format } from "date-fns";
import {
  Building2,
  Mail,
  Phone,
  MapPin,
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  Clock,
  Star,
  FileText,
  ShoppingCart,
  Search,
  Eye,
  Download,
  MoreHorizontal,
  Package,
  Edit,
  ArrowLeft,
  Receipt,
  Users,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomer, type CustomerWithRelations } from "@/hooks/useCustomer";
import { useOrders, type Order } from "@/hooks/useOrders";
import { useInvoices } from "@/hooks/useInvoices";
import { ROUTES } from "@/config/routes";
import { cn } from "@/lib/utils";

// ============================================================
// TYPE DEFINITIONS
// ============================================================

type TabType = "orders" | "quotes" | "invoices" | "statement";
type TimePeriod = "month" | "year" | "all";
type LayoutMode = "full" | "embedded";

interface EnhancedCustomerViewProps {
  customerId: string;
  layoutMode?: LayoutMode;
  onBack?: () => void;
}

interface StatCardConfig {
  key: string;
  label: string;
  value: string | number;
  trend?: number | null;
  trendType?: "up" | "down";
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  highlight?: boolean;
  subtext?: string;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num || 0);
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "MMM d, yyyy");
  } catch {
    return "-";
  }
}

function getStatusStyle(status: string): string {
  const s = (status || "").toLowerCase().replace(/_/g, "");
  switch (s) {
    case "completed":
    case "paid":
      return "bg-titan-success-bg text-titan-success border-titan-success/30";
    case "inproduction":
    case "new":
    case "scheduled":
    case "sent":
      return "bg-titan-accent/15 text-titan-accent border-titan-accent/30";
    case "shipped":
    case "delivered":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "readyforpickup":
      return "bg-teal-500/15 text-teal-400 border-teal-500/30";
    case "onhold":
    case "pending":
    case "draft":
    case "pendingapproval":
      return "bg-titan-warning-bg text-titan-warning border-titan-warning/30";
    case "canceled":
    case "rejected":
    case "overdue":
      return "bg-titan-error-bg text-titan-error border-titan-error/30";
    default:
      return "bg-titan-bg-card-elevated text-titan-text-secondary border-titan-border-subtle";
  }
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function CustomerHeader({
  customer,
  layoutMode,
  onBack,
}: {
  customer: CustomerWithRelations;
  layoutMode: LayoutMode;
  onBack?: () => void;
}) {
  const primaryContact = customer.contacts?.find((c) => c.isPrimary) || customer.contacts?.[0];
  const navigate = useNavigate();

  const formattedAddress = useMemo(() => {
    const parts = [
      customer.shippingAddressLine1,
      customer.shippingAddressLine2,
      [customer.shippingCity, customer.shippingState, customer.shippingZipCode]
        .filter(Boolean)
        .join(", "),
    ].filter(Boolean);
    return parts.join(", ") || "No address on file";
  }, [customer]);

  const lastContactDate = customer.updatedAt || customer.createdAt;
  const daysAgo = lastContactDate
    ? formatDistanceToNow(new Date(lastContactDate), { addSuffix: false })
    : "Unknown";

  const isEmbedded = layoutMode === "embedded";

  return (
    <div className={cn(
      "bg-titan-bg-card border border-titan-border-subtle shadow-titan-card",
      isEmbedded ? "rounded-titan-lg p-4" : "rounded-titan-xl p-5"
    )}>
      <div className={cn(
        "flex items-center justify-between",
        isEmbedded && "flex-wrap gap-4"
      )}>
        {/* Left side - Customer info */}
        <div className="flex items-center gap-4">
          {layoutMode === "full" && (
            <Button
              variant="ghost"
              size="icon"
              className="mr-2 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              onClick={() => onBack ? onBack() : navigate(ROUTES.customers.list)}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
          )}
          <div className={cn(
            "bg-titan-bg-card-elevated rounded-titan-lg flex items-center justify-center",
            isEmbedded ? "w-10 h-10" : "w-14 h-14"
          )}>
            <Building2 className={cn(
              "text-titan-text-secondary",
              isEmbedded ? "w-5 h-5" : "w-7 h-7"
            )} />
          </div>
          <div>
            <h2 className={cn(
              "font-semibold text-titan-text-primary",
              isEmbedded ? "text-titan-lg" : "text-titan-xl"
            )}>
              {customer.companyName}
            </h2>
            {primaryContact && (
              <p className="text-titan-sm text-titan-text-secondary">
                {primaryContact.firstName} {primaryContact.lastName}
              </p>
            )}
            {!isEmbedded && (
              <div className="flex items-center gap-4 mt-1.5 text-titan-xs text-titan-text-muted">
                {(primaryContact?.email || customer.email) && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3 h-3" />
                    {primaryContact?.email || customer.email}
                  </span>
                )}
                {(primaryContact?.phone || customer.phone) && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-3 h-3" />
                    {primaryContact?.phone || customer.phone}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3" />
                  <span className="max-w-[300px] truncate">{formattedAddress}</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right side - Key metrics */}
        <div className={cn(
          "flex items-center",
          isEmbedded ? "gap-4" : "gap-8"
        )}>
          {!isEmbedded && (
            <div className="text-right">
              <div className="text-titan-xs text-titan-text-muted uppercase tracking-wider mb-1">
                Account #
              </div>
              <div className="text-titan-sm font-medium text-titan-text-primary">
                {customer.id.slice(0, 12).toUpperCase()}
              </div>
            </div>
          )}
          <div className="text-right">
            <div className="text-titan-xs text-titan-text-muted uppercase tracking-wider mb-1">
              Credit Limit
            </div>
            <div className="text-titan-sm font-medium text-titan-text-primary">
              {formatCurrency(customer.creditLimit)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-titan-xs text-titan-text-muted uppercase tracking-wider mb-1">
              Current Balance
            </div>
            <div className="text-titan-sm font-medium text-titan-success">
              {formatCurrency(customer.currentBalance)}
            </div>
          </div>
          {!isEmbedded && (
            <div className="text-right">
              <div className="text-titan-xs text-titan-text-muted uppercase tracking-wider mb-1">
                Last Contact
              </div>
              <div className="text-titan-sm font-medium text-titan-text-primary">
                {formatDate(lastContactDate)}
              </div>
              <div className="text-titan-xs text-titan-text-muted">{daysAgo} ago</div>
            </div>
          )}
          <Button 
            variant="secondary" 
            size="sm"
            className="bg-titan-bg-card-elevated border border-titan-border text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-highlight text-titan-sm rounded-titan-md"
          >
            <Edit className="w-4 h-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ stat, compact }: { stat: StatCardConfig; compact?: boolean }) {
  const IconComponent = stat.icon;
  const isPositive = stat.trendType === "up";

  return (
    <div
      className={cn(
        "rounded-titan-lg border transition-all",
        compact ? "p-3" : "p-4",
        stat.highlight
          ? "bg-titan-accent/10 border-titan-accent/20"
          : "bg-titan-bg-card border-titan-border-subtle"
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-titan-xs font-medium text-titan-text-muted uppercase tracking-wider">
          {stat.label}
        </span>
        <div
          className={cn(
            "rounded-titan-md flex items-center justify-center",
            compact ? "w-6 h-6" : "w-8 h-8",
            stat.iconBg
          )}
        >
          <IconComponent className={cn("text-white", compact ? "w-3 h-3" : "w-4 h-4")} />
        </div>
      </div>
      <div className={cn(
        "font-bold text-titan-text-primary mb-1",
        compact ? "text-titan-lg" : "text-titan-2xl"
      )}>
        {stat.value}
      </div>
      {stat.trend !== undefined && stat.trend !== null && (
        <div
          className={cn(
            "flex items-center gap-1 text-titan-xs",
            isPositive ? "text-titan-success" : "text-titan-error"
          )}
        >
          {isPositive ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {Math.abs(stat.trend).toFixed(1)}%
          <span className="text-titan-text-muted ml-1">vs prev month</span>
        </div>
      )}
      {stat.subtext && (
        <div className="text-titan-xs text-titan-text-muted truncate">{stat.subtext}</div>
      )}
    </div>
  );
}

function CustomerStatsGrid({
  customer,
  orders,
  quotes,
  invoices,
  period,
  layoutMode,
}: {
  customer: CustomerWithRelations;
  orders: Order[];
  quotes: any[];
  invoices: any[];
  period: TimePeriod;
  layoutMode: LayoutMode;
}) {
  const isEmbedded = layoutMode === "embedded";

  const stats = useMemo<StatCardConfig[]>(() => {
    const totalSales = orders.reduce(
      (sum, o) => sum + parseFloat(o.total || "0"),
      0
    );
    const avgOrder = orders.length > 0 ? totalSales / orders.length : 0;
    const pendingQuotes = quotes.filter(
      (q) => q.status === "pending_approval" || q.status === "draft"
    ).length;

    const lastActivity = [...orders, ...quotes]
      .map((item) => new Date(item.createdAt))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const lastContactStr = lastActivity
      ? formatDistanceToNow(lastActivity, { addSuffix: false })
      : "Never";

    const baseStats: StatCardConfig[] = [
      {
        key: "quotes",
        label: "QUOTES",
        value: quotes.length.toString(),
        trend: 8.5,
        trendType: "up" as const,
        icon: FileText,
        iconBg: "bg-amber-500",
      },
      {
        key: "orders",
        label: "ORDERS",
        value: orders.length.toString(),
        trend: 15.2,
        trendType: "up" as const,
        icon: ShoppingCart,
        iconBg: "bg-purple-500",
      },
      {
        key: "sales",
        label: "SALES",
        value: `$${(totalSales / 1000).toFixed(1)}k`,
        trend: 12.3,
        trendType: "up" as const,
        icon: DollarSign,
        iconBg: "bg-teal-500",
      },
      {
        key: "avgOrder",
        label: "AVG ORDER",
        value: `$${(avgOrder / 1000).toFixed(1)}k`,
        trend: -2.1,
        trendType: "down" as const,
        icon: TrendingUp,
        iconBg: "bg-blue-500",
      },
    ];

    if (isEmbedded) {
      return baseStats;
    }

    return [
      ...baseStats,
      {
        key: "pending",
        label: "PENDING QUOTES",
        value: pendingQuotes.toString(),
        icon: Clock,
        iconBg: "bg-orange-500",
        highlight: true,
      },
      {
        key: "lastContact",
        label: "LAST CONTACT",
        value: lastContactStr,
        subtext: "Follow-up recommended",
        icon: Calendar,
        iconBg: "bg-pink-500",
        highlight: true,
      },
      {
        key: "rank",
        label: "CUSTOMER RANK",
        value: "#12",
        subtext: "of 247",
        icon: Star,
        iconBg: "bg-emerald-500",
        highlight: true,
      },
    ];
  }, [customer, orders, quotes, invoices, period, isEmbedded]);

  return (
    <div className={cn(
      "grid gap-3",
      isEmbedded ? "grid-cols-4" : "grid-cols-7"
    )}>
      {stats.map((stat) => (
        <StatCard key={stat.key} stat={stat} compact={isEmbedded} />
      ))}
    </div>
  );
}

function OrdersTable({
  orders,
  searchQuery,
  statusFilter,
  compact,
}: {
  orders: Order[];
  searchQuery: string;
  statusFilter: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch =
        !searchQuery ||
        order.orderNumber?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || order.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [orders, searchQuery, statusFilter]);

  if (filteredOrders.length === 0) {
    return (
      <div className="py-12 text-center text-titan-text-secondary">
        No orders found
      </div>
    );
  }

  return (
    <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Order #
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Date
            </th>
            {!compact && (
              <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                Product
              </th>
            )}
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Amount
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredOrders.map((order: any) => {
            const lineItems = order.lineItems || [];
            const firstProduct = lineItems[0]?.description || lineItems[0]?.productName || "—";

            return (
              <tr
                key={order.id}
                className="border-b border-titan-border-subtle last:border-0 hover:bg-titan-bg-table-row transition-colors cursor-pointer"
                onClick={() => navigate(ROUTES.orders.detail(order.id))}
              >
                <td className="px-4 py-3">
                  <span className="text-titan-sm font-medium text-titan-accent">
                    {order.orderNumber}
                  </span>
                </td>
                <td className="px-4 py-3 text-titan-sm text-titan-text-secondary">
                  {formatDate(order.createdAt)}
                </td>
                {!compact && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-purple-500/20 rounded-titan-sm flex items-center justify-center">
                        <Package className="w-3 h-3 text-purple-400" />
                      </div>
                      <span className="text-titan-sm text-titan-text-primary truncate max-w-[200px]">
                        {firstProduct}
                      </span>
                    </div>
                  </td>
                )}
                <td className="px-4 py-3 text-titan-sm font-medium text-titan-success">
                  {formatCurrency(order.total)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-titan-xs font-medium border",
                      getStatusStyle(order.status)
                    )}
                  >
                    {formatStatusLabel(order.status)}
                  </span>
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
                      onClick={() => navigate(ROUTES.orders.detail(order.id))}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {!compact && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated">
                          <Download className="w-4 h-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-titan-bg-card border-titan-border">
                            <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Send Email</DropdownMenuItem>
                            <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Duplicate</DropdownMenuItem>
                            <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Print</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function QuotesTable({
  quotes,
  searchQuery,
  statusFilter,
  compact,
}: {
  quotes: any[];
  searchQuery: string;
  statusFilter: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();

  const filteredQuotes = useMemo(() => {
    return quotes.filter((quote) => {
      const matchesSearch =
        !searchQuery ||
        String(quote.quoteNumber)?.includes(searchQuery);
      const matchesStatus =
        statusFilter === "all" || quote.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [quotes, searchQuery, statusFilter]);

  if (filteredQuotes.length === 0) {
    return (
      <div className="py-12 text-center text-titan-text-secondary">
        No quotes found
      </div>
    );
  }

  return (
    <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Quote #
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Date
            </th>
            {!compact && (
              <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                Description
              </th>
            )}
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Total
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredQuotes.map((quote: any) => {
            const firstLine = quote.lineItems?.[0]?.description || "Quote items";

            return (
              <tr
                key={quote.id}
                className="border-b border-titan-border-subtle last:border-0 hover:bg-titan-bg-table-row transition-colors cursor-pointer"
                onClick={() => navigate(ROUTES.quotes.detail(quote.id))}
              >
                <td className="px-4 py-3">
                  <span className="text-titan-sm font-medium text-titan-accent">
                    Q-{quote.quoteNumber}
                  </span>
                </td>
                <td className="px-4 py-3 text-titan-sm text-titan-text-secondary">
                  {formatDate(quote.createdAt)}
                </td>
                {!compact && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-amber-500/20 rounded-titan-sm flex items-center justify-center">
                        <FileText className="w-3 h-3 text-amber-400" />
                      </div>
                      <span className="text-titan-sm text-titan-text-primary truncate max-w-[250px]">
                        {firstLine}
                      </span>
                    </div>
                  </td>
                )}
                <td className="px-4 py-3 text-titan-sm font-medium text-titan-success">
                  {formatCurrency(quote.totalPrice)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-titan-xs font-medium border",
                      getStatusStyle(quote.status || "draft")
                    )}
                  >
                    {formatStatusLabel(quote.status || "draft")}
                  </span>
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
                      onClick={() => navigate(ROUTES.quotes.detail(quote.id))}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {!compact && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated">
                          <Download className="w-4 h-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-titan-bg-card border-titan-border">
                            <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Convert to Order</DropdownMenuItem>
                            <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Send Email</DropdownMenuItem>
                            <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Duplicate</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesTable({
  invoices,
  searchQuery,
  statusFilter,
  compact,
}: {
  invoices: any[];
  searchQuery: string;
  statusFilter: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const matchesSearch =
        !searchQuery ||
        inv.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || inv.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [invoices, searchQuery, statusFilter]);

  if (filteredInvoices.length === 0) {
    return (
      <div className="py-12 text-center text-titan-text-secondary">
        No invoices found
      </div>
    );
  }

  return (
    <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Invoice #
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Date
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Total
            </th>
            {!compact && (
              <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                Balance
              </th>
            )}
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredInvoices.map((inv: any) => (
            <tr
              key={inv.id}
              className="border-b border-titan-border-subtle last:border-0 hover:bg-titan-bg-table-row transition-colors cursor-pointer"
              onClick={() => navigate(ROUTES.invoices.detail(inv.id))}
            >
              <td className="px-4 py-3">
                <span className="text-titan-sm font-medium text-titan-accent">
                  {inv.invoiceNumber}
                </span>
              </td>
              <td className="px-4 py-3 text-titan-sm text-titan-text-secondary">
                {formatDate(inv.createdAt)}
              </td>
              <td className="px-4 py-3 text-titan-sm font-medium text-titan-text-primary">
                {formatCurrency(inv.total)}
              </td>
              {!compact && (
                <td className="px-4 py-3 text-titan-sm font-medium text-titan-warning">
                  {formatCurrency(inv.balanceDue || inv.total)}
                </td>
              )}
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-titan-xs font-medium border",
                    getStatusStyle(inv.status)
                  )}
                >
                  {formatStatusLabel(inv.status)}
                </span>
              </td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
                    onClick={() => navigate(ROUTES.invoices.detail(inv.id))}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  {!compact && (
                    <>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated">
                        <Download className="w-4 h-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-titan-bg-card border-titan-border">
                          <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Apply Payment</DropdownMenuItem>
                          <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Send Email</DropdownMenuItem>
                          <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Print</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatementTab({ customer }: { customer: CustomerWithRelations }) {
  return (
    <div className="py-12 text-center">
      <Receipt className="w-12 h-12 text-titan-text-secondary mx-auto mb-4" />
      <h3 className="text-titan-lg font-medium text-titan-text-primary mb-2">
        Statement View
      </h3>
      <p className="text-titan-text-secondary mb-4">
        A summary of all invoices and payments for {customer.companyName}.
      </p>
      <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
        <div className="bg-titan-bg-card-elevated rounded-titan-lg p-4">
          <div className="text-titan-sm text-titan-text-secondary">Credit Limit</div>
          <div className="text-titan-xl font-bold text-titan-text-primary">
            {formatCurrency(customer.creditLimit)}
          </div>
        </div>
        <div className="bg-titan-bg-card-elevated rounded-titan-lg p-4">
          <div className="text-titan-sm text-titan-text-secondary">Current Balance</div>
          <div className="text-titan-xl font-bold text-titan-text-primary">
            {formatCurrency(customer.currentBalance)}
          </div>
        </div>
        <div className="bg-titan-bg-card-elevated rounded-titan-lg p-4">
          <div className="text-titan-sm text-titan-text-secondary">Available Credit</div>
          <div className="text-titan-xl font-bold text-titan-success">
            {formatCurrency(customer.availableCredit)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LOADING SKELETON
// ============================================================

function LoadingSkeleton({ layoutMode }: { layoutMode: LayoutMode }) {
  const isEmbedded = layoutMode === "embedded";

  return (
    <div className={cn("space-y-6", isEmbedded ? "p-4" : "p-6")}>
      {/* Header skeleton */}
      <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl p-5">
        <div className="flex items-center gap-4">
          <Skeleton className="w-14 h-14 rounded-titan-lg bg-titan-bg-card-elevated" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48 bg-titan-bg-card-elevated" />
            <Skeleton className="h-4 w-32 bg-titan-bg-card-elevated" />
            <Skeleton className="h-3 w-64 bg-titan-bg-card-elevated" />
          </div>
        </div>
      </div>

      {/* Stats skeleton */}
      <div className={cn("grid gap-3", isEmbedded ? "grid-cols-4" : "grid-cols-7")}>
        {Array.from({ length: isEmbedded ? 4 : 7 }).map((_, i) => (
          <div key={i} className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg p-4">
            <div className="flex justify-between mb-3">
              <Skeleton className="h-3 w-16 bg-titan-bg-card-elevated" />
              <Skeleton className="h-8 w-8 rounded-titan-md bg-titan-bg-card-elevated" />
            </div>
            <Skeleton className="h-8 w-20 mb-1 bg-titan-bg-card-elevated" />
            <Skeleton className="h-3 w-24 bg-titan-bg-card-elevated" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl p-4">
        <div className="flex gap-2 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-titan-md bg-titan-bg-card-elevated" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded bg-titan-bg-card-elevated" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function EnhancedCustomerView({
  customerId,
  layoutMode = "full",
  onBack,
}: EnhancedCustomerViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>("orders");
  const [period, setPeriod] = useState<TimePeriod>("month");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const isEmbedded = layoutMode === "embedded";

  // Data fetching
  const { data: customer, isLoading: isLoadingCustomer } = useCustomer(customerId);
  const { data: orders = [], isLoading: isLoadingOrders } = useOrders({
    customerId,
  });
  const { data: invoices = [], isLoading: isLoadingInvoices } = useInvoices({
    customerId,
  });

  // Quotes from customer data
  const quotes = customer?.quotes || [];

  // Tab configuration with counts
  const tabs = [
    { key: "orders" as const, label: "Orders", count: orders.length },
    { key: "quotes" as const, label: "Quotes", count: quotes.length },
    { key: "invoices" as const, label: "Invoices", count: invoices.length },
    ...(!isEmbedded ? [{ key: "statement" as const, label: "Statement" }] : []),
  ];

  // Loading state
  if (isLoadingCustomer) {
    return <LoadingSkeleton layoutMode={layoutMode} />;
  }

  // Not found state
  if (!customer) {
    return (
      <div className={cn(
        "flex items-center justify-center",
        isEmbedded ? "p-4 min-h-[300px]" : "p-6 min-h-[400px]"
      )}>
        <div className="text-center">
          <Building2 className="w-16 h-16 text-titan-text-secondary mx-auto mb-4" />
          <h2 className="text-titan-xl font-semibold text-titan-text-primary mb-2">
            Customer Not Found
          </h2>
          <p className="text-titan-text-secondary mb-4">
            The customer you're looking for doesn't exist or has been removed.
          </p>
          {!isEmbedded && (
            <Link to={ROUTES.customers.list}>
              <Button className="bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Customers
              </Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "space-y-6 max-w-[1600px]",
      isEmbedded ? "p-4" : "p-6"
    )}>
      {/* Customer Header Card */}
      <CustomerHeader customer={customer} layoutMode={layoutMode} onBack={onBack} />

      {/* Dashboard Overview Header - hide in embedded for space */}
      {!isEmbedded && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h3 className="text-titan-base font-semibold text-titan-text-primary">
              Dashboard Overview
            </h3>
            <div className="flex items-center gap-1 bg-titan-bg-card-elevated rounded-titan-md p-1">
              {(["month", "year", "all"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-3 py-1.5 rounded-titan-sm text-titan-xs font-medium transition-colors",
                    period === p
                      ? "bg-titan-bg-card text-titan-text-primary shadow-titan-sm"
                      : "text-titan-text-secondary hover:text-titan-text-primary"
                  )}
                >
                  {p === "month"
                    ? "This Month"
                    : p === "year"
                    ? "This Year"
                    : "All Time"}
                </button>
              ))}
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
          >
            <Users className="w-4 h-4 mr-2" />
            {customer.contacts?.length || 0} Contacts
          </Button>
        </div>
      )}

      {/* Stats Cards Grid */}
      <CustomerStatsGrid
        customer={customer}
        orders={orders}
        quotes={quotes}
        invoices={invoices}
        period={period}
        layoutMode={layoutMode}
      />

      {/* Activity Section */}
      <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden shadow-titan-card">
        {/* Tabs */}
        <div className="flex items-center gap-2 p-4 border-b border-titan-border-subtle bg-titan-bg-card-elevated">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setSearchQuery("");
                setStatusFilter("all");
              }}
              className={cn(
                "px-4 py-2 rounded-titan-md text-titan-sm font-medium flex items-center gap-2 transition-colors",
                activeTab === tab.key
                  ? "bg-titan-accent text-white"
                  : "text-titan-text-secondary hover:bg-titan-bg-card-highlight hover:text-titan-text-primary"
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "text-titan-xs px-1.5 py-0.5 rounded-full",
                    activeTab === tab.key
                      ? "bg-white/20"
                      : "bg-titan-bg-card-elevated"
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Filter Bar - only show for data tabs */}
        {activeTab !== "statement" && (
          <div className="flex items-center justify-between p-4 border-b border-titan-border-subtle">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-titan-text-muted" />
              <Input
                type="text"
                placeholder={`Search ${activeTab}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn(
                  "pl-9 bg-titan-bg-input border-titan-border-subtle text-titan-text-primary placeholder:text-titan-text-muted rounded-titan-md",
                  isEmbedded ? "w-48" : "w-64"
                )}
              />
            </div>
            <div className="flex items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] bg-titan-bg-card-elevated border-titan-border-subtle text-titan-text-primary rounded-titan-md">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent className="bg-titan-bg-card border-titan-border">
                  <SelectItem value="all" className="text-titan-text-primary">All Status</SelectItem>
                  {activeTab === "orders" && (
                    <>
                      <SelectItem value="new" className="text-titan-text-primary">New</SelectItem>
                      <SelectItem value="in_production" className="text-titan-text-primary">In Production</SelectItem>
                      <SelectItem value="completed" className="text-titan-text-primary">Completed</SelectItem>
                      <SelectItem value="shipped" className="text-titan-text-primary">Shipped</SelectItem>
                    </>
                  )}
                  {activeTab === "quotes" && (
                    <>
                      <SelectItem value="draft" className="text-titan-text-primary">Draft</SelectItem>
                      <SelectItem value="pending_approval" className="text-titan-text-primary">Pending</SelectItem>
                      <SelectItem value="approved" className="text-titan-text-primary">Approved</SelectItem>
                      <SelectItem value="rejected" className="text-titan-text-primary">Rejected</SelectItem>
                    </>
                  )}
                  {activeTab === "invoices" && (
                    <>
                      <SelectItem value="draft" className="text-titan-text-primary">Draft</SelectItem>
                      <SelectItem value="sent" className="text-titan-text-primary">Sent</SelectItem>
                      <SelectItem value="paid" className="text-titan-text-primary">Paid</SelectItem>
                      <SelectItem value="overdue" className="text-titan-text-primary">Overdue</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <div className={cn("min-h-[300px]", isEmbedded && "min-h-[200px]")}>
          {activeTab === "orders" && (
            isLoadingOrders ? (
              <div className="p-8 text-center text-titan-text-secondary">
                Loading orders...
              </div>
            ) : (
              <OrdersTable
                orders={orders}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                compact={isEmbedded}
              />
            )
          )}
          {activeTab === "quotes" && (
            <QuotesTable
              quotes={quotes}
              searchQuery={searchQuery}
              statusFilter={statusFilter}
              compact={isEmbedded}
            />
          )}
          {activeTab === "invoices" && (
            isLoadingInvoices ? (
              <div className="p-8 text-center text-titan-text-secondary">
                Loading invoices...
              </div>
            ) : (
              <InvoicesTable
                invoices={invoices}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                compact={isEmbedded}
              />
            )
          )}
          {activeTab === "statement" && <StatementTab customer={customer} />}
        </div>
      </div>
    </div>
  );
}
