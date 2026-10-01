import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Copy,
  FileText,
  Loader2,
  MapPinned,
  Truck,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FulfillmentDebugPanel } from "@/components/fulfillment/FulfillmentDebugPanel";
import { AuthenticatedArtworkThumbnail } from "@/components/artwork/AuthenticatedArtworkThumbnail";
import { AttachmentViewerDialog, type AttachmentData } from "@/components/AttachmentViewerDialog";
import { ShippingDocumentPrintDialog } from "@/components/production/ShippingDocumentPrintDialog";
import { toAttachmentViewerAttachments } from "@/lib/attachmentViewer";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";
import { fulfillmentReturnRoute } from "@/lib/fulfillmentWorkspaceMode";
import { shippingPartyAddressLines, shippingPartyValidationErrors, type ShipmentShippingContext, type ShippingParty } from "@shared/shippingDocuments";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  getOrderDetails,
  getFulfillmentOrderDetail,
  FulfillmentDetail,
  toFulfillmentError,
  useMarkShippedMutation,
  useCreateShipmentPackageMutation,
  useShipmentDetailQuery,
  useShippingDocumentSourceQuery,
  useUpdateShipmentMutation,
  useVoidShipmentMutation,
  useReverseTerminalFulfillmentMutation,
} from "@/hooks/useFulfillment";
import { formatDistanceToNowStrict } from "date-fns";
import { ROUTES } from "@/config/routes";
import { buildReferrer, toHref } from "@/lib/nav/smartBack";

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

function parseNumber(value: string | number): number | null {
  if (!String(value).trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const emptyShippingParty: ShippingParty = { name: null, company: null, address1: null, address2: null, city: null, state: null, postalCode: null, country: null, phone: null, email: null };
const partyFields: Array<[keyof ShippingParty, string]> = [["name", "Contact name"], ["company", "Company"], ["address1", "Street address"], ["address2", "Address line 2"], ["city", "City"], ["state", "State / province"], ["postalCode", "ZIP / postal code"], ["country", "Country"], ["phone", "Phone"], ["email", "Email"]];

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
  const { guardedNavigate: navigate } = useNavigationGuard();
  const { shipmentId: routeShipmentId } = useParams<{ shipmentId: string }>();
  const shipmentId = embeddedShipmentId ?? routeShipmentId;
  const location = useLocation();

  const [form, setForm] = useState<ShipmentFormState>(defaultForm);
  const [splitQuantities, setSplitQuantities] = useState<Record<string, number>>({});
  const [allocatedByLineItemId, setAllocatedByLineItemId] = useState<Record<string, number>>({});
  const [packageByLineItemId, setPackageByLineItemId] = useState<Record<string, string>>({});
  const [packageFieldsById, setPackageFieldsById] = useState<Record<string, { weight: string | number; length: string | number; width: string | number; height: string | number; notes: string }>>({});
  const [ordersById, setOrdersById] = useState<Record<string, OrderDetailLite>>({});
  const [fulfillmentByOrderId, setFulfillmentByOrderId] = useState<Record<string, FulfillmentDetail>>({});
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const [lastError, setLastError] = useState<{ code?: string; message?: string } | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [shipmentReversalOpen, setShipmentReversalOpen] = useState(false);
  const [shipmentReversalReason, setShipmentReversalReason] = useState("");
  const [shipmentReversalConfirmed, setShipmentReversalConfirmed] = useState(false);
  const [shipmentReversalQuantities, setShipmentReversalQuantities] = useState<Record<string, number>>({});
  const [shippingContext, setShippingContext] = useState<ShipmentShippingContext | null>(null);
  const customSenderDraft = useRef<ShippingParty | null>(null);
  const [editingDestination, setEditingDestination] = useState(false);
  const [artworkViewer, setArtworkViewer] = useState<{ attachments: AttachmentData[]; initialIndex: number } | null>(null);
  const hydratedShipmentId = useRef<string | null>(null);

  const debugEnabled = useMemo(() => new URLSearchParams(location.search).get("debug") === "1", [location.search]);

  const shipmentQuery = useShipmentDetailQuery(shipmentId);
  const updateShipment = useUpdateShipmentMutation(shipmentId || "");
  const markShipped = useMarkShippedMutation(shipmentId || "");
  const voidShipment = useVoidShipmentMutation(shipmentId || "");
  const reverseTerminalFulfillment = useReverseTerminalFulfillmentMutation();
  const createPackage = useCreateShipmentPackageMutation(shipmentId || "");

  const shipment = shipmentQuery.data;
  const documentSourceQuery = useShippingDocumentSourceQuery(shipmentId);
  const shipmentReversalLines = useMemo(() => {
    const quantities: Record<string, number> = {};
    for (const item of shipment?.items ?? []) quantities[item.orderLineItemId] = (quantities[item.orderLineItemId] ?? 0) + item.quantity;
    return Object.entries(quantities).map(([orderLineItemId, quantity]) => ({ orderLineItemId, quantity }));
  }, [shipment?.items]);

  useEffect(() => {
    if (!shipment) return;
    if (hydratedShipmentId.current === shipment.id) return;
    hydratedShipmentId.current = shipment.id;
    setShippingContext(shipment.shippingContext ?? null);
    customSenderDraft.current = shipment.shippingContext?.blindSenderSource === "ordering_customer" ? null : shipment.shippingContext?.blindSender ?? null;
    setEditingDestination(false);
    setArtworkViewer(null);
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
      allocatedMap[item.orderLineItemId] = (allocatedMap[item.orderLineItemId] ?? 0) + item.quantity;
    }
    setAllocatedByLineItemId(allocatedMap);
    setSplitQuantities({});
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
        size: string | null;
        material: string | null;
        options: string[];
        artwork: FulfillmentDetail["lineItems"][number]["artwork"];
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
        size: li.size,
        material: li.materialName,
        options: li.optionSummary ?? [],
        artwork: [...(li.artwork ?? [])].filter(file => file.source === "canonical" && !!file.fileRecordId).sort((a, b) => {
          const roles = ["modified_production", "production", "customer_source"];
          const rank = (role: string | null) => roles.includes(role || "") ? roles.indexOf(role!) : roles.length;
          return rank(a.role) - rank(b.role);
        }),
      }));

      return {
        orderId: orderRef.orderId,
        orderNumber: orderRef.orderNumber,
        customerName: order?.customer?.companyName || orderRef.customerName || "Unknown Customer",
        lineItems,
      };
    });
  }, [fulfillmentByOrderId, ordersById, shipment]);

  const destination = shipment?.status === "DRAFT" ? shippingContext?.destination : shipment?.documentSnapshot?.destination ?? shipment?.shippingContext?.destination;
  const blindShipping = shipment?.status === "DRAFT" ? shippingContext?.blindShipping : shipment?.documentSnapshot?.blindShipping ?? shipment?.shippingContext?.blindShipping;
  const sender = blindShipping
    ? (shipment?.status === "DRAFT" ? shippingContext?.blindSender : shipment?.documentSnapshot?.sender ?? shipment?.shippingContext?.blindSender)
    : shipment?.documentSnapshot?.sender ?? (documentSourceQuery.data?.blindShipping ? undefined : documentSourceQuery.data?.sender);
  const missingDestination = destination ? shippingPartyValidationErrors(destination) : ["shipping destination"];
  const missingBlindSender = blindShipping ? sender ? shippingPartyValidationErrors(sender) : ["alternate sender"] : [];

  const draftShipmentItems = useMemo(() => lineItemsByOrder.flatMap(group =>
    group.lineItems.flatMap(item => {
      const existing = shipment?.items.filter(allocation => allocation.orderLineItemId === item.id) ?? [];
      return existing.length > 1
        ? existing.map(allocation => ({
          orderId: group.orderId, orderLineItemId: item.id,
          quantity: splitQuantities[allocation.id] ?? allocation.quantity, packageId: allocation.packageId,
        }))
        : [{ orderId: group.orderId, orderLineItemId: item.id,
          quantity: Number(allocatedByLineItemId[item.id] || 0), packageId: packageByLineItemId[item.id] || null }];
    }),
  ), [lineItemsByOrder, shipment?.items, splitQuantities, allocatedByLineItemId, packageByLineItemId]);

  const validationErrors = useMemo(() => {
    const errors = new Set<string>();
    for (const allocation of draftShipmentItems) {
      if (!Number.isInteger(allocation.quantity) || allocation.quantity < 0) errors.add(allocation.orderLineItemId);
    }
    for (const group of lineItemsByOrder) {
      for (const item of group.lineItems) {
        const allocated = Number(allocatedByLineItemId[item.id] || 0);
        if (!Number.isInteger(allocated) || allocated < 0 || allocated > item.remainingQty) {
          errors.add(item.id);
        }
      }
    }
    return errors;
  }, [allocatedByLineItemId, lineItemsByOrder, draftShipmentItems]);

  const allocatedCount = useMemo(
    () => Object.values(allocatedByLineItemId).reduce((acc, value) => acc + (Number(value) > 0 ? Number(value) : 0), 0),
    [allocatedByLineItemId],
  );

  const hasUnsavedChanges = shipment?.status === "DRAFT" && (
    form.carrier !== (shipment.carrier ?? "") || form.serviceLevel !== (shipment.serviceLevel ?? "") ||
    form.trackingNumber !== (shipment.trackingNumber ?? "") || form.shipDate !== toDateInput(shipment.shipDate) ||
    form.internalNotes !== (shipment.internalNotes ?? "") ||
    JSON.stringify(shippingContext) !== JSON.stringify(shipment.shippingContext ?? null) ||
    JSON.stringify(draftShipmentItems.filter(item => item.quantity > 0).map(item => [item.orderId, item.orderLineItemId, item.packageId || null, item.quantity]).sort()) !==
      JSON.stringify(shipment.items.map(item => [item.orderId, item.orderLineItemId, item.packageId || null, item.quantity]).sort()) ||
    shipment.packages.some((pkg, index) => {
      const fields = index === 0 ? { weight: form.weight, length: form.length, width: form.width, height: form.height, notes: form.packageNotes } : packageFieldsById[pkg.id];
      return !!fields && (parseNumber(fields.weight) !== parseNumber(pkg.weightLbs ?? "") ||
        parseNumber(fields.length) !== parseNumber(pkg.dimLengthIn ?? "") || parseNumber(fields.width) !== parseNumber(pkg.dimWidthIn ?? "") ||
        parseNumber(fields.height) !== parseNumber(pkg.dimHeightIn ?? "") || fields.notes !== (pkg.notes ?? ""));
    })
  );
  const documentActionsDisabled = !!hasUnsavedChanges || loadingOrders || updateShipment.isPending;

  const markShippedDisabled =
    loadingOrders || shipment?.orders.some(order => !fulfillmentByOrderId[order.orderId]) || !shipment ||
    shipment.status !== "DRAFT" ||
    validationErrors.size > 0 ||
    allocatedCount <= 0 ||
    missingDestination.length > 0 || missingBlindSender.length > 0 ||
    markShipped.isPending ||
    updateShipment.isPending;

  const saveDraft = async (silent = false) => {
    if (!shipmentId || !shipment || shipment.status !== "DRAFT" || loadingOrders || shipment.orders.some(order => !fulfillmentByOrderId[order.orderId]) || validationErrors.size > 0) return;
    try {
      setLastError(null);

      const shipmentItems = draftShipmentItems.filter(item => item.quantity > 0);

      const payload = {
        carrier: form.carrier || null,
        serviceLevel: form.serviceLevel || null,
        trackingNumber: form.trackingNumber || null,
        shipDate: form.shipDate || null,
        internalNotes: form.internalNotes || null,
        ...(shippingContext ? { shippingContext } : {}),
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
        shipmentItems,
      };

      const response = await updateShipment.mutateAsync(payload);
      setLastResponse(response);
      setPackageByLineItemId(Object.fromEntries(shipmentItems.filter(item => item.packageId).map(item => [item.orderLineItemId, item.packageId!])));

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
    if (!shipmentId || !shipment) return;
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
    if (!shipmentId || !shipment || markShippedDisabled) return;
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
    if (!shipmentId || !shipment) return;
    try {
      setLastError(null);
      const response = await voidShipment.mutateAsync();
      setLastResponse(response);
      toast({ title: "Shipment voided", description: `${shipment.shipmentReference || "Shipment"} moved to VOIDED` });
      await shipmentQuery.refetch();
      await onMutationComplete?.();
    } catch (error) {
      const parsed = toFulfillmentError(error);
      setLastError({ code: parsed.code, message: parsed.message });
      toast({ title: "Void failed", description: parsed.message, variant: "destructive" });
    }
  };

  const handleShipmentReversal = async () => {
    if (!shipmentId || !shipment || !shipmentReversalConfirmed || !shipmentReversalReason.trim()) return;
    const items = shipmentReversalLines.map((item) => ({ orderLineItemId: item.orderLineItemId, quantity: Math.floor(Number(shipmentReversalQuantities[item.orderLineItemId] ?? 0)) })).filter((item) => item.quantity > 0);
    if (!items.length) return;
    try {
      setLastError(null);
      const response = await reverseTerminalFulfillment.mutateAsync({ sourceType: "SHIPMENT", sourceId: shipmentId, items, reason: shipmentReversalReason.trim(), clientRequestId: crypto.randomUUID() });
      setLastResponse(response);
      toast({ title: "Shipment reversal recorded", description: "Shipment history is retained and its fulfillment quantity has been reopened." });
      setShipmentReversalOpen(false);
      await shipmentQuery.refetch();
      await onMutationComplete?.();
    } catch (error) {
      const parsed = toFulfillmentError(error);
      setLastError({ code: parsed.code, message: parsed.message });
      toast({ title: "Shipment reversal failed", description: parsed.message, variant: "destructive" });
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
        {shipmentQuery.isError ? <><h2 className="font-semibold">Could not load shipment</h2><p role="alert" className="mt-2 text-sm text-muted-foreground">{toFulfillmentError(shipmentQuery.error).message}</p><button type="button" className="mt-3 rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => void shipmentQuery.refetch()}>Retry</button></> : <p className="text-sm text-muted-foreground">Shipment not found.</p>}
      </div>
    );
  }

  const isDraft = shipment.status === "DRAFT";
  const isSingleOrderShipment = shipment.orders.length === 1;
  const advancedPacking = shipment.packingMode === "advanced_separate_packing" || splitMode;
  const packedCount = isDraft ? allocatedCount : shipment.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const updatedAgo = formatDistanceToNowStrict(new Date(shipment.updatedAt), { addSuffix: true });
  const returnRoute = fulfillmentReturnRoute(location.state?.referrer, [ROUTES.fulfillment.list, ...shipment.orders.map(order => ROUTES.fulfillment.order(order.orderId))]);
  const editContext = () => {
    setShippingContext(context => ({ ...(context ?? { version: 1, sourceOrderId: shipment.primaryOrderId ?? shipment.orders[0]?.orderId ?? null, destination: { ...emptyShippingParty }, blindShipping: false, blindSender: null }), source: "staff" }));
    setEditingDestination(true);
  };

  const enableBlindShipping = (enabled: boolean) => {
    setShippingContext(context => {
      if (!context) return context;
      if (!enabled) return { ...context, source: "staff", blindShipping: false };
      if (context.blindSender) return { ...context, source: "staff", blindShipping: true };
      const customerSender = shipment.orderingCustomer?.sender;
      return customerSender && !shipment.orderingCustomer?.issue
        ? { ...context, source: "staff", blindShipping: true, blindSender: { ...customerSender }, blindSenderSource: "ordering_customer" }
        : { ...context, source: "staff", blindShipping: true, blindSender: { ...emptyShippingParty }, blindSenderSource: "custom" };
    });
  };

  const chooseSender = (choice: "ordering_customer" | "custom") => {
    setShippingContext(context => {
      if (!context) return context;
      if (choice === "ordering_customer") {
        if (context.blindSenderSource !== "ordering_customer") customSenderDraft.current = context.blindSender;
        return { ...context, source: "staff", blindSenderSource: choice, blindSender: shipment.orderingCustomer?.sender ? { ...shipment.orderingCustomer.sender } : null };
      }
      return { ...context, source: "staff", blindSenderSource: choice, blindSender: { ...(customSenderDraft.current ?? emptyShippingParty) } };
    });
  };

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
              aria-label="Back to fulfillment workspace"
              onClick={() => navigate(returnRoute ? toHref(returnRoute) : ROUTES.fulfillment.list, { state: returnRoute ? location.state?.referrerState : undefined })}
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
          <aside className={embedded ? "hidden" : "order-3 flex min-w-0 flex-col gap-4 xl:order-none"}>
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

              const addressPreview = destination ? shippingPartyAddressLines(destination).join(", ") : "Destination not recorded";

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

          <section className="order-1 flex min-w-0 flex-col gap-6 xl:order-none">
            <section className="rounded-xl border border-primary/30 bg-card p-4 md:p-5" aria-labelledby="shipment-destination-heading">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="shipment-destination-heading" className="flex items-center gap-2 text-lg font-bold"><MapPinned className="h-5 w-5 text-primary" />Ship To</h2><div className="flex items-center gap-2">{blindShipping && <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold">Blind shipment</span>}{isDraft && <button type="button" className="rounded border px-3 py-1.5 text-xs font-semibold hover:bg-muted" onClick={editContext}>{editingDestination ? "Editing destination" : "Edit destination / sender"}</button>}</div></div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2"><div>{destination ? <address className="not-italic text-sm leading-relaxed">{shippingPartyAddressLines(destination).map((line, index) => <p key={index} className={index === 0 ? "font-semibold" : ""}>{line}</p>)}{destination.phone && <p className="mt-1">{destination.phone}</p>}{destination.email && <p className="break-all">{destination.email}</p>}</address> : <p className="text-sm text-muted-foreground">Destination not recorded for this shipment.</p>}</div><div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{blindShipping ? "Alternate sender" : "Sender"}</h3>{sender ? <address className="not-italic text-sm leading-relaxed">{shippingPartyAddressLines(sender).map((line, index) => <p key={index}>{line}</p>)}{sender.phone && <p>{sender.phone}</p>}{sender.email && <p className="break-all">{sender.email}</p>}</address> : <p className="text-sm text-muted-foreground">{blindShipping ? "Alternate sender not recorded. No sender will be guessed." : documentSourceQuery.isLoading ? "Loading saved document sender..." : "Sender unavailable from the saved document source."}</p>}</div></div>
              {(missingDestination.length > 0 || missingBlindSender.length > 0) && <div role="alert" className="mt-3 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><p>Missing {missingDestination.length ? `Ship To: ${missingDestination.join(", ")}` : ""}{missingDestination.length && missingBlindSender.length ? "; " : ""}{missingBlindSender.length ? `alternate sender: ${missingBlindSender.join(", ")}` : ""}.</p>{isDraft ? <button type="button" className="mt-1 font-semibold underline" onClick={editContext}>Complete destination / sender before shipping</button> : <p className="mt-1">Historical destination is not reconstructed from live customer fields.</p>}</div>}
              {isDraft && editingDestination && shippingContext && <div className="mt-4 space-y-4 border-t pt-4">
                <fieldset><legend className="mb-2 text-sm font-semibold">Shipment destination</legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{partyFields.map(([key, label]) => <label key={key} className="grid gap-1 text-xs font-medium">{label}<input aria-label={`Ship To ${label}`} className="h-9 min-w-0 rounded border border-input bg-background px-2 text-sm" value={shippingContext.destination[key] ?? ""} onChange={event => setShippingContext(context => context && ({ ...context, source: "staff", destination: { ...context.destination, [key]: event.target.value || null } }))} /></label>)}</div></fieldset>
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={shippingContext.blindShipping} onChange={event => enableBlindShipping(event.target.checked)} />Blind shipping: use an alternate sender</label>
                {shippingContext.blindShipping && <fieldset className="space-y-3"><legend className="text-sm font-semibold">Sender</legend>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    <label className="flex items-center gap-2"><input type="radio" name="blind-sender-source" checked={shippingContext.blindSenderSource === "ordering_customer"} onChange={() => chooseSender("ordering_customer")} />Ordering Customer</label>
                    <label className="flex items-center gap-2"><input type="radio" name="blind-sender-source" checked={shippingContext.blindSenderSource !== "ordering_customer"} onChange={() => chooseSender("custom")} />Custom Sender</label>
                  </div>
                  {shippingContext.blindSenderSource !== "ordering_customer" && !shippingContext.blindSender?.address1 && shipment.orderingCustomer?.issue && <p className="text-xs text-muted-foreground">{shipment.orderingCustomer.issue} Enter a Custom Sender to ship.</p>}
                  {shippingContext.blindSenderSource === "ordering_customer"
                    ? <div className="min-w-0 rounded border bg-muted/30 p-3 text-sm">
                        {shippingContext.blindSender && <address className="not-italic leading-relaxed">{shippingPartyAddressLines(shippingContext.blindSender).map((line, index) => <p key={index} className="break-words">{line}</p>)}{shippingContext.blindSender.phone && <p>{shippingContext.blindSender.phone}</p>}{shippingContext.blindSender.email && <p className="break-all">{shippingContext.blindSender.email}</p>}</address>}
                        {shippingContext.blindSender && shippingPartyValidationErrors(shippingContext.blindSender).length > 0 && <p role="alert" className="mt-2 text-destructive">Ordering Customer sender is incomplete: {shippingPartyValidationErrors(shippingContext.blindSender).join(", ")}. Select Custom Sender to enter a complete sender.</p>}
                        {!shippingContext.blindSender && <p role="alert">Ordering Customer sender is unavailable. Select Custom Sender.</p>}
                        <p className="mt-2 text-xs text-muted-foreground">This sender is copied into the shipment draft; later Customer changes will not update it.</p>
                      </div>
                    : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{partyFields.map(([key, label]) => <label key={key} className="grid gap-1 text-xs font-medium">{label}<input aria-label={`Alternate sender ${label}`} className="h-9 min-w-0 rounded border border-input bg-background px-2 text-sm" value={shippingContext.blindSender?.[key] ?? ""} onChange={event => setShippingContext(context => { if (!context) return context; const blindSender = { ...emptyShippingParty, ...context.blindSender, [key]: event.target.value || null }; customSenderDraft.current = blindSender; return { ...context, source: "staff", blindSenderSource: "custom", blindSender }; })} /></label>)}</div>}
                </fieldset>}
                <p className="text-xs text-muted-foreground">Saved with this draft only. Order and customer records are unchanged.</p>
              </div>}
            </section>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
                <h3 className="text-sm font-bold uppercase tracking-wider">Items in Shipment</h3>
                <span className="text-xs text-muted-foreground">{lineItemsByOrder.reduce((acc, group) => acc + group.lineItems.length, 0)} items total across {lineItemsByOrder.length} orders</span>
              </div>
              {!advancedPacking && <div className="flex flex-wrap items-center justify-between gap-3 p-6 text-sm"><div><p className="font-semibold">Items packed: {packedCount}</p><p className="mt-1 text-muted-foreground">Choose how many units are leaving now. Reduce Qty in this shipment for a partial shipment; set zero to leave a line out.</p></div>{isDraft && <button type="button" className="rounded border px-3 py-2 text-xs font-bold hover:bg-muted" onClick={() => setSplitMode(true)}>Split Shipment / Packages</button>}</div>}
              <div>
                <table className="block w-full text-left">
                  <thead className="sr-only">
                    <tr className="border-b border-border bg-muted/30">
                      {lineItemsByOrder.length > 1 && <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Order Ref</th>}
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Artwork / Item</th>
                      <th className="px-6 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ordered</th>
                      <th className="px-6 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Remaining</th>
                      <th className="px-6 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Qty in this shipment</th>
                      <th className="px-6 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Package</th>
                    </tr>
                  </thead>
                  <tbody className="block divide-y divide-border">
                    {loadingOrders && (
                      <tr className="block">
                        <td colSpan={lineItemsByOrder.length > 1 ? 6 : 5} className="block px-4 py-6 text-center text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading order line items...
                          </span>
                        </td>
                      </tr>
                    )}

                    {!loadingOrders && lineItemsByOrder.map((group) => (
                      <Fragment key={group.orderId}>
                        <tr key={`${group.orderId}-header`} className="block bg-muted/20">
                          <td className="block px-4 py-2" colSpan={lineItemsByOrder.length > 1 ? 6 : 5}>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase text-primary">Order #{group.orderNumber}</span>
                              <span className="h-px flex-1 bg-border" />
                            </div>
                          </td>
                        </tr>

                        {group.lineItems.map((item) => {
                          const value = Number(allocatedByLineItemId[item.id] || 0);
                          const hasError = validationErrors.has(item.id);
                          const splits = shipment.items.filter(allocation => allocation.orderLineItemId === item.id);
                          return (
                            <tr key={item.id} className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
                              {lineItemsByOrder.length > 1 && <td className="col-span-2 block text-xs font-mono text-muted-foreground sm:col-span-4">#{group.orderNumber}</td>}
                              <td className="col-span-2 block min-w-0 sm:col-span-4">
                                <div className="flex min-w-0 items-start gap-3"><div className="max-w-[140px] shrink-0">{item.artwork.length ? <div className="flex flex-wrap gap-1">{item.artwork.map((file, index) => <button key={`${file.id}-${file.fileRecordId}`} type="button" aria-label={`View artwork ${file.fileName} for ${item.label}, Order ${group.orderNumber}`} title={`${file.fileName} (${file.role || "artwork"})`} className="flex h-16 w-16 items-center justify-center overflow-hidden rounded border border-border bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setArtworkViewer({ attachments: toAttachmentViewerAttachments(item.artwork), initialIndex: index })}><AuthenticatedArtworkThumbnail fileRecordId={file.fileRecordId} fileName={file.fileName} mimeType={file.mimeType} previewStatus={file.previewStatus} previewError={file.previewError} alt={file.fileName} className="h-full w-full object-contain text-[10px]" fallback={<span className="p-1 text-[10px] text-muted-foreground">No artwork available</span>} /></button>)}</div> : <span className="block w-16 text-xs text-muted-foreground">No artwork available</span>}</div><div className="min-w-0 break-words"><p className="text-sm font-bold">{item.label}</p>{(item.size || item.material) && <p className="mt-1 text-xs text-muted-foreground">{[item.size, item.material].filter(Boolean).join(" · ")}</p>}{item.options.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{item.options.join(" · ")}</p>}{item.artwork[0] && <p className="mt-1 text-[10px] text-muted-foreground">{item.artwork[0].role === "modified_production" || item.artwork[0].role === "production" ? "Production artwork first" : "Source artwork"}</p>}</div></div>
                              </td>
                              <td className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">Ordered</span>{item.orderedQty}</td>
                              <td className={`block text-sm font-medium ${item.remainingQty === 0 ? "text-muted-foreground" : "text-foreground"}`}><span className="mb-1 block text-xs font-normal text-muted-foreground">Remaining</span>{item.remainingQty}</td>
                              <td className="block min-w-0">
                                <span className="mb-1 block text-xs font-medium text-muted-foreground">Qty in this shipment</span>
                                <div className="inline-flex items-center gap-2">
                                  {splits.length <= 1 ? <input
                                    type="number"
                                    aria-label={`Qty in this shipment: ${item.label}`}
                                    min={0}
                                    max={item.remainingQty}
                                    step={1}
                                    value={value}
                                    disabled={!isDraft}
                                    className={`h-8 w-16 rounded border-2 bg-background text-center text-sm font-bold focus:border-primary focus:ring-0 ${hasError ? "border-red-500" : "border-primary/20"}`}
                                    onChange={(event) => {
                                      const next = Math.max(0, Number(event.target.value || 0));
                                      setAllocatedByLineItemId((prev) => ({ ...prev, [item.id]: next }));
                                    }}
                                  /> : <div className="space-y-2">{splits.map(allocation => <label key={allocation.id} className="flex min-w-0 flex-col items-start gap-1 break-all text-xs">
                                    {shipment.packages.find(pkg => pkg.id === allocation.packageId)?.packageReference || "Unpacked"}
                                    <input type="number" aria-label={`Qty in package ${allocation.packageId}: ${item.label}`} min={0} max={item.remainingQty} step={1} disabled={!isDraft}
                                      className="h-8 w-16 rounded border bg-background text-center" value={splitQuantities[allocation.id] ?? allocation.quantity}
                                      onChange={event => {
                                        const next = Math.max(0, Number(event.target.value || 0));
                                        setSplitQuantities(values => ({ ...values, [allocation.id]: next }));
                                        setAllocatedByLineItemId(values => ({ ...values, [item.id]: splits.reduce(
                                          (sum, part) => sum + (part.id === allocation.id ? next : splitQuantities[part.id] ?? part.quantity), 0,
                                        ) }));
                                      }} />
                                  </label>)}</div>}
                                </div>
                                {hasError && <p className="mt-1 text-[10px] font-bold text-red-500">Enter a whole quantity from 0 to {item.remainingQty}</p>}
                              </td>
                              <td className="block min-w-0">
                                <span className="mb-1 block text-xs font-medium text-muted-foreground">Package</span>
                                <select
                                  aria-label={`Package assignment: ${item.label}, Order ${group.orderNumber}`}
                                  className="h-8 w-full min-w-0 max-w-[180px] rounded border border-input bg-background px-2 text-xs"
                                  disabled={!isDraft || shipment.packages.length === 0 || splits.length > 1}
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
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-6 py-3">
                <div><h3 className="text-sm font-bold uppercase tracking-wider">Packages</h3><p className="text-xs text-muted-foreground">{advancedPacking ? "Assign split quantities to physical packages." : "Package count is derived from package records."}</p></div>
                {(advancedPacking || shipment.packages.length === 0) && <button type="button" className="rounded border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted" disabled={!isDraft || createPackage.isPending} onClick={() => void handleAddPackage()}>
                  {createPackage.isPending ? "ADDING..." : "ADD PACKAGE"}
                </button>}
              </div>
              <div className="divide-y divide-border">
                {shipment.packages.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No packages yet. Create one to group physical contents and print a package ticket.</p> : shipment.packages.map((pkg, index) => {
                  const fields = index === 0 ? { weight: form.weight, length: form.length, width: form.width, height: form.height, notes: form.packageNotes } : packageFieldsById[pkg.id] ?? { weight: pkg.weightLbs ?? "", length: pkg.dimLengthIn ?? "", width: pkg.dimWidthIn ?? "", height: pkg.dimHeightIn ?? "", notes: pkg.notes ?? "" };
                  const updateFields = (key: keyof typeof fields, value: string) => index === 0 ? setForm(previous => ({ ...previous, [key === "notes" ? "packageNotes" : key]: value })) : setPackageFieldsById((previous) => ({ ...previous, [pkg.id]: { ...fields, [key]: value } }));
                  return <div key={pkg.id} className="px-6 py-4">
                    <div className="flex items-center justify-between gap-3"><span className="font-semibold">{pkg.packageReference}</span><span className="text-xs text-muted-foreground">{(isDraft ? draftShipmentItems : shipment.items).filter(item => item.packageId === pkg.id).reduce((sum, item) => sum + item.quantity, 0)} allocated unit(s)</span></div>
                    <details className="mt-2" open={Object.values(fields).some(value => String(value).trim()) || undefined}><summary className="cursor-pointer text-xs font-medium text-muted-foreground">Dimensions, weight & package notes</summary><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                      {([['weight', 'Weight (lbs)'], ['length', 'Length (in)'], ['width', 'Width (in)'], ['height', 'Height (in)']] as const).map(([key, label]) => <label key={key} className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}<input type="number" className="h-9 rounded border border-input bg-background px-2 text-sm normal-case" value={fields[key]} onChange={(event) => updateFields(key, event.target.value)} disabled={!isDraft} /></label>)}
                      <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted-foreground md:col-span-4">Package Notes<textarea aria-label={`Package notes: ${pkg.packageReference}`} rows={2} className="resize-none rounded border border-input bg-background p-2 text-sm normal-case" value={fields.notes} onChange={(event) => updateFields('notes', event.target.value)} disabled={!isDraft} /></label>
                    </div></details>
                  </div>;
                })}
              </div>
            </div>
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-4 py-3"><h3 className="text-sm font-bold">Carrier & Tracking</h3></div>
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">{([["carrier", "Carrier"], ["serviceLevel", "Service Level"], ["trackingNumber", "Tracking Number"], ["shipDate", "Ship Date"]] as const).map(([key, label]) => <label key={key} className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">{label}<div className="flex gap-1"><input aria-label={label} type={key === "shipDate" ? "date" : "text"} className="h-9 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm text-foreground" value={form[key]} disabled={!isDraft} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} />{key === "trackingNumber" && <button type="button" aria-label="Copy tracking number" className="rounded border px-2 hover:bg-muted" onClick={() => navigator.clipboard?.writeText(form.trackingNumber || "")}><Copy className="h-4 w-4" /></button>}</div></label>)}</div>
            </section>
            <details className="rounded-xl border border-border bg-card p-4" open={!!form.internalNotes || undefined}><summary className="cursor-pointer text-sm font-semibold">Shipment Internal Notes</summary><textarea aria-label="Shipment internal notes" className="mt-3 w-full resize-none rounded border border-input bg-background p-3 text-sm" rows={2} placeholder="Internal shipping instructions..." value={form.internalNotes} disabled={!isDraft} onChange={event => setForm(previous => ({ ...previous, internalNotes: event.target.value }))} /></details>
          </section>

          <aside className="order-2 flex min-w-0 flex-col gap-4 xl:order-none xl:sticky xl:top-24">
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
                   <AlertTriangle className="h-5 w-5" />
                  <div className="flex flex-col">
                    <p className="text-xs font-bold uppercase tracking-tight">Draft Shipment</p>
                    <p className="text-[10px]">Complete allocation and mark as shipped when ready</p>
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Documents</h3>
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="divide-y px-4">{([["packing_slip", "Packing Slip"], ["shipment_manifest", "Shipment Manifest"]] as const).map(([documentType, label]) => <div key={documentType} className="space-y-2 py-3"><p className="text-sm font-semibold">{label}</p><div className="flex flex-wrap items-center gap-2">{documentActionsDisabled ? <><button type="button" disabled className="rounded border px-3 py-1.5 text-xs opacity-50" aria-label={`Preview ${label}`}>Preview</button><button type="button" disabled className="rounded border px-3 py-1.5 text-xs opacity-50" aria-label={`Print ${label}`}>Print</button></> : <><a className="rounded border px-3 py-1.5 text-xs font-semibold hover:bg-muted" aria-label={`Preview ${label}`} href={`/fulfillment/shipments/${shipment.id}/manifest?documentType=${documentType}`} target="_blank" rel="noreferrer">Preview</a><ShippingDocumentPrintDialog shipmentId={shipment.id} documentType={documentType} label="Print" /></>}</div></div>)}{shipment.packages.map(pkg => <div key={pkg.id} className="space-y-2 py-3"><p className="text-xs font-semibold">Package Ticket · {pkg.packageReference}</p><div className="flex flex-wrap items-center gap-2">{documentActionsDisabled ? <><button type="button" disabled className="rounded border px-3 py-1.5 text-xs opacity-50" aria-label={`Preview Package Ticket ${pkg.packageReference}`}>Preview</button><button type="button" disabled className="rounded border px-3 py-1.5 text-xs opacity-50" aria-label={`Print Package Ticket ${pkg.packageReference}`}>Print</button></> : <><a className="rounded border px-3 py-1.5 text-xs font-semibold hover:bg-muted" aria-label={`Preview Package Ticket ${pkg.packageReference}`} href={`/fulfillment/shipments/${shipment.id}/manifest?documentType=package_ticket&packageId=${encodeURIComponent(pkg.id)}`} target="_blank" rel="noreferrer">Preview</a><ShippingDocumentPrintDialog shipmentId={shipment.id} documentType="package_ticket" packageId={pkg.id} label="Print" /></>}</div></div>)}</div>
              {isDraft && <p role={hasUnsavedChanges ? "status" : undefined} className="border-t px-4 py-2 text-xs text-muted-foreground">{hasUnsavedChanges ? "Save draft before previewing or printing. Documents use saved quantities and context." : "Documents use saved quantities and context."}</p>}
              {documentSourceQuery.isError && <p className="border-t px-4 py-2 text-xs text-destructive">{toFulfillmentError(documentSourceQuery.error).message}</p>}
            </div>

            {isDraft && <div className="flex flex-col gap-3">
              <button type="button" className="w-full rounded-lg border border-border bg-background py-3 text-sm font-bold transition-colors hover:bg-muted/50" disabled={updateShipment.isPending || loadingOrders || validationErrors.size > 0 || shipment.orders.some(order => !fulfillmentByOrderId[order.orderId])} onClick={() => void saveDraft()}>{updateShipment.isPending ? "SAVING..." : "SAVE DRAFT"}</button>
              <button type="button" className={`flex w-full items-center justify-center gap-2 rounded-lg py-3 font-bold text-primary-foreground transition-colors ${markShippedDisabled ? "cursor-not-allowed bg-primary/50" : "bg-primary hover:bg-primary/90"}`} disabled={markShippedDisabled} onClick={() => void handleMarkShipped()}>{(markShipped.isPending || updateShipment.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}MARK AS SHIPPED</button>
            </div>}
            {lastError && <p role="alert" className="rounded border border-destructive/30 p-3 text-sm text-destructive">{lastError.message}</p>}
            {shipment.orders.map(order => <button key={order.orderId} type="button" className="rounded border px-3 py-2 text-sm font-semibold hover:bg-muted" onClick={() => navigate(`${ROUTES.orders.detail(order.orderId)}?panel=timeline`, { state: { referrer: buildReferrer(location), referrerState: location.state } })}>View Order {shipment.orders.length > 1 ? `#${order.orderNumber} ` : ""}Timeline</button>)}

            <details className="mt-2 border-t border-border pt-4">
              <summary className="mb-3 cursor-pointer text-xs font-semibold text-muted-foreground">Exceptional actions</summary>
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
              {shipment.status === "SHIPPED" && isSingleOrderShipment && fulfillmentByOrderId[shipment.orders[0].orderId]?.permissions?.canReverseTerminalFulfillment ? <button
                type="button"
                className="mt-2 w-full rounded border border-red-500/30 py-2 text-[10px] font-bold uppercase tracking-wider text-red-500 transition-colors hover:bg-red-500/10"
                onClick={() => { setShipmentReversalReason(""); setShipmentReversalConfirmed(false); setShipmentReversalQuantities(Object.fromEntries(shipmentReversalLines.map((item) => [item.orderLineItemId, item.quantity]))); setShipmentReversalOpen(true); }}
              >
                Reverse Shipment
              </button> : null}
            </details>
          </aside>
        </div>

        <FulfillmentDebugPanel enabled={debugEnabled} lastResponse={lastResponse ?? shipmentQuery.data ?? null} lastError={lastError} />
        <AttachmentViewerDialog open={!!artworkViewer} onOpenChange={open => !open && setArtworkViewer(null)} attachments={artworkViewer?.attachments ?? []} initialIndex={artworkViewer?.initialIndex ?? 0} />
        <AlertDialog open={shipmentReversalOpen} onOpenChange={setShipmentReversalOpen}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Reverse Shipment</AlertDialogTitle><AlertDialogDescription>This records a TitanOS fulfillment correction only. Shipment, carrier, tracking, and invoice/payment history remain intact; the allocated quantity will reopen for fulfillment.</AlertDialogDescription></AlertDialogHeader>
            <div className="space-y-3"><p className="text-sm">Set the quantity to reopen for each original shipment line. Prior reversals are checked by the server.</p>{shipmentReversalLines.map((item) => <label key={item.orderLineItemId} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0">{item.orderLineItemId} <span className="text-muted-foreground">(originally {item.quantity})</span></span><input aria-label={`Reverse quantity: ${item.orderLineItemId}`} type="number" min={0} max={item.quantity} className="h-9 w-24 rounded border border-input bg-background px-2" value={shipmentReversalQuantities[item.orderLineItemId] ?? 0} onChange={(event) => setShipmentReversalQuantities((current) => ({ ...current, [item.orderLineItemId]: Math.max(0, Math.min(Number(item.quantity || 0), Math.floor(Number(event.target.value) || 0))) }))} /></label>)}<textarea aria-label="Shipment reversal reason" className="min-h-24 w-full rounded border border-input bg-background p-3 text-sm" value={shipmentReversalReason} onChange={(event) => setShipmentReversalReason(event.target.value)} placeholder="Reason for correction" /><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={shipmentReversalConfirmed} onChange={(event) => setShipmentReversalConfirmed(event.target.checked)} /><span>I understand this reopens fulfillment quantity without cancelling the carrier transaction or deleting shipment history.</span></label></div>
            <AlertDialogFooter><AlertDialogCancel disabled={reverseTerminalFulfillment.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={!shipmentReversalReason.trim() || !shipmentReversalConfirmed || reverseTerminalFulfillment.isPending} onClick={(event) => { event.preventDefault(); void handleShipmentReversal(); }}>{reverseTerminalFulfillment.isPending ? "Reversing…" : "Reverse Shipment"}</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}

export default function FulfillmentShipmentDetailPage() {
  return <FulfillmentShipmentEditor />;
}
