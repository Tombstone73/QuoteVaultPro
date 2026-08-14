import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Copy,
  Download,
  FileText,
  Loader2,
  MapPinned,
  Package,
  Printer,
  Truck,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FulfillmentDebugPanel } from "@/components/fulfillment/FulfillmentDebugPanel";
import {
  getOrderDetails,
  getFulfillmentOrderDetail,
  FulfillmentDetail,
  ShipmentDetail,
  toFulfillmentError,
  useMarkShippedMutation,
  useCreateShipmentPackageMutation,
  useShipmentDetailQuery,
  useUpdateShipmentMutation,
  useVoidShipmentMutation,
} from "@/hooks/useFulfillment";
import { formatDistanceToNowStrict } from "date-fns";
import { ROUTES } from "@/config/routes";
import { useSmartBack } from "@/hooks/useSmartBack";
import { buildReferrer } from "@/lib/nav/smartBack";

interface OrderDetailLite {
  id: string;
  orderNumber: string;
  customerId?: string | null;
  customer?: { id?: string | null; companyName?: string | null } | null;
  shipToAddress1?: string | null;
  shipToAddress2?: string | null;
  shipToCity?: string | null;
  shipToState?: string | null;
  shipToPostalCode?: string | null;
  lineItems?: Array<{
    id: string;
    orderId: string;
    description?: string | null;
    quantity: number;
    product?: { name?: string | null; sku?: string | null } | null;
  }>;
}

interface ShipmentFormState {
  carrier: string;
  serviceLevel: string;
  trackingNumber: string;
  shipDate: string;
  boxCount: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  packageNotes: string;
  internalNotes: string;
}

const defaultForm: ShipmentFormState = {
  carrier: "",
  serviceLevel: "",
  trackingNumber: "",
  shipDate: "",
  boxCount: "",
  weight: "",
  length: "",
  width: "",
  height: "",
  packageNotes: "",
  internalNotes: "",
};

function statusPill(status: string): string {
  const value = status.toUpperCase();
  if (value === "SHIPPED") return "bg-blue-500/10 text-blue-500 border border-blue-500/20";
  if (value === "VOIDED") return "bg-red-500/10 text-red-500 border border-red-500/20";
  return "bg-primary/20 text-primary border border-primary/30";
}

function toDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function FulfillmentShipmentEditor({
  shipmentId: embeddedShipmentId,
  embedded = false,
  onMutationComplete,
}: {
  shipmentId?: string;
  embedded?: boolean;
  onMutationComplete?: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { onSmartBack } = useSmartBack();
  const { shipmentId: routeShipmentId } = useParams<{ shipmentId: string }>();
  const shipmentId = embeddedShipmentId ?? routeShipmentId;
  const location = useLocation();

  const [form, setForm] = useState<ShipmentFormState>(defaultForm);
  const [allocatedByLineItemId, setAllocatedByLineItemId] = useState<Record<string, number>>({});
  const [packageByLineItemId, setPackageByLineItemId] = useState<Record<string, string>>({});
  const [packageFieldsById, setPackageFieldsById] = useState<Record<string, { weight: string | number; length: string | number; width: string | number; height: string | number; notes: string }>>({});
  const [ordersById, setOrdersById] = useState<Record<string, OrderDetailLite>>({});
  const [fulfillmentByOrderId, setFulfillmentByOrderId] = useState<Record<string, FulfillmentDetail>>({});
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const [lastError, setLastError] = useState<{ code?: string; message?: string } | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const hydratedShipmentId = useRef<string | null>(null);

  const debugEnabled = useMemo(() => new URLSearchParams(location.search).get("debug") === "1", [location.search]);

  const shipmentQuery = useShipmentDetailQuery(shipmentId);
  const updateShipment = useUpdateShipmentMutation(shipmentId || "");
  const markShipped = useMarkShippedMutation(shipmentId || "");
  const voidShipment = useVoidShipmentMutation(shipmentId || "");
  const createPackage = useCreateShipmentPackageMutation(shipmentId || "");

  const shipment = shipmentQuery.data;

  useEffect(() => {
    if (!shipment) return;
    if (hydratedShipmentId.current === shipment.id) return;
    hydratedShipmentId.current = shipment.id;
    const defaultPackage = shipment.packages[0];
    const nextForm: ShipmentFormState = {
      carrier: shipment.carrier ?? "",
      serviceLevel: shipment.serviceLevel ?? "",
      trackingNumber: shipment.trackingNumber ?? "",
      shipDate: toDateInput(shipment.shipDate),
      boxCount: shipment.boxCount == null ? "" : String(shipment.boxCount),
      weight: defaultPackage?.weightLbs ?? shipment.weightLbs ?? "",
      length: defaultPackage?.dimLengthIn ?? shipment.dimLengthIn ?? "",
      width: defaultPackage?.dimWidthIn ?? shipment.dimWidthIn ?? "",
      height: defaultPackage?.dimHeightIn ?? shipment.dimHeightIn ?? "",
      packageNotes: defaultPackage?.notes ?? "",
      internalNotes: shipment.internalNotes ?? "",
    };
    setForm(nextForm);

    const allocatedMap: Record<string, number> = {};
    for (const item of shipment.items) {
      allocatedMap[item.orderLineItemId] = item.quantity;
    }
    setAllocatedByLineItemId(allocatedMap);
    const packageMap: Record<string, string> = {};
    for (const item of shipment.items) if (item.packageId) packageMap[item.orderLineItemId] = item.packageId;
    setPackageByLineItemId(packageMap);
    setPackageFieldsById(Object.fromEntries(shipment.packages.map((pkg) => [pkg.id, {
      weight: pkg.weightLbs ?? "",
      length: pkg.dimLengthIn ?? "",
      width: pkg.dimWidthIn ?? "",
      height: pkg.dimHeightIn ?? "",
      notes: pkg.notes ?? "",
    }])));
  }, [shipment]);

  useEffect(() => {
    if (!shipment?.orders?.length) return;

    let cancelled = false;
    setLoadingOrders(true);

    Promise.all(shipment.orders.map(async (orderRef) => Promise.all([
      getOrderDetails(orderRef.orderId),
      getFulfillmentOrderDetail(orderRef.orderId),
    ])))
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, OrderDetailLite> = {};
        const fulfillmentMap: Record<string, FulfillmentDetail> = {};
        results.forEach(([order, fulfillment]) => {
          map[String(order.id)] = order as OrderDetailLite;
          fulfillmentMap[String(order.id)] = fulfillment;
        });
        setOrdersById(map);
        setFulfillmentByOrderId(fulfillmentMap);
      })
      .catch((error) => {
        if (cancelled) return;
        const parsed = toFulfillmentError(error);
        setLastError({ code: parsed.code, message: parsed.message });
      })
      .finally(() => {
        if (!cancelled) setLoadingOrders(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shipment?.orders]);

  const lineItemsByOrder = useMemo(() => {
    if (!shipment) return [] as Array<{
      orderId: string;
      orderNumber: string;
      customerName: string;
      lineItems: Array<{
        id: string;
        label: string;
        sku: string;
        orderedQty: number;
        remainingQty: number;
      }>;
    }>;

    return shipment.orders.map((orderRef) => {
      const order = ordersById[orderRef.orderId];
      const fulfillment = fulfillmentByOrderId[orderRef.orderId];
      const lineItems = (fulfillment?.lineItems ?? []).map((li) => ({
        id: li.id,
        label: li.productName || li.description || "Line Item",
        sku: "--",
        orderedQty: li.production.orderedQuantity,
        remainingQty: li.production.remainingQuantity,
      }));

      return {
        orderId: orderRef.orderId,
        orderNumber: orderRef.orderNumber,
        customerName: order?.customer?.companyName || orderRef.customerName || "Unknown Customer",
        lineItems,
      };
    });
  }, [fulfillmentByOrderId, ordersById, shipment]);

  const addressMismatch = useMemo(() => {
    const addresses = new Set(
      (shipment?.orders ?? []).map((o) => {
        const order = ordersById[o.orderId];
        return [order?.shipToAddress1, order?.shipToAddress2, order?.shipToCity, order?.shipToState, order?.shipToPostalCode]
          .filter(Boolean)
          .join("|")
          .toLowerCase();
      }).filter(Boolean),
    );
    return addresses.size > 1;
  }, [ordersById, shipment?.orders]);

  const validationErrors = useMemo(() => {
    const errors = new Set<string>();
    for (const group of lineItemsByOrder) {
      for (const item of group.lineItems) {
        const allocated = Number(allocatedByLineItemId[item.id] || 0);
        if (allocated > item.remainingQty) {
          errors.add(item.id);
        }
      }
    }
    return errors;
  }, [allocatedByLineItemId, lineItemsByOrder]);

  const allocatedCount = useMemo(
    () => Object.values(allocatedByLineItemId).reduce((acc, value) => acc + (Number(value) > 0 ? Number(value) : 0), 0),
    [allocatedByLineItemId],
  );

  const markShippedDisabled =
    !shipment ||
    shipment.status !== "DRAFT" ||
    validationErrors.size > 0 ||
    allocatedCount <= 0 ||
    markShipped.isPending ||
    updateShipment.isPending;

  const saveDraft = async (silent = false) => {
    if (!shipmentId) return;
    try {
      setLastError(null);

      const shipmentItems = lineItemsByOrder.flatMap((group) =>
        group.lineItems
          .map((item) => ({
            orderId: group.orderId,
            orderLineItemId: item.id,
            quantity: Number(allocatedByLineItemId[item.id] || 0),
            packageId: packageByLineItemId[item.id] || null,
          }))
          .filter((item) => item.quantity > 0),
      );

      const payload = {
        carrier: form.carrier || null,
        serviceLevel: form.serviceLevel || null,
        trackingNumber: form.trackingNumber || null,
        shipDate: form.shipDate || null,
        internalNotes: form.internalNotes || null,
        packages: shipment.packages.map((pkg, index) => {
          const fields = index === 0
            ? { weight: form.weight, length: form.length, width: form.width, height: form.height, notes: form.packageNotes }
            : packageFieldsById[pkg.id] ?? { weight: pkg.weightLbs ?? "", length: pkg.dimLengthIn ?? "", width: pkg.dimWidthIn ?? "", height: pkg.dimHeightIn ?? "", notes: pkg.notes ?? "" };
          return ({
          id: pkg.id,
          weightLbs: parseNumber(fields.weight),
          dims: { length: parseNumber(fields.length), width: parseNumber(fields.width), height: parseNumber(fields.height) },
          notes: fields.notes || null,
          });
        }),
        ...(advancedPacking ? { shipmentItems } : {}),
      };

      const response = await updateShipment.mutateAsync(payload);
      setLastResponse(response);

      if (!silent) {
        toast({ title: "Draft saved", description: "Shipment draft updated" });
      }
      await onMutationComplete?.();
      return response;
    } catch (error) {
      const parsed = toFulfillmentError(error);
      setLastError({ code: parsed.code, message: parsed.message });
      if (!silent) {
        toast({ title: "Save failed", description: parsed.message, variant: "destructive" });
      }
      return null;
    }
  };

  const handleAddPackage = async () => {
    if (!shipmentId) return;
    try {
      const created = await createPackage.mutateAsync({});
      toast({ title: "Package added", description: created.packageReference });
      await shipmentQuery.refetch();
      await onMutationComplete?.();
    } catch (error) {
      const parsed = toFulfillmentError(error);
      toast({ title: "Package could not be added", description: parsed.message, variant: "destructive" });
    }
  };

  const handleMarkShipped = async () => {
    if (!shipmentId) return;
    const saved = await saveDraft(true);
    if (!saved) return;

    try {
      setLastError(null);
      const response = await markShipped.mutateAsync();
      setLastResponse(response);
      toast({ title: "Shipment marked shipped", description: `${shipment.shipmentReference || "Shipment"} is now SHIPPED` });
      await shipmentQuery.refetch();
      await onMutationComplete?.();
    } catch (error) {
      const parsed = toFulfillmentError(error);
      setLastError({ code: parsed.code, message: parsed.message });
      toast({ title: "Mark shipped failed", description: parsed.message, variant: "destructive" });
    }
  };

  const handleVoid = async () => {
    if (!shipmentId) return;
    try {
      setLastError(null);
      const response = await voidShipment.mutateAsync();
      setLastResponse(response);
      toast({ title: "Shipment voided", description: `${shipment.shipmentReference || "Shipment"} moved to VOIDED` });
      await shipmentQuery.refetch();
    } catch (error) {
      const parsed = toFulfillmentError(error);
      setLastError({ code: parsed.code, message: parsed.message });
      toast({ title: "Void failed", description: parsed.message, variant: "destructive" });
    }
  };

  if (shipmentQuery.isLoading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading shipment...
        </div>
      </div>
    );
  }

  if (!shipment) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Shipment not found.</p>
      </div>
    );
  }

  const isDraft = shipment.status === "DRAFT";
  const advancedPacking = shipment.packingMode === "advanced_separate_packing" || splitMode;
  const packedCount = shipment.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const updatedAgo = formatDistanceToNowStrict(new Date(shipment.updatedAt), { addSuffix: true });

  const resolveCustomerId = (orderId: string): string | null => {
    const order = ordersById[orderId];
    return String(order?.customerId || order?.customer?.id || "") || null;
  };

  return (
    <div className={embedded ? "bg-background font-display text-foreground" : "min-h-full bg-background font-display text-foreground"}>
      <header className={`${embedded ? "hidden" : "sticky top-0 z-50"} border-b border-border bg-background px-6 py-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              className="rounded-lg p-2 transition-colors hover:bg-accent"
              type="button"
              onClick={onSmartBack}
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="flex flex-col">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold tracking-tight">{shipment.shipmentReference || "Shipment"}</h1>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${statusPill(shipment.status)}`}>
                  {shipment.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Fulfillment shipment · {shipment.orders.map((order) => `Order #${order.orderNumber}`).join(" · ")}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Last Updated</span>
              <span className="text-sm font-medium">{updatedAgo}</span>
            </div>
          </div>
        </div>
      </header>

      <main className={embedded ? "p-0" : "p-4 md:p-6"}>
        <div className={`grid grid-cols-1 items-start gap-6 ${embedded ? "xl:grid-cols-[minmax(0,1fr)_300px]" : "xl:grid-cols-[320px_minmax(0,1fr)_300px]"}`}>
          <aside className={embedded ? "hidden" : "flex flex-col gap-4"}>
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Orders Included</h3>
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-foreground">{shipment.orders.length.toString().padStart(2, "0")}</span>
            </div>

            {shipment.orders.map((orderRef) => {
              const order = ordersById[orderRef.orderId];
              const lineCount = order?.lineItems?.length ?? 0;
              const allocatedForOrder = lineItemsByOrder
                .find((g) => g.orderId === orderRef.orderId)
                ?.lineItems.reduce((acc, item) => acc + Number(allocatedByLineItemId[item.id] || 0), 0) ?? 0;

              const addressPreview = [order?.shipToAddress1, order?.shipToCity, order?.shipToState].filter(Boolean).join(", ") || "Address unavailable";

              return (
                <div key={orderRef.orderId} className="group relative mb-4 cursor-default rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50">
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <button
                        type="button"
                        className="text-sm font-bold text-primary underline-offset-2 hover:underline"
                        onClick={() => navigate(ROUTES.orders.detail(orderRef.orderId), { state: { referrer: buildReferrer(location) } })}
                      >
                        #{orderRef.orderNumber}
                      </button>
                      {resolveCustomerId(orderRef.orderId) ? (
                        <button
                          type="button"
                          className="block text-[10px] font-bold uppercase tracking-wider text-primary/90 underline-offset-2 hover:underline"
                          onClick={() => navigate(ROUTES.customers.detail(resolveCustomerId(orderRef.orderId) as string), { state: { referrer: buildReferrer(location) } })}
                        >
                          {order?.customer?.companyName || orderRef.customerName || "Customer"}
                        </button>
                      ) : (
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{order?.customer?.companyName || orderRef.customerName || "Customer"}</p>
                      )}
                    </div>
                    <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-500">
                      {isDraft ? "Draft" : shipment.status}
                    </span>
                  </div>
                  <div className="mb-3">
                    <p className="text-xs font-medium text-muted-foreground">{allocatedForOrder} allocated across {lineCount} items</p>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: lineCount > 0 ? `${Math.min(100, (allocatedForOrder / (lineCount || 1)) * 100)}%` : "0%" }} />
                    </div>
                  </div>
                  <div className="space-y-1.5 border-t border-border pt-2">
                    <div className="flex items-start gap-2">
                      <MapPinned className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-[10px] leading-tight text-muted-foreground">{addressPreview}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </aside>

          <section className="flex flex-col gap-6">
            {addressMismatch && (
              <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-medium text-amber-500">Orders in this shipment have different delivery addresses</p>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-6 py-3">
                <h3 className="text-sm font-bold uppercase tracking-wider">Logistics & Carrier Details</h3>
              </div>
              <div className="grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Carrier</label>
                  <input
                    className="h-10 rounded border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-primary"
                    value={form.carrier}
                    onChange={(event) => setForm((prev) => ({ ...prev, carrier: event.target.value }))}
                    disabled={!isDraft}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Service Level</label>
                  <input
                    className="h-10 rounded border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-primary"
                    value={form.serviceLevel}
                    onChange={(event) => setForm((prev) => ({ ...prev, serviceLevel: event.target.value }))}
                    disabled={!isDraft}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tracking Number</label>
                  <div className="relative">
                    <input
                      className="h-10 w-full rounded border border-input bg-background px-3 font-mono text-sm focus:ring-2 focus:ring-primary"
                      value={form.trackingNumber}
                      onChange={(event) => setForm((prev) => ({ ...prev, trackingNumber: event.target.value }))}
                      disabled={!isDraft}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-2 text-muted-foreground"
                      onClick={() => navigator.clipboard?.writeText(form.trackingNumber || "")}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ship Date</label>
                  <input
                    type="date"
                    className="h-10 rounded border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-primary"
                    value={form.shipDate}
                    onChange={(event) => setForm((prev) => ({ ...prev, shipDate: event.target.value }))}
                    disabled={!isDraft}
                  />
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-6 py-3">
                <h3 className="text-sm font-bold uppercase tracking-wider">Default Package Dimensions & Weight</h3>
              </div>
              <div className="p-6">
                <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
                  {[
                    ["Weight (lbs)", "weight"],
                    ["Length (in)", "length"],
                    ["Width (in)", "width"],
                    ["Height (in)", "height"],
                  ].map(([label, key]) => (
                    <div key={key} className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</label>
                      <input
                        type="number"
                        className="h-10 rounded border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-primary"
                        value={form[key as keyof ShipmentFormState]}
                        onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                        disabled={!isDraft}
                      />
                    </div>
                  ))}
                </div>
                <p className="mb-4 text-xs text-muted-foreground">Package count: {shipment.packages.length}. Physical package records are the source of truth.</p>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Default Package Notes</label>
                  <textarea
                    className="w-full resize-none rounded border border-input bg-background p-3 text-sm focus:ring-2 focus:ring-primary"
                    rows={2}
                    placeholder="Add any special handling instructions..."
                    value={form.packageNotes}
                    onChange={(event) => setForm((prev) => ({ ...prev, packageNotes: event.target.value }))}
                    disabled={!isDraft}
                  />
                </div>
                <div className="mt-4 flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Shipment Internal Notes</label>
                  <textarea
                    className="w-full resize-none rounded border border-input bg-background p-3 text-sm focus:ring-2 focus:ring-primary"
                    rows={2}
                    placeholder="Internal shipping instructions..."
                    value={form.internalNotes}
                    onChange={(event) => setForm((prev) => ({ ...prev, internalNotes: event.target.value }))}
                    disabled={!isDraft}
                  />
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-6 py-3">
                <h3 className="text-sm font-bold uppercase tracking-wider">Items in Shipment</h3>
                <span className="text-xs text-muted-foreground">{lineItemsByOrder.reduce((acc, group) => acc + group.lineItems.length, 0)} items total across {lineItemsByOrder.length} orders</span>
              </div>
              {!advancedPacking && <div className="flex flex-wrap items-center justify-between gap-3 p-6 text-sm"><div><p className="font-semibold">Items packed: {packedCount}</p><p className="mt-1 text-muted-foreground">Verified, production-complete quantities are automatically allocated to {shipment.packages[0]?.packageReference || "the default package"}.</p></div>{isDraft && <button type="button" className="rounded border px-3 py-2 text-xs font-bold hover:bg-muted" onClick={() => setSplitMode(true)}>Split Shipment / Packages</button>}</div>}
              <div className={advancedPacking ? "overflow-x-auto" : "hidden"}>
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {lineItemsByOrder.length > 1 && <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Order Ref</th>}
                      <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Product SKU / Name</th>
                      <th className="px-6 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ordered</th>
                      <th className="px-6 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Remaining</th>
                      <th className="px-6 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">In Shipment</th>
                      <th className="px-6 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Package</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {loadingOrders && (
                      <tr>
                        <td colSpan={lineItemsByOrder.length > 1 ? 6 : 5} className="px-6 py-6 text-center text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading order line items...
                          </span>
                        </td>
                      </tr>
                    )}

                    {!loadingOrders && lineItemsByOrder.map((group) => (
                      <>
                        <tr key={`${group.orderId}-header`} className="bg-muted/20">
                          <td className="px-6 py-2" colSpan={lineItemsByOrder.length > 1 ? 6 : 5}>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase text-primary">Order #{group.orderNumber}</span>
                              <span className="h-px flex-1 bg-border" />
                            </div>
                          </td>
                        </tr>

                        {group.lineItems.map((item) => {
                          const value = Number(allocatedByLineItemId[item.id] || 0);
                          const hasError = validationErrors.has(item.id);
                          return (
                            <tr key={item.id}>
                              {lineItemsByOrder.length > 1 && <td className="px-6 py-4 text-xs font-mono text-muted-foreground">#{group.orderNumber}</td>}
                              <td className="px-6 py-4">
                                <p className="text-sm font-bold">{item.label}</p>
                                <p className="text-xs font-mono text-muted-foreground">SKU: {item.sku}</p>
                              </td>
                              <td className="px-6 py-4 text-center text-sm">{item.orderedQty}</td>
                              <td className={`px-6 py-4 text-center text-sm font-medium ${item.remainingQty === 0 ? "text-muted-foreground" : "text-amber-500"}`}>{item.remainingQty}</td>
                              <td className="px-6 py-4 text-center">
                                <div className="inline-flex items-center gap-2">
                                  <input
                                    type="number"
                                    value={value}
                                    disabled={!isDraft}
                                    className={`h-8 w-16 rounded border-2 bg-background text-center text-sm font-bold focus:border-primary focus:ring-0 ${hasError ? "border-red-500" : "border-primary/20"}`}
                                    onChange={(event) => {
                                      const next = Math.max(0, Number(event.target.value || 0));
                                      setAllocatedByLineItemId((prev) => ({ ...prev, [item.id]: next }));
                                    }}
                                  />
                                </div>
                                {hasError && <p className="mt-1 text-[10px] font-bold text-red-500">Exceeds remaining quantity</p>}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <select
                                  className="h-8 max-w-[180px] rounded border border-input bg-background px-2 text-xs"
                                  disabled={!isDraft || shipment.packages.length === 0}
                                  value={packageByLineItemId[item.id] || ""}
                                  onChange={(event) => setPackageByLineItemId((prev) => ({ ...prev, [item.id]: event.target.value }))}
                                >
                                  <option value="">Unpacked</option>
                                  {shipment.packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.packageReference}</option>)}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-6 py-3">
                <div><h3 className="text-sm font-bold uppercase tracking-wider">Packages</h3><p className="text-xs text-muted-foreground">{advancedPacking ? "Assign split quantities to physical packages." : "Package count is derived from package records."}</p></div>
                {advancedPacking && <button type="button" className="rounded border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted" disabled={!isDraft || createPackage.isPending} onClick={() => void handleAddPackage()}>
                  {createPackage.isPending ? "ADDING..." : "ADD PACKAGE"}
                </button>}
              </div>
              <div className="divide-y divide-border">
                {shipment.packages.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No packages yet. Create one to group physical contents and print a package ticket.</p> : shipment.packages.map((pkg, index) => {
                  const fields = packageFieldsById[pkg.id] ?? { weight: pkg.weightLbs ?? "", length: pkg.dimLengthIn ?? "", width: pkg.dimWidthIn ?? "", height: pkg.dimHeightIn ?? "", notes: pkg.notes ?? "" };
                  const updateFields = (key: keyof typeof fields, value: string) => setPackageFieldsById((previous) => ({ ...previous, [pkg.id]: { ...fields, [key]: value } }));
                  return <div key={pkg.id} className="px-6 py-4">
                    <div className="flex items-center justify-between gap-3"><span className="font-semibold">{pkg.packageReference}</span><span className="text-xs text-muted-foreground">{shipment.items.filter((item) => item.packageId === pkg.id).reduce((sum, item) => sum + item.quantity, 0)} allocated unit(s)</span></div>
                    {advancedPacking && index > 0 && <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
                      {([['weight', 'Weight (lbs)'], ['length', 'Length (in)'], ['width', 'Width (in)'], ['height', 'Height (in)']] as const).map(([key, label]) => <label key={key} className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}<input type="number" className="h-9 rounded border border-input bg-background px-2 text-sm normal-case" value={fields[key]} onChange={(event) => updateFields(key, event.target.value)} disabled={!isDraft} /></label>)}
                      <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Package Notes<textarea rows={1} className="resize-none rounded border border-input bg-background p-2 text-sm normal-case" value={fields.notes} onChange={(event) => updateFields('notes', event.target.value)} disabled={!isDraft} /></label>
                    </div>}
                  </div>;
                })}
              </div>
            </div>
          </section>

          <aside className="sticky top-24 flex flex-col gap-6">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <label className="mb-3 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Shipment Status</label>
              <div className="mb-4 flex items-center gap-4">
                <div className="rounded-lg bg-primary/10 p-3 text-primary">
                  <Truck className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-2xl font-black tracking-tight">{shipment.status}</p>
                  <p className="text-xs text-muted-foreground">Created {toDateInput(shipment.createdAt) || "--"}</p>
                </div>
              </div>
              {isDraft && (
                <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-red-500">
                  <AlertTriangle className="h-5 w-5 animate-pulse" />
                  <div className="flex flex-col">
                    <p className="text-xs font-bold uppercase tracking-tight">Draft Shipment</p>
                    <p className="text-[10px]">Complete allocation and mark as shipped when ready</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                className={`flex w-full items-center justify-center gap-2 rounded-lg py-4 font-bold text-white transition-all ${markShippedDisabled ? "cursor-not-allowed bg-primary/50" : "bg-primary hover:bg-primary/90"}`}
                disabled={markShippedDisabled}
                onClick={() => void handleMarkShipped()}
              >
                {(markShipped.isPending || updateShipment.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                MARK AS SHIPPED
              </button>
              <button
                type="button"
                className="w-full rounded-lg border border-border bg-background py-3 text-sm font-bold transition-colors hover:bg-muted/50"
                disabled={!isDraft || updateShipment.isPending}
                onClick={() => void saveDraft()}
              >
                {updateShipment.isPending ? "SAVING..." : "SAVE DRAFT"}
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Documents</h3>
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="space-y-1 p-2">
                <a className="group flex items-center justify-between rounded p-3 transition-colors hover:bg-muted/50" href={`/fulfillment/shipments/${shipment.id}/manifest`} target="_blank" rel="noreferrer">
                  <div className="flex items-center gap-3"><FileText className="h-4 w-4 text-primary" /><span className="text-xs font-medium">Shipment Packing Slip / Manifest</span></div>
                  <Package className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                </a>
                <a className="group flex items-center justify-between rounded p-3 transition-colors hover:bg-muted/50" href={`/fulfillment/shipments/${shipment.id}/manifest`} target="_blank" rel="noreferrer">
                  <div className="flex items-center gap-3"><Printer className="h-4 w-4 text-primary" /><span className="text-xs font-medium">Print Package Tickets</span></div>
                  <Package className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                </a>
              </div>
            </div>

            <div className="relative h-32 overflow-hidden rounded-xl border border-border bg-card" title="Available with carrier integrations">
              <div className="absolute inset-0 z-10 flex cursor-help flex-col items-center justify-center bg-slate-900/80 p-4 text-center backdrop-blur-[2px]">
                <div className="rounded border border-border-dark bg-surface-dark p-2 shadow-xl">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Route Visualization</p>
                  <p className="mt-1 text-[9px] text-muted-foreground">Available with carrier integrations</p>
                </div>
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-surface-dark opacity-30" />
            </div>

            <div className="mt-2 border-t border-border pt-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Danger Zone</p>
              <button
                type="button"
                className="w-full rounded border border-red-500/30 py-2 text-[10px] font-bold uppercase tracking-wider text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!isDraft || voidShipment.isPending}
                onClick={() => void handleVoid()}
              >
                <span className="inline-flex items-center gap-1">
                  {voidShipment.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  Void Shipment
                </span>
              </button>
            </div>
          </aside>
        </div>

        <FulfillmentDebugPanel enabled={debugEnabled} lastResponse={lastResponse ?? shipmentQuery.data ?? null} lastError={lastError} />
      </main>
    </div>
  );
}

export default function FulfillmentShipmentDetailPage() {
  return <FulfillmentShipmentEditor />;
}
