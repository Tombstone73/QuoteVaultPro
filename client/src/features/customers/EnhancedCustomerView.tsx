import { useState, useMemo, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { formatDistanceToNow, format } from "date-fns";
import CustomerForm from "@/components/customer-form";
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
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  GripVertical,
  Settings2,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
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
  const [showEditForm, setShowEditForm] = useState(false);
  const primaryContact = customer.contacts?.find((c) => c.isPrimary) || customer.contacts?.[0];
  const navigate = useNavigate();

  const cityState = useMemo(() => {
    const parts = [customer.shippingCity, customer.shippingState]
      .filter(Boolean)
      .join(", ");
    return parts || null;
  }, [customer]);

  const isEmbedded = layoutMode === "embedded";
  
  // Generate account number display (show first 12 chars of ID, or hide if empty/null)
  const accountNumber = customer.id ? customer.id.slice(0, 12).toUpperCase() : null;

  return (
    <div className={cn(
      "bg-titan-bg-card border border-titan-border-subtle shadow-titan-card",
      isEmbedded ? "rounded-titan-lg p-4" : "rounded-titan-xl p-4"
    )}>
      <div className="flex items-start justify-between gap-6">
        {/* LEFT: Company & Contact Info */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {layoutMode === "full" && (
            <Button
              variant="ghost"
              size="icon"
              className="flex-shrink-0 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              onClick={() => onBack ? onBack() : navigate(ROUTES.customers.list)}
              aria-label="Back to customers"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
          )}
          
          {!isEmbedded && (
            <div className="flex-shrink-0 w-10 h-10 bg-titan-bg-card-elevated rounded-full flex items-center justify-center">
              <Building2 className="w-5 h-5 text-titan-text-secondary" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* Company Name */}
            <h2 className={cn(
              "font-bold text-titan-text-primary leading-tight",
              isEmbedded ? "text-titan-lg" : "text-2xl"
            )}>
              {customer.companyName}
            </h2>
            
            {/* Primary Contact Name */}
            {primaryContact && (
              <p className="text-titan-sm font-medium text-titan-text-secondary mt-0.5">
                {primaryContact.firstName} {primaryContact.lastName}
              </p>
            )}
            
            {/* Contact Details (email, phone, location) */}
            {!isEmbedded && (
              <div className="flex items-center gap-3 mt-1.5 text-titan-xs text-titan-text-muted flex-wrap">
                {(primaryContact?.email || customer.email) && (
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate max-w-[200px]">{primaryContact?.email || customer.email}</span>
                  </span>
                )}
                {(primaryContact?.phone || customer.phone) && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3 flex-shrink-0" />
                    {primaryContact?.phone || customer.phone}
                  </span>
                )}
                {cityState && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    {cityState}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Financial Tags + Edit Icon */}
        <div className="flex items-start gap-4 flex-shrink-0">
          {/* Financial Info Pills */}
          <div className={cn(
            "flex gap-4",
            isEmbedded ? "flex-row" : "flex-col"
          )}>
            {/* Account Number - only show if exists */}
            {!isEmbedded && accountNumber && (
              <div className="text-right">
                <div className="text-[10px] text-titan-text-muted uppercase tracking-wide mb-0.5">
                  Account #
                </div>
                <div className="text-xs font-semibold text-titan-text-primary">
                  {accountNumber}
                </div>
              </div>
            )}
            
            {/* Credit Limit */}
            <div className="text-right">
              <div className="text-[10px] text-titan-text-muted uppercase tracking-wide mb-0.5">
                Credit Limit
              </div>
              <div className="text-xs font-semibold text-titan-text-primary">
                {formatCurrency(customer.creditLimit)}
              </div>
            </div>
            
            {/* Current Balance */}
            <div className="text-right">
              <div className="text-[10px] text-titan-text-muted uppercase tracking-wide mb-0.5">
                Balance
              </div>
              <div className="text-xs font-semibold text-titan-success">
                {formatCurrency(customer.currentBalance)}
              </div>
            </div>
          </div>

          {/* Edit Icon Button */}
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setShowEditForm(true)}
            className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-md flex-shrink-0"
            aria-label="Edit company"
          >
            <Edit className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      <CustomerForm 
        open={showEditForm} 
        onOpenChange={setShowEditForm}
        customer={customer}
      />
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
        compact ? "p-2" : "p-3",
        stat.highlight
          ? "bg-titan-accent/10 border-titan-accent/20"
          : "bg-titan-bg-card border-titan-border-subtle"
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-medium text-titan-text-muted uppercase tracking-wider">
          {stat.label}
        </span>
        <div
          className={cn(
            "rounded-titan-md flex items-center justify-center",
            compact ? "w-5 h-5" : "w-6 h-6",
            stat.iconBg
          )}
        >
          <IconComponent className={cn("text-white", compact ? "w-2.5 h-2.5" : "w-3 h-3")} />
        </div>
      </div>
      <div className={cn(
        "font-bold text-titan-text-primary mb-0.5",
        compact ? "text-titan-base" : "text-titan-xl"
      )}>
        {stat.value}
      </div>
      {stat.trend !== undefined && stat.trend !== null && (
        <div
          className={cn(
            "flex items-center gap-1 text-[10px]",
            isPositive ? "text-titan-success" : "text-titan-error"
          )}
        >
          {isPositive ? (
            <TrendingUp className="w-2.5 h-2.5" />
          ) : (
            <TrendingDown className="w-2.5 h-2.5" />
          )}
          {Math.abs(stat.trend).toFixed(1)}%
          <span className="text-titan-text-muted ml-1">vs prev month</span>
        </div>
      )}
      {stat.subtext && (
        <div className="text-[10px] text-titan-text-muted truncate">{stat.subtext}</div>
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
  onPeriodChange,
}: {
  customer: CustomerWithRelations;
  orders: Order[];
  quotes: any[];
  invoices: any[];
  period: TimePeriod;
  layoutMode: LayoutMode;
  onPeriodChange: (p: TimePeriod) => void;
}) {
  const isEmbedded = layoutMode === "embedded";

  // Load visible stats from localStorage
  const [visibleStats, setVisibleStats] = useState<string[]>(() => {
    if (isEmbedded) return ["quotes", "orders", "sales", "avgOrder"];
    try {
      const saved = localStorage.getItem("customer_stats_visible");
      return saved ? JSON.parse(saved) : ["quotes", "orders", "sales", "avgOrder", "pending", "lastContact", "rank"];
    } catch {
      return ["quotes", "orders", "sales", "avgOrder", "pending", "lastContact", "rank"];
    }
  });

  // Persist visible stats to localStorage
  useEffect(() => {
    if (!isEmbedded) {
      localStorage.setItem("customer_stats_visible", JSON.stringify(visibleStats));
    }
  }, [visibleStats, isEmbedded]);

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

  // Filter stats based on visibility
  const visibleStatsData = stats.filter((stat) => visibleStats.includes(stat.key));

  // All possible stat keys for the visibility controls
  const allStatKeys = stats.map((s) => ({ key: s.key, label: s.label }));

  const toggleStatVisibility = (key: string) => {
    setVisibleStats((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const selectAllStats = () => {
    setVisibleStats(allStatKeys.map((s) => s.key));
  };

  const resetStatsVisibility = () => {
    setVisibleStats(["quotes", "orders", "sales", "avgOrder", "pending", "lastContact", "rank"]);
  };

  return (
    <div className={cn(
      "grid gap-2",
      isEmbedded ? "grid-cols-4" : "grid-cols-7"
    )}>
      {/* First slot: Overview Controls Card (only in full mode) */}
      {!isEmbedded && (
        <div
          className="rounded-titan-lg border bg-titan-bg-card border-titan-border-subtle p-3 flex flex-col justify-between"
        >
          {/* Top row: Overview label + settings gear */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-medium text-titan-text-muted uppercase tracking-wider">
              OVERVIEW
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button className="w-6 h-6 rounded-titan-md bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors">
                  <Settings2 className="w-3 h-3 text-white" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3 bg-titan-bg-card border-titan-border" align="start">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-titan-text-primary">Visible Stats</h4>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={selectAllStats}
                        className="h-6 px-2 text-xs text-titan-text-secondary hover:text-titan-text-primary"
                      >
                        All
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={resetStatsVisibility}
                        className="h-6 px-2 text-xs text-titan-text-secondary hover:text-titan-text-primary"
                      >
                        Reset
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {allStatKeys.map((stat) => (
                      <div key={stat.key} className="flex items-center gap-2">
                        <Checkbox
                          id={`stat-${stat.key}`}
                          checked={visibleStats.includes(stat.key)}
                          onCheckedChange={() => toggleStatVisibility(stat.key)}
                        />
                        <label
                          htmlFor={`stat-${stat.key}`}
                          className="text-sm text-titan-text-primary cursor-pointer flex-1"
                        >
                          {stat.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Time period selector pills */}
          <div className="flex flex-col gap-1">
            {(["month", "year", "all"] as const).map((p) => (
              <button
                key={p}
                onClick={() => onPeriodChange(p)}
                className={cn(
                  "px-2 py-1.5 rounded-titan-sm text-[11px] font-medium transition-colors text-left",
                  period === p
                    ? "bg-titan-accent text-white shadow-titan-sm"
                    : "bg-titan-bg-card-elevated text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-highlight"
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
      )}

      {/* Visible stat cards */}
      {visibleStatsData.map((stat) => (
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
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  
  // Column visibility configuration
  const allColumns = [
    { id: "orderNumber", label: "Order #", defaultVisible: true, sortable: true, resizable: true, minWidth: 100 },
    { id: "date", label: "Date", defaultVisible: true, sortable: true, resizable: true, minWidth: 100 },
    { id: "product", label: "Product", defaultVisible: true, sortable: true, resizable: true, minWidth: 150 },
    { id: "amount", label: "Amount", defaultVisible: true, sortable: true, resizable: true, minWidth: 100 },
    { id: "status", label: "Status", defaultVisible: true, sortable: true, resizable: true, minWidth: 100 },
    { id: "actions", label: "Actions", defaultVisible: true, sortable: false, resizable: false, minWidth: 120 },
  ];
  
  const defaultVisibleColumns = allColumns
    .filter(col => col.defaultVisible)
    .map(col => col.id);
  
  const defaultColumnOrder = allColumns.map(col => col.id);
  
  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("customerOrders_visibleColumns");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Failed to load column preferences:", e);
    }
    return defaultVisibleColumns;
  });
  
  // Column order
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("customerOrders_columnOrder");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Failed to load column order:", e);
    }
    return defaultColumnOrder;
  });
  
  // Column sizing
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem("customerOrders_columnSizing");
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to load column sizing:", e);
    }
    return {};
  });
  
  // Sorting state: array of {id: string, desc: boolean}
  const [sorting, setSorting] = useState<Array<{id: string, desc: boolean}>>([]);
  
  // Drag and drop state
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = useState<number>(0);
  const [resizeStartWidth, setResizeStartWidth] = useState<number>(0);
  
  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem("customerOrders_visibleColumns", JSON.stringify(visibleColumns));
  }, [visibleColumns]);
  
  useEffect(() => {
    localStorage.setItem("customerOrders_columnOrder", JSON.stringify(columnOrder));
  }, [columnOrder]);
  
  useEffect(() => {
    localStorage.setItem("customerOrders_columnSizing", JSON.stringify(columnSizing));
  }, [columnSizing]);
  
  const toggleColumn = (columnId: string) => {
    setVisibleColumns(prev => 
      prev.includes(columnId)
        ? prev.filter(id => id !== columnId)
        : [...prev, columnId]
    );
  };
  
  const selectAll = () => {
    setVisibleColumns(allColumns.map(col => col.id));
  };
  
  const resetToDefault = () => {
    setVisibleColumns(defaultVisibleColumns);
    setColumnOrder(defaultColumnOrder);
    setColumnSizing({});
    setSorting([]);
  };
  
  // Sorting handlers
  const handleSort = (columnId: string, shiftKey: boolean) => {
    const column = allColumns.find(col => col.id === columnId);
    if (!column?.sortable) return;
    
    setSorting(prev => {
      const existing = prev.find(s => s.id === columnId);
      
      if (shiftKey) {
        // Multi-sort: shift+click adds/modifies this column in the sort order
        if (existing) {
          if (existing.desc) {
            // Remove from sorting
            return prev.filter(s => s.id !== columnId);
          } else {
            // Toggle to desc
            return prev.map(s => s.id === columnId ? { ...s, desc: true } : s);
          }
        } else {
          // Add as asc
          return [...prev, { id: columnId, desc: false }];
        }
      } else {
        // Single sort: replace all sorting with this column
        if (existing && prev.length === 1) {
          if (existing.desc) {
            // Remove sorting
            return [];
          } else {
            // Toggle to desc
            return [{ id: columnId, desc: true }];
          }
        } else {
          // Set as asc
          return [{ id: columnId, desc: false }];
        }
      }
    });
  };
  
  // Drag and drop handlers
  const handleDragStart = (columnId: string) => {
    setDraggedColumn(columnId);
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  
  const handleDrop = (targetColumnId: string) => {
    if (!draggedColumn || draggedColumn === targetColumnId) {
      setDraggedColumn(null);
      return;
    }
    
    setColumnOrder(prev => {
      const newOrder = [...prev];
      const draggedIndex = newOrder.indexOf(draggedColumn);
      const targetIndex = newOrder.indexOf(targetColumnId);
      
      // Remove dragged column
      newOrder.splice(draggedIndex, 1);
      // Insert before target
      const insertIndex = draggedIndex < targetIndex ? targetIndex : targetIndex;
      newOrder.splice(insertIndex, 0, draggedColumn);
      
      return newOrder;
    });
    
    setDraggedColumn(null);
  };
  
  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnId);
    setResizeStartX(e.clientX);
    const currentWidth = columnSizing[columnId] || 150;
    setResizeStartWidth(currentWidth);
  };
  
  useEffect(() => {
    if (!resizingColumn) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX;
      const column = allColumns.find(col => col.id === resizingColumn);
      const minWidth = column?.minWidth || 80;
      const newWidth = Math.max(minWidth, resizeStartWidth + delta);
      
      setColumnSizing(prev => ({
        ...prev,
        [resizingColumn]: newWidth,
      }));
    };
    
    const handleMouseUp = () => {
      setResizingColumn(null);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, resizeStartX, resizeStartWidth, allColumns]);

  const filteredOrders = useMemo(() => {
    let result = orders.filter((order) => {
      const matchesSearch =
        !searchQuery ||
        order.orderNumber?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || order.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    
    // Apply sorting
    if (sorting.length > 0) {
      result = [...result].sort((a: any, b: any) => {
        for (const sort of sorting) {
          let aVal: any;
          let bVal: any;
          
          switch (sort.id) {
            case "orderNumber":
              aVal = a.orderNumber || "";
              bVal = b.orderNumber || "";
              break;
            case "date":
              aVal = new Date(a.createdAt).getTime();
              bVal = new Date(b.createdAt).getTime();
              break;
            case "product":
              const aProduct = a.lineItems?.[0]?.description || a.lineItems?.[0]?.productName || "";
              const bProduct = b.lineItems?.[0]?.description || b.lineItems?.[0]?.productName || "";
              aVal = aProduct.toLowerCase();
              bVal = bProduct.toLowerCase();
              break;
            case "amount":
              aVal = parseFloat(a.total || "0");
              bVal = parseFloat(b.total || "0");
              break;
            case "status":
              aVal = a.status || "";
              bVal = b.status || "";
              break;
            default:
              continue;
          }
          
          if (aVal < bVal) return sort.desc ? 1 : -1;
          if (aVal > bVal) return sort.desc ? -1 : 1;
        }
        return 0;
      });
    }
    
    return result;
  }, [orders, searchQuery, statusFilter, sorting]);

  if (filteredOrders.length === 0) {
    return (
      <div className="py-12 text-center text-titan-text-secondary">
        No orders found
      </div>
    );
  }

  // Helper to render sort icon
  const renderSortIcon = (columnId: string) => {
    const sortIndex = sorting.findIndex(s => s.id === columnId);
    if (sortIndex === -1) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    
    const sort = sorting[sortIndex];
    const showIndex = sorting.length > 1;
    
    return (
      <div className="flex items-center gap-1">
        {sort.desc ? (
          <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUp className="w-3 h-3" />
        )}
        {showIndex && (
          <span className="text-[10px] font-bold">{sortIndex + 1}</span>
        )}
      </div>
    );
  };
  
  // Get ordered and visible columns
  const orderedVisibleColumns = columnOrder
    .filter(id => visibleColumns.includes(id))
    .filter(id => !(compact && id === "product")); // Hide product in compact mode

  return (
    <>
      <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
              {orderedVisibleColumns.map((columnId) => {
                const column = allColumns.find(col => col.id === columnId);
                if (!column) return null;
                
                const width = columnSizing[columnId] || (column.minWidth + 50);
                
                return (
                  <th
                    key={columnId}
                    className={cn(
                      "relative px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider select-none",
                      column.sortable && "cursor-pointer hover:bg-titan-bg-card-highlight",
                      draggedColumn === columnId && "opacity-50"
                    )}
                    style={{ width: `${width}px` }}
                    draggable={column.id !== "actions"}
                    onDragStart={() => handleDragStart(columnId)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(columnId)}
                    onClick={(e) => column.sortable && handleSort(columnId, e.shiftKey)}
                  >
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-2">
                        {column.id !== "actions" && (
                          <GripVertical className="w-3 h-3 opacity-30 cursor-grab" />
                        )}
                        <span>{column.label}</span>
                      </div>
                      {column.sortable && renderSortIcon(columnId)}
                    </div>
                    
                    {/* Resize handle */}
                    {column.resizable && (
                      <div
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 group"
                        onMouseDown={(e) => handleResizeStart(e, columnId)}
                      >
                        <div className="absolute right-0 top-0 h-full w-1 group-hover:bg-blue-500" />
                      </div>
                    )}
                  </th>
                );
              })}
              <th className="px-4 py-3 w-12">
                <div className="flex items-center justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-titan-text-muted hover:text-titan-text-primary hover:bg-titan-bg-card-highlight"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowColumnSettings(true);
                    }}
                    aria-label="Edit columns"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </Button>
                </div>
              </th>
            </tr>
          </thead>
        <tbody>
          {filteredOrders.map((order: any) => {
            const lineItems = order.lineItems || [];
            const firstProduct = lineItems[0]?.description || lineItems[0]?.productName || "—";
            
            const renderCell = (columnId: string) => {
              const column = allColumns.find(col => col.id === columnId);
              if (!column) return null;
              
              const width = columnSizing[columnId] || (column.minWidth + 50);
              
              switch (columnId) {
                case "orderNumber":
                  return (
                    <td key={columnId} className="px-4 py-3" style={{ width: `${width}px` }}>
                      <span className="text-titan-sm font-medium text-titan-accent">
                        {order.orderNumber}
                      </span>
                    </td>
                  );
                  
                case "date":
                  return (
                    <td key={columnId} className="px-4 py-3 text-titan-sm text-titan-text-secondary" style={{ width: `${width}px` }}>
                      {formatDate(order.createdAt)}
                    </td>
                  );
                  
                case "product":
                  return (
                    <td key={columnId} className="px-4 py-3" style={{ width: `${width}px` }}>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-purple-500/20 rounded-titan-sm flex items-center justify-center">
                          <Package className="w-3 h-3 text-purple-400" />
                        </div>
                        <span className="text-titan-sm text-titan-text-primary truncate" style={{ maxWidth: `${width - 60}px` }}>
                          {firstProduct}
                        </span>
                      </div>
                    </td>
                  );
                  
                case "amount":
                  return (
                    <td key={columnId} className="px-4 py-3 text-titan-sm font-medium text-titan-success" style={{ width: `${width}px` }}>
                      {formatCurrency(order.total)}
                    </td>
                  );
                  
                case "status":
                  return (
                    <td key={columnId} className="px-4 py-3" style={{ width: `${width}px` }}>
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-titan-xs font-medium border",
                          getStatusStyle(order.status)
                        )}
                      >
                        {formatStatusLabel(order.status)}
                      </span>
                    </td>
                  );
                  
                case "actions":
                  return (
                    <td key={columnId} className="px-4 py-3" onClick={(e) => e.stopPropagation()} style={{ width: `${width}px` }}>
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
                  );
                  
                default:
                  return null;
              }
            };

            return (
              <tr
                key={order.id}
                className="border-b border-titan-border-subtle last:border-0 hover:bg-titan-bg-table-row transition-colors cursor-pointer"
                onClick={() => navigate(ROUTES.orders.detail(order.id))}
              >
                {orderedVisibleColumns.map(columnId => renderCell(columnId))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    <Dialog open={showColumnSettings} onOpenChange={setShowColumnSettings}>
      <DialogContent className="bg-titan-bg-card border-titan-border">
        <DialogHeader>
          <DialogTitle className="text-titan-text-primary">Edit Columns</DialogTitle>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Choose which columns to show in this table.
          </p>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {allColumns.map(column => (
            <div key={column.id} className="flex items-center space-x-3">
              <Checkbox
                id={`column-${column.id}`}
                checked={visibleColumns.includes(column.id)}
                onCheckedChange={() => toggleColumn(column.id)}
                className="border-titan-border-subtle data-[state=checked]:bg-titan-accent data-[state=checked]:border-titan-accent"
              />
              <label
                htmlFor={`column-${column.id}`}
                className="text-titan-sm text-titan-text-primary cursor-pointer flex-1"
              >
                {column.label}
              </label>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-4 border-t border-titan-border-subtle">
          <Button
            variant="outline"
            size="sm"
            onClick={selectAll}
            className="flex-1 border-titan-border-subtle text-titan-text-primary hover:bg-titan-bg-card-highlight"
          >
            Select All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={resetToDefault}
            className="flex-1 border-titan-border-subtle text-titan-text-primary hover:bg-titan-bg-card-highlight"
          >
            Reset to Default
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
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

      {/* Stats Cards Grid */}
      <CustomerStatsGrid
        customer={customer}
        orders={orders}
        quotes={quotes}
        invoices={invoices}
        period={period}
        layoutMode={layoutMode}
        onPeriodChange={setPeriod}
      />

      {/* Activity Section */}
      <div className="mt-4">
        {/* Compact Header Bar: Search Left, Tabs Center, Status Right */}
        <div className="flex items-center justify-between gap-4 rounded-t-2xl bg-[#111827] border border-slate-800 px-4 py-2">
          {/* Left: Search Input */}
          <div className="flex items-center">
            {activeTab !== "statement" && (
              <div className="relative w-64 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder={`Search ${activeTab}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm bg-slate-900/50 border-slate-700 text-white placeholder:text-slate-500 rounded-lg"
                />
              </div>
            )}
          </div>

          {/* Center: Tabs */}
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    setSearchQuery("");
                    setStatusFilter("all");
                  }}
                  className={cn(
                    "px-3 py-1 text-sm font-medium rounded-full flex items-center gap-2 transition-colors",
                    activeTab === tab.key
                      ? "bg-blue-600 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  )}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span
                      className={cn(
                        "text-xs px-1.5 py-0.5 rounded-full",
                        activeTab === tab.key
                          ? "bg-white/20"
                          : "bg-slate-700"
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Right: Status Filter */}
          <div className="flex items-center">
            {activeTab !== "statement" && (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] h-9 text-sm bg-slate-900/50 border-slate-700 text-white rounded-lg">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">All Status</SelectItem>
                  {activeTab === "orders" && (
                    <>
                      <SelectItem value="new" className="text-white">New</SelectItem>
                      <SelectItem value="in_production" className="text-white">In Production</SelectItem>
                      <SelectItem value="completed" className="text-white">Completed</SelectItem>
                      <SelectItem value="shipped" className="text-white">Shipped</SelectItem>
                    </>
                  )}
                  {activeTab === "quotes" && (
                    <>
                      <SelectItem value="draft" className="text-white">Draft</SelectItem>
                      <SelectItem value="pending_approval" className="text-white">Pending</SelectItem>
                      <SelectItem value="approved" className="text-white">Approved</SelectItem>
                      <SelectItem value="rejected" className="text-white">Rejected</SelectItem>
                    </>
                  )}
                  {activeTab === "invoices" && (
                    <>
                      <SelectItem value="draft" className="text-white">Draft</SelectItem>
                      <SelectItem value="sent" className="text-white">Sent</SelectItem>
                      <SelectItem value="paid" className="text-white">Paid</SelectItem>
                      <SelectItem value="overdue" className="text-white">Overdue</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Table Container - Seamlessly Connected */}
        <div className="bg-titan-bg-card border border-slate-800 border-t-0 rounded-b-2xl overflow-hidden shadow-titan-card">
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
    </div>
  );
}
