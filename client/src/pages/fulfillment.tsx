import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Box,
  Check,
  ClipboardList,
  Factory,
  Filter,
  Loader2,
  PackageCheck,
  Search,
  Settings,
  Truck,
  ChevronDown,
  Printer,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ROUTES } from "@/config/routes";
import { buildReferrer } from "@/lib/nav/smartBack";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { getFulfillmentArtworkViewUrl } from "@/lib/fulfillmentArtwork";
import { FulfillmentDebugPanel } from "@/components/fulfillment/FulfillmentDebugPanel";
import {
  FulfillmentQueueRow,
  FulfillmentQueueFilters,
  useAddFulfillmentNoteMutation,
  getOrderDetails,
  getOrderShipments,
  toFulfillmentError,
  useCreatePickupTicketMutation,
  useCreateShipmentMutation,
  useFulfillmentOrderDetailQuery,
  useFulfillmentQueueQuery,
  useMarkFulfillmentReadyMutation,
  useMarkOrderReadyForPickupMutation,
  useMarkPickupPickedUpMutation,
  useMarkShippedMutation,
  useUnreadyFulfillmentOrderMutation,
  useUpdateFulfillmentChecklistItemMutation,
} from "@/hooks/useFulfillment";
import { useGeneratePackingSlip } from "@/hooks/useShipments";
import { PackingSlipModal } from "@/components/PackingSlipModal";
import { PrintTicketButton } from "@/components/production/PrintTicketButton";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDistanceToNowStrict } from "date-fns";

const statusOptions = [
  { value: "all", label: "All" },
  { value: "waiting_on_production", label: "Waiting" },
  { value: "partially_ready", label: "Partially Ready" },
  { value: "ready", label: "Ready" },
  { value: "partially_shipped", label: "Partially Shipped" },
  { value: "shipped", label: "Shipped" },
  { value: "ready_for_pickup", label: "Ready for Pickup" },
  { value: "picked_up", label: "Picked Up" },
];

type FulfillmentPageProps = {
  title?: string;
  initialType?: "all" | "ship" | "pickup";
};

function statusBadgeClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === "DRAFT") return "bg-muted text-muted-foreground border border-border";
  if (normalized === "READY") return "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20";
  if (normalized === "SHIPPED") return "bg-blue-500/10 text-blue-500 border border-blue-500/20";
  if (["PARTIAL", "PARTIALLY_READY", "PARTIALLY_SHIPPED"].includes(normalized)) return "bg-amber-500/10 text-amber-500 border border-amber-500/20";
  if (normalized === "WAITING_ON_PRODUCTION") return "bg-orange-500/10 text-orange-500 border border-orange-500/20";
  if (normalized === "READY_FOR_PICKUP") return "bg-amber-500/10 text-amber-500 border border-amber-500/20";
  if (normalized === "PICKED_UP") return "bg-muted text-muted-foreground border border-border";
  return "bg-muted text-muted-foreground border border-border";
}

function statusLabel(status: string): string {
  return status.toLowerCase().split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

// Retained for the secondary detail component while the list itself no longer
// renders per-job ticket controls.
function FulfillmentProductionTickets({ row }: { row: FulfillmentQueueRow }) {
  const count = (row.productionJobs ?? []).filter((job) => job.id).length;
  return <span className="text-xs text-muted-foreground">{count ? `${count} production job${count === 1 ? "" : "s"}` : "--"}</span>;
}

function FulfillmentProductionContext({ row }: { row: FulfillmentQueueRow }) {
  const context = row.productionContext;
  const printer = context?.primaryPrinterName || "Unassigned";
  const finishing = context?.finishingRequirements ?? [];
  const registrationMarks = context?.registrationMarks ?? [];
  const notes = context?.productionNotes ?? [];
  const completedAt = context?.completedAt ? new Date(context.completedAt) : null;

  return (
    <div className="max-w-[260px] space-y-1 text-xs">
      <div className="font-semibold text-foreground">{printer}</div>
      <div className="flex flex-wrap gap-1">
        {context?.lamination ? (
          <span className="rounded border border-border bg-muted px-1.5 py-0.5">Lam: {context.lamination}</span>
        ) : null}
        {finishing.slice(0, 2).map((item) => (
          <span key={item} className="rounded border border-border bg-muted px-1.5 py-0.5">{item}</span>
        ))}
        {registrationMarks.slice(0, 1).map((item) => (
          <span key={item} className="rounded border border-border bg-muted px-1.5 py-0.5">{item}</span>
        ))}
        {finishing.length > 2 ? (
          <span className="rounded border border-border bg-muted px-1.5 py-0.5">+{finishing.length - 2} finish</span>
        ) : null}
      </div>
      {notes[0] ? <div className="truncate text-muted-foreground" title={notes[0]}>Note: {notes[0]}</div> : null}
      {completedAt && !Number.isNaN(completedAt.getTime()) ? (
        <div className="text-[11px] text-muted-foreground">Printed {completedAt.toLocaleString()}</div>
      ) : null}
    </div>
  );
}

function FulfillmentDetailPanel({
  orderId,
  onOpenOrder,
  onOpenShipment,
}: {
  orderId: string | null;
  onOpenOrder: (orderId: string) => void;
  onOpenShipment: (row: FulfillmentQueueRow) => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [unreadyReason, setUnreadyReason] = useState("");
  const detailQuery = useFulfillmentOrderDetailQuery(orderId || undefined);
  const detail = detailQuery.data;
  const markReady = useMarkFulfillmentReadyMutation(orderId || "");
  const markReadyForPickup = useMarkOrderReadyForPickupMutation(orderId || "");
  const addNote = useAddFulfillmentNoteMutation(orderId || "");
  const unready = useUnreadyFulfillmentOrderMutation(orderId || "");
  const updateChecklist = useUpdateFulfillmentChecklistItemMutation(orderId || "");
  const ticketId = detail?.pickupTicket?.id || detail?.pickupTicketId || "";
  const markPickedUp = useMarkPickupPickedUpMutation(ticketId, orderId || undefined);
  const shipmentId = detail?.shipmentId || detail?.shipments?.[0]?.id || "";
  const markShipped = useMarkShippedMutation(shipmentId);
  const generatePackingSlip = useGeneratePackingSlip(orderId || "");
  const [packingSlipHtml, setPackingSlipHtml] = useState<string | null>(null);
  const [packingSlipOpen, setPackingSlipOpen] = useState(false);

  if (!orderId) {
    return (
      <aside className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <ClipboardList className="h-5 w-5" />
        </div>
        <h3 className="text-base font-semibold text-foreground">Select a fulfillment row</h3>
        <p className="mt-1">Choose an order from the queue to verify items, update pickup/shipping status, add notes, or open the order.</p>
      </aside>
    );
  }

  const invoiceAutomationToast = (result: unknown): string | undefined => {
    const automation = (result as any)?.billingAutomation;
    if (!automation) return undefined;
    if (automation.status === "created") return "Draft invoice created.";
    if (automation.status === "skipped_existing_invoice") return "Draft invoice already exists.";
    if (automation.status === "failed_controlled_error") return `Invoice draft warning: ${automation.message}`;
    return undefined;
  };

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    try {
      const result = await action();
      toast({ title: label, description: invoiceAutomationToast(result) });
    } catch (error) {
      const parsed = toFulfillmentError(error);
      toast({ title: `${label} failed`, description: parsed.message, variant: "destructive" });
    }
  };

  const normalizedStatus = String(detail?.status || "").toUpperCase();
  const isPickup = detail?.fulfillmentType === "PICKUP";
  const isShip = detail?.fulfillmentType === "SHIP";
  const canMarkPickupReady = isPickup && normalizedStatus === "READY";
  const canMarkPickedUp = isPickup && normalizedStatus === "READY_FOR_PICKUP" && !!ticketId;
  const canMarkReady = (isShip || isPickup) && normalizedStatus === "DRAFT";
  const canMarkShipped = isShip && !!shipmentId && normalizedStatus === "READY";
  const canUnready = (normalizedStatus === "READY" || normalizedStatus === "READY_FOR_PICKUP") && detail?.permissions?.canRevertStatus === true;
  const unreadyLabel = normalizedStatus === "READY_FOR_PICKUP" ? "Move Back to Ready" : "Move Back to Draft";
  const checklistBlocking = detail ? !detail.checklistComplete : true;
  const showChecklistBlocker = checklistBlocking && normalizedStatus === "READY" && (canMarkPickupReady || canMarkShipped);
  const checklistBlockMessage = isShip
    ? "Verify all fulfillment checklist items before marking shipped."
    : "Verify all fulfillment checklist items before marking ready for pickup.";

  const toggleChecklistItem = async (lineItemId: string, checked: boolean, notes?: string | null) => {
    await runAction(checked ? "Item verified" : "Item unverified", () =>
      updateChecklist.mutateAsync({ lineItemId, checked, notes: notes ?? null }),
    );
  };

  const openPackingSlip = async () => {
    try {
      const html = await generatePackingSlip.mutateAsync();
      setPackingSlipHtml(html);
      setPackingSlipOpen(true);
    } catch (error) {
      toast({ title: "Packing slip unavailable", description: error instanceof Error ? error.message : "Failed to generate packing slip", variant: "destructive" });
    }
  };

  return (
    <aside className="flex max-h-[calc(100vh-9rem)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Fulfillment Detail</div>
            <h2 className="text-lg font-semibold">{detail ? `#${detail.orderNumber}` : "Loading..."}</h2>
          </div>
          {detail ? <span className={statusBadgeClass(detail.status)}>{detail.status}</span> : null}
        </div>

        {detailQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading fulfillment detail...
          </div>
        ) : !detail ? (
          <div className="p-5 text-sm text-muted-foreground">Fulfillment row not found.</div>
        ) : (
          <div className="flex-1 overflow-auto p-5">
            <div className="mb-5 flex flex-wrap gap-2">
              {canMarkReady ? (
                <button type="button" className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground" onClick={() => void runAction("Marked ready", () => markReady.mutateAsync())}>
                  <PackageCheck className="mr-2 inline h-4 w-4" />
                  Mark Ready
                </button>
              ) : null}
              {canMarkPickupReady ? (
                <button
                  type="button"
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={checklistBlocking}
                  title={checklistBlocking ? checklistBlockMessage : "Mark ready for pickup"}
                  onClick={() => void runAction("Ready for pickup", () => markReadyForPickup.mutateAsync({}))}
                >
                  Ready for Pickup
                </button>
              ) : null}
              {canMarkPickedUp ? (
                <button type="button" className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground" onClick={() => void runAction("Picked up", () => markPickedUp.mutateAsync())}>
                  Picked Up
                </button>
              ) : null}
              {canMarkShipped ? (
                <button
                  type="button"
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={checklistBlocking}
                  title={checklistBlocking ? checklistBlockMessage : "Mark shipped"}
                  onClick={() => void runAction("Marked shipped", () => markShipped.mutateAsync())}
                >
                  Mark Shipped
                </button>
              ) : null}
              {isShip ? (
                <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-accent" onClick={() => onOpenShipment(detail)}>
                  Open Shipment
                </button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={generatePackingSlip.isPending}>
                    <Printer className="mr-1.5 h-4 w-4" />
                    Print
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <PrintTicketButton orderId={detail.orderId} asMenuItem />
                  <DropdownMenuItem onSelect={() => void openPackingSlip()} disabled={generatePackingSlip.isPending}>
                    <Printer />
                    {generatePackingSlip.isPending ? "Generating packing slip…" : "Packing Slip"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-accent" onClick={() => onOpenOrder(detail.orderId)}>
                Open Order
              </button>
            </div>
            {(normalizedStatus === "READY" || normalizedStatus === "READY_FOR_PICKUP") && detail.permissions?.canRevertStatus !== true ? (
              <div className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Un-Ready requires permission: {detail.permissions?.revertPermission || "fulfillment.revert_status"}.
              </div>
            ) : null}
            {canUnready ? (
              <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3">
                <div className="mb-2 text-sm font-semibold">{unreadyLabel}</div>
                <textarea
                  className="min-h-16 w-full rounded-lg border border-input bg-background p-2 text-sm"
                  value={unreadyReason}
                  onChange={(event) => setUnreadyReason(event.target.value)}
                  placeholder="Reason required"
                />
                <button
                  type="button"
                  className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!unreadyReason.trim() || unready.isPending}
                  onClick={() => void runAction("Fulfillment status reverted", async () => {
                    await unready.mutateAsync({ reason: unreadyReason.trim() });
                    setUnreadyReason("");
                  })}
                >
                  {unreadyLabel}
                </button>
              </div>
            ) : null}
            {showChecklistBlocker ? (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {checklistBlockMessage}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-bold">Customer</h3>
                <div className="space-y-1 text-sm">
                  <div>{detail.customer.name}</div>
                  <div className="text-muted-foreground">{detail.customer.email || "--"}</div>
                  <div className="text-muted-foreground">{detail.customer.phone || "--"}</div>
                  <div className="pt-2"><span className={statusBadgeClass(detail.status)}>{detail.status}</span></div>
                  {detail.isArchived ? <div className="text-xs text-muted-foreground">{detail.archivedReason}</div> : null}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-bold">Pickup / Shipping</h3>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div>Type: {detail.fulfillmentType}</div>
                  <div>Ship To: {detail.shipTo}</div>
                  {detail.pickupTicket ? <div>Pickup Ticket: {detail.pickupTicket.status}</div> : null}
                  {detail.shipments[0] ? <div>Shipment: {detail.shipments[0].status}</div> : null}
                </div>
              </section>
            </div>

            <section className="mt-4 rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-bold">Production Summary</h3>
              <div className="divide-y divide-border">
                {detail.productionSummary.map((job) => (
                  <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <div className="font-medium">{job.stationKey} / {job.stepKey}</div>
                      <div className="text-xs text-muted-foreground">{job.assignedPrinterName || "Unassigned"}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{job.status}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <FulfillmentProductionTickets row={detail} />
              </div>
            </section>

            <section className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold">Fulfillment Checklist</h3>
                <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                  {detail.checklistSummary.checked}/{detail.checklistSummary.total} verified
                </span>
              </div>
              <div className="divide-y divide-border">
                {detail.lineItems.map((item) => {
                  const firstArtwork = item.artwork[0] ?? null;
                  const thumbnailSrc = getThumbSrc(firstArtwork);
                  const artworkViewUrl = getFulfillmentArtworkViewUrl(firstArtwork);
                  const productionIncomplete = item.production.status && !["done", "completed"].includes(String(item.production.status).toLowerCase());
                  return (
                    <div key={item.id} className="grid gap-3 py-3 md:grid-cols-[auto_72px_1fr]">
                      <div className="pt-1">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border"
                          checked={item.checklist.checked}
                          disabled={updateChecklist.isPending}
                          aria-label={`Verify ${item.productName || item.description || "line item"}`}
                          onChange={(event) => void toggleChecklistItem(item.id, event.target.checked, item.checklist.notes)}
                        />
                      </div>
                      <div className="h-16 w-16 overflow-hidden rounded-md border border-border bg-muted">
                        {thumbnailSrc ? (
                          <img src={thumbnailSrc} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-muted-foreground">
                            {item.artwork.length > 0 ? "No preview available" : "No artwork"}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold">{item.productName || item.description || "Line item"}</div>
                          {item.checklist.checked ? (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Verified</span>
                          ) : (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Needs check</span>
                          )}
                          {productionIncomplete ? (
                            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-700">Production incomplete</span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Qty {item.quantity ?? "Not captured"} · {item.size || "Not captured"} · {item.materialName || item.productType || "Not captured"}
                          {item.finishing.lamination ? ` · Lamination: ${item.finishing.lamination}` : ""}
                        </div>
                        {item.optionSummary.length > 0 ? (
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.optionSummary.join(" · ")}</div>
                        ) : null}
                        <div className="mt-1 text-xs text-muted-foreground">
                          Artwork: {item.artwork.length > 0 ? item.artwork.map((art) => art.fileName).join(", ") : "No artwork files found."}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Production: {item.production.stationLabel || item.production.stationKey || "No station assigned"} {item.production.status || "unknown"}
                        </div>
                        {item.checklist.notes ? <div className="mt-1 text-xs text-muted-foreground">Issue: {item.checklist.notes}</div> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!artworkViewUrl}
                            title={artworkViewUrl ? "View artwork" : "No artwork preview URL available."}
                            onClick={() => artworkViewUrl && window.open(artworkViewUrl, "_blank", "noopener,noreferrer")}
                          >
                            View Art
                          </button>
                          {item.production.jobId ? (
                            <PrintTicketActions jobId={item.production.jobId} jobQuantity={item.quantity ?? undefined} size="sm" variant="outline" />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {detail.lineItems.length === 0 ? (
                  <div className="py-4 text-sm text-muted-foreground">No fulfillment checklist items found.</div>
                ) : null}
              </div>
            </section>

            <section className="mt-4 rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-bold">Fulfillment Note</h3>
              <textarea className="min-h-20 w-full rounded-lg border border-input bg-background p-2 text-sm" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add an internal fulfillment note..." />
              <button
                type="button"
                className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-accent disabled:opacity-50"
                disabled={!note.trim() || addNote.isPending}
                onClick={() => void runAction("Note added", async () => {
                  await addNote.mutateAsync(note.trim());
                  setNote("");
                })}
              >
                Add Note
              </button>
            </section>

            <section className="mt-4 rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-bold">Event History</h3>
              <div className="space-y-2">
                {detail.events.length === 0 ? <div className="text-sm text-muted-foreground">No fulfillment events yet.</div> : null}
                {detail.events.map((event) => (
                  <div key={event.id} className="rounded-lg border border-border p-2 text-sm">
                    <div className="font-medium">{event.eventType}</div>
                    <div className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</div>
                    {event.payloadJson?.note ? <div className="mt-1 text-muted-foreground">{String(event.payloadJson.note)}</div> : null}
                  </div>
                ))}
              </div>
            </section>

            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600">
              <ClipboardList className="mr-1 inline h-3.5 w-3.5" />
              Invoice automation hook: terminal fulfillment status will become the billing trigger in the next pass. Production completion does not invoice.
            </div>
          </div>
        )}
        {packingSlipHtml ? <PackingSlipModal open={packingSlipOpen} onOpenChange={setPackingSlipOpen} packingSlipHtml={packingSlipHtml} /> : null}
      </aside>
  );
}

export default function FulfillmentPage({ title = "Fulfillment", initialType = "all" }: FulfillmentPageProps = {}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [type, setType] = useState<"all" | "ship" | "pickup">(initialType);
  const [status, setStatus] = useState("all");
  const [printerFilter, setPrinterFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<NonNullable<FulfillmentQueueFilters["sortBy"]>>("createdAt");
  const [sortDirection, setSortDirection] = useState<NonNullable<FulfillmentQueueFilters["sortDirection"]>>("asc");
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
    printer: printerFilter,
    sortBy,
    sortDirection,
  });

  const createShipment = useCreateShipmentMutation();
  const createPickupTicket = useCreatePickupTicketMutation();

  const allRows = queueQuery.data?.rows ?? [];
  const printerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of allRows) {
      for (const name of row.productionContext?.printerNames ?? []) {
        const trimmed = String(name || "").trim();
        if (trimmed) names.add(trimmed);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [allRows]);
  const rows = allRows;
  const selectedRows = rows.filter((row) => selectedOrderIds.has(row.orderId));

  const disableCombinedReason = useMemo(() => {
    if (selectedRows.length === 0) return "Select at least one order";
    const hasPickup = selectedRows.some((row) => row.fulfillmentType === "PICKUP");
    if (hasPickup) return "Combined shipment supports shipping orders only";
    const uniqueTypes = new Set(selectedRows.map((row) => row.fulfillmentType));
    if (uniqueTypes.size > 1) return "Selected orders include mixed fulfillment types";

    const uniqueAddresses = new Set(selectedRows.map((row) => row.shipTo.trim().toLowerCase()));
    if (uniqueAddresses.size > 1) return "Selected orders have different delivery addresses";

    if (selectedRows.some((row) => row.remainingQuantity <= 0)) return "Every selected order must have remaining quantity to ship";

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

  const toggleSort = (next: NonNullable<FulfillmentQueueFilters["sortBy"]>) => {
    if (next === sortBy) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortBy(next); setSortDirection("asc"); }
  };
  const sortIndicator = (column: NonNullable<FulfillmentQueueFilters["sortBy"]>) => sortBy === column ? (sortDirection === "asc" ? " ▲" : " ▼") : "";

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

  const handleOpenOrder = (orderId: string) => {
    navigate(ROUTES.fulfillment.order(orderId), { state: { referrer: buildReferrer(location) } });
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

            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
              <span className="px-2 text-[10px] font-bold uppercase text-muted-foreground">Printer</span>
              <select
                value={printerFilter}
                onChange={(event) => setPrinterFilter(event.target.value)}
                className="h-7 rounded border-0 bg-transparent px-2 text-xs font-medium outline-none"
              >
                <option value="all">All Printers</option>
                <option value="unassigned">Unassigned</option>
                {printerOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
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

      <div className="flex-1 p-4 pb-24 md:p-6">
        <div className="w-full">
        {pickupTicketId && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm">
            <p className="font-semibold">Pickup ticket selected</p>
            <p className="text-xs text-muted-foreground">Ticket ID: {pickupTicketId}</p>
          </div>
        )}

        <div className="overflow-auto rounded-xl border border-border bg-card shadow-sm">
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
                {([['orderNumber', 'Order #'], ['customer', 'Customer'], ['fulfillmentType', 'Fulfillment'], ['status', 'Status'], ['createdAt', 'Ready Since'], ['readyQuantity', 'Ready / remaining'], ['destination', 'Destination']] as const).map(([column, label]) => <th key={column} aria-sort={sortBy === column ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground"><button type="button" className="hover:text-foreground" onClick={() => toggleSort(column)}>{label}{sortIndicator(column)}</button></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {queueQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading queue...
                    </div>
                  </td>
                </tr>
              )}

              {!queueQuery.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="mx-auto mb-4 w-fit rounded-full bg-muted p-4">
                      <Box className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="mb-1 text-lg font-bold">No active fulfillment work</h3>
                    <p className="text-sm text-muted-foreground">Try adjusting your filters to find what you're looking for.</p>
                  </td>
                </tr>
              )}

              {rows.map((row) => {
                const isChecked = selectedOrderIds.has(row.orderId);
                const readySince = row.readySince ? `${formatDistanceToNowStrict(new Date(row.readySince), { addSuffix: true })}` : "--";

                return (
                  <tr
                    key={row.orderId}
                    className={`cursor-pointer transition-colors hover:bg-muted/50 ${isChecked ? "bg-muted/50" : ""}`}
                    onClick={() => handleOpenOrder(row.orderId)}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input bg-transparent text-primary focus:ring-primary"
                        checked={isChecked}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => handleToggleRow(row.orderId, event.target.checked)}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col">
                        <button
                          type="button"
                          className="w-fit text-sm font-bold text-primary underline-offset-2 hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenOrder(row.orderId);
                          }}
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
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleOpenCustomer(row);
                        }}
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
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">{readySince}</td>
                    <td className="px-4 py-4 text-sm"><span className="font-medium">Remaining {row.remainingQuantity}</span><p className="text-xs text-muted-foreground">{row.fulfillmentType === "PICKUP" ? `${row.pickedUpQuantity} picked up` : `${row.shippedQuantity} shipped`}</p></td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">{row.shipTo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <FulfillmentDebugPanel enabled={debugEnabled} lastResponse={lastResponse ?? queueQuery.data ?? null} lastError={lastError} />
        </div>

      </div>

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
