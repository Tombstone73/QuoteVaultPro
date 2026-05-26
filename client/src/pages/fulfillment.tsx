import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Box,
  Check,
  Factory,
  Filter,
  Loader2,
  Search,
  Settings,
  Truck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ROUTES } from "@/config/routes";
import { buildReferrer } from "@/lib/nav/smartBack";
import { PrintTicketActions } from "@/components/production/PrintTicketActions";
import { FulfillmentDebugPanel } from "@/components/fulfillment/FulfillmentDebugPanel";
import {
  FulfillmentQueueRow,
  getOrderDetails,
  getOrderShipments,
  toFulfillmentError,
  useCreatePickupTicketMutation,
  useCreateShipmentMutation,
  useFulfillmentQueueQuery,
} from "@/hooks/useFulfillment";
import { formatDistanceToNowStrict } from "date-fns";

const statusOptions = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "shipped", label: "Shipped" },
  { value: "ready_for_pickup", label: "Ready for Pickup" },
  { value: "picked_up", label: "Picked Up" },
];

type FulfillmentPageProps = {
  title?: string;
  initialType?: "all" | "ship" | "pickup";
};

function parseItemsRemaining(value: string): number {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function statusBadgeClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === "READY") return "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20";
  if (normalized === "SHIPPED") return "bg-blue-500/10 text-blue-500 border border-blue-500/20";
  if (normalized === "PARTIAL") return "bg-amber-500/10 text-amber-500 border border-amber-500/20";
  if (normalized === "READY_FOR_PICKUP") return "bg-amber-500/10 text-amber-500 border border-amber-500/20";
  if (normalized === "PICKED_UP") return "bg-muted text-muted-foreground border border-border";
  return "bg-muted text-muted-foreground border border-border";
}

function FulfillmentProductionTickets({ row }: { row: FulfillmentQueueRow }) {
  const jobs = (row.productionJobs ?? []).filter((job) => job.id);

  if (jobs.length === 0) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  return (
    <div className="flex max-w-[260px] flex-col gap-2">
      {jobs.map((job, index) => (
        <div key={job.id} className="flex flex-wrap items-center gap-2">
          {jobs.length > 1 ? (
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Job {index + 1}</span>
          ) : null}
          <PrintTicketActions
            jobId={job.id}
            jobQuantity={job.quantity ?? undefined}
            size="sm"
            variant="outline"
            className="flex flex-wrap"
          />
        </div>
      ))}
    </div>
  );
}

export default function FulfillmentPage({ title = "Fulfillment", initialType = "all" }: FulfillmentPageProps = {}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [type, setType] = useState<"all" | "ship" | "pickup">(initialType);
  const [status, setStatus] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const [lastError, setLastError] = useState<{ code?: string; message?: string } | null>(null);

  const debugEnabled = useMemo(() => new URLSearchParams(location.search).get("debug") === "1", [location.search]);
  const pickupTicketId = useMemo(() => new URLSearchParams(location.search).get("pickupTicketId"), [location.search]);

  const queueQuery = useFulfillmentQueueQuery({
    type,
    status,
    overdueOnly,
    showArchived,
    search,
  });

  const createShipment = useCreateShipmentMutation();
  const createPickupTicket = useCreatePickupTicketMutation();

  const rows = queueQuery.data?.rows ?? [];
  const selectedRows = rows.filter((row) => selectedOrderIds.has(row.orderId));

  const disableCombinedReason = useMemo(() => {
    if (selectedRows.length === 0) return "Select at least one order";
    const hasPickup = selectedRows.some((row) => row.fulfillmentType === "PICKUP");
    if (hasPickup) return "Combined shipment supports shipping orders only";
    const uniqueTypes = new Set(selectedRows.map((row) => row.fulfillmentType));
    if (uniqueTypes.size > 1) return "Selected orders include mixed fulfillment types";

    const uniqueAddresses = new Set(selectedRows.map((row) => row.shipTo.trim().toLowerCase()));
    if (uniqueAddresses.size > 1) return "Selected orders have different delivery addresses";

    const hasRemaining = selectedRows.some((row) => parseItemsRemaining(row.itemsRemaining) > 0);
    if (!hasRemaining) return "No shippable items remaining";

    return null;
  }, [selectedRows]);

  const handleToggleRow = (orderId: string, checked: boolean) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  };

  const handleOpenShipOrder = async (row: FulfillmentQueueRow) => {
    try {
      setBusyOrderId(row.orderId);
      setLastError(null);

      const existing = await getOrderShipments(row.orderId);
      setLastResponse(existing);

      const draft = existing
        .filter((s) => String(s.status || "").toUpperCase() === "DRAFT")
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];

      if (draft?.id) {
        navigate(`/fulfillment/shipments/${draft.id}${debugEnabled ? "?debug=1" : ""}`, {
          state: { referrer: buildReferrer(location) },
        });
        return;
      }

      const created = await createShipment.mutateAsync({
        scope: "SINGLE_ORDER",
        orderIds: [row.orderId],
        primaryOrderId: row.orderId,
      });
      setLastResponse(created);

      navigate(`/fulfillment/shipments/${created.shipmentId}${debugEnabled ? "?debug=1" : ""}`, {
        state: { referrer: buildReferrer(location) },
      });
    } catch (error) {
      const parsed = toFulfillmentError(error);
      setLastError({ code: parsed.code, message: parsed.message });
      toast({ title: "Open failed", description: parsed.message, variant: "destructive" });
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleOpenPickupOrder = async (row: FulfillmentQueueRow) => {
    try {
      setBusyOrderId(row.orderId);
      setLastError(null);
      const ticket = await createPickupTicket.mutateAsync(row.orderId);
      setLastResponse(ticket);
      toast({ title: "Pickup ticket ready", description: `Ticket ${ticket.id}` });
      navigate(`/fulfillment?pickupTicketId=${ticket.id}${debugEnabled ? "&debug=1" : ""}`, {
        state: { pickupTicket: ticket, referrer: buildReferrer(location) },
      });
    } catch (error) {
      const parsed = toFulfillmentError(error);
      setLastError({ code: parsed.code, message: parsed.message });
      toast({ title: "Pickup failed", description: parsed.message, variant: "destructive" });
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleOpen = async (row: FulfillmentQueueRow) => {
    if (row.fulfillmentType === "SHIP") {
      await handleOpenShipOrder(row);
      return;
    }
    await handleOpenPickupOrder(row);
  };

  const handleOpenCustomer = async (row: FulfillmentQueueRow) => {
    try {
      const order = await getOrderDetails(row.orderId);
      const customerId = order?.customerId || order?.customer?.id;
      if (!customerId) {
        toast({ title: "Customer not linked", description: "This order does not have a linked customer record.", variant: "destructive" });
        return;
      }

      navigate(ROUTES.customers.detail(String(customerId)), { state: { referrer: buildReferrer(location) } });
    } catch (error) {
      const parsed = toFulfillmentError(error);
      toast({ title: "Open customer failed", description: parsed.message, variant: "destructive" });
    }
  };

  const handleCreateCombined = async () => {
    if (disableCombinedReason) return;
    try {
      setLastError(null);
      const selectedShipOrderIds = selectedRows.map((row) => row.orderId);
      const response = await createShipment.mutateAsync({
        scope: "MULTI_ORDER",
        orderIds: selectedShipOrderIds,
      });
      setLastResponse(response);
      navigate(`/fulfillment/shipments/${response.shipmentId}${debugEnabled ? "?debug=1" : ""}`, {
        state: { referrer: buildReferrer(location) },
      });
    } catch (error) {
      const parsed = toFulfillmentError(error);
      setLastError({ code: parsed.code, message: parsed.message });
      toast({ title: "Combined shipment failed", description: parsed.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-full bg-background font-display text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-primary">
              <Truck className="h-6 w-6" />
              <h2 className="text-lg font-medium">{title}</h2>
            </div>
          </div>
          <div className="max-w-xl flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="w-full rounded-lg border border-input bg-muted/30 py-2 pl-10 pr-4 text-sm focus:border-primary focus:ring-primary"
                placeholder="Search orders, customers, or tracking numbers..."
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 text-muted-foreground hover:bg-accent" type="button">
              <Bell className="h-4 w-4" />
            </button>
            <button className="rounded-lg p-2 text-muted-foreground hover:bg-accent" type="button">
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-6 py-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
              <span className="px-2 text-[10px] font-bold uppercase text-muted-foreground">Type</span>
              {([
                ["all", "All"],
                ["ship", "Ship"],
                ["pickup", "Pickup"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  className={`rounded px-3 py-1 text-xs font-medium ${type === value ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
              <span className="px-2 text-[10px] font-bold uppercase text-muted-foreground">Status</span>
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  className={`rounded px-3 py-1 text-xs font-medium ${status === option.value ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-6">
            <label className="group flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
              <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">Show Archived</span>
            </label>
            <label className="group flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(event) => setOverdueOnly(event.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
              <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">Overdue Only</span>
            </label>
            <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent" type="button">
              <Filter className="h-3.5 w-3.5" />
              More Filters
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 pb-24">
        {pickupTicketId && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm">
            <p className="font-semibold">Pickup ticket selected</p>
            <p className="text-xs text-muted-foreground">Ticket ID: {pickupTicketId}</p>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-10 px-4 py-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input bg-transparent text-primary focus:ring-primary"
                    checked={rows.length > 0 && selectedOrderIds.size === rows.length}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedOrderIds(new Set(rows.map((row) => row.orderId)));
                      } else {
                        setSelectedOrderIds(new Set());
                      }
                    }}
                  />
                </th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Order #</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Customer</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Fulfillment</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Items Remaining</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Ready Since</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Ship To</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Print Tickets</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {queueQuery.isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading queue...
                    </div>
                  </td>
                </tr>
              )}

              {!queueQuery.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <div className="mx-auto mb-4 w-fit rounded-full bg-muted p-4">
                      <Box className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="mb-1 text-lg font-bold">No orders ready for fulfillment</h3>
                    <p className="text-sm text-muted-foreground">Try adjusting your filters to find what you're looking for.</p>
                  </td>
                </tr>
              )}

              {rows.map((row) => {
                const isSelected = selectedOrderIds.has(row.orderId);
                const readySince = row.readySince ? `${formatDistanceToNowStrict(new Date(row.readySince), { addSuffix: true })}` : "--";

                return (
                  <tr key={row.orderId} className={`transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/10" : ""}`}>
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input bg-transparent text-primary focus:ring-primary"
                        checked={isSelected}
                        onChange={(event) => handleToggleRow(row.orderId, event.target.checked)}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col">
                        <button
                          type="button"
                          className="w-fit text-sm font-bold text-primary underline-offset-2 hover:underline"
                          onClick={() => void handleOpen(row)}
                          disabled={busyOrderId === row.orderId}
                        >
                          #{row.orderNumber}
                        </button>
                        {row.overdue && (
                          <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-500">
                            <AlertTriangle className="h-3 w-3" /> OVERDUE
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm font-medium">
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline"
                        onClick={() => void handleOpenCustomer(row)}
                      >
                        {row.customerName}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold ${row.fulfillmentType === "SHIP" ? "border border-primary/20 bg-primary/10 text-primary" : "border border-border bg-muted text-muted-foreground"}`}>
                        {row.fulfillmentType === "SHIP" ? <Truck className="h-3.5 w-3.5" /> : <Factory className="h-3.5 w-3.5" />}
                        {row.fulfillmentType}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center rounded px-2 py-1 text-[11px] font-bold ${statusBadgeClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-medium">{row.itemsRemaining}</td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">{readySince}</td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">{row.shipTo}</td>
                    <td className="px-4 py-4">
                      <FulfillmentProductionTickets row={row} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <FulfillmentDebugPanel enabled={debugEnabled} lastResponse={lastResponse ?? queueQuery.data ?? null} lastError={lastError} />
      </main>

      {selectedOrderIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex w-[90%] max-w-2xl -translate-x-1/2 items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-lg bg-primary p-2">
              <Check className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold">{selectedOrderIds.size} Orders Selected</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Batch Operations Enabled</p>
              {disableCombinedReason && (
                <div className="mt-1 flex items-center gap-1.5 text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  <p className="text-[9px] font-bold uppercase tracking-tight">{disableCombinedReason}</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all ${disableCombinedReason ? "cursor-not-allowed bg-muted text-muted-foreground opacity-50" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
              disabled={!!disableCombinedReason || createShipment.isPending}
              onClick={() => void handleCreateCombined()}
              title={disableCombinedReason || "Create combined shipment"}
            >
              {createShipment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Box className="h-4 w-4" />}
              Create Combined Shipment
            </button>
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-bold text-foreground transition-all hover:bg-muted/50"
              onClick={() => setSelectedOrderIds(new Set())}
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
