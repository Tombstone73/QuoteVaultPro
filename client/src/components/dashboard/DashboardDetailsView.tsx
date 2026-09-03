import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useOrders } from "@/hooks/useOrders";
import { useInvoices } from "@/hooks/useInvoices";
import { useFulfillmentQueueQuery } from "@/hooks/useFulfillment";
import { DASHBOARD_PANELS, getPanelOpenTarget, type DashboardPanel } from "@/components/dashboard/dashboardPanels";
import { buildReferrer } from "@/lib/nav/smartBack";
import { formatOrderDate } from "@/lib/orderDate";

type QuoteRow = {
  id: string;
  quoteNumber?: number | null;
  status?: string | null;
  customer?: { companyName?: string | null } | null;
  totalPrice?: string | null;
  createdAt?: string | null;
  convertedToOrderId?: string | null;
};

type QuotesResponse = {
  items?: QuoteRow[];
};

type LowInventoryItem = {
  id: string;
  name: string;
  currentQty: number;
  reorderThreshold: number;
  unit: string | null;
  supplier: string | null;
};

type LowInventoryResponse = {
  items?: LowInventoryItem[];
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatCurrency(value?: string | number | null) {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatQty(value?: number | null, unit?: string | null) {
  if (value == null || !Number.isFinite(Number(value))) return "â€”";
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));
  return unit ? `${formatted} ${unit}` : formatted;
}

function panelTitle(panel: DashboardPanel) {
  return DASHBOARD_PANELS[panel]?.title ?? "Details";
}

function LoadingState() {
  return (
    <div className="space-y-2 p-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

function DetailErrorState({ message }: { message: string }) {
  return (
    <div className="py-10 text-center text-sm text-red-500">
      {message}
    </div>
  );
}

export default function DashboardDetailsView({ panel }: { panel: DashboardPanel }) {
  const navigate = useNavigate();
  const location = useLocation();
  const dueFilter = panel === "orders_due_today"
    ? "today"
    : panel === "orders_due_tomorrow"
      ? "tomorrow"
      : undefined;
  // Due panels use the same server-side tenant-calendar predicate as the
  // dashboard counts. Other dashboard panels retain their existing list flow.
  const ordersQuery = useOrders(dueFilter
    ? { due: dueFilter, page: 1, pageSize: 200, includeThumbnails: false, sortBy: "dueDate", sortDir: "asc" }
    : undefined);
  const invoicesQuery = useInvoices();
  const fulfillmentQueueQuery = useFulfillmentQueueQuery({
    type: "all",
    status: "all",
    showArchived: false,
    overdueOnly: false,
    search: "",
  });
  const openTarget = getPanelOpenTarget(panel);

  const quotesQuery = useQuery<QuotesResponse>({
    queryKey: ["dashboard", "quotes", "pending"],
    queryFn: async () => {
      const params = new URLSearchParams({ source: "internal", status: "pending_approval", page: "1", pageSize: "25", includeThumbnails: "false" });
      const response = await fetch(`/api/quotes?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load quotes details");
      return response.json();
    },
    enabled: panel === "quotes_pending",
    staleTime: 60_000,
  });

  const lowInventoryQuery = useQuery<LowInventoryResponse>({
    queryKey: ["dashboard", "low-inventory", "details"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/low-inventory?limit=50", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load low inventory details");
      const json = await response.json();
      return json?.data ?? json;
    },
    enabled: panel === "low_inventory_items",
    staleTime: 60_000,
  });

  const filteredOrders = useMemo(() => {
    const paginated = ordersQuery.data && !Array.isArray(ordersQuery.data) && "items" in ordersQuery.data
      ? ordersQuery.data
      : null;
    const list = paginated?.items ?? (Array.isArray(ordersQuery.data) ? ordersQuery.data : []);
    if (dueFilter) return list;
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return list.filter((o: any) => {
      const canonical = String(o?.canonicalState || "").toLowerCase();
      const status = String(o?.status || "").toLowerCase();

      switch (panel) {
        case "orders_status_new":
          return canonical ? canonical === "new" : status === "new";
        case "orders_status_in_production":
          return canonical ? canonical === "active" : status === "in_production";
        case "orders_status_on_hold":
          return canonical ? canonical === "on_hold" : status === "on_hold";
        case "ready_to_ship":
          return canonical ? canonical === "ready" : status === "ready_for_shipment";
        case "shipped_today": {
          if (!o?.shippedAt) return false;
          const shippedAt = new Date(o.shippedAt);
          return shippedAt >= today && shippedAt < tomorrow;
        }
        default:
          return false;
      }
    });
  }, [dueFilter, ordersQuery.data, panel]);

  const filteredInvoices = useMemo(() => {
    const list = Array.isArray(invoicesQuery.data) ? invoicesQuery.data : [];
    const now = new Date();

    return list.filter((inv: any) => {
      const status = String(inv?.status || "").toLowerCase();
      switch (panel) {
        case "invoices_overdue": {
          if (status === "overdue") return true;
          if (status === "paid" || status === "void") return false;
          const due = inv?.dueDate ? new Date(inv.dueDate) : null;
          return !!due && due < now;
        }
        case "invoices_unpaid":
          return status !== "paid" && status !== "void";
        default:
          return false;
      }
    });
  }, [invoicesQuery.data, panel]);

  const isLoading =
    panel === "quotes_pending"
      ? quotesQuery.isLoading
      : panel === "low_inventory_items"
        ? lowInventoryQuery.isLoading
      : panel === "invoices_overdue" || panel === "invoices_unpaid"
        ? invoicesQuery.isLoading
        : panel === "ready_to_ship"
          ? fulfillmentQueueQuery.isLoading
        : panel === "my_work"
          ? false
          : ordersQuery.isLoading;

  const errorMessage =
    panel === "quotes_pending"
      ? (quotesQuery.error as Error | null)?.message
      : panel === "low_inventory_items"
        ? (lowInventoryQuery.error as Error | null)?.message
      : panel === "invoices_overdue" || panel === "invoices_unpaid"
        ? (invoicesQuery.error as Error | null)?.message
        : panel === "ready_to_ship"
          ? (fulfillmentQueueQuery.error as Error | null)?.message
        : panel === "my_work"
          ? null
          : (ordersQuery.error as Error | null)?.message;

  if (panel === "my_work") {
    return (
      <Card className="border-border bg-card h-full">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Select a tile above to view details.
        </CardContent>
      </Card>
    );
  }

  if (panel === "low_inventory_items") {
    const rows = lowInventoryQuery.data?.items ?? [];
    return (
      <Card className="border-border bg-card h-full">
        <CardHeader className="border-b border-border flex-row items-center justify-between">
          <CardTitle className="text-base">{panelTitle(panel)}</CardTitle>
          {openTarget ? <Button asChild variant="ghost" size="sm"><Link to={openTarget.href}>{openTarget.label}</Link></Button> : null}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <LoadingState /> : null}
          {!isLoading && errorMessage ? <DetailErrorState message={errorMessage} /> : null}
          {!isLoading && !errorMessage ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Threshold</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No low-stock materials.</TableCell></TableRow>
              ) : rows.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-right text-amber-600">{formatQty(item.currentQty, item.unit)}</TableCell>
                  <TableCell className="text-right">{formatQty(item.reorderThreshold, item.unit)}</TableCell>
                  <TableCell>{item.supplier || "â€”"}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={ROUTES.materials.detail(item.id)}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (panel === "quotes_pending") {
    const rows = quotesQuery.data?.items ?? [];
    return (
      <Card className="border-border bg-card h-full">
        <CardHeader className="border-b border-border flex-row items-center justify-between">
          <CardTitle className="text-base">{panelTitle(panel)}</CardTitle>
          {openTarget ? <Button asChild variant="ghost" size="sm"><Link to={openTarget.href}>{openTarget.label}</Link></Button> : null}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <LoadingState /> : null}
          {!isLoading && errorMessage ? <DetailErrorState message={errorMessage} /> : null}
          {!isLoading && !errorMessage ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No results.</TableCell></TableRow>
              ) : rows.map((q) => (
                <TableRow key={q.id} className="cursor-pointer" onClick={() => navigate(ROUTES.quotes.detail(q.id), { state: { referrer: buildReferrer(location) } })}>
                  <TableCell className="font-medium">#{q.quoteNumber ?? "—"}</TableCell>
                  <TableCell>{q.customer?.companyName || "—"}</TableCell>
                  <TableCell>{q.status || "—"}</TableCell>
                  <TableCell>{formatDate(q.createdAt)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(q.totalPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (panel === "ready_to_ship") {
    const rows = fulfillmentQueueQuery.data?.rows ?? [];
    return (
      <Card className="border-border bg-card h-full">
        <CardHeader className="border-b border-border flex-row items-center justify-between">
          <CardTitle className="text-base">{panelTitle(panel)}</CardTitle>
          {openTarget ? <Button asChild variant="ghost" size="sm"><Link to={openTarget.href}>{openTarget.label}</Link></Button> : null}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <LoadingState /> : null}
          {!isLoading && errorMessage ? <DetailErrorState message={errorMessage} /> : null}
          {!isLoading && !errorMessage ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Fulfillment</TableHead>
                  <TableHead>Station</TableHead>
                  <TableHead>Ready Since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No results.</TableCell></TableRow>
                ) : rows.map((row) => (
                  <TableRow key={row.orderId} className="cursor-pointer" onClick={() => navigate(ROUTES.orders.detail(row.orderId), { state: { referrer: buildReferrer(location) } })}>
                    <TableCell className="font-medium">{row.orderNumber || "Not available"}</TableCell>
                    <TableCell>{row.customerName || "Not available"}</TableCell>
                    <TableCell>{row.fulfillmentType === "PICKUP" ? "Pickup" : "Ship"}</TableCell>
                    <TableCell>{row.productionContext?.completedAt ? "Fulfillment" : "No station assigned"}</TableCell>
                    <TableCell>{formatDate(row.readySince)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (panel === "invoices_overdue" || panel === "invoices_unpaid") {
    return (
      <Card className="border-border bg-card h-full">
        <CardHeader className="border-b border-border flex-row items-center justify-between">
          <CardTitle className="text-base">{panelTitle(panel)}</CardTitle>
          {openTarget ? <Button asChild variant="ghost" size="sm"><Link to={openTarget.href}>{openTarget.label}</Link></Button> : null}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <LoadingState /> : null}
          {!isLoading && errorMessage ? <DetailErrorState message={errorMessage} /> : null}
          {!isLoading && !errorMessage ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvoices.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No results.</TableCell></TableRow>
              ) : filteredInvoices.map((inv: any) => (
                <TableRow key={inv.id} className="cursor-pointer" onClick={() => navigate(ROUTES.invoices.detail(inv.id), { state: { referrer: buildReferrer(location) } })}>
                  <TableCell className="font-medium">#{inv.invoiceNumber ?? "—"}</TableCell>
                  <TableCell>{inv.displayStatus || inv.status || "—"}</TableCell>
                  <TableCell>{formatDate(inv.dueDate)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(inv.displayTotal ?? inv.total)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(inv.displayRemaining ?? inv.balanceDue ?? (Number(inv.total || 0) - Number(inv.amountPaid || 0)))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card h-full">
      <CardHeader className="border-b border-border flex-row items-center justify-between">
        <CardTitle className="text-base">{panelTitle(panel)}</CardTitle>
        {openTarget ? <Button asChild variant="ghost" size="sm"><Link to={openTarget.href}>{openTarget.label}</Link></Button> : null}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? <LoadingState /> : null}
        {!isLoading && errorMessage ? <DetailErrorState message={errorMessage} /> : null}
        {!isLoading && !errorMessage ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOrders.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No results.</TableCell></TableRow>
            ) : filteredOrders.map((o: any) => (
              <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(ROUTES.orders.detail(o.id), { state: { referrer: buildReferrer(location) } })}>
                <TableCell className="font-medium">{o.orderNumber || "—"}</TableCell>
                <TableCell>{o.status || "—"}</TableCell>
                <TableCell>{formatOrderDate(o.dueDate, "short")}</TableCell>
                <TableCell>{o.customer?.companyName || o.customerName || "—"}</TableCell>
                <TableCell className="text-right">{formatCurrency(o.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
