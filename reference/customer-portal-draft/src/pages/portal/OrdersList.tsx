import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { useOrders } from "@/hooks/useOrders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, CalendarIcon, Package, Search, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderState, PortalOrderListItem } from "@/types/portal";

const STATE_BADGE_VARIANT: Record<OrderState, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default",
  production_complete: "secondary",
  closed: "outline",
  canceled: "destructive",
};

const PRIORITY_LABELS: Record<string, string> = {
  rush: "Rush",
  normal: "Normal",
  low: "Low",
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function OrdersList() {
  const navigate = useNavigate();
  const { data: orders, isLoading, isError, error, refetch } = useOrders();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  const filtered = useMemo(() => {
    if (!orders) return [];
    let result = orders;

    if (stateFilter !== "all") {
      result = result.filter((o) => o.state === stateFilter);
    }

    if (priorityFilter !== "all") {
      result = result.filter((o) => o.priority === priorityFilter);
    }

    if (dateFrom) {
      result = result.filter((o) => new Date(o.createdAt) >= dateFrom);
    }

    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      result = result.filter((o) => new Date(o.createdAt) <= end);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          (o.poNumber && o.poNumber.toLowerCase().includes(q))
      );
    }

    return result;
  }, [orders, search, stateFilter, priorityFilter, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Your Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and track all of your orders.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by order # or PO #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">In Progress</SelectItem>
              <SelectItem value="production_complete">Ready for Pickup</SelectItem>
              <SelectItem value="closed">Completed</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="rush">Rush</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[180px] justify-start text-left font-normal",
                  !dateFrom && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFrom ? format(dateFrom, "MMM d, yyyy") : "From date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateFrom}
                onSelect={setDateFrom}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[180px] justify-start text-left font-normal",
                  !dateTo && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateTo ? format(dateTo, "MMM d, yyyy") : "To date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateTo}
                onSelect={setDateTo}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {(dateFrom || dateTo || priorityFilter !== "all" || stateFilter !== "all" || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStateFilter("all");
                setPriorityFilter("all");
                setDateFrom(undefined);
                setDateTo(undefined);
              }}
            >
              <X className="mr-1 h-4 w-4" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <div>
            <p className="text-lg font-medium text-foreground">Unable to load orders</p>
            <p className="text-sm text-muted-foreground mt-1">
              {error instanceof Error ? error.message : "An unexpected error occurred."}
            </p>
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <Package className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-lg font-medium text-foreground">No orders found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {orders && orders.length > 0
                ? "Try adjusting your search or filter."
                : "You don't have any orders yet."}
            </p>
          </div>
        </div>
      )}

      {/* Orders Table */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead className="hidden sm:table-cell">PO #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Priority</TableHead>
                <TableHead className="hidden md:table-cell">Due Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((order) => (
                <OrderRow key={order.id} order={order} onClick={() => navigate(`/orders/${order.id}`)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order, onClick }: { order: PortalOrderListItem; onClick: () => void }) {
  return (
    <TableRow className="cursor-pointer" onClick={onClick}>
      <TableCell className="font-medium">{order.orderNumber}</TableCell>
      <TableCell className="hidden sm:table-cell text-muted-foreground">
        {order.poNumber || "—"}
      </TableCell>
      <TableCell>
        <Badge variant={STATE_BADGE_VARIANT[order.state]}>{order.stateLabel}</Badge>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {order.priority === "rush" ? (
          <span className="text-sm font-medium text-destructive">Rush</span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {PRIORITY_LABELS[order.priority] ?? order.priority}
          </span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell text-muted-foreground">
        {formatDate(order.dueDate)}
      </TableCell>
      <TableCell className="text-right font-medium">{formatCurrency(order.total)}</TableCell>
      <TableCell className="hidden lg:table-cell text-muted-foreground">
        {formatDate(order.createdAt)}
      </TableCell>
    </TableRow>
  );
}
