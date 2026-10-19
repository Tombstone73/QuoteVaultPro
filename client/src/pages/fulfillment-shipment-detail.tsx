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
import { apiFetchBlob } from "@/lib/queryClient";
import { FulfillmentDebugPanel } from "@/components/fulfillment/FulfillmentDebugPanel";
import { AuthenticatedArtworkThumbnail } from "@/components/artwork/AuthenticatedArtworkThumbnail";
import { AttachmentViewerDialog, type AttachmentData } from "@/components/AttachmentViewerDialog";
import { ShippingDocumentPrintDialog } from "@/components/production/ShippingDocumentPrintDialog";
import { toAttachmentViewerAttachments } from "@/lib/attachmentViewer";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";
import { fulfillmentReturnRoute } from "@/lib/fulfillmentWorkspaceMode";
import { shippingPartyAddressLines, shippingPartyValidationErrors, shipmentShippingContextMismatches, type ShipmentShippingContext, type ShippingParty } from "@shared/shippingDocuments";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getOrderDetails,
  getCurrentOrderDestination,
  getFulfillmentOrderDetail,
  apiCall,
  FulfillmentDetail,
  toFulfillmentError,
  useMarkShippedMutation,
  useCreateShipmentPackageMutation,
  useShipmentDetailQuery,
  useShippingDocumentSourceQuery,
  useUpdateShipmentMutation,
  useVoidShipmentMutation,
  useReverseTerminalFulfillmentMutation,
  type ShipmentDetail,
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

type UpsCustomerCharge = { orderId: string; orderNumber: string | null; shippingCents: number;
  shippingChargeDecision: string; shippingChargeRateQuoteId: string | null;
  shippingChargeRateServiceCode: string | null; updatedAt: string };
type UpsLabelHistory = { id: string; status: string; environment: 'unknown' | 'test' | 'live'; serviceName: string; estimateCents: number;
  estimateCurrency: string; carrierCostCents: number | null; carrierCurrency: string | null;
  providerShipmentId: string | null; purchasedAt: string | null; errorCode: string | null;
  voidProviderCode: string | null;
  voidAcceptedAt: string | null; externalCanceledAt: string | null; externalCancelReason: string | null;
  adjustments: Array<{ id: string; kind: string; amountCents: number; currency: string; providerReference: string }>;
  labels: Array<{ packageId: string; trackingNumber: string; labelFormat: string }> };

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

function invalidPackageNumber(value: string | number): boolean {
  const text = String(value).trim();
  return text !== '' && (!/^(?:\d+|\d*\.\d{1,2})$/.test(text) || !Number.isFinite(Number(text)));
}

type PackageFields = { weight: string | number; length: string | number; width: string | number; height: string | number; notes: string };
type DraftPatch = Parameters<ReturnType<typeof useUpdateShipmentMutation>['mutateAsync']>[0];

function draftReadbackMatches(saved: ShipmentDetail, patch: DraftPatch): boolean {
  if (saved.status !== 'DRAFT' || saved.carrier !== patch.carrier || saved.serviceLevel !== patch.serviceLevel ||
    saved.trackingNumber !== patch.trackingNumber || toDateInput(saved.shipDate) !== (patch.shipDate ?? '') ||
    saved.internalNotes !== patch.internalNotes) return false;
  if (patch.shippingContext && shipmentShippingContextMismatches(patch.shippingContext, saved.shippingContext ?? null).length) return false;
  const allocations = (items: Array<{ orderId: string; orderLineItemId: string; packageId?: string | null; quantity: number }>) =>
    JSON.stringify(items.map(item => [item.orderId, item.orderLineItemId, item.packageId ?? null, item.quantity]).sort());
  if (patch.shipmentItems && allocations(patch.shipmentItems) !== allocations(saved.items)) return false;
  return (patch.packages ?? []).every(expected => {
    const actual = saved.packages.find(pkg => pkg.id === expected.id);
    return actual && parseNumber(actual.weightLbs ?? '') === expected.weightLbs &&
      (actual.upsPackagingType ?? '02') === (expected.upsPackagingType ?? '02') &&
      parseNumber(actual.dimLengthIn ?? '') === expected.dims?.length &&
      parseNumber(actual.dimWidthIn ?? '') === expected.dims?.width &&
      parseNumber(actual.dimHeightIn ?? '') === expected.dims?.height &&
      (actual.notes ?? null) === (expected.notes ?? null);
  });
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
  const [upsPackageTypes, setUpsPackageTypes] = useState<Record<string, '02' | '21'>>({});
  const [upsRates, setUpsRates] = useState<Array<{ serviceCode: string; serviceName: string; currency: string; total: string; negotiated: boolean; estimatedArrival: string | null }> | null>(null);
  const [upsQuoteId, setUpsQuoteId] = useState<string | null>(null);
  const [upsEnvironment, setUpsEnvironment] = useState<'test' | 'live' | null>(null);
  const [upsCustomerCharges, setUpsCustomerCharges] = useState<UpsCustomerCharge[]>([]);
  const [upsLabelHistory, setUpsLabelHistory] = useState<UpsLabelHistory[]>([]);
  const [upsStateLoaded, setUpsStateLoaded] = useState(false);
  const [upsActionPending, setUpsActionPending] = useState(false);
  const [upsChargePending, setUpsChargePending] = useState(false);
  const [upsActionError, setUpsActionError] = useState<string | null>(null);
  const [upsActionMessage, setUpsActionMessage] = useState<string | null>(null);
  const [externalCancelPurchaseId, setExternalCancelPurchaseId] = useState<string | null>(null);
  const [externalCancelReason, setExternalCancelReason] = useState('');
  const [externalCancelReference, setExternalCancelReference] = useState('');
  const [carrierAdjustmentPurchaseId, setCarrierAdjustmentPurchaseId] = useState<string | null>(null);
  const [carrierAdjustmentKind, setCarrierAdjustmentKind] = useState<'CONFIRMED_CREDIT' | 'CARRIER_ADJUSTMENT'>('CONFIRMED_CREDIT');
  const [carrierAdjustmentAmount, setCarrierAdjustmentAmount] = useState('');
  const [carrierAdjustmentReference, setCarrierAdjustmentReference] = useState('');
  const [upsLabelPreview, setUpsLabelPreview] = useState<{ url: string; trackingNumber: string; printable: boolean } | null>(null);
  const [upsRateError, setUpsRateError] = useState<string | null>(null);
  const [upsRatesLoading, setUpsRatesLoading] = useState(false);
  const [upsRatesStale, setUpsRatesStale] = useState(false);
  const [selectedUpsService, setSelectedUpsService] = useState<string | null>(null);
  const upsRequestInFlight = useRef(false);
  const upsRatePresented = useRef(false);
  const upsRateEpoch = useRef(0);
  const upsRateKeyRef = useRef('');
  const customSenderDraft = useRef<ShippingParty | null>(null);
  const [editingDestination, setEditingDestination] = useState(false);
  const [editingSender, setEditingSender] = useState(false);
  const [loadingOrderDestination, setLoadingOrderDestination] = useState(false);
  const [artworkViewer, setArtworkViewer] = useState<{ attachments: AttachmentData[]; initialIndex: number } | null>(null);
  const hydratedShipmentId = useRef<string | null>(null);
  const [draftSaveState, setDraftSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const savedDraftKey = useRef<string | null>(null);
  const failedDraftKey = useRef<string | null>(null);

  const debugEnabled = useMemo(() => new URLSearchParams(location.search).get("debug") === "1", [location.search]);

  const shipmentQuery = useShipmentDetailQuery(shipmentId);
  const updateShipment = useUpdateShipmentMutation(shipmentId || "");
  const markShipped = useMarkShippedMutation(shipmentId || "");
  const voidShipment = useVoidShipmentMutation(shipmentId || "");
  const reverseTerminalFulfillment = useReverseTerminalFulfillmentMutation();
  const createPackage = useCreateShipmentPackageMutation(shipmentId || "");

  const shipment = shipmentQuery.data;
  const upsActivePurchase = upsLabelHistory.find(row => ['REQUESTING', 'UNCERTAIN', 'PURCHASED', 'VOID_REQUESTING', 'VOID_UNCERTAIN'].includes(row.status));
  const upsDraftLocked = upsActionPending || !!upsActivePurchase;
  const refreshUpsState = async (id: string) => {
    const [charges, history] = await Promise.all([
      apiCall<UpsCustomerCharge[]>(`/api/fulfillment/shipments/${id}/ups-customer-charges`),
      apiCall<UpsLabelHistory[]>(`/api/fulfillment/shipments/${id}/ups-labels`),
    ]);
    setUpsCustomerCharges(charges); setUpsLabelHistory(history); setUpsStateLoaded(true);
  };
  useEffect(() => {
    if (!shipment?.id) return;
    let canceled = false;
    setUpsStateLoaded(false);
    Promise.all([
      apiCall<UpsCustomerCharge[]>(`/api/fulfillment/shipments/${shipment.id}/ups-customer-charges`),
      apiCall<UpsLabelHistory[]>(`/api/fulfillment/shipments/${shipment.id}/ups-labels`),
    ]).then(([charges, history]) => { if (!canceled) { setUpsCustomerCharges(charges); setUpsLabelHistory(history); setUpsStateLoaded(true); } })
      .catch(error => { if (!canceled) setUpsActionError(toFulfillmentError(error).message); });
    return () => { canceled = true; };
  }, [shipment?.id]);
  useEffect(() => { let canceled = false;
    apiCall<{ mode: 'test' | 'live' }>('/api/fulfillment/ups-environment')
      .then(result => { if (!canceled) setUpsEnvironment(result.mode); }).catch(() => undefined);
    return () => { canceled = true; };
  }, []);
  useEffect(() => () => { if (upsLabelPreview) URL.revokeObjectURL(upsLabelPreview.url); }, [upsLabelPreview]);
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
    savedDraftKey.current = null;
    failedDraftKey.current = null;
    setDraftSaveState('idle');
    setDraftSaveError(null);
    setShippingContext(shipment.shippingContext ?? null);
    customSenderDraft.current = shipment.shippingContext?.blindSenderSource === "ordering_customer" ? null : shipment.shippingContext?.blindSender ?? null;
    setEditingDestination(false);
    setEditingSender(false);
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
    setUpsPackageTypes(Object.fromEntries(shipment.packages.map(pkg => [pkg.id, pkg.upsPackagingType ?? '02'])));
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
      return !!fields && ((upsPackageTypes[pkg.id] ?? '02') !== (pkg.upsPackagingType ?? '02') ||
        [fields.weight, fields.length, fields.width, fields.height].some(invalidPackageNumber) ||
        parseNumber(fields.weight) !== parseNumber(pkg.weightLbs ?? "") ||
        parseNumber(fields.length) !== parseNumber(pkg.dimLengthIn ?? "") || parseNumber(fields.width) !== parseNumber(pkg.dimWidthIn ?? "") ||
        parseNumber(fields.height) !== parseNumber(pkg.dimHeightIn ?? "") || fields.notes !== (pkg.notes ?? ""));
    })
  );
  const draftKey = JSON.stringify({ shipmentId: shipment?.id, form, shippingContext, packageFieldsById, upsPackageTypes,
    packageIds: shipment?.packages.map(pkg => pkg.id), items: draftShipmentItems.filter(item => item.quantity > 0) });
  const latestDraft = useRef({ draftKey, form, shippingContext, packageFieldsById, upsPackageTypes, draftShipmentItems, shipment, hasUnsavedChanges, loadingOrders, validationErrors, fulfillmentByOrderId });
  latestDraft.current = { draftKey, form, shippingContext, packageFieldsById, upsPackageTypes, draftShipmentItems, shipment, hasUnsavedChanges, loadingOrders, validationErrors, fulfillmentByOrderId };
  useEffect(() => {
    if (failedDraftKey.current !== draftKey) {
      setDraftSaveError(null);
      setDraftSaveState(state => state === 'failed' ? 'idle' : state);
    }
  }, [draftKey]);
  const documentActionsDisabled = !!hasUnsavedChanges || draftSaveState === 'saving' || draftSaveState === 'failed' || loadingOrders || updateShipment.isPending;
  const upsRateKey = JSON.stringify({ shipmentId: shipment?.id,
    shippingContext, packages: shipment?.packages.map(pkg => pkg.id), form: [form.weight, form.length, form.width, form.height],
    packageFieldsById, upsPackageTypes });
  useEffect(() => {
    upsRateEpoch.current += 1;
    upsRateKeyRef.current = upsRateKey;
    if (upsRatePresented.current) setUpsRatesStale(true);
    setUpsRates(null); setUpsQuoteId(null); setUpsRateError(null); setSelectedUpsService(null);
  }, [upsRateKey]);
  useEffect(() => {
    const invalidate = () => { upsRateEpoch.current += 1; if (upsRatePresented.current) { setUpsRates(null); setUpsRatesStale(true); setSelectedUpsService(null); } };
    const onVisible = () => { if (document.visibilityState === 'visible') invalidate(); };
    window.addEventListener('focus', invalidate);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', invalidate); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const requestUpsRates = async () => {
    if (!shipment || shipment.status !== 'DRAFT' || upsRequestInFlight.current) return;
    upsRequestInFlight.current = true;
    setUpsRatesLoading(true);
    setUpsRates(null);
    setUpsRatesStale(false);
    setUpsRateError(null);
    const saved = await flushDraft();
    if (!saved) {
      setUpsRateError('Could not save the current draft. Correct the issue or retry saving before requesting rates.');
      setUpsRatesLoading(false); upsRequestInFlight.current = false; return;
    }
    const requestedKey = upsRateKeyRef.current;
    const requestedEpoch = upsRateEpoch.current;
    const current = latestDraft.current;
    const packages = current.shipment!.packages.map((pkg, index) => {
      const fields = index === 0 ? { weight: current.form.weight, length: current.form.length, width: current.form.width, height: current.form.height } :
        current.packageFieldsById[pkg.id] ?? { weight: pkg.weightLbs ?? '', length: pkg.dimLengthIn ?? '', width: pkg.dimWidthIn ?? '', height: pkg.dimHeightIn ?? '' };
      return { id: pkg.id, packagingType: current.upsPackageTypes[pkg.id] ?? '02', weightLbs: Number(fields.weight),
        lengthIn: Number(fields.length), widthIn: Number(fields.width), heightIn: Number(fields.height) };
    });
    if (!packages.length || packages.some(pkg => [pkg.weightLbs, pkg.lengthIn, pkg.widthIn, pkg.heightIn].some(value => !Number.isFinite(value) || value <= 0))) {
      setUpsRateError('Enter a positive weight and length, width, and height for every package.');
      setUpsRatesLoading(false); upsRequestInFlight.current = false; return;
    }
    try {
      const result = await apiCall<{ rates: NonNullable<typeof upsRates>; quoteId: string; environment: 'test' | 'live' }>(`/api/fulfillment/shipments/${current.shipment!.id}/ups-rates`,
        { method: 'POST', body: JSON.stringify({ packages }) });
      if (requestedKey === upsRateKeyRef.current && requestedEpoch === upsRateEpoch.current) {
        upsRatePresented.current = true; setUpsRatesStale(false); setUpsRates(result.rates); setUpsQuoteId(result.quoteId); setUpsEnvironment(result.environment);
      }
    } catch (error) {
      if (requestedKey === upsRateKeyRef.current && requestedEpoch === upsRateEpoch.current) setUpsRateError(toFulfillmentError(error).message);
    } finally { setUpsRatesLoading(false); upsRequestInFlight.current = false; }
  };

  const applySelectedUpsRate = async (serviceCode: string, intent: 'default_if_unset' | 'use_ups_rate') => {
    if (!shipmentId || !upsQuoteId || upsChargePending || upsRatesStale) return;
    setUpsChargePending(true); setUpsActionError(null); setUpsActionMessage(null);
    try {
      const result = await apiCall<{ applied: boolean; reason: string }>(`/api/fulfillment/shipments/${shipmentId}/ups-customer-charge`,
        { method: 'POST', body: JSON.stringify({ quoteId: upsQuoteId, serviceCode, intent }) });
      await refreshUpsState(shipmentId);
      setUpsActionMessage(result.reason);
    } catch (error) { setUpsActionError(toFulfillmentError(error).message); }
    finally { setUpsChargePending(false); }
  };

  const buySelectedUpsLabel = async () => {
    if (!shipmentId || !upsQuoteId || !selectedUpsService || !upsStateLoaded || upsRatesStale || upsActionPending || upsChargePending || upsActivePurchase) return;
    const saved = await flushDraft();
    if (!saved) { setUpsActionError('Save the latest draft details before buying a UPS label. No purchase request was sent.'); return; }
    if (upsCustomerCharges.some(row => row.shippingChargeDecision === 'unset')) {
      setUpsActionError('A customer shipping charge is still unset. Set it on the Order or apply the UPS rate before buying.'); return;
    }
    setUpsActionPending(true); setUpsActionError(null); setUpsActionMessage(null);
    try {
      const purchased = await apiCall<{ environment: 'test' | 'live'; carrierCostCents: number; carrierCurrency: string; labels: Array<{ trackingNumber: string }> }>(
        `/api/fulfillment/shipments/${shipmentId}/ups-labels/purchase`,
        { method: 'POST', body: JSON.stringify({ quoteId: upsQuoteId, serviceCode: selectedUpsService }) });
      const refreshed = await shipmentQuery.refetch();
      if (refreshed.data) setForm(previous => ({ ...previous, carrier: refreshed.data.carrier ?? 'UPS',
        serviceLevel: refreshed.data.serviceLevel ?? '', trackingNumber: refreshed.data.trackingNumber ?? '' }));
      await refreshUpsState(shipmentId);
      setUpsActionMessage(purchased.environment === 'test'
        ? `Test label created. This sample label and tracking cannot be used for shipping. UPS sandbox amount: ${purchased.carrierCurrency} ${(purchased.carrierCostCents / 100).toFixed(2)}.`
        : `UPS live label purchased. Actual UPS carrier cost: ${purchased.carrierCurrency} ${(purchased.carrierCostCents / 100).toFixed(2)}. Shipment remains DRAFT until marked shipped.`);
    } catch (error) {
      setUpsActionError(`${toFulfillmentError(error).message} Review purchase history before retrying; UPS may have accepted the first request.`);
      await refreshUpsState(shipmentId).catch(() => undefined);
    } finally { setUpsActionPending(false); }
  };

  const voidPurchasedUpsLabel = async (purchaseId: string) => {
    if (!shipmentId || upsActionPending || !window.confirm('Request UPS to void this unused label? This does not reverse fulfillment or confirm a carrier credit.')) return;
    setUpsActionPending(true); setUpsActionError(null);
    try { await apiCall(`/api/fulfillment/shipments/${shipmentId}/ups-labels/${purchaseId}/void`, { method: 'POST' });
      await refreshUpsState(shipmentId); setUpsActionMessage('UPS accepted the void request. Carrier credit is not yet confirmed.'); }
    catch (error) { setUpsActionError(toFulfillmentError(error).message); await refreshUpsState(shipmentId).catch(() => undefined); }
    finally { setUpsActionPending(false); }
  };

  const recordExternalCancellation = async () => {
    if (!shipmentId || !externalCancelPurchaseId || externalCancelReason.trim().length < 3 || upsActionPending) return;
    setUpsActionPending(true); setUpsActionError(null);
    try { await apiCall(`/api/fulfillment/shipments/${shipmentId}/ups-labels/${externalCancelPurchaseId}/external-cancellation`,
      { method: 'POST', body: JSON.stringify({ reason: externalCancelReason.trim(), reference: externalCancelReference.trim() || undefined }) });
      await refreshUpsState(shipmentId); setExternalCancelPurchaseId(null); setExternalCancelReason(''); setExternalCancelReference('');
      setUpsActionMessage('External cancellation reported. UPS void and carrier credit are not confirmed by this record.'); }
    catch (error) { setUpsActionError(toFulfillmentError(error).message); }
    finally { setUpsActionPending(false); }
  };

  const recordCarrierAdjustment = async (purchase: UpsLabelHistory) => {
    if (!shipmentId || !purchase.carrierCurrency || upsActionPending) return;
    const amount = Number(carrierAdjustmentAmount);
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(carrierAdjustmentAmount.trim()) || !Number.isSafeInteger(Math.round(amount * 100)) ||
      Math.round(amount * 100) === 0 || (carrierAdjustmentKind === 'CONFIRMED_CREDIT' && amount < 0) || !carrierAdjustmentReference.trim()) {
      setUpsActionError('Enter a nonzero amount with no more than two decimals and a carrier confirmation/reference. Confirmed credits must be positive.'); return;
    }
    setUpsActionPending(true); setUpsActionError(null);
    try { await apiCall(`/api/fulfillment/shipments/${shipmentId}/ups-labels/${purchase.id}/carrier-adjustments`,
      { method: 'POST', body: JSON.stringify({ kind: carrierAdjustmentKind, amountCents: Math.round(amount * 100),
        currency: purchase.carrierCurrency, providerReference: carrierAdjustmentReference.trim() }) });
      await refreshUpsState(shipmentId); setCarrierAdjustmentPurchaseId(null); setCarrierAdjustmentAmount(''); setCarrierAdjustmentReference('');
      setUpsActionMessage('Carrier billing evidence recorded. The original purchase cost remains in history.'); }
    catch (error) { setUpsActionError(toFulfillmentError(error).message); }
    finally { setUpsActionPending(false); }
  };

  const labelImagePath = (purchaseId: string, packageId: string) => `/api/fulfillment/shipments/${encodeURIComponent(shipmentId || '')}/ups-labels/${encodeURIComponent(purchaseId)}/packages/${encodeURIComponent(packageId)}/image`;
  const openUpsLabel = async (purchaseId: string, packageId: string, trackingNumber: string, printable: boolean) => {
    try { const blob = await apiFetchBlob(labelImagePath(purchaseId, packageId));
      setUpsLabelPreview({ url: URL.createObjectURL(blob), trackingNumber, printable }); }
    catch (error) { setUpsActionError(toFulfillmentError(error).message); }
  };
  const downloadUpsLabel = async (purchaseId: string, packageId: string, trackingNumber: string, environment: UpsLabelHistory['environment']) => {
    try { const blob = await apiFetchBlob(labelImagePath(purchaseId, packageId) + '?download=1');
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
      link.download = `${environment === 'live' ? 'UPS' : 'NOT-FOR-SHIPPING-UPS'}-${trackingNumber}.gif`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (error) { setUpsActionError(toFulfillmentError(error).message); }
  };

  const printPreviewedUpsLabel = () => {
    if (!upsLabelPreview?.printable) return;
    const popup = window.open('', '_blank');
    if (!popup) { setUpsActionError('Allow a print window, or download the UPS label and print it from your device.'); return; }
    popup.document.write(`<!doctype html><html><head><title>UPS label</title><style>@page{size:4in 6in;margin:0}html,body{margin:0;background:white}img{display:block;width:4in;height:6in;object-fit:contain}</style></head><body><img src="${upsLabelPreview.url}" onload="window.print()" /></body></html>`);
    popup.document.close();
  };

  const markShippedDisabled =
    loadingOrders || shipment?.orders.some(order => !fulfillmentByOrderId[order.orderId]) || !shipment ||
    shipment.status !== "DRAFT" ||
    upsActionPending || upsLabelHistory.some(row => ['REQUESTING', 'UNCERTAIN', 'VOID_REQUESTING', 'VOID_UNCERTAIN'].includes(row.status)) ||
    (form.carrier.trim().toUpperCase() === 'UPS' && form.trackingNumber.trim().toUpperCase() === '1ZXXXXXXXXXXXXXXXX') ||
    (Boolean(shipment.carrierShipmentId) && upsLabelHistory.some(row => row.providerShipmentId === shipment.carrierShipmentId &&
      (row.status !== 'PURCHASED' || row.environment !== 'live' || row.labels.some(label => label.trackingNumber.toUpperCase() === '1ZXXXXXXXXXXXXXXXX')))) ||
    validationErrors.size > 0 ||
    allocatedCount <= 0 ||
    missingDestination.length > 0 || missingBlindSender.length > 0 ||
    markShipped.isPending ||
    updateShipment.isPending;

  const flushDraft = async (): Promise<boolean> => {
    if (upsDraftLocked) return !latestDraft.current.hasUnsavedChanges;
    if (saveInFlight.current) {
      try { await saveInFlight.current; } catch { return false; }
      if (latestDraft.current.draftKey === savedDraftKey.current) return true;
      return flushDraft();
    }
    const snapshot = latestDraft.current;
    const currentShipment = snapshot.shipment;
    if (!shipmentId || !currentShipment || currentShipment.status !== 'DRAFT' || snapshot.loadingOrders ||
      currentShipment.orders.some(order => !snapshot.fulfillmentByOrderId[order.orderId])) return false;
    if (snapshot.draftKey === savedDraftKey.current) return true;
    if (failedDraftKey.current === snapshot.draftKey) return false;
    if (!snapshot.hasUnsavedChanges) { savedDraftKey.current = snapshot.draftKey; return true; }
    const packageValues: PackageFields[] = currentShipment.packages.map((pkg, index) => index === 0
      ? { weight: snapshot.form.weight, length: snapshot.form.length, width: snapshot.form.width, height: snapshot.form.height, notes: snapshot.form.packageNotes }
      : snapshot.packageFieldsById[pkg.id] ?? { weight: pkg.weightLbs ?? '', length: pkg.dimLengthIn ?? '', width: pkg.dimWidthIn ?? '', height: pkg.dimHeightIn ?? '', notes: pkg.notes ?? '' });
    if (snapshot.validationErrors.size || packageValues.some(fields =>
      [fields.weight, fields.length, fields.width, fields.height].some(invalidPackageNumber))) {
      setDraftSaveState('idle'); setDraftSaveError('Finish invalid quantities or package measurements before saving.');
      failedDraftKey.current = snapshot.draftKey;
      return false;
    }
    const shipmentItems = snapshot.draftShipmentItems.filter(item => item.quantity > 0);
    const payload: DraftPatch = {
      carrier: snapshot.form.carrier || null, serviceLevel: snapshot.form.serviceLevel || null,
      trackingNumber: snapshot.form.trackingNumber || null, shipDate: snapshot.form.shipDate || null,
      internalNotes: snapshot.form.internalNotes || null,
      ...(snapshot.shippingContext ? { shippingContext: snapshot.shippingContext } : {}),
      packages: currentShipment.packages.map((pkg, index) => ({ id: pkg.id, upsPackagingType: snapshot.upsPackageTypes[pkg.id] ?? '02',
        weightLbs: parseNumber(packageValues[index].weight),
        dims: { length: parseNumber(packageValues[index].length), width: parseNumber(packageValues[index].width), height: parseNumber(packageValues[index].height) },
        notes: packageValues[index].notes || null })),
      shipmentItems,
    };
    const task = (async () => {
      setDraftSaveState('saving'); setDraftSaveError(null); setLastError(null);
      const response = await updateShipment.mutateAsync(payload);
      const refreshed = await shipmentQuery.refetch();
      if (!refreshed.data || refreshed.isError || !draftReadbackMatches(refreshed.data, payload))
        throw new Error('Could not verify the saved shipment draft. Your edits remain available for retry.');
      savedDraftKey.current = snapshot.draftKey;
      failedDraftKey.current = null;
      if (latestDraft.current.shippingContext === snapshot.shippingContext && snapshot.shippingContext === null)
        setShippingContext(refreshed.data.shippingContext ?? null);
      setDraftSaveState(latestDraft.current.draftKey === snapshot.draftKey ? 'saved' : 'idle');
      setLastResponse(response);
      await onMutationComplete?.();
    })();
    saveInFlight.current = task;
    try { await task; }
    catch (error) {
      const parsed = toFulfillmentError(error);
      failedDraftKey.current = snapshot.draftKey;
      setDraftSaveError(parsed.message); setDraftSaveState('failed');
      setLastError({ code: parsed.code, message: parsed.message });
      return false;
    } finally { if (saveInFlight.current === task) saveInFlight.current = null; }
    return latestDraft.current.draftKey === snapshot.draftKey ? true : flushDraft();
  };

  useEffect(() => {
    if (!shipment || shipment.status !== 'DRAFT' || upsDraftLocked || loadingOrders || shipment.orders.some(order => !fulfillmentByOrderId[order.orderId])) return;
    if (!hasUnsavedChanges) {
      if (!saveInFlight.current && failedDraftKey.current !== draftKey) savedDraftKey.current = draftKey;
      return;
    }
    if (failedDraftKey.current === draftKey || saveInFlight.current) return;
    const timer = window.setTimeout(() => { void flushDraft(); }, 500);
    return () => window.clearTimeout(timer);
  }, [draftKey, hasUnsavedChanges, loadingOrders, shipment?.id, shipment?.status, fulfillmentByOrderId, upsDraftLocked]);

  const retryDraftSave = () => { failedDraftKey.current = null; void flushDraft(); };

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
    const saved = await flushDraft();
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
  const editContext = (target: "destination" | "sender") => {
    if (upsDraftLocked) { setUpsActionError('Void or resolve the UPS label before editing this shipment draft.'); return; }
    setShippingContext(context => ({ ...(context ?? { version: 1, sourceOrderId: shipment.primaryOrderId ?? shipment.orders[0]?.orderId ?? null, destination: { ...emptyShippingParty }, blindShipping: false, blindSender: null }), source: "staff" }));
    if (target === "destination") setEditingDestination(true);
    else setEditingSender(true);
  };

  const useSavedOrderAddress = async () => {
    if (!shipmentId || !isDraft || upsDraftLocked || !isSingleOrderShipment || loadingOrderDestination) return;
    setLoadingOrderDestination(true);
    try {
      const latest = await getCurrentOrderDestination(shipmentId);
      const oldAddress = shippingContext?.destination ?? emptyShippingParty;
      if (JSON.stringify(oldAddress) !== JSON.stringify(latest.destination) &&
        !window.confirm('Replace this DRAFT shipment destination with the currently saved Order address?\n\nCurrent: ' + shippingPartyAddressLines(oldAddress).join(', ') + '\nSaved Order: ' + shippingPartyAddressLines(latest.destination).join(', '))) return;
      setShippingContext(context => context && ({ ...context, source: "staff", sourceOrderId: latest.orderId, destination: latest.destination }));
      setEditingDestination(true);
      toast({ title: "Order address updated", description: "The shipment draft will save this destination automatically." });
    } catch (error) {
      toast({ title: "Could not load Order address", description: toFulfillmentError(error).message, variant: "destructive" });
    } finally {
      setLoadingOrderDestination(false);
    }
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
    <div className={embedded ? "bg-background font-display text-foreground" : "min-h-full bg-background font-display text-foreground"}
      onBlurCapture={event => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) void flushDraft(); }}>
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
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="shipment-destination-heading" className="flex items-center gap-2 text-lg font-bold"><MapPinned className="h-5 w-5 text-primary" />Ship To</h2><div className="flex items-center gap-2">{blindShipping && <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold">Blind shipment</span>}{isDraft && <button type="button" className="rounded border px-3 py-1.5 text-xs font-semibold hover:bg-muted" onClick={() => editContext("destination")}>Edit Shipping Address</button>}{isDraft && <button type="button" className="rounded border px-3 py-1.5 text-xs font-semibold hover:bg-muted" onClick={() => editContext("sender")}>Edit Sender</button>}</div></div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2"><div>{destination ? <address className="not-italic text-sm leading-relaxed">{shippingPartyAddressLines(destination).map((line, index) => <p key={index} className={index === 0 ? "font-semibold" : ""}>{line}</p>)}{destination.phone && <p className="mt-1">{destination.phone}</p>}{destination.email && <p className="break-all">{destination.email}</p>}</address> : <p className="text-sm text-muted-foreground">Destination not recorded for this shipment.</p>}</div><div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{blindShipping ? "Alternate sender" : "Sender"}</h3>{sender ? <address className="not-italic text-sm leading-relaxed">{shippingPartyAddressLines(sender).map((line, index) => <p key={index}>{line}</p>)}{sender.phone && <p>{sender.phone}</p>}{sender.email && <p className="break-all">{sender.email}</p>}</address> : <p className="text-sm text-muted-foreground">{blindShipping ? "Alternate sender not recorded. No sender will be guessed." : documentSourceQuery.isLoading ? "Loading saved document sender..." : "Sender unavailable from the saved document source."}</p>}</div></div>
              {(missingDestination.length > 0 || missingBlindSender.length > 0) && <div role="alert" className="mt-3 space-y-2 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{missingDestination.length > 0 && <p>Shipping destination incomplete: {missingDestination.join(", ")} required. {isDraft && <button type="button" className="font-semibold underline" onClick={() => editContext("destination")}>Edit Shipping Address</button>}</p>}{missingBlindSender.length > 0 && <p>Blind Shipping sender incomplete: {missingBlindSender.join(", ")} required. {isDraft && <button type="button" className="font-semibold underline" onClick={() => editContext("sender")}>Edit Sender</button>}</p>}{!isDraft && <p>Historical shipping details are not reconstructed from live customer fields.</p>}</div>}
              {isDraft && !upsDraftLocked && (editingDestination || editingSender) && shippingContext && <div className="mt-4 space-y-4 border-t pt-4">
                {editingDestination && <fieldset><legend className="mb-2 text-sm font-semibold">Shipment destination</legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{partyFields.map(([key, label]) => <label key={key} className="grid gap-1 text-xs font-medium">{label}<input aria-label={`Ship To ${label}`} className="h-9 min-w-0 rounded border border-input bg-background px-2 text-sm" value={shippingContext.destination[key] ?? ""} onChange={event => setShippingContext(context => context && ({ ...context, source: "staff", destination: { ...context.destination, [key]: event.target.value || null } }))} /></label>)}</div></fieldset>}
                {editingDestination && isSingleOrderShipment && <button type="button" className="w-fit rounded border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50" disabled={loadingOrderDestination} onClick={() => void useSavedOrderAddress()}>{loadingOrderDestination ? "Loading Order address..." : "Use saved Order address"}</button>}
                {editingSender && <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={shippingContext.blindShipping} onChange={event => enableBlindShipping(event.target.checked)} />Blind shipping: use an alternate sender</label>}
                {editingSender && shippingContext.blindShipping && <fieldset className="space-y-3"><legend className="text-sm font-semibold">Sender</legend>
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
              {!advancedPacking && <div className="flex flex-wrap items-center justify-between gap-3 p-6 text-sm"><div><p className="font-semibold">Items packed: {packedCount}</p><p className="mt-1 text-muted-foreground">Choose how many units are leaving now. Reduce Qty in this shipment for a partial shipment; set zero to leave a line out.</p></div>{isDraft && !upsDraftLocked && <button type="button" className="rounded border px-3 py-2 text-xs font-bold hover:bg-muted" onClick={() => setSplitMode(true)}>Split Shipment / Packages</button>}</div>}
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
                                    disabled={!isDraft || upsDraftLocked}
                                    className={`h-8 w-16 rounded border-2 bg-background text-center text-sm font-bold focus:border-primary focus:ring-0 ${hasError ? "border-red-500" : "border-primary/20"}`}
                                    onChange={(event) => {
                                      const next = Math.max(0, Number(event.target.value || 0));
                                      setAllocatedByLineItemId((prev) => ({ ...prev, [item.id]: next }));
                                    }}
                                  /> : <div className="space-y-2">{splits.map(allocation => <label key={allocation.id} className="flex min-w-0 flex-col items-start gap-1 break-all text-xs">
                                    {shipment.packages.find(pkg => pkg.id === allocation.packageId)?.packageReference || "Unpacked"}
                                    <input type="number" aria-label={`Qty in package ${allocation.packageId}: ${item.label}`} min={0} max={item.remainingQty} step={1} disabled={!isDraft || upsDraftLocked}
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
                                  disabled={!isDraft || upsDraftLocked || shipment.packages.length === 0 || splits.length > 1}
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
                {(advancedPacking || shipment.packages.length === 0) && <button type="button" className="rounded border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted" disabled={!isDraft || upsDraftLocked || createPackage.isPending} onClick={() => void handleAddPackage()}>
                  {createPackage.isPending ? "ADDING..." : "ADD PACKAGE"}
                </button>}
              </div>
              <div className="divide-y divide-border">
                {shipment.packages.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No packages yet. Create one to group physical contents and print a package ticket.</p> : shipment.packages.map((pkg, index) => {
                  const fields = index === 0 ? { weight: form.weight, length: form.length, width: form.width, height: form.height, notes: form.packageNotes } : packageFieldsById[pkg.id] ?? { weight: pkg.weightLbs ?? "", length: pkg.dimLengthIn ?? "", width: pkg.dimWidthIn ?? "", height: pkg.dimHeightIn ?? "", notes: pkg.notes ?? "" };
                  const updateFields = (key: keyof typeof fields, value: string) => index === 0 ? setForm(previous => ({ ...previous, [key === "notes" ? "packageNotes" : key]: value })) : setPackageFieldsById((previous) => ({ ...previous, [pkg.id]: { ...fields, [key]: value } }));
                  return <div key={pkg.id} className="px-6 py-4">
                    <div className="flex items-center justify-between gap-3"><span className="font-semibold">{pkg.packageReference}</span><span className="text-xs text-muted-foreground">{(isDraft ? draftShipmentItems : shipment.items).filter(item => item.packageId === pkg.id).reduce((sum, item) => sum + item.quantity, 0)} allocated unit(s)</span></div>
                    <div className="mt-2"><h4 className="text-xs font-medium text-muted-foreground">Dimensions, weight & package notes</h4><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                      {([['weight', 'Weight (lbs)'], ['length', 'Length (in)'], ['width', 'Width (in)'], ['height', 'Height (in)']] as const).map(([key, label]) => <label key={key} className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}<input type="text" inputMode="decimal" className="h-9 rounded border border-input bg-background px-2 text-sm normal-case" value={fields[key]} onChange={(event) => updateFields(key, event.target.value)} disabled={!isDraft || upsDraftLocked} /></label>)}
                      <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted-foreground md:col-span-4">UPS package type
                        <select aria-label={`UPS package type: ${pkg.packageReference}`} className="h-9 rounded border border-input bg-background px-2 text-sm normal-case" value={upsPackageTypes[pkg.id] ?? '02'} disabled={!isDraft || upsDraftLocked}
                          onChange={event => setUpsPackageTypes(previous => ({ ...previous, [pkg.id]: event.target.value as '02' | '21' }))}>
                          <option value="02">Customer supplied package</option><option value="21">UPS Express Box</option>
                        </select>
                      </label>
                      <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted-foreground md:col-span-4">Package Notes<textarea aria-label={`Package notes: ${pkg.packageReference}`} rows={2} className="resize-none rounded border border-input bg-background p-2 text-sm normal-case" value={fields.notes} onChange={(event) => updateFields('notes', event.target.value)} disabled={!isDraft || upsDraftLocked} /></label>
                    </div></div>
                  </div>;
                })}
              </div>
            </div>
            {isDraft && !upsDraftLocked && <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="UPS rates">
              <div><h3 className="text-sm font-bold">UPS carrier rate estimates</h3><p className="text-xs text-muted-foreground">Rates use the saved DRAFT destination and Company Settings origin. Selecting a service does not buy a label. Customer shipping charge is saved separately from UPS carrier cost.</p>
                {upsEnvironment && <p role="status" className={upsEnvironment === 'test' ? 'mt-2 rounded border border-amber-500 bg-amber-50 p-2 text-xs text-amber-900' : 'mt-2 rounded border border-green-600 p-2 text-xs'}>
                  UPS environment: <strong>{upsEnvironment === 'test' ? 'Sandbox / Test' : 'Live'}</strong>{upsEnvironment === 'test' ? ' · Labels and tracking from this environment cannot be used for real shipping.' : ''}
                </p>}</div>
              <button type="button" className="rounded border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50" disabled={upsRatesLoading || shipment.packages.length === 0}
                onClick={() => void requestUpsRates()}>{upsRatesLoading ? 'Getting UPS rates…' : 'Get UPS Rates'}</button>
              {upsRateError && <p role="alert" className="text-sm text-destructive">{upsRateError}</p>}
              {upsRatesStale && !upsRatesLoading && !upsRateError && <p role="status" className="text-xs text-amber-700">Previous UPS rates are stale. Get fresh rates for the current details.</p>}
              {upsRates && <div className="space-y-2" role="status">{upsRates.map(rate => <label key={`${rate.serviceCode}:${rate.currency}`} className="flex items-start gap-2 rounded border p-2 text-sm">
                <input type="radio" name="ups-rate" checked={selectedUpsService === rate.serviceCode} disabled={upsChargePending || upsActionPending} onChange={() => { setSelectedUpsService(rate.serviceCode); void applySelectedUpsRate(rate.serviceCode, 'default_if_unset'); }} aria-label={`Select ${rate.serviceName} estimate`} />
                <span><strong>{rate.serviceName}</strong> · {rate.currency} {rate.total} {rate.negotiated ? 'negotiated account rate' : 'UPS returned rate'}
                  {rate.estimatedArrival && <span className="block text-xs text-muted-foreground">UPS delivery estimate: {rate.estimatedArrival}</span>}</span>
              </label>)}</div>}
              {upsCustomerCharges.map(row => <p key={row.orderId} className="text-sm">Customer shipping charge · Order {row.orderNumber}: <strong>USD {(row.shippingCents / 100).toFixed(2)}</strong> <span className="text-xs text-muted-foreground">({row.shippingChargeDecision === 'unset' ? 'unset' : row.shippingChargeDecision === 'free' ? 'explicit free shipping' : row.shippingChargeDecision === 'ups_rate' ? 'UPS rate selected' : 'existing decision'})</span></p>)}
              {selectedUpsService && upsQuoteId && upsCustomerCharges.length === 1 && upsCustomerCharges[0].shippingChargeDecision !== 'unset' &&
                <button type="button" className="rounded border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50" disabled={upsChargePending || upsActionPending} onClick={() => void applySelectedUpsRate(selectedUpsService, 'use_ups_rate')}>{upsChargePending ? 'Saving customer charge…' : 'Use UPS rate as customer charge'}</button>}
              {selectedUpsService && upsQuoteId && upsCustomerCharges.length > 1 && <p className="text-xs text-amber-700">Combined shipment: keep each Order’s existing charge, or set its amount on that Order. The full UPS cost will not be charged to every Order.</p>}
              {selectedUpsService && upsQuoteId && upsCustomerCharges.some(row => row.shippingChargeDecision === 'ups_rate' &&
                (row.shippingChargeRateQuoteId !== upsQuoteId || row.shippingChargeRateServiceCode !== selectedUpsService)) &&
                <p className="text-xs text-amber-700">The current customer charge came from a different UPS rate or service. Review it or explicitly use this rate.</p>}
              {selectedUpsService && upsQuoteId && <div className="rounded border p-3 text-sm"><p>Selected service: <strong>{upsRates?.find(rate => rate.serviceCode === selectedUpsService)?.serviceName}</strong> · Estimated UPS carrier cost: <strong>{upsRates?.find(rate => rate.serviceCode === selectedUpsService)?.currency} {upsRates?.find(rate => rate.serviceCode === selectedUpsService)?.total}</strong></p><button type="button" className="mt-2 rounded bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50" disabled={!upsStateLoaded || upsActionPending || upsChargePending || upsRatesStale || upsCustomerCharges.some(row => row.shippingChargeDecision === 'unset')} onClick={() => void buySelectedUpsLabel()}>{upsActionPending ? 'Purchasing…' : upsEnvironment === 'test' ? 'Create Test UPS Label' : 'Buy UPS Label'}</button></div>}
            </section>}
            {(upsLabelHistory.length > 0 || upsActionError || upsActionMessage) && <section aria-label="UPS label history" className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-sm font-bold">UPS labels and carrier cost</h3>
              {upsCustomerCharges.map(row => <p key={row.orderId} className="text-sm">Customer shipping charge · Order {row.orderNumber}: <strong>USD {(row.shippingCents / 100).toFixed(2)}</strong> <span className="text-xs text-muted-foreground">({row.shippingChargeDecision === 'free' ? 'explicit free shipping' : row.shippingChargeDecision === 'ups_rate' ? 'selected UPS rate' : 'existing Order decision'})</span></p>)}
              {upsActionError && <p role="alert" className="text-sm text-destructive">{upsActionError}</p>}
              {upsActionMessage && <p role="status" className="text-sm">{upsActionMessage}</p>}
              {upsLabelHistory.map(purchase => <div key={purchase.id} className="rounded border p-3 text-sm space-y-2">
                <p><strong>{purchase.serviceName}</strong> · {purchase.environment === 'test' && purchase.status === 'PURCHASED' ? 'TEST LABEL CREATED' : purchase.status.replaceAll('_', ' ')} · {purchase.environment === 'test' ? 'Sandbox / Test' : purchase.environment === 'live' ? 'Live' : 'Environment unverified'}{purchase.providerShipmentId && <> · UPS {purchase.providerShipmentId}</>}</p>
                {(purchase.environment !== 'live' || purchase.labels.some(label => label.trackingNumber.toUpperCase() === '1ZXXXXXXXXXXXXXXXX')) &&
                  <p role="alert" className="text-xs font-semibold text-amber-700">This label is not verified for real shipping. Do not dispatch or print it as a shipping label. Historical environment is unverified unless explicitly recorded.</p>}
                <p>Original UPS estimate: {purchase.estimateCurrency} {(purchase.estimateCents / 100).toFixed(2)} · Recorded UPS carrier cost: {purchase.carrierCostCents == null ? 'Not confirmed' : `${purchase.carrierCurrency} ${(purchase.carrierCostCents / 100).toFixed(2)}`}</p>
                {purchase.carrierCostCents != null && <p className="text-xs text-muted-foreground">
                  {purchase.carrierCurrency === purchase.estimateCurrency
                    ? `Difference from estimate: ${purchase.carrierCurrency} ${((purchase.carrierCostCents - purchase.estimateCents) / 100).toFixed(2)}.`
                    : 'Estimate and purchased cost use different currencies; conversion is needed to compare them.'}
                  {' '}Buying this label did not change the customer shipping charge.</p>}
                {purchase.status === 'VOID_ACCEPTED' && <p className="text-xs text-amber-700">UPS accepted the void request. Carrier credit is not confirmed; original cost remains recorded.</p>}
                {purchase.status === 'EXTERNAL_CANCEL_REPORTED' && <p className="text-xs text-amber-700">Operator reported external cancellation: {purchase.externalCancelReason}. UPS void and carrier credit are not confirmed here.</p>}
                {purchase.adjustments?.map(adjustment => <p key={adjustment.id} className="text-xs">{adjustment.kind === 'CONFIRMED_CREDIT' ? 'Confirmed carrier credit' : 'Carrier cost adjustment'}: {adjustment.currency} {(adjustment.amountCents / 100).toFixed(2)} · {adjustment.providerReference}</p>)}
                {purchase.errorCode && <p className="text-xs text-destructive">Carrier action needs review: {purchase.errorCode}</p>}
                {purchase.voidProviderCode && <p className="text-xs text-destructive">UPS void response code: {purchase.voidProviderCode}</p>}
                {purchase.labels.map(label => <div key={label.packageId} className="flex flex-wrap items-center gap-2"><span>Package {label.trackingNumber}</span>{purchase.status === 'PURCHASED' && <><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => void openUpsLabel(purchase.id, label.packageId, label.trackingNumber, purchase.environment === 'live' && label.trackingNumber.toUpperCase() !== '1ZXXXXXXXXXXXXXXXX')}>{purchase.environment === 'live' && label.trackingNumber.toUpperCase() !== '1ZXXXXXXXXXXXXXXXX' ? 'Preview / Browser Print' : 'Preview evidence'}</button><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => void downloadUpsLabel(purchase.id, label.packageId, label.trackingNumber, purchase.environment)}>Download evidence</button>{purchase.environment === 'live' && label.trackingNumber.toUpperCase() !== '1ZXXXXXXXXXXXXXXXX' && <ShippingDocumentPrintDialog shipmentId={shipment.id} documentType="ups_label" purchaseId={purchase.id} packageId={label.packageId} label="Direct Print" />}</>}</div>)}
                {['PURCHASED', 'VOID_UNCERTAIN'].includes(purchase.status) && <div className="flex gap-2">
                  {purchase.status === 'PURCHASED' && isDraft && purchase.environment !== 'unknown' && <button type="button" className="rounded border px-2 py-1 text-xs" disabled={upsActionPending || purchase.environment !== upsEnvironment} onClick={() => void voidPurchasedUpsLabel(purchase.id)}>Void UPS label</button>}
                  <button type="button" className="rounded border px-2 py-1 text-xs" disabled={upsActionPending} onClick={() => setExternalCancelPurchaseId(purchase.id)}>Report external cancellation</button>
                </div>}
                {purchase.status === 'PURCHASED' && purchase.environment !== upsEnvironment &&
                  <p className="text-xs text-amber-700">Provider void requires a connection to this label’s original {purchase.environment === 'unknown' ? 'verified' : purchase.environment} environment. Use carrier support for historical unverified labels.</p>}
                {externalCancelPurchaseId === purchase.id && <div className="space-y-2 rounded border p-2"><p className="text-xs">This records an operator report only. It does not call UPS, refund a carrier cost, or reverse fulfillment.</p><textarea aria-label="External cancellation reason" className="w-full rounded border p-2" value={externalCancelReason} onChange={event => setExternalCancelReason(event.target.value)} placeholder="Reason" /><input aria-label="External cancellation reference" className="w-full rounded border p-2" value={externalCancelReference} onChange={event => setExternalCancelReference(event.target.value)} placeholder="UPS or support reference, if available" /><button type="button" className="rounded border px-2 py-1 text-xs" disabled={upsActionPending || externalCancelReason.trim().length < 3} onClick={() => void recordExternalCancellation()}>Record external cancellation</button><button type="button" className="ml-2 rounded border px-2 py-1 text-xs" onClick={() => setExternalCancelPurchaseId(null)}>Cancel</button></div>}
                {purchase.carrierCostCents != null && <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setCarrierAdjustmentPurchaseId(purchase.id)}>Record carrier credit / adjustment</button>}
                {carrierAdjustmentPurchaseId === purchase.id && <div className="space-y-2 rounded border p-2"><p className="text-xs">Use carrier billing evidence. A void request alone does not prove a credit.</p><select aria-label="Carrier adjustment type" className="w-full rounded border p-2" value={carrierAdjustmentKind} onChange={event => setCarrierAdjustmentKind(event.target.value as 'CONFIRMED_CREDIT' | 'CARRIER_ADJUSTMENT')}><option value="CONFIRMED_CREDIT">Confirmed carrier credit</option><option value="CARRIER_ADJUSTMENT">Later carrier cost adjustment (+ or −)</option></select><input aria-label="Carrier adjustment amount" type="number" step="0.01" className="w-full rounded border p-2" value={carrierAdjustmentAmount} onChange={event => setCarrierAdjustmentAmount(event.target.value)} placeholder="Amount in carrier currency" /><input aria-label="Carrier adjustment reference" className="w-full rounded border p-2" value={carrierAdjustmentReference} onChange={event => setCarrierAdjustmentReference(event.target.value)} placeholder="UPS statement or credit reference" /><button type="button" className="rounded border px-2 py-1 text-xs" disabled={upsActionPending || !carrierAdjustmentAmount || !carrierAdjustmentReference.trim()} onClick={() => void recordCarrierAdjustment(purchase)}>Record evidence</button><button type="button" className="ml-2 rounded border px-2 py-1 text-xs" onClick={() => setCarrierAdjustmentPurchaseId(null)}>Cancel</button></div>}
              </div>)}
            </section>}
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-4 py-3"><h3 className="text-sm font-bold">Carrier & Tracking</h3></div>
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">{([["carrier", "Carrier"], ["serviceLevel", "Service Level"], ["trackingNumber", "Tracking Number"], ["shipDate", "Ship Date"]] as const).map(([key, label]) => <label key={key} className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">{label}<div className="flex gap-1"><input aria-label={label} type={key === "shipDate" ? "date" : "text"} className="h-9 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm text-foreground" value={form[key]} disabled={!isDraft || upsDraftLocked} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} />{key === "trackingNumber" && <button type="button" aria-label="Copy tracking number" className="rounded border px-2 hover:bg-muted" onClick={() => navigator.clipboard?.writeText(form.trackingNumber || "")}><Copy className="h-4 w-4" /></button>}</div></label>)}</div>
            </section>
            <details className="rounded-xl border border-border bg-card p-4" open={!!form.internalNotes || undefined}><summary className="cursor-pointer text-sm font-semibold">Shipment Internal Notes</summary><textarea aria-label="Shipment internal notes" className="mt-3 w-full resize-none rounded border border-input bg-background p-3 text-sm" rows={2} placeholder="Internal shipping instructions..." value={form.internalNotes} disabled={!isDraft || upsDraftLocked} onChange={event => setForm(previous => ({ ...previous, internalNotes: event.target.value }))} /></details>
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
              {isDraft && <p role={hasUnsavedChanges ? "status" : undefined} className="border-t px-4 py-2 text-xs text-muted-foreground">{hasUnsavedChanges ? "Waiting for draft autosave before previewing or printing. Documents use saved quantities and context." : "Documents use saved quantities and context."}</p>}
              {documentSourceQuery.isError && <p className="border-t px-4 py-2 text-xs text-destructive">{toFulfillmentError(documentSourceQuery.error).message}</p>}
            </div>

            {isDraft && <div className="flex flex-col gap-3">
              <div role="status" className="text-xs text-muted-foreground">{draftSaveState === 'saving' ? 'Saving draft…' : draftSaveState === 'failed' ? 'Save failed' : hasUnsavedChanges ? 'Unsaved changes' : draftSaveState === 'saved' ? 'Saved' : 'Draft saved'}{draftSaveError && <span className="block text-destructive">{draftSaveError}</span>}{draftSaveState === 'failed' && <button type="button" className="mt-1 font-semibold underline" onClick={retryDraftSave}>Retry save</button>}</div>
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
        <Dialog open={!!upsLabelPreview} onOpenChange={open => !open && setUpsLabelPreview(null)}>
          <DialogContent className="max-h-[95dvh] max-w-[min(95vw,40rem)] overflow-auto"><DialogHeader><DialogTitle>UPS label · {upsLabelPreview?.trackingNumber}</DialogTitle></DialogHeader>
            {upsLabelPreview && <><img src={upsLabelPreview.url} alt={`UPS label evidence for ${upsLabelPreview.trackingNumber}`} className="mx-auto max-h-[75dvh] max-w-full object-contain" />{upsLabelPreview.printable ? <button type="button" className="rounded border px-3 py-2 text-sm" onClick={printPreviewedUpsLabel}>Print in browser</button> : <p role="alert" className="text-sm text-amber-700">Test or unverified label: not usable for shipping.</p>}</>}
          </DialogContent>
        </Dialog>
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
