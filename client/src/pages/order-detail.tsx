import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Calendar, Package, DollarSign, Trash2, Edit, Check, X, Plus, UserCog, Truck, ExternalLink, FileText, ChevronDown, Mail, Phone, ChevronsUpDown, Download, Printer } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import { useAuth } from "@/hooks/useAuth";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { useOrder, useCancelOrder, useDeleteOrder, useUpdateOrder, useBulkUpdateOrderLineItemStatus, useTransitionOrderStatus, getAllowedNextStatuses, isOrderEditable, useOrderWorkflow, useOrderCancellationEligibility } from "@/hooks/useOrders";
import { useCreateOrderInvoice, useInvoices } from "@/hooks/useInvoices";
import { OrderAttachmentsPanel } from "@/components/OrderAttachmentsPanel";
import { useQuery } from "@tanstack/react-query";
import type { OrderLineItem as HookOrderLineItem, OrderWithRelations as HookOrderWithRelations } from "@/hooks/useOrders";
import { OrderStatusBadge, OrderPriorityBadge, LineItemStatusBadge } from "@/components/order-status-badge";
import { FulfillmentStatusBadge } from "@/components/FulfillmentStatusBadge";
import { ShipmentForm } from "@/components/ShipmentForm";
import { PackingSlipModal } from "@/components/PackingSlipModal";
import { PrintTicketButton } from "@/components/production/PrintTicketButton";
import { useShipments, useDeleteShipment, useUpdateShipment, useGeneratePackingSlip, useSendShipmentEmail, useUpdateFulfillmentStatus } from "@/hooks/useShipments";
import type { Shipment } from "@shared/schema";
import { format } from "date-fns";
import { formatOrderDate, orderDateInputValue, serializeOrderDateInput } from "@/lib/orderDate";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Page, ContentLayout, DataCard, StatusPill } from "@/components/titan";
import { TimelinePanel } from "@/components/TimelinePanel";
import { getDisplayOrderNumber } from "@/lib/orderUtils";
import { cn, formatPhoneForDisplay, phoneToTelHref } from "@/lib/utils";
import { resolveInventoryPolicyFromOrgPreferences } from "@shared/inventoryPolicy";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";
import { useSmartBack } from "@/hooks/useSmartBack";
import { buildReferrer } from "@/lib/nav/smartBack";
import {
  notifyBrowserRouterOfCurrentUrlSoon,
  recoverBrowserRouterMismatchSoon,
} from "@/lib/nav/browserRouterSync";
// TitanOS State Architecture
import { OrderStatusPillSelector } from "@/components/OrderStatusPillSelector";
import { 
  CloseOrderButton, 
  ReopenOrderButton 
} from "@/components/StateTransitionButtons";
import type { OrderState } from "@/hooks/useOrderState";
import { isTerminalState as checkIfTerminalState, useCloseOrder, useCompleteOrder } from "@/hooks/useOrderState";
import { deriveOrderInvoiceState } from "@shared/orderInvoiceState";
import { OrderLineItemsSection, type OrderLineItemsSectionHandle } from "@/components/orders/OrderLineItemsSection";
import {
  hasOrderDetailSecondaryActions,
  OrderDetailPrimaryActions,
  OrderDetailSecondaryActions,
} from "@/components/orders/OrderDetailActionPanels";
import { orchestrateOrderSave } from "@/pages/orderSaveOrchestration";
import { createOrderNavigationGuard } from "@/pages/orderNavigationGuard";
import { ManualReservationsCard } from "@/components/orders/ManualReservationsCard";
import BackNavControls from "@/components/BackNavControls";
import { buildProofingLineItemPath } from "@/lib/proofingNavigation";
import { getOrderProofBadgeClass } from "@/lib/orderProofUi";
import { canOpenProofingFromOrderStatus } from "@shared/orderProofStatus";
import { isCanceledOrder } from "@shared/operationalState";
import { ROUTES } from "@/config/routes";
import { downloadAuthenticatedPdf, openAuthenticatedPdfForPrint, openAuthenticatedPdfPreview } from "@/lib/authenticatedPdfPreview";
import { apiFetch } from "@/lib/queryClient";
import { hasEnteredShipToAddress, resolveCustomerShipTo } from "@/lib/customerShipTo";
import { useOrderPaymentResolution } from "@/hooks/usePaymentOrchestrator";
import type { PaymentInvoiceCandidate } from "@shared/paymentOrchestration";
import { getOrderBillingActionState } from "@/lib/paymentResolutionUi";
import { isClearlyGeneratedInboundProvenance } from "@/lib/inboundInternalNotes";
import { OrderRecipientFallbackDialog } from "@/features/orders/components/OrderRecipientFallbackDialog";
import {
  resolveAttachOrderPdfDefault,
  resolveSelectedOrderContactEmail,
  type OrderRecipientContactLike,
} from "@/features/orders/orderRecipientFallback";
import {
  orderCancellationReasonLabels,
  orderCancellationReasonValues,
  type OrderCancellationReason,
} from "@shared/orderCancellation";

/**
 * OrderDetail renders some legacy "bill to / ship to / shipping" snapshot fields
 * that are returned by the API but are not part of the current `OrderWithRelations`
 * type in `@shared/schema`.
 *
 * We model them here as optional fields to keep runtime behavior identical while
 * satisfying TypeScript without weakening types globally.
 */
type OrderAddressSnapshotFields = {
  billToName?: string | null;
  billToCompany?: string | null;
  billToAddress1?: string | null;
  billToAddress2?: string | null;
  billToCity?: string | null;
  billToState?: string | null;
  billToPostalCode?: string | null;
  billToPhone?: string | null;
  billToEmail?: string | null;

  shipToName?: string | null;
  shipToCompany?: string | null;
  shipToEmail?: string | null;
  shipToPhone?: string | null;
  shipToAddress1?: string | null;
  shipToAddress2?: string | null;
  shipToCity?: string | null;
  shipToState?: string | null;
  shipToPostalCode?: string | null;
  shipToCountry?: string | null;

  shippingMethod?: string | null;
  shippingInstructions?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;

  // Quote-style tags/flags (fail-soft; may be present in some deployments)
  tags?: string[] | null;
  
  // TitanOS State Architecture fields
  state?: string;
  statusPillValue?: string | null;
  statusPillId?: string | null;
  paymentStatus?: string;
  routingTarget?: string | null;
};

type OrderDetailOrder = HookOrderWithRelations & OrderAddressSnapshotFields;
type OrderDetailLineItem = HookOrderWithRelations["lineItems"][number];

type OrderInternalNoteRow = {
  id: string;
  orderId: string;
  noteText: string;
  audienceTags: string[] | null;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: string;
};

type OrderInboundAttachmentAudit = {
  id: string;
  actionType: string;
  note: string | null;
  metadata: {
    inboundRecordId?: string;
    senderEmail?: string | null;
    subject?: string | null;
    receivedAt?: string | null;
  } | null;
  createdAt: string;
};

type OrderDesignBillingVisibilityItem = {
  lineItemId: string;
  orderId: string;
  description: string | null;
  quantity: number;
  productName: string | null;
  effectiveRequiresDesign: boolean;
  designPricingModeSnapshot: string | null;
  visibilityState: "not_applicable" | "no_summary" | "available";
  designCostState: "not_applicable" | "estimated" | "accrued" | "finalized" | null;
  correctedTrackedMinutes: number | null;
  soldDesignAmount: number | null;
  billableDesignMinutes: number | null;
  billableDesignAmount: number | null;
  billingStatus: "not_billable" | "candidate" | "approved_for_invoice" | "invoiced" | "waived" | null;
  lastSyncedAt: string | null;
};

const DESIGN_BILLING_STATUS_LABELS: Record<NonNullable<OrderDesignBillingVisibilityItem["billingStatus"]>, string> = {
  not_billable: "Not billable",
  candidate: "Candidate",
  approved_for_invoice: "Approved for invoice",
  invoiced: "Invoiced",
  waived: "Waived",
};

const DESIGN_COST_STATE_LABELS: Record<NonNullable<OrderDesignBillingVisibilityItem["designCostState"]>, string> = {
  not_applicable: "Not applicable",
  estimated: "Estimated",
  accrued: "Accrued",
  finalized: "Finalized",
};

const DESIGN_PRICING_MODE_LABELS: Record<string, string> = {
  none: "None",
  flat_fee: "Flat fee",
  hourly: "Hourly",
  included_minutes_plus_overage: "Included minutes + overage",
  manual_quote: "Manual quote",
};

const fulfillmentMethods = ["pickup", "ship", "deliver"] as const;
type FulfillmentMethod = (typeof fulfillmentMethods)[number];
const isFulfillmentMethod = (value: string): value is FulfillmentMethod =>
  fulfillmentMethods.some((method) => method === value);

// Date display style for Due Date and Promised Date in the order details card
// Future: This will be configurable via organization preferences
const DATE_DISPLAY_STYLE: "short" | "numeric" = "short";

function hasAnyStagedChanges(stagedPatch: Record<string, any>): boolean {
  return Object.keys(stagedPatch).length > 0;
}

const ORDER_DETAIL_DEV_DIAGNOSTICS =
  typeof process !== "undefined" && process.env?.NODE_ENV === "development";

export default function OrderDetail() {
  const { user } = useAuth();
  const { activeOrg: activeOrganization, role, isAdminOrOwner } = useActiveOrganizationRole({ enabled: Boolean(user) });
  const { preferences } = useOrgPreferences();
  const inventoryPolicy = resolveInventoryPolicyFromOrgPreferences(preferences);
  const inventoryReservationsEnabled = inventoryPolicy.mode !== "off";
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isOrderEditRoute = location.pathname.endsWith("/edit");
  const { registerGuard, guardedNavigate, getGuardDiagnostics } = useNavigationGuard();
  const { onSmartBack } = useSmartBack();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const [isContactPickerOpen, setIsContactPickerOpen] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState("");
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [editingPromisedDate, setEditingPromisedDate] = useState(false);
  const [tempDueDate, setTempDueDate] = useState("");
  const [tempPromisedDate, setTempPromisedDate] = useState("");
  const [proofBypassReason, setProofBypassReason] = useState("");

  const [jobLabelDraft, setJobLabelDraft] = useState("");
  const [poNumberDraft, setPoNumberDraft] = useState("");
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [pendingOrderPatch, setPendingOrderPatch] = useState<Record<string, any>>({});
  // True when the line items section has an expanded line item with unsaved edits.
  const [hasDirtyLineItem, setHasDirtyLineItem] = useState(false);

  // Order flags (stored in order_list_notes.listLabel as comma-separated values)
  const [flags, setFlags] = useState<string[]>([]);
  const [flagInput, setFlagInput] = useState("");
  const flagInputRef = useRef<HTMLInputElement | null>(null);
  

  // Fulfillment state
  const [showShipmentForm, setShowShipmentForm] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [showPackingSlipModal, setShowPackingSlipModal] = useState(false);
  const [packingSlipHtml, setPackingSlipHtml] = useState<string | null>(null);
  const [shipmentToDelete, setShipmentToDelete] = useState<string | null>(null);
  const [showOrderEmailDialog, setShowOrderEmailDialog] = useState(false);
  const [isOrderPdfBusy, setIsOrderPdfBusy] = useState<"preview" | "download" | "print" | null>(null);
  
  // Status transition confirmation state
  const [pendingStatusTransition, setPendingStatusTransition] = useState<{ toStatus: string; requiresReason: boolean } | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [showCancelOrderDialog, setShowCancelOrderDialog] = useState(false);
  const [cancelOrderReason, setCancelOrderReason] = useState<OrderCancellationReason>("customer_requested");
  const [cancelOrderInternalNote, setCancelOrderInternalNote] = useState("");
  
  // Per-section edit states (replaces global editMode)
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [isEditingFulfillment, setIsEditingFulfillment] = useState(false);
  const [isShipToAutofillOpen, setIsShipToAutofillOpen] = useState(false);
  const [shipToAutofillQuery, setShipToAutofillQuery] = useState("");
  const [shipToAutofillDebounced, setShipToAutofillDebounced] = useState("");

  // Local draft state for shipping/delivery price (cents persisted on order)
  const [shippingDraft, setShippingDraft] = useState<string>("");
  const [isEditingShippingDraft, setIsEditingShippingDraft] = useState(false);

  const suppressShipToBlurRef = useRef(false);
  const shipToCompanyInputRef = useRef<HTMLInputElement>(null);
  const shipToNameInputRef = useRef<HTMLInputElement>(null);
  const shipToEmailInputRef = useRef<HTMLInputElement>(null);
  const shipToPhoneInputRef = useRef<HTMLInputElement>(null);
  const shipToAddress1InputRef = useRef<HTMLInputElement>(null);
  const shipToAddress2InputRef = useRef<HTMLInputElement>(null);
  const shipToCityInputRef = useRef<HTMLInputElement>(null);
  const shipToStateInputRef = useRef<HTMLInputElement>(null);
  const shipToPostalCodeInputRef = useRef<HTMLInputElement>(null);

  const [rightPanel, setRightPanel] = useState<"collapsed" | "timeline" | "material">("collapsed");

  const [showReleaseReservationsDialog, setShowReleaseReservationsDialog] = useState(false);
  const [showPbv2RollupDialog, setShowPbv2RollupDialog] = useState(false);
  const [showInventoryReservationsDialog, setShowInventoryReservationsDialog] = useState(false);
  const [showManualReservationsDialog, setShowManualReservationsDialog] = useState(false);

  const [showCustomerAddress, setShowCustomerAddress] = useState(true);
  const lineItemsSectionRef = useRef<HTMLDivElement | null>(null);
  // Imperative API for orchestrating an open-line-item save from Save Order.
  const orderLineItemsApiRef = useRef<OrderLineItemsSectionHandle | null>(null);

  const focusProduction = searchParams.get("focusProduction") === "1";
  const focusProductionStatus = searchParams.get("productionStatus");

  // Auto-open pickers when entering edit mode
  useEffect(() => {
    if (isEditingCustomer) {
      setIsCustomerPickerOpen(true);
    }
  }, [isEditingCustomer]);

  useEffect(() => {
    if (isEditingContact) {
      setIsContactPickerOpen(true);
    }
  }, [isEditingContact]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShipToAutofillDebounced(shipToAutofillQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [shipToAutofillQuery]);

  const orderId = params.id;
  const { data: orderRaw, isLoading } = useOrder(orderId);
  const { data: inboundAttachmentAudit = [] } = useQuery<OrderInboundAttachmentAudit[]>({
    queryKey: ["/api/orders", orderId, "inbound-attachments"],
    queryFn: async () => {
      const response = await apiFetch(`/api/orders/${encodeURIComponent(orderId ?? "")}/audit`);
      if (!response.ok) throw new Error("Failed to load order attachment history");
      const payload = await response.json();
      return Array.isArray(payload?.data)
        ? payload.data.filter((entry: OrderInboundAttachmentAudit) => entry.actionType === "inbound_record_attached")
        : [];
    },
    enabled: Boolean(orderId),
    staleTime: 30_000,
  });
  const [draftLineItemTotalsCents, setDraftLineItemTotalsCents] = useState<Record<string, number>>({});
  const [lineItemsEditorResetKey, setLineItemsEditorResetKey] = useState(0);
  let order = orderRaw as OrderDetailOrder | undefined;
  if (order && Object.keys(pendingOrderPatch).length > 0) {
    order = {
      ...order,
      ...pendingOrderPatch,
    } as OrderDetailOrder;
  }
  const proofPolicyMutation = useMutation({
    mutationFn: async ({ policy, reason }: { policy: "inherit_default" | "force_required" | "bypass"; reason?: string | null }) => {
      const response = await fetch(`/api/orders/${orderId}/proof-policy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ policy, reason: reason ?? null }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.message || json.error || "Failed to update proof policy");
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] as any });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] as any });
      toast({ title: "Proof policy updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Proof policy failed", description: error.message, variant: "destructive" });
    },
  });

  const productionFocus = useMemo(() => {
    if (!focusProduction || !order?.lineItems?.length) {
      return {
        highlightedIds: [] as string[],
        prioritizedIds: [] as string[],
      };
    }

    const productionRelevant = order.lineItems.filter((lineItem: any) =>
      (lineItem?.product as any)?.requiresProductionJob === true && (lineItem?.product as any)?.workflowIntent !== "service_fee",
    );
    const terminalStates = new Set(["completed", "canceled", "complete"]);
    const readyStates = new Set(["ready_for_prepress", "ready_for_production"]);

    const pending = productionRelevant.filter((lineItem: any) => {
      const workflowState = String(lineItem.workflowState || lineItem.status || "").trim().toLowerCase();
      if (terminalStates.has(workflowState)) return false;
      if (!readyStates.has(workflowState)) return false;
      return !lineItem.activeOwnerJobId;
    });

    const prioritized = focusProductionStatus === "needs_handoff"
      ? pending
      : [...pending, ...productionRelevant.filter((lineItem: any) => !pending.some((pendingItem) => pendingItem.id === lineItem.id))];

    return {
      highlightedIds: prioritized.map((lineItem: any) => String(lineItem.id)),
      prioritizedIds: prioritized.map((lineItem: any) => String(lineItem.id)),
    };
  }, [focusProduction, focusProductionStatus, order]);

  const orderOperationalSummary = useMemo(() => {
    const lineItems = order?.lineItems ?? [];
    const totalItems = lineItems.length;
    const productionRequiredCount = lineItems.filter((lineItem: any) =>
      (lineItem?.product as any)?.requiresProductionJob === true && (lineItem?.product as any)?.workflowIntent !== "service_fee",
    ).length;
    const actionNeededCount = lineItems.filter((lineItem: any) => {
      const workflowState = String(lineItem?.workflowState || lineItem?.status || "new").trim().toLowerCase();
      return ["new", "needs_design", "ready_for_prepress", "ready_for_production", "on_hold"].includes(workflowState);
    }).length;
    const inProgressCount = lineItems.filter((lineItem: any) => {
      const workflowState = String(lineItem?.workflowState || lineItem?.status || "").trim().toLowerCase();
      return ["in_design", "in_prepress", "in_production"].includes(workflowState);
    }).length;

    return {
      totalItems,
      productionRequiredCount,
      actionNeededCount,
      inProgressCount,
    };
  }, [order]);

  useEffect(() => {
    setDraftLineItemTotalsCents({});
  }, [orderId]);

  const handleDraftLineItemPricingChange = useCallback((lineItemId: string, effectiveTotalCents: number | null) => {
    setDraftLineItemTotalsCents((prev) => {
      const next = { ...prev };
      if (effectiveTotalCents === null) {
        delete next[lineItemId];
      } else {
        next[lineItemId] = effectiveTotalCents;
      }
      return next;
    });
  }, []);

  const displayedOrderTotals = useMemo(() => {
    if (!order) {
      return { subtotal: 0, discount: 0, tax: 0, shipping: 0, total: 0 };
    }

    const discount = parseFloat(order.discount) || 0;
    const tax = parseFloat(order.tax) || 0;
    const shipping = (Number((order as any).shippingCents) || 0) / 100;
    if (Object.keys(draftLineItemTotalsCents).length === 0) {
      return {
        subtotal: parseFloat(order.subtotal) || 0,
        discount,
        tax,
        shipping,
        total: parseFloat(order.total) || 0,
      };
    }

    const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
    const subtotal = lineItems.reduce((sum: number, item: any) => {
      const draftCents = draftLineItemTotalsCents[String(item.id)];
      if (Number.isFinite(draftCents)) return sum + draftCents / 100;
      return sum + (parseFloat(item?.totalPrice) || 0);
    }, 0);
    return {
      subtotal,
      discount,
      tax,
      shipping,
      total: subtotal - discount + tax + shipping,
    };
  }, [order, draftLineItemTotalsCents]);

  useEffect(() => {
    if (!focusProduction || productionFocus.prioritizedIds.length === 0) return;

    const targetId = productionFocus.prioritizedIds[0];
    window.dispatchEvent(new CustomEvent("titanos:jump-to-line-item", { detail: { lineItemId: targetId } }));

    const timer = window.setTimeout(() => {
      lineItemsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);

    return () => window.clearTimeout(timer);
  }, [focusProduction, productionFocus]);

  const deleteOrder = useDeleteOrder();
  const cancelOrderMutation = useCancelOrder(orderId!);
  const duplicateOrderMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/orders/${orderId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || "Failed to duplicate order");
      return payload.data.order as { id: string; displayNumber?: string | null; orderNumber?: string | null };
    },
    onSuccess: async (duplicatedOrder) => {
      await queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      toast({ title: "Order duplicated", description: `Created ${duplicatedOrder.displayNumber || duplicatedOrder.orderNumber || "a new order"}.` });
      navigate(ROUTES.orders.detail(duplicatedOrder.id));
    },
    onError: (error: Error) => {
      toast({ title: "Unable to duplicate order", description: error.message, variant: "destructive" });
    },
  });
  const cancellationEligibilityQuery = useOrderCancellationEligibility(orderId);
  const updateOrder = useUpdateOrder(orderId!);
  const transitionStatus = useTransitionOrderStatus(orderId!);
  const workflowQuery = useOrderWorkflow();
  const bulkUpdateLineItemStatus = useBulkUpdateOrderLineItemStatus(orderId!);

  // Fulfillment hooks
  const { data: shipments = [] } = useShipments(orderId!);
  const deleteShipmentMutation = useDeleteShipment(orderId!);
  const updateShipmentMutation = useUpdateShipment(orderId!);
  const generatePackingSlip = useGeneratePackingSlip(orderId!);
  const updateFulfillmentStatus = useUpdateFulfillmentStatus(orderId!);

  const pbv2RollupQuery = useQuery({
    queryKey: ["/api/orders", orderId, "pbv2", "rollup"],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/pbv2/rollup`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load PBV2 rollup");
      return res.json();
    },
  });

  const [orderInternalNoteDraft, setOrderInternalNoteDraft] = useState("");
  const [isAddingOrderInternalNote, setIsAddingOrderInternalNote] = useState(false);

  const orderInternalNotesQuery = useQuery<OrderInternalNoteRow[]>({
    queryKey: ["orders", "internalNotes", orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const response = await fetch(`/api/orders/${orderId}/internal-notes`, { credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "Failed to load order internal notes");
      }
      const payload = await response.json();
      return payload.data as OrderInternalNoteRow[];
    },
  });

  const orderDesignBillingVisibilityQuery = useQuery<OrderDesignBillingVisibilityItem[]>({
    queryKey: ["orders", "design-billing-visibility", orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const response = await fetch(`/api/orders/${orderId}/design-billing-visibility`, { credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "Failed to load design billing visibility");
      }
      const payload = await response.json();
      return payload.data as OrderDesignBillingVisibilityItem[];
    },
  });

  const addOrderInternalNoteMutation = useMutation({
    mutationFn: async (noteText: string) => {
      const response = await fetch(`/api/orders/${orderId}/internal-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ noteText }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to add order internal note");
      }
      return payload.data as OrderInternalNoteRow;
    },
    onSuccess: async () => {
      setOrderInternalNoteDraft("");
      setIsAddingOrderInternalNote(false);
      await queryClient.invalidateQueries({ queryKey: ["orders", "internalNotes", orderId] });
      toast({ title: "Order internal note added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add order internal note", description: error.message, variant: "destructive" });
    },
  });

  const inventoryQuery = useQuery({
    queryKey: ["/api/orders", orderId, "inventory"],
    enabled: Boolean(orderId) && inventoryReservationsEnabled,
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/inventory`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to load inventory reservations");
      }
      return res.json();
    },
  });

  const reserveInventoryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/inventory/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).message || "Failed to reserve inventory");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "inventory"] });
      toast({ title: "Inventory reserved" });
    },
    onError: (e: any) => {
      toast({ title: "Reserve failed", description: String(e?.message || "Unknown error"), variant: "destructive" });
    },
  });

  const releaseInventoryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/inventory/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).message || "Failed to release inventory");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "inventory"] });
      toast({ title: "Inventory released" });
    },
    onError: (e: any) => {
      toast({ title: "Release failed", description: String(e?.message || "Unknown error"), variant: "destructive" });
    },
  });

  // Billing / invoices
  const { data: orderInvoices = [], isLoading: isInvoicesLoading } = useInvoices(orderId ? { orderId } : undefined);
  const createOrderInvoice = useCreateOrderInvoice();
  const closeOrder = useCloseOrder(orderId || '');
  const completeOrder = useCompleteOrder(orderId || '');
  const orderPaymentResolution = useOrderPaymentResolution(orderId);
  const [billingOverrideDialogOpen, setBillingOverrideDialogOpen] = useState(false);
  const [billingOverrideNote, setBillingOverrideNote] = useState('');
  const [paymentInvoiceSelectorOpen, setPaymentInvoiceSelectorOpen] = useState(false);
  const [paymentBlockedDialogOpen, setPaymentBlockedDialogOpen] = useState(false);
  const [closeFeeOnlyAfterInvoice, setCloseFeeOnlyAfterInvoice] = useState<{ invoiceId: string } | null>(null);

  const setBillingOverrideMutation = useMutation({
    mutationFn: async ({ note }: { note: string }) => {
      const response = await fetch(`/api/orders/${orderId}/billing-ready-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to set billing override');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (orderId) queryClient.invalidateQueries({ queryKey: ['orders', 'detail', orderId] });
    },
  });

  const clearBillingOverrideMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/orders/${orderId}/clear-billing-ready-override`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to clear billing override');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (orderId) queryClient.invalidateQueries({ queryKey: ['orders', 'detail', orderId] });
    },
  });

  // This only controls the saved-order editor affordance. The PATCH endpoint
  // independently authorizes the same active organization membership.
  const isManagerOrHigher = isAdminOrOwner || role === "manager";
  const proofApprovalPolicyOverride = String((order as any)?.proofApprovalPolicyOverride || "inherit_default");
  const proofBypassed = proofApprovalPolicyOverride === "bypass";
  
  // Check editability based on order status
  const baseCanEditOrder = order ? isOrderEditable(order.status) : false;
  const allowedNextStatuses = useMemo(() => {
    if (!order) return [] as string[];

    const statuses = workflowQuery.data?.statuses ?? [];
    if (statuses.length === 0) {
      return getAllowedNextStatuses(order.status);
    }

    const current = statuses.find((s) => s.id === order.workflowStatusId) ?? statuses.find((s) => s.key === order.status);
    const activeStatuses = statuses.filter((s) => s.isActive);

    const transitions = workflowQuery.data?.transitions ?? [];
    if (current && transitions.length > 0) {
      const toIds = transitions.filter((t) => t.fromStatusId === current.id).map((t) => t.toStatusId);
      const keys = activeStatuses.filter((s) => toIds.includes(s.id)).map((s) => s.key);
      return Array.from(new Set(keys));
    }

    return activeStatuses
      .filter((s) => s.key !== order.status)
      .map((s) => s.key);
  }, [order, workflowQuery.data]);
  const isTerminal = allowedNextStatuses.length === 0;
  const orderIsCanceled = isCanceledOrder(order);
  const cancellationReasonLabel = order?.cancellationReason
    ? (orderCancellationReasonLabels as Record<string, string>)[order.cancellationReason] || order.cancellationReason
    : null;
  const cancellationDateLabel = order?.canceledAt ? format(new Date(order.canceledAt), "MMM d, yyyy h:mm a") : null;
  
  // Admin/Owner override: allow editing terminal orders if setting enabled
  const allowCompletedOrderEdits = preferences?.orders?.allowCompletedOrderEdits || false;
  const requireLineItemsDone = (preferences?.orders?.requireAllLineItemsDoneToComplete
    ?? preferences?.orders?.requireLineItemsDoneToComplete
    ?? true); // Default strict
  const canEditOrder = baseCanEditOrder || (isTerminal && isAdminOrOwner && allowCompletedOrderEdits);
  const canShowCancelOrder = Boolean(order && !orderIsCanceled);
  const canCancelOrder = Boolean(canShowCancelOrder && isAdminOrOwner && cancellationEligibilityQuery.data?.canCancel);
  const cancelOrderUnavailableReason = canShowCancelOrder
    ? !isAdminOrOwner
      ? "Only Admin and Owner users can cancel orders."
      : cancellationEligibilityQuery.isLoading
      ? "Checking cancellation availability..."
      : cancellationEligibilityQuery.data?.message ?? (cancellationEligibilityQuery.isError ? "Cancellation availability could not be checked." : null)
    : null;
  const orderPdfEligibleLineItems = useMemo(() => {
    return (order?.lineItems ?? []).filter((lineItem: any) => {
      const status = String(lineItem?.status || "").toLowerCase();
      return (
        lineItem?.id &&
        lineItem?.productId &&
        Number(lineItem?.quantity ?? 0) > 0 &&
        Number.isFinite(Number(lineItem?.totalPrice ?? 0)) &&
        status !== "draft" &&
        status !== "canceled"
      );
    });
  }, [order?.lineItems]);
  const canUseOrderPdf = Boolean(order?.id && orderPdfEligibleLineItems.length > 0 && !hasDirtyLineItem);
  const orderPdfUnavailableReason = !order?.id
    ? "Save the order before generating an order PDF."
    : hasDirtyLineItem
      ? "Save the open line item before generating an order PDF."
      : orderPdfEligibleLineItems.length === 0
        ? "Add at least one valid saved line item before generating an order PDF."
        : null;
  // Single canonical dirty value: staged order-level edits OR an unsaved line
  // item. This same value drives the Save Order button.
  const hasStagedOrderChanges = hasAnyStagedChanges(pendingOrderPatch);
  const isDirty = hasStagedOrderChanges || hasDirtyLineItem;
  // Synchronized guard mirror of the same canonical dirty value. Save Order
  // releases this before navigating so a stale registered callback cannot keep
  // blocking after the UI has already committed a successful save.
  const orderDirtyRef = useRef(isDirty);
  orderDirtyRef.current = isDirty;

  const getOrderDirtyAuditSnapshot = useCallback(
    (phase: string) => {
      const guardDiagnostics = getGuardDiagnostics();
      const lineItemDiagnostics = orderLineItemsApiRef.current?.getDirtyDiagnostics();

      return {
        phase,
        saveOrderButtonDirty: isDirty,
        canonicalGuardDirty: orderDirtyRef.current,
        hasDirtyLineItem,
        hasStagedOrderChanges,
        pendingOrderPatchKeys: Object.keys(pendingOrderPatch),
        registeredGuardCount: guardDiagnostics.registeredGuardCount,
        eachGuardShouldBlockResult: guardDiagnostics.guards,
        activeGuardLabels: guardDiagnostics.activeGuardLabels,
        beforeUnloadActive: isDirty,
        expandedLineItemDirty: lineItemDiagnostics?.expandedLineItemDirty ?? false,
        productReplacementDirty: lineItemDiagnostics?.productReplacementDirty ?? false,
        designBriefDirty: lineItemDiagnostics?.designBriefDirty ?? false,
        lineItemDiagnostics: lineItemDiagnostics ?? null,
        windowPath: window.location.pathname,
        reactRouterPath: location.pathname,
        at: new Date().toISOString(),
      };
    },
    [
      getGuardDiagnostics,
      hasDirtyLineItem,
      hasStagedOrderChanges,
      isDirty,
      location.pathname,
      pendingOrderPatch,
    ],
  );

  const logOrderDirtyAudit = useCallback(
    (phase: string) => {
      if (!ORDER_DETAIL_DEV_DIAGNOSTICS) return;
      console.warn("[ORDER_SAVE_DIRTY_AUDIT]", getOrderDirtyAuditSnapshot(phase));
    },
    [getOrderDirtyAuditSnapshot],
  );
  const routeLocationRef = useRef(location);
  routeLocationRef.current = location;

  const applyOrderPatch = async (patch: Record<string, any>) => {
    if (!canEditOrder) return;
    setPendingOrderPatch((prev) => ({ ...prev, ...patch }));
  };

  // beforeunload (tab close / refresh): attached only while dirty, re-bound on
  // every isDirty change so it reflects the committed value without a ref.
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // DEV diagnostics — surfaces the canonical dirty state and the inputs that
  // feed it whenever any of them change, so a stuck guard is traceable.
  useEffect(() => {
    if (!ORDER_DETAIL_DEV_DIAGNOSTICS) return;
    console.warn("[ORDER_NAV_GUARD] dirty-state", {
      isDirty,
      hasDirtyLineItem,
      hasStagedOrderChanges,
      isSavingOrder,
      updateOrderPending: updateOrder.isPending,
      pendingOrderPatchKeys: Object.keys(pendingOrderPatch),
      at: new Date().toISOString(),
    });
  }, [isDirty, hasDirtyLineItem, hasStagedOrderChanges, isSavingOrder, updateOrder.isPending, pendingOrderPatch]);

  // In-app navigation guard. It reads the synchronized canonical dirty ref so
  // Save Order can release the guard immediately after persistence succeeds,
  // before the next render/effect cleanup has a chance to run.
  useEffect(() => {
    const unregister = registerGuard(
      (targetPath) => createOrderNavigationGuard(orderDirtyRef.current).guard(targetPath),
      () => createOrderNavigationGuard(orderDirtyRef.current).shouldBlock(),
      "order-detail",
    );
    if (ORDER_DETAIL_DEV_DIAGNOSTICS) {
      console.warn("[ORDER_NAV_GUARD] guard registered", { isDirty: orderDirtyRef.current });
    }
    return () => {
      unregister();
      if (ORDER_DETAIL_DEV_DIAGNOSTICS) {
        console.warn("[ORDER_NAV_GUARD] guard unregistered", { wasDirty: orderDirtyRef.current });
      }
    };
  }, [registerGuard]);

  const listNoteQuery = useQuery<{ listLabel: string | null }>(
    {
      queryKey: ["orders", "list-note", orderId],
      enabled: !!orderId,
      queryFn: async () => {
        const response = await fetch(`/api/orders/${orderId}/list-note`, { credentials: "include" });
        if (!response.ok) throw new Error("Failed to load list note");
        return response.json();
      },
      staleTime: 30_000,
    }
  );

  const updateListNoteMutation = useMutation({
    mutationFn: async ({ listLabel }: { listLabel: string }) => {
      const response = await fetch(`/api/orders/${orderId}/list-note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listLabel }),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update list note");
      return response.json() as Promise<{ success: true; listLabel: string | null }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["orders", "list-note", orderId], { listLabel: data.listLabel ?? null });
    },
  });
  
  // Helper functions to enter edit mode (ensures only one section is editable at a time)
  const enterCustomerEdit = () => {
    if (!canEditOrder) return;
    setIsEditingCustomer(true);
    setIsEditingContact(false);
    setIsEditingFulfillment(false);
    // Open customer picker immediately
    setIsCustomerPickerOpen(true);
  };

  const enterContactEdit = () => {
    if (!canEditOrder) return;
    setIsEditingCustomer(false);
    setIsEditingContact(true);
    setIsEditingFulfillment(false);
    // Open contact picker immediately
    setIsContactPickerOpen(true);
  };

  const enterFulfillmentEdit = () => {
    if (!canEditOrder) return;
    setIsEditingCustomer(false);
    setIsEditingContact(false);
    setIsEditingFulfillment(true);
  };

  const handleFulfillmentMethodChange = (value: string) => {
    if (!canEditOrder) return;
    if (!isFulfillmentMethod(value)) return;
    if (value === "pickup") {
      setShippingDraft("");
      void applyOrderPatch({ shippingMethod: value, shippingCents: 0 });
      return;
    }

    void applyOrderPatch({ shippingMethod: value });
  };

  const handleAddNewShipToAddress = () => {
    // Ensure manual entry UI is visible/enabled
    enterFulfillmentEdit();

    // Clear fields client-side only (do NOT persist)
    suppressShipToBlurRef.current = true;
    if (shipToCompanyInputRef.current) shipToCompanyInputRef.current.value = "";
    if (shipToNameInputRef.current) shipToNameInputRef.current.value = "";
    if (shipToEmailInputRef.current) shipToEmailInputRef.current.value = "";
    if (shipToPhoneInputRef.current) shipToPhoneInputRef.current.value = "";
    if (shipToAddress1InputRef.current) shipToAddress1InputRef.current.value = "";
    if (shipToAddress2InputRef.current) shipToAddress2InputRef.current.value = "";
    if (shipToCityInputRef.current) shipToCityInputRef.current.value = "";
    if (shipToStateInputRef.current) shipToStateInputRef.current.value = "";
    if (shipToPostalCodeInputRef.current) shipToPostalCodeInputRef.current.value = "";

    // Focus first field if possible (avoid refactor if not)
    requestAnimationFrame(() => {
      shipToCompanyInputRef.current?.focus();
      suppressShipToBlurRef.current = false;
    });
  };

  const currentFulfillmentMethod: FulfillmentMethod =
    order?.shippingMethod && typeof order.shippingMethod === "string" && isFulfillmentMethod(order.shippingMethod)
      ? order.shippingMethod
      : "ship";

  // Keep shipping input in sync when order hydrates/changes
  useEffect(() => {
    if (isEditingShippingDraft) return;
    const cents = (order as any)?.shippingCents;
    if (typeof cents === "number" && cents > 0) {
      setShippingDraft((cents / 100).toFixed(2));
    } else {
      setShippingDraft("");
    }
  }, [order, isEditingShippingDraft]);

  const exitAllEditModes = () => {
    setIsEditingCustomer(false);
    setIsEditingContact(false);
    setIsEditingFulfillment(false);
  };

  // Calculate incomplete line items for completion workflow
  const incompleteLi = order?.lineItems?.filter(li => li.status !== 'complete' && li.status !== 'canceled') || [];

  // Fetch customers for the customer change dialog (kept for backward compat)
  const { data: customers = [] } = useQuery({
    queryKey: ["/api/customers"],
    queryFn: async () => {
      const response = await fetch("/api/customers", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customers");
      return response.json();
    },
  });

  // Fetch contacts for the current customer
  const { data: customerContacts = [] } = useQuery({
    queryKey: ["/api/customers", order?.customerId, "contacts"],
    queryFn: async () => {
      if (!order?.customerId) return [];
      const response = await fetch(`/api/customers/${order.customerId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customer");
      const customer = await response.json();
      return customer.contacts || [];
    },
    enabled: !!order?.customerId,
  });

  const sendOrderEmailMutation = useMutation({
    mutationFn: async (payload: {
      recipientEmail: string;
      recipientName?: string;
      saveToCustomerContact: boolean;
      contactId: string | null;
      attachPdf: boolean;
    }) => {
      if (!orderId) throw new Error("Save the order before sending email.");
      const response = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || result.error || "Failed to send order email.");
      }
      return result as { success: boolean; message?: string };
    },
    onSuccess: async (result) => {
      setShowOrderEmailDialog(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/customers", order?.customerId, "contacts"] });
      toast({
        title: "Order email sent",
        description: result.message || "The order email was sent successfully.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Order email failed", description: error.message, variant: "destructive" });
    },
  });

  const { data: shipToAutofillCustomers = [], isLoading: isShipToAutofillCustomersLoading } = useQuery<CustomerWithContacts[]>({
    queryKey: ["/api/customers", { search: shipToAutofillDebounced }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (shipToAutofillDebounced.trim()) {
        params.set("search", shipToAutofillDebounced.trim());
      }
      const url = `/api/customers${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customers");
      return response.json();
    },
    staleTime: 30000,
    enabled: isEditingFulfillment,
  });

  // Filtered contacts based on search
  const filteredContacts = contactSearchQuery
    ? customerContacts.filter((contact: any) => {
        const searchLower = contactSearchQuery.toLowerCase();
        return (
          contact.firstName?.toLowerCase().includes(searchLower) ||
          contact.lastName?.toLowerCase().includes(searchLower) ||
          contact.email?.toLowerCase().includes(searchLower)
        );
      })
    : customerContacts;

  const saveOrderOwner = (changes: { customerId?: string | null; contactId?: string | null }) => {
    updateOrder.mutate(changes, {
      onSuccess: () => {
        setIsCustomerPickerOpen(false);
        setIsContactPickerOpen(false);
        exitAllEditModes();
      },
    });
  };

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(typeof amount === "string" ? parseFloat(amount) : amount);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "—";
    try {
      const date = new Date(dateString);
      if (DATE_DISPLAY_STYLE === "short") {
        // Format: "Jan 12, 2026"
        return new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(date);
      } else {
        // Format: "01/12/2026" (MM/DD/YYYY)
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const year = date.getFullYear();
        return `${month}/${day}/${year}`;
      }
    } catch {
      return "—";
    }
  };

  const handleDelete = async () => {
    if (!orderId) return;
    try {
      await deleteOrder.mutateAsync(orderId);
      navigate("/orders");
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    // Check if this transition requires confirmation
    if (newStatus === 'canceled') {
      setShowCancelOrderDialog(true);
      return;
    }
    
    if (newStatus === 'completed') {
      // Check if there are incomplete line items and strict mode is enabled
      if (requireLineItemsDone && incompleteLi.length > 0) {
        // Show dialog offering to mark items complete
        setPendingStatusTransition({ toStatus: newStatus, requiresReason: false });
        return;
      }
      // If not strict OR all items are complete, show regular confirmation
      setPendingStatusTransition({ toStatus: newStatus, requiresReason: false });
      return;
    }
    
    // Execute transition immediately for other statuses
    try {
      await transitionStatus.mutateAsync({ toStatus: newStatus });
    } catch (error) {
      // Error toast handled by mutation
    }
  };
  
  const confirmStatusTransition = async () => {
    if (!pendingStatusTransition) return;
    
    try {
      // If completing and there are incomplete items in strict mode, mark them complete first
      if (pendingStatusTransition.toStatus === 'completed' && requireLineItemsDone && incompleteLi.length > 0) {
        // Mark all incomplete items as complete
        await bulkUpdateLineItemStatus.mutateAsync({ status: 'complete' });
        
        // Small delay to ensure queries invalidated
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      await transitionStatus.mutateAsync({
        toStatus: pendingStatusTransition.toStatus,
        reason: pendingStatusTransition.requiresReason ? cancellationReason : undefined,
      });
      
      setPendingStatusTransition(null);
      setCancellationReason("");
    } catch (error) {
      // Error toast handled by mutation
    }
  };
  
  const cancelStatusTransition = () => {
    setPendingStatusTransition(null);
    setCancellationReason("");
  };

  const handleCancelOrderConfirm = async () => {
    if (!orderId) return;
    await cancelOrderMutation.mutateAsync({
      reason: cancelOrderReason,
      internalNote: cancelOrderInternalNote.trim() || undefined,
    });
    setShowCancelOrderDialog(false);
    setCancelOrderReason("customer_requested");
    setCancelOrderInternalNote("");
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await applyOrderPatch({ priority: newPriority });
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleDueDateEdit = () => {
    setTempDueDate(orderDateInputValue(order?.dueDate));
    setEditingDueDate(true);
  };

  const handleDueDateSave = async () => {
    try {
      const dateValue = serializeOrderDateInput(tempDueDate);
      await applyOrderPatch({ dueDate: dateValue });
      setEditingDueDate(false);
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleDueDateCancel = () => {
    setEditingDueDate(false);
    setTempDueDate('');
  };

  const handlePromisedDateEdit = () => {
    setTempPromisedDate(orderDateInputValue(order?.promisedDate));
    setEditingPromisedDate(true);
  };

  const handlePromisedDateSave = async () => {
    try {
      const dateValue = serializeOrderDateInput(tempPromisedDate);
      await applyOrderPatch({ promisedDate: dateValue });
      setEditingPromisedDate(false);
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handlePromisedDateCancel = () => {
    setEditingPromisedDate(false);
    setTempPromisedDate('');
  };

  const parseFlagsFromLabel = (label: string | null | undefined): string[] => {
    const raw = (label ?? "").trim();
    if (!raw) return [];

    const parts = raw
      .split(/[,\n]/g)
      .map((s) => s.trim())
      .filter(Boolean);

    const unique: string[] = [];
    const seen = new Set<string>();
    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      unique.push(p);
    }
    return unique;
  };

  const formatFlagsToLabel = (nextFlags: string[]): string | null => {
    const cleaned = nextFlags.map((f) => f.trim()).filter(Boolean);
    return cleaned.length ? cleaned.join(", ") : null;
  };

  useEffect(() => {
    const persistedOrder = orderRaw as OrderDetailOrder | undefined;
    setJobLabelDraft(persistedOrder?.label ?? "");
  }, [orderRaw]);

  useEffect(() => {
    const persistedOrder = orderRaw as OrderDetailOrder | undefined;
    setPoNumberDraft(persistedOrder?.poNumber ?? "");
  }, [orderRaw]);

  useEffect(() => {
    setFlags(parseFlagsFromLabel(listNoteQuery.data?.listLabel ?? null));
  }, [listNoteQuery.data?.listLabel]);

  const commitFlagInput = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      setFlagInput("");
      return;
    }

    void (async () => {
      const next = [...flags];
      for (const p of parts) {
        if (!next.includes(p)) next.push(p);
      }

      setFlags(next);
      setFlagInput("");

      if (!canEditOrder) return;
      try {
        await updateListNoteMutation.mutateAsync({ listLabel: formatFlagsToLabel(next) ?? "" });
      } catch {
        setFlags(parseFlagsFromLabel(listNoteQuery.data?.listLabel ?? null));
      }
    })();
  };

  const handleFlagKeyDown = (e: any) => {
    const isCommitKey = e.key === "Enter" || e.key === "," || e.key === "Comma";
    if (isCommitKey) {
      e.preventDefault();
      commitFlagInput(flagInput);
    } else if (e.key === "Backspace" && flagInput === "" && flags.length > 0) {
      e.preventDefault();
      void (async () => {
        const next = flags.slice(0, -1);
        setFlags(next);
        if (!canEditOrder) return;
        try {
          await updateListNoteMutation.mutateAsync({ listLabel: formatFlagsToLabel(next) ?? "" });
        } catch {
          setFlags(parseFlagsFromLabel(listNoteQuery.data?.listLabel ?? null));
        }
      })();
    }
  };

  const removeFlag = (flag: string) => {
    void (async () => {
      const next = flags.filter((f) => f !== flag);
      setFlags(next);
      if (!canEditOrder) return;
      try {
        await updateListNoteMutation.mutateAsync({ listLabel: formatFlagsToLabel(next) ?? "" });
      } catch {
        setFlags(parseFlagsFromLabel(listNoteQuery.data?.listLabel ?? null));
      }
    })();
  };

  const commitJobLabel = async () => {
    if (!orderId) return;
    await applyOrderPatch({ label: normalizeNullableString(jobLabelDraft) });
  };

  const commitPoNumber = async () => {
    if (!orderId) return;
    await applyOrderPatch({ poNumber: normalizeNullableString(poNumberDraft) });
  };

  // Save Order = "save all dirty work on this page". Sequencing (line item
  // first, then order-level fields, abort on line item failure) is delegated to
  // the pure `orchestrateOrderSave` helper; the step closures below perform the
  // actual mutations.
  const handleSaveOrder = async (routeEligible = false) => {
    if (!orderId || !order) return;
    setIsSavingOrder(true);
    try {
      logOrderDirtyAudit("before-save");
      const persistedOrder = orderRaw as OrderDetailOrder | undefined;
      const nextPatch: Record<string, any> = { ...pendingOrderPatch };
      const normalizedLabel = normalizeNullableString(jobLabelDraft);
      const normalizedPoNumber = normalizeNullableString(poNumberDraft);
      if ((persistedOrder?.label ?? null) !== normalizedLabel) {
        nextPatch.label = normalizedLabel;
      }
      if ((persistedOrder?.poNumber ?? null) !== normalizedPoNumber) {
        nextPatch.poNumber = normalizedPoNumber;
      }
      const hasOrderLevelChanges = Object.keys(nextPatch).length > 0;

      const result = await orchestrateOrderSave({
        hasDirtyLineItem,
        saveDirtyLineItem: async () => {
          const api = orderLineItemsApiRef.current;
          if (!api) {
            return { ok: false, error: "Save or discard changes on the open line item first." };
          }
          const r = await api.saveDirtyLineItem();
          logOrderDirtyAudit("after-line-item-save-step");
          return { ok: r.saved, error: r.error };
        },
        hasOrderLevelChanges,
        saveOrderLevelChanges: async () => {
          try {
            await updateOrder.mutateAsync({ ...nextPatch });
            setPendingOrderPatch({});
            await queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
            await queryClient.refetchQueries({ queryKey: ["orders", "detail", orderId], type: "active" });
            return { ok: true };
          } catch (error: any) {
            return { ok: false, error: error?.message || "Failed to save order" };
          }
        },
      });

      if (!result.ok) {
        // Failure at either step leaves that layer's dirty state intact.
        toast({
          title: result.failedStep === "lineItem" ? "Line item not saved" : "Order not saved",
          description: result.error || "Could not save changes.",
          variant: "destructive",
        });
        return;
      }

      if (routeEligible) {
        try {
          const response = await fetch(`/api/orders/${orderId}/route-eligible-line-items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ mode: "route_eligible" }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.message || "Routing failed.");
          const routingResult = Array.isArray(payload?.data?.routingResult) ? payload.data.routingResult : [];
          const routed = routingResult.filter((line: any) => line.status === "routed" || line.status === "already_routed");
          const blocked = routingResult.filter((line: any) => line.status === "blocked" || line.status === "failed");
          toast({
            title: "Order saved and routing evaluated",
            description: `${routed.length} routed; ${blocked.length} need attention. Review line-item operational status for exact blockers.`,
            variant: blocked.length > 0 ? "destructive" : undefined,
          });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] }),
            queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] }),
            queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] }),
            queryClient.invalidateQueries({ queryKey: ["/api/design/queue"] }),
            queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] }),
          ]);
        } catch (error: any) {
          // The save remains valid even when a downstream route is unavailable.
          toast({ title: "Order saved; routing needs attention", description: error?.message || "Routing could not be completed.", variant: "destructive" });
        }
      }

      logOrderDirtyAudit("after-save-success-before-clear");

      // updateOrder's onSuccess already toasts when order-level fields were
      // saved; only surface a toast for the line-item-only path.
      if (!hasOrderLevelChanges) {
        toast({ title: "Order saved" });
      }

      // Commit-and-exit: clear all dirty state then leave the explicit edit route.
      // Direct navigate() is intentionally allowed after a successful save; the
      // global guard only intercepts explicit guardedNavigate() calls.
      orderDirtyRef.current = false;
      setHasDirtyLineItem(false);
      setDraftLineItemTotalsCents({});
      setPendingOrderPatch({});
      logOrderDirtyAudit("after-clear-before-navigate");
      const postSavePath = isOrderEditRoute ? ROUTES.orders.detail(orderId) : ROUTES.orders.list;
      navigate(postSavePath);
      notifyBrowserRouterOfCurrentUrlSoon();
      recoverBrowserRouterMismatchSoon({
        targetPath: postSavePath,
        getReactRouterPath: () =>
          `${routeLocationRef.current.pathname}${routeLocationRef.current.search}${routeLocationRef.current.hash}`,
      });
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleCancelOrderEdits = async () => {
    setPendingOrderPatch({});
    setDraftLineItemTotalsCents({});
    setHasDirtyLineItem(false);
    setLineItemsEditorResetKey((value) => value + 1);
    setJobLabelDraft((orderRaw as OrderDetailOrder | undefined)?.label ?? "");
    setPoNumberDraft((orderRaw as OrderDetailOrder | undefined)?.poNumber ?? "");
    setEditingDueDate(false);
    setEditingPromisedDate(false);
    exitAllEditModes();
    if (orderId) {
      await queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
      await queryClient.refetchQueries({ queryKey: ["orders", "detail", orderId], type: "active" });
    }
  };

  type ShipToUpdatePayload = Partial<Pick<
    OrderDetailOrder,
    | "shipToCompany"
    | "shipToName"
    | "shipToEmail"
    | "shipToPhone"
    | "shipToAddress1"
    | "shipToAddress2"
    | "shipToCity"
    | "shipToState"
    | "shipToPostalCode"
    | "shipToCountry"
  >>;

  const normalizeNullableString = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  const saveShipTo = async (payload: ShipToUpdatePayload) => {
    try {
      await applyOrderPatch(payload);
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const autofillShipToFromCustomer = async (customer: CustomerWithContacts) => {
    const resolved = resolveCustomerShipTo(customer);
    if (!resolved) return;
    const currentShipTo = {
      company: order?.shipToCompany,
      name: order?.shipToName,
      email: order?.shipToEmail,
      phone: order?.shipToPhone,
      address1: order?.shipToAddress1,
      address2: order?.shipToAddress2,
      city: order?.shipToCity,
      state: order?.shipToState,
      postalCode: order?.shipToPostalCode,
      country: order?.shipToCountry,
    };
    if (
      hasEnteredShipToAddress(currentShipTo) &&
      !window.confirm("Replace the current Ship To address with the customer's address?")
    ) {
      return;
    }

    const next = resolved.data;
    const payload: ShipToUpdatePayload = {
      shipToCompany: next.company,
      shipToEmail: next.email,
      shipToPhone: next.phone,
      shipToAddress1: next.address1,
      shipToAddress2: next.address2,
      shipToCity: next.city,
      shipToState: next.state,
      shipToPostalCode: next.postalCode,
      shipToCountry: next.country,
    };

    suppressShipToBlurRef.current = true;
    if (shipToCompanyInputRef.current) shipToCompanyInputRef.current.value = next.company ?? "";
    if (shipToEmailInputRef.current) shipToEmailInputRef.current.value = next.email ?? "";
    if (shipToPhoneInputRef.current) shipToPhoneInputRef.current.value = next.phone ?? "";
    if (shipToAddress1InputRef.current) shipToAddress1InputRef.current.value = next.address1 ?? "";
    if (shipToAddress2InputRef.current) shipToAddress2InputRef.current.value = next.address2 ?? "";
    if (shipToCityInputRef.current) shipToCityInputRef.current.value = next.city ?? "";
    if (shipToStateInputRef.current) shipToStateInputRef.current.value = next.state ?? "";
    if (shipToPostalCodeInputRef.current) shipToPostalCodeInputRef.current.value = next.postalCode ?? "";

    try {
      await saveShipTo(payload);
    } finally {
      setTimeout(() => {
        suppressShipToBlurRef.current = false;
      }, 0);
    }
  };

  /**
   * Reconcile order aggregate totals after a line item is saved/added/deleted.
   *
   * The line item itself is already persisted by its own save. This derives the
   * order subtotal/total and persists them DIRECTLY (silent PATCH) rather than
   * staging them into `pendingOrderPatch`. Staging derived totals into the order
   * draft made the order perpetually "dirty" after every line item save and
   * forced a confusing second Save Order step. Keeping `pendingOrderPatch`
   * reserved for genuine order-level edits lets the navigation guard and Save
   * Order button reflect real dirty state.
   */
  const recalculateOrderTotals = async () => {
    if (!orderId) return;
    try {
      const response = await fetch(`/api/orders/${orderId}`, { credentials: "include" });
      if (response.ok) {
        const freshOrder = await response.json();
        const lineItems = Array.isArray(freshOrder?.lineItems) ? freshOrder.lineItems : [];
        const subtotal = lineItems.reduce(
          (sum: number, item: any) => sum + (parseFloat(item?.totalPrice) || 0),
          0,
        );
        const discount = parseFloat(freshOrder?.discount) || 0;
        const tax = parseFloat(freshOrder?.tax) || 0;
        const shipping = (Number(freshOrder?.shippingCents) || 0) / 100;
        const total = subtotal - discount + tax + shipping;

        const persistedSubtotal = parseFloat(freshOrder?.subtotal);
        const persistedTotal = parseFloat(freshOrder?.total);
        const alreadyCurrent =
          Number.isFinite(persistedSubtotal) &&
          Number.isFinite(persistedTotal) &&
          Math.abs(persistedSubtotal - subtotal) < 0.005 &&
          Math.abs(persistedTotal - total) < 0.005;

        if (!alreadyCurrent) {
          await fetch(`/api/orders/${orderId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subtotal: subtotal.toFixed(2), total: total.toFixed(2) }),
            credentials: "include",
          });
        }
      }
    } catch (error) {
      console.error("[recalculateOrderTotals] Failed to reconcile order totals:", error);
    } finally {
      // Always refresh from authoritative server state.
      await queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
      await queryClient.refetchQueries({ queryKey: ["orders", "detail", orderId], type: "active" });
    }
  };

  const handleLineItemStatusChange = async (lineItemId: string, newStatus: string) => {
    // This would need a hook similar to useUpdateOrderLineItem
    // For now, just show a toast
    toast({
      title: "Feature coming soon",
      description: "Line item status updates will be available soon",
    });
  };

  // Fulfillment handlers
  const handleAddShipment = () => {
    setEditingShipment(null);
    setShowShipmentForm(true);
  };

  const handleEditShipment = (shipment: Shipment) => {
    setEditingShipment(shipment);
    setShowShipmentForm(true);
  };

  const handleDeleteShipment = async (shipmentId: string) => {
    try {
      await deleteShipmentMutation.mutateAsync(shipmentId);
      toast({ title: "Success", description: "Shipment deleted successfully" });
      setShipmentToDelete(null);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to delete shipment", 
        variant: "destructive" 
      });
    }
  };

  const handleMarkDelivered = async (shipment: Shipment) => {
    try {
      await updateShipmentMutation.mutateAsync({
        id: shipment.id,
        updates: {
          deliveredAt: new Date(),
        } as any,
      });
      toast({ title: "Success", description: "Shipment marked as delivered" });
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update shipment", 
        variant: "destructive" 
      });
    }
  };

  const handleGeneratePackingSlip = async () => {
    try {
      const html = await generatePackingSlip.mutateAsync();
      setPackingSlipHtml(html);
      setShowPackingSlipModal(true);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to generate packing slip", 
        variant: "destructive" 
      });
    }
  };

  const getOrderPdfUrl = (disposition?: "preview" | "download" | "print") => {
    const base = `/api/orders/${encodeURIComponent(orderId || "")}/pdf`;
    return disposition ? `${base}?disposition=${encodeURIComponent(disposition)}` : base;
  };

  const getOrderPdfFilename = () => {
    const display = String((order as any)?.displayNumber || order?.orderNumber || orderId || "order").replace(/[^a-z0-9._-]+/gi, "-");
    return `Order_${display}.pdf`;
  };

  const handleOrderPdfAction = async (action: "preview" | "download" | "print") => {
    if (!canUseOrderPdf) {
      toast({
        title: "Order PDF unavailable",
        description: orderPdfUnavailableReason || "This order is not ready for PDF generation.",
        variant: "destructive",
      });
      return;
    }

    setIsOrderPdfBusy(action);
    try {
      if (action === "download") {
        await downloadAuthenticatedPdf(getOrderPdfUrl("download"), getOrderPdfFilename());
        return;
      }
      if (action === "print") {
        await openAuthenticatedPdfForPrint(getOrderPdfUrl("print"));
        return;
      }
      await openAuthenticatedPdfPreview(getOrderPdfUrl("preview"));
    } catch (error: any) {
      toast({
        title: action === "download" ? "Download failed" : action === "print" ? "Print preview failed" : "Preview failed",
        description: error?.message || "Could not open the order PDF.",
        variant: "destructive",
      });
    } finally {
      setIsOrderPdfBusy(null);
    }
  };

  const handleOpenOrderEmailDialog = () => {
    if (!canUseOrderPdf) {
      toast({
        title: "Order email unavailable",
        description: orderPdfUnavailableReason || "This order is not ready to email.",
        variant: "destructive",
      });
      return;
    }
    setShowOrderEmailDialog(true);
  };

  const handleFulfillmentStatusChange = async (newStatus: "pending" | "packed" | "shipped" | "delivered") => {
    try {
      await updateFulfillmentStatus.mutateAsync(newStatus);
      toast({ title: "Success", description: `Fulfillment status updated to ${newStatus}` });
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update fulfillment status", 
        variant: "destructive" 
      });
    }
  };

  const getTrackingUrl = (carrier: string, trackingNumber: string): string => {
    const urls: Record<string, string> = {
      UPS: `https://www.ups.com/track?tracknum=${trackingNumber}`,
      FedEx: `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
      USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
      DHL: `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`,
    };
    return urls[carrier] || '#';
  };

  if (isLoading) {
    return (
      <Page>
        <ContentLayout>
          <DataCard className="bg-titan-bg-card border-titan-border-subtle">
            <div className="py-16 text-center text-sm text-titan-text-muted">Loading order...</div>
          </DataCard>
        </ContentLayout>
      </Page>
    );
  }

  if (!order) {
    return (
      <Page>
        <ContentLayout>
          <DataCard className="bg-titan-bg-card border-titan-border-subtle">
            <div className="py-16 text-center">
              <h2 className="text-titan-xl font-bold mb-2 text-titan-text-primary">Order not found</h2>
              <p className="text-titan-text-muted mb-4">The order you're looking for doesn't exist.</p>
              <Link to="/orders">
                <Button className="bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md">
                  Back to Orders
                </Button>
              </Link>
            </div>
          </DataCard>
        </ContentLayout>
      </Page>
    );
  }

  const { displayNumber, isTest } = getDisplayOrderNumber(order);
  const titleText = isTest ? `${displayNumber} (Test Data)` : displayNumber;
  const showPaymentStatus = order.state === 'closed';
  const showRoutedTo = Boolean(order.routingTarget);

  const billingStatus = String((order as any).billingStatus || 'not_ready');
  const billingOverrideActive = Boolean((order as any).billingReadyOverride);
  const billingOverrideNoteValue = String((order as any).billingReadyOverrideNote || '');
  const billingReadyAtValue = (order as any).billingReadyAt as string | null | undefined;
  const invoiceStateSummary = deriveOrderInvoiceState({
    billingStatus,
    invoices: orderInvoices,
  });
  const designBillingRows = orderDesignBillingVisibilityQuery.data ?? [];
  const designBillingCandidateTotal = designBillingRows.reduce((sum, row) => sum + (row.billableDesignAmount ?? 0), 0);
  const designBillingSoldTotal = designBillingRows.reduce((sum, row) => sum + (row.soldDesignAmount ?? 0), 0);
  const designBillingUnsyncedCount = designBillingRows.filter((row) => row.visibilityState === "no_summary").length;
  const billingLineItems = order.lineItems ?? [];
  const isServiceFeeOnlyOrder = billingLineItems.length > 0 && billingLineItems.every((lineItem: any) =>
    lineItem.product?.workflowIntent === 'service_fee',
  );
  const fulfillmentOperationallyComplete = order.fulfillmentStatus === 'shipped' || order.fulfillmentStatus === 'delivered';
  const orderOperationallyComplete = order.state === 'production_complete' && order.routingTarget !== 'fulfillment';
  const canCompleteOrder = isAdminOrOwner && (
    (order.state === 'open' && isServiceFeeOnlyOrder)
    || (order.state === 'production_complete' && !orderOperationallyComplete && fulfillmentOperationallyComplete)
  );
  const canCloseTerminalOrder = isAdminOrOwner
    && orderOperationallyComplete
    && invoiceStateSummary.activeInvoiceCount > 0
    && invoiceStateSummary.key === 'paid';
  const unpricedServiceFeeCount = billingLineItems.filter((lineItem: any) => {
    const product = lineItem.product as any;
    if (product?.workflowIntent !== 'service_fee') return false;
    const total = Number(lineItem.totalPrice ?? 0);
    return !Number.isFinite(total) || (total <= 0 && product?.allowZeroPrice !== true);
  }).length;
  const incompleteProductionCount = billingLineItems.filter((lineItem: any) => {
    const workflowIntent = lineItem.product?.workflowIntent;
    if (workflowIntent === 'service_fee') return false;
    const status = String(lineItem.status ?? '').toLowerCase();
    return status !== 'done' && status !== 'complete' && status !== 'canceled';
  }).length;
  const invoiceEligibleForCreation = billingLineItems.length > 0 && unpricedServiceFeeCount === 0;
  const billingBadgeVariant: "default" | "secondary" | "outline" =
    billingStatus === 'billed' ? 'secondary' : invoiceEligibleForCreation ? 'default' : 'outline';
  const billingLabel =
    billingStatus === 'billed'
      ? 'Billed'
      : invoiceEligibleForCreation
        ? 'Invoice Eligible'
        : 'Financial Review Needed';
  const paymentResolution = orderPaymentResolution.data;
  const isPreparingInvoicePayment = createOrderInvoice.isPending;
  const billingActions = getOrderBillingActionState({
    // This is deliberately financial eligibility, not the persisted operational
    // billing-status field, which can lag behind production workflow updates.
    billingReady: invoiceEligibleForCreation,
    hasExistingInvoice: orderInvoices.length > 0,
    orderCanceled: orderIsCanceled,
    isLoading: orderPaymentResolution.isLoading || isInvoicesLoading,
    isPreparing: isPreparingInvoicePayment,
    resolutionStatus: paymentResolution?.resolutionStatus,
    blockedReason: paymentResolution?.blockedReason,
  });
  const payableInvoiceCandidates = paymentResolution?.invoiceCandidates.filter((invoice) => invoice.payable) ?? [];
  const billingNotReadyExplanation = billingLineItems.length === 0
    ? 'Add at least one billable line before creating an invoice.'
    : unpricedServiceFeeCount > 0
      ? `${unpricedServiceFeeCount} service/fee line${unpricedServiceFeeCount === 1 ? '' : 's'} missing a configured price.`
      : null;
  const productionStatusWarning = incompleteProductionCount > 0
    ? `${incompleteProductionCount} production line${incompleteProductionCount === 1 ? '' : 's'} still show incomplete status. This does not prevent invoice creation.`
    : null;

  const handleCreateInvoice = async () => {
    if (!orderId) return;
    try {
      const result = await createOrderInvoice.mutateAsync({ orderId, terms: 'due_on_receipt' });
      const created = (result as any)?.data;
      if (created?.id) {
        toast({ title: 'Success', description: 'Invoice created' });
        if (isServiceFeeOnlyOrder) {
          setCloseFeeOnlyAfterInvoice({ invoiceId: String(created.id) });
          return;
        }
        navigate(`/invoices/${created.id}`);
        return;
      }
      toast({ title: 'Success', description: 'Invoice created' });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to create invoice', variant: 'destructive' });
    }
  };

  const navigateToInvoicePayment = (invoiceId: string, takePayment = true) => {
    const suffix = takePayment ? "?takePayment=1" : "";
    navigate(`/invoices/${invoiceId}${suffix}`);
  };

  const handleCreateInvoiceAndTakePayment = async () => {
    if (!orderId) return;
    try {
      const result = await createOrderInvoice.mutateAsync({ orderId, terms: 'due_on_receipt' });
      const created = (result as any)?.data;
      if (!created?.id) {
        throw new Error('Invoice was created, but the response did not include an invoice id.');
      }

      toast({ title: 'Invoice ready', description: 'Invoice generated and ready for payment.' });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', { orderId }] });
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'payment-resolution'] });
      navigateToInvoicePayment(String(created.id), true);
    } catch (error: any) {
      toast({
        title: 'Could not prepare payment',
        description: error?.message || 'Invoice generation failed.',
        variant: 'destructive',
      });
    }
  };

  const handleTakePaymentFromOrder = async () => {
    if (!orderId) return;

    let resolution = orderPaymentResolution.data;
    if (!resolution) {
      const refreshed = await orderPaymentResolution.refetch();
      resolution = refreshed.data;
    }

    if (!resolution) {
      toast({ title: 'Payment unavailable', description: 'Could not resolve payment state for this order.', variant: 'destructive' });
      return;
    }

    if (resolution.resolutionStatus === 'NO_INVOICE') {
      await handleCreateInvoiceAndTakePayment();
      return;
    }

    if (resolution.resolutionStatus === 'MULTIPLE_PAYABLE_INVOICES') {
      setPaymentInvoiceSelectorOpen(true);
      return;
    }

    if (resolution.resolutionStatus === 'ALREADY_PAID' && resolution.selectedInvoice?.id) {
      navigateToInvoicePayment(resolution.selectedInvoice.id, false);
      return;
    }

    if (resolution.resolutionStatus === 'SINGLE_PAYABLE_INVOICE' && resolution.selectedInvoice?.id) {
      navigateToInvoicePayment(resolution.selectedInvoice.id, true);
      return;
    }

    setPaymentBlockedDialogOpen(true);
  };

  const handleInvoiceAndTakePayment = async () => {
    if (!orderId) return;
    let resolution = orderPaymentResolution.data;
    if (!resolution) {
      const refreshed = await orderPaymentResolution.refetch();
      resolution = refreshed.data;
    }

    if (resolution?.resolutionStatus === 'NO_INVOICE' || (!resolution && orderInvoices.length === 0)) {
      await handleCreateInvoiceAndTakePayment();
      return;
    }

    await handleTakePaymentFromOrder();
  };

  const handleSelectPayableInvoice = (candidate: PaymentInvoiceCandidate) => {
    setPaymentInvoiceSelectorOpen(false);
    navigateToInvoicePayment(candidate.id, true);
  };

  const handleSetBillingOverride = async () => {
    try {
      await setBillingOverrideMutation.mutateAsync({ note: billingOverrideNote });
      toast({ title: 'Success', description: 'Billing override set' });
      setBillingOverrideDialogOpen(false);
      setBillingOverrideNote('');
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to set override', variant: 'destructive' });
    }
  };

  const handleClearBillingOverride = async () => {
    try {
      await clearBillingOverrideMutation.mutateAsync();
      toast({ title: 'Success', description: 'Billing override cleared' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to clear override', variant: 'destructive' });
    }
  };

  const normalizeAddressKey = (parts: Array<string | null | undefined>) =>
    parts
      .filter((p): p is string => Boolean(p && p.trim().length > 0))
      .map((p) => p.trim().toLowerCase().replace(/\s+/g, ' '))
      .join('|');

  const billToKey = normalizeAddressKey([
    order.billToName,
    order.billToCompany,
    order.billToAddress1,
    order.billToAddress2,
    order.billToCity,
    order.billToState,
    order.billToPostalCode,
  ]);
  const shipToKey = normalizeAddressKey([
    order.shipToName,
    order.shipToCompany,
    order.shipToAddress1,
    order.shipToAddress2,
    order.shipToCity,
    order.shipToState,
    order.shipToPostalCode,
  ]);

  const isSameBillShipAddress = billToKey === shipToKey;
  const billToTitle = isSameBillShipAddress ? 'Billing / Shipping' : 'Bill To';

  const normalizePhoneKey = (value: string | null | undefined) =>
    (value || '').replace(/\D+/g, '');

  const customerCompanyName: string | null = order.customer?.companyName || order.billToCompany || null;
  const defaultCustomerShipTo = resolveCustomerShipTo(order.customer);
  const contactNameFromContact: string | null = (() => {
    const c: any = order.contact;
    if (!c) return null;
    const name = (c.name || c.fullName || c.displayName || `${c.firstName || ""} ${c.lastName || ""}`).trim();
    return name || null;
  })();
  const contactLinePhone: string | null = (order.contact as any)?.phone || (order.contact as any)?.phoneNumber || (order.contact as any)?.mobile || null;

  const email: string | null = order.contact?.email || order.customer?.email || order.billToEmail || null;
  const customerPhone: string | null = order.customer?.phone || null;
  const metaPhone: string | null = customerPhone || contactLinePhone || null;

  const getAddressParts = (source: {
    street1?: string | null;
    street2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  }) => {
    const line1 = [source.street1, source.street2].filter(Boolean).join(', ');
    const line2 = [source.city, source.state, source.postalCode].filter(Boolean).join(', ');
    const line3 = [source.country].filter(Boolean).join(', ');
    return { line1, line2, line3 };
  };

  const resolvedBillAddress = (() => {
    if (order.billToAddress1 || order.billToAddress2 || order.billToCity || order.billToState || order.billToPostalCode) {
      return getAddressParts({
        street1: order.billToAddress1,
        street2: order.billToAddress2,
        city: order.billToCity,
        state: order.billToState,
        postalCode: order.billToPostalCode,
        country: (order as any).billToCountry,
      });
    }

    if (order.contact?.street1) {
      return getAddressParts({
        street1: order.contact.street1,
        street2: order.contact.street2,
        city: order.contact.city,
        state: order.contact.state,
        postalCode: order.contact.postalCode,
        country: order.contact.country,
      });
    }

    if (order.customer?.shippingStreet1) {
      return getAddressParts({
        street1: order.customer.shippingStreet1,
        street2: order.customer.shippingStreet2,
        city: order.customer.shippingCity,
        state: order.customer.shippingState,
        postalCode: order.customer.shippingPostalCode,
        country: order.customer.shippingCountry,
      });
    }

    return getAddressParts({
      street1: order.customer?.billingStreet1,
      street2: order.customer?.billingStreet2,
      city: order.customer?.billingCity,
      state: order.customer?.billingState,
      postalCode: order.customer?.billingPostalCode,
      country: order.customer?.billingCountry,
    });
  })();

  const billAddressLine1 = resolvedBillAddress.line1;
  const billAddressLine2 = resolvedBillAddress.line2;
  const hasBillAddress = Boolean(billAddressLine1 || billAddressLine2);

  return (
    <div className="w-full px-4 py-6 sm:px-5 lg:px-5">
      <div className="w-full max-w-none">
        <div className="flex items-center justify-between mb-6 pb-3">
          <div className="flex items-center gap-4 min-w-0">
            <BackNavControls
              onBack={onSmartBack}
              onSectionHome={() => guardedNavigate("/orders")}
              sectionLabel="Orders"
            />

            <div className="flex flex-col justify-center min-w-0">
              <h1 className="text-titan-xl font-semibold tracking-tight text-titan-text-primary">
                {`Order ${titleText}`}
              </h1>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center px-4">
            <OrderStatusPillSelector
              orderId={order.id}
              currentState={order.state as OrderState}
              currentPillId={order.statusPillId}
              currentPillValue={order.statusPillValue}
              disabled={checkIfTerminalState(order.state as OrderState) && !canEditOrder}
              className="h-10 w-[260px] rounded-full text-base"
            />
          </div>

          <div className="flex items-center gap-3">
            {isOrderEditRoute && (
              <Button asChild variant="outline" size="sm" className="rounded-titan-md">
                <Link to={ROUTES.orders.detail(order.id)}>
                  View Order
                </Link>
              </Button>
            )}

            <OrderDetailPrimaryActions
              canEditOrder={canEditOrder}
              canShowCancelOrder={canShowCancelOrder}
              canCancelOrder={canCancelOrder}
              canMarkCompleted={false}
              canCompleteProduction={isAdminOrOwner && order.state === 'open' && !isServiceFeeOnlyOrder}
              canCompleteOrder={canCompleteOrder}
              orderId={order.id}
              isDirty={isDirty}
              isSavingOrder={isSavingOrder}
              isUpdatingOrder={updateOrder.isPending}
              isTransitioningStatus={transitionStatus.isPending}
              isCancelingOrder={cancelOrderMutation.isPending}
              canDuplicateOrder={Boolean(activeOrganization) && isAdminOrOwner}
              isDuplicatingOrder={duplicateOrderMutation.isPending}
              hasDirtyLineItem={hasDirtyLineItem}
              cancelOrderUnavailableReason={cancelOrderUnavailableReason}
              onSaveOrder={handleSaveOrder}
              onSaveAndRoute={() => handleSaveOrder(true)}
              onDiscardChanges={handleCancelOrderEdits}
              onCancelOrder={() => setShowCancelOrderDialog(true)}
              onDuplicateOrder={() => duplicateOrderMutation.mutate()}
              onMarkCompleted={() => {
                if (requireLineItemsDone && incompleteLi.length > 0) {
                  setPendingStatusTransition({ toStatus: 'completed', requiresReason: false });
                  return;
                }
                setPendingStatusTransition({ toStatus: 'completed', requiresReason: false });
              }}
            />
          </div>
        </div>

        {isOrderEditRoute && !canEditOrder && (
          <div className="mb-4 rounded-titan-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Order editing is locked</div>
                <div>
                  Completed and cancelled orders are read-only for normal operations. Existing history remains available.
                </div>
              </div>
            </div>
          </div>
        )}

        {orderIsCanceled && (
          <div className="mb-4 rounded-titan-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Cancelled order</div>
                <div className="text-destructive/90">
                  This order is read-only for operations. History, files, proofs, invoices, payments, and activity remain available.
                </div>
                {(cancellationReasonLabel || cancellationDateLabel || order?.cancellationNotes) && (
                  <div className="mt-2 space-y-1 text-destructive/90">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {cancellationReasonLabel && <span>Reason: {cancellationReasonLabel}</span>}
                      {cancellationDateLabel && <span>Cancelled: {cancellationDateLabel}</span>}
                    </div>
                    {order?.cancellationNotes && (
                      <div className="whitespace-pre-wrap break-words">Note: {order.cancellationNotes}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <ContentLayout>
          <div className="grid grid-cols-1 gap-4 lg:gap-5 xl:gap-6 lg:[grid-template-columns:minmax(0,1fr)_var(--titan-order-right-col)]">
          {/* Main Content */}
          <div className="min-w-0 space-y-4">
            <Card className="bg-titan-bg-card border-titan-border-subtle">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
                  {/* Customer + Contact */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {isEditingCustomer ? (
                        <div className="space-y-2">
                          <Popover
                            open={isCustomerPickerOpen}
                            onOpenChange={(open) => {
                              setIsCustomerPickerOpen(open);
                              if (!open) exitAllEditModes();
                            }}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={isCustomerPickerOpen}
                                className="w-full justify-between font-normal h-9"
                              >
                                <span className="truncate">{customerCompanyName || "Select customer..."}</span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0" align="start">
                              <Command shouldFilter={true}>
                                  <CommandInput placeholder="Search customers..." autoFocus />
                                <CommandList>
                                  {order?.contactId && order?.customerId && (
                                    <CommandItem
                                      value="contact-only"
                                      onSelect={() => saveOrderOwner({ customerId: null })}
                                    >
                                      Keep the selected contact; remove customer
                                    </CommandItem>
                                  )}
                                  <CommandEmpty>No customers found.</CommandEmpty>
                                  {customers.map((customer: any) => {
                                    const searchValue = [customer.companyName, customer.email]
                                      .filter(Boolean)
                                      .join(" ");
                                    return (
                                      <CommandItem
                                        key={customer.id}
                                        value={searchValue}
                                        onSelect={() => {
                                          saveOrderOwner({ customerId: customer.id });
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            order?.customerId === customer.id ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                        <div className="flex-1">
                                          <div className="font-medium">{customer.companyName}</div>
                                          {customer.email && (
                                            <div className="text-xs text-muted-foreground">{customer.email}</div>
                                          )}
                                        </div>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="min-w-0 flex-1">
                            <HoverCard openDelay={150} closeDelay={50}>
                              <HoverCardTrigger asChild>
                                {order.customer?.id && customerCompanyName ? (
                                  <Link
                                    to={`/customers/${order.customer.id}`}
                                    state={{ referrer: buildReferrer(location) }}
                                    className="block truncate text-sm font-semibold leading-5 text-foreground hover:underline"
                                    title={customerCompanyName}
                                  >
                                    {customerCompanyName}
                                  </Link>
                                ) : (
                                  <span
                                    tabIndex={0}
                                    className="block truncate text-sm font-semibold leading-5 text-foreground"
                                    title={customerCompanyName || "—"}
                                  >
                                    {customerCompanyName || "—"}
                                  </span>
                                )}
                              </HoverCardTrigger>
                              <HoverCardContent className="w-[340px] max-w-[90vw] p-3" align="start" side="bottom">
                                <div className="space-y-2">
                                  {hasBillAddress && (
                                    <div className="text-sm">
                                      <div className="font-medium text-foreground">Billing</div>
                                      <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                                        {[billAddressLine1, billAddressLine2].filter(Boolean).join("\n") || "—"}
                                      </div>
                                    </div>
                                  )}
                                  {(email || metaPhone) && (
                                    <div className="text-xs text-muted-foreground">
                                      {email && <div className="font-mono break-words">{email}</div>}
                                      {metaPhone && <div className="font-mono break-words">{formatPhoneForDisplay(metaPhone)}</div>}
                                    </div>
                                  )}
                                </div>
                              </HoverCardContent>
                            </HoverCard>
                          </div>
                          {canEditOrder && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={enterCustomerEdit}
                              title="Edit Customer"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}

                      {hasBillAddress && (
                        <div className="text-[11px] leading-4 text-muted-foreground">
                          <div className="hidden print:block">
                            {billAddressLine1 && <div>{billAddressLine1}</div>}
                            {billAddressLine2 && <div>{billAddressLine2}</div>}
                          </div>
                          <div className="flex items-center gap-2">
                            {showCustomerAddress && (
                              <div className="space-y-0.5 print:hidden">
                                {billAddressLine1 && <div>{billAddressLine1}</div>}
                                {billAddressLine2 && <div>{billAddressLine2}</div>}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowCustomerAddress((v) => !v)}
                              className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4 print:hidden"
                            >
                              {showCustomerAddress ? "Hide" : "Show"}
                            </button>
                          </div>
                        </div>
                      )}

                      {email && (
                        <div className="text-[11px] leading-4">
                          <a
                            href={`mailto:${email}`}
                            className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                            title={email}
                          >
                            {email}
                          </a>
                        </div>
                      )}

                      {metaPhone && (
                        <div className="text-[11px] leading-4">
                          <a
                            href={phoneToTelHref(metaPhone)}
                            className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                            title={metaPhone}
                          >
                            {formatPhoneForDisplay(metaPhone)}
                          </a>
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      {isEditingContact ? (
                        <div className="space-y-2">
                          <Popover
                            open={isContactPickerOpen}
                            onOpenChange={(open) => {
                              setIsContactPickerOpen(open);
                              if (!open) exitAllEditModes();
                            }}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={isContactPickerOpen}
                                className="w-full justify-between font-normal h-9"
                                disabled={!order?.customerId}
                              >
                                <span className="truncate">
                                  {!order?.customerId
                                    ? "Select a customer first"
                                    : contactNameFromContact || "Select contact..."}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[350px] p-0" align="start">
                              <Command shouldFilter={false}>
                                <CommandInput
                                  placeholder="Search contacts..."
                                  value={contactSearchQuery}
                                  onValueChange={setContactSearchQuery}
                                  autoFocus
                                />
                                <CommandList>
                                  <CommandEmpty>
                                    {!order?.customerId ? "Select a customer first" : "No contacts found."}
                                  </CommandEmpty>
                                  {filteredContacts.map((contact: any) => {
                                    const contactName = [contact.firstName, contact.lastName]
                                      .filter(Boolean)
                                      .join(" ");
                                    return (
                                      <CommandItem
                                        key={contact.id}
                                        value={contactName}
                                        onSelect={() => {
                                          saveOrderOwner({ contactId: contact.id });
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            order?.contact?.id === contact.id ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                        <div className="flex-1">
                                          <div className="font-medium">{contactName}</div>
                                          {contact.email && (
                                            <div className="text-xs text-muted-foreground">{contact.email}</div>
                                          )}
                                        </div>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>
                      ) : order.contact?.id && contactNameFromContact ? (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <HoverCard openDelay={150} closeDelay={50}>
                              <HoverCardTrigger asChild>
                                <Link
                                  to={`/contacts/${order.contact.id}`}
                                  className="text-sm font-semibold text-foreground hover:underline flex-1 min-w-0 truncate"
                                  title={contactNameFromContact}
                                >
                                  {contactNameFromContact}
                                </Link>
                              </HoverCardTrigger>
                              <HoverCardContent className="w-[340px] max-w-[90vw] p-3" align="start" side="bottom">
                                <div className="space-y-2">
                                  {(order.contact?.email || contactLinePhone) && (
                                    <div className="text-xs text-muted-foreground">
                                      {order.contact?.email && (
                                        <div className="font-mono break-words">{order.contact.email}</div>
                                      )}
                                      {contactLinePhone && (
                                        <div className="font-mono break-words">{formatPhoneForDisplay(contactLinePhone)}</div>
                                      )}
                                    </div>
                                  )}
                                  {(order.contact as any)?.street1 && (
                                    <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                                      {[
                                        (order.contact as any)?.street1,
                                        (order.contact as any)?.street2,
                                        [(order.contact as any)?.city, (order.contact as any)?.state].filter(Boolean).join(", "),
                                        (order.contact as any)?.postalCode,
                                      ]
                                        .filter(Boolean)
                                        .join("\n")}
                                    </div>
                                  )}
                                </div>
                              </HoverCardContent>
                            </HoverCard>
                            {canEditOrder && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0"
                                onClick={enterContactEdit}
                                title="Edit Contact"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                          {order.contact?.email && (
                            <div className="text-[11px] leading-4">
                              <a
                                href={`mailto:${order.contact.email}`}
                                className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                                title={order.contact.email}
                              >
                                {order.contact.email}
                              </a>
                            </div>
                          )}
                          {contactLinePhone && (
                            <div className="text-[11px] leading-4">
                              <a
                                href={phoneToTelHref(contactLinePhone)}
                                className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                                title={contactLinePhone}
                              >
                                {formatPhoneForDisplay(contactLinePhone)}
                              </a>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm text-muted-foreground">—</span>
                          {canEditOrder && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={enterContactEdit}
                              title="Edit Contact"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Order meta */}
                  <div className="min-w-0 space-y-4">
                    {/* TitanOS State Architecture */}
                    {(showPaymentStatus || showRoutedTo) && (
                      <div
                        className={cn(
                          "grid grid-cols-1 gap-4 p-4 bg-muted/50 rounded-lg border border-border",
                          showPaymentStatus && showRoutedTo ? "md:grid-cols-2" : "md:grid-cols-1"
                        )}
                      >
                        {showPaymentStatus && (
                          <div>
                            <label className="text-sm font-medium text-muted-foreground">Payment</label>
                            <div className="mt-2">
                              <Badge
                                variant="outline"
                                className={
                                  order.paymentStatus === "paid"
                                    ? "bg-green-100 text-green-800 border-green-300"
                                    : order.paymentStatus === "partial"
                                      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                                      : "bg-gray-100 text-gray-800 border-gray-300"
                                }
                              >
                                {order.paymentStatus === "paid" && "Paid"}
                                {order.paymentStatus === "partial" && "Partial"}
                                {order.paymentStatus === "unpaid" && "Unpaid"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Payment status</p>
                          </div>
                        )}

                        {showRoutedTo && (
                          <div>
                            <label className="text-sm font-medium text-muted-foreground">Routed To</label>
                            <div className="mt-2">
                              <Badge
                                variant="outline"
                                className="bg-purple-100 text-purple-800 border-purple-300"
                              >
                                {order.routingTarget === "fulfillment" ? "Fulfillment" : "Invoicing"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Next workflow stage</p>
                          </div>
                        )}
                      </div>
                    )}
                
                {/* State Transition Actions */}
                {isAdminOrOwner && (
                  <div className="flex gap-2 flex-wrap">
                    {canCloseTerminalOrder && (
                      <CloseOrderButton orderId={order.id} />
                    )}
                    
                    {order.state === 'closed' && (
                      <ReopenOrderButton orderId={order.id} />
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">PO #</label>
                    <Input
                      value={poNumberDraft}
                      onChange={(e) => setPoNumberDraft(e.target.value)}
                      onBlur={() => void commitPoNumber()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="h-8 w-auto min-w-[120px]"
                      disabled={!canEditOrder || updateOrder.isPending}
                      placeholder="—"
                    />
                  </div>

                  <div className="flex items-center gap-2 min-w-0">
                    <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Job Label</label>
                    <Input
                      value={jobLabelDraft}
                      onChange={(e) => setJobLabelDraft(e.target.value)}
                      onBlur={() => void commitJobLabel()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="h-8 w-full min-w-0"
                      disabled={!canEditOrder || updateOrder.isPending}
                      placeholder="—"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Priority</label>
                    <Select 
                      value={order.priority} 
                      onValueChange={handlePriorityChange} 
                      disabled={!canEditOrder || updateOrder.isPending}
                    >
                      <SelectTrigger className="h-8 w-auto min-w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rush">Rush</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Due Date</label>
                    {editingDueDate ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <Input
                          type="date"
                          value={tempDueDate}
                          onChange={(e) => setTempDueDate(e.target.value)}
                          className="h-8 w-auto"
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleDueDateSave}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleDueDateCancel}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 shrink-0">
                        <div className="text-sm whitespace-nowrap">{formatOrderDate(order.dueDate, DATE_DISPLAY_STYLE === "short" ? "short" : "numeric")}</div>
                        {canEditOrder && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={handleDueDateEdit}
                            title="Edit Due Date"
                          >
                            <Calendar className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Promised Date</label>
                    {editingPromisedDate ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <Input
                          type="date"
                          value={tempPromisedDate}
                          onChange={(e) => setTempPromisedDate(e.target.value)}
                          className="h-8 w-auto"
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handlePromisedDateSave}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handlePromisedDateCancel}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 shrink-0">
                        <div className="text-sm whitespace-nowrap">{formatOrderDate(order.promisedDate, DATE_DISPLAY_STYLE === "short" ? "short" : "numeric")}</div>
                        {canEditOrder && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={handlePromisedDateEdit}
                            title="Edit Promised Date"
                          >
                            <Calendar className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Flags</label>
                  <div className="flex-1">
                    <div
                      className="min-h-9 rounded-md bg-muted/30 border border-border/50 px-2 py-1 flex flex-wrap items-center gap-1.5 cursor-text focus-within:ring-1 focus-within:ring-ring/20"
                      onClick={() => flagInputRef.current?.focus()}
                      role="group"
                      aria-label="Flags"
                    >
                      {flags.map((t) => (
                        <Badge key={t} variant="secondary" className="h-7 px-2.5 py-0.5 text-xs flex items-center gap-1">
                          {t}
                          {canEditOrder && !updateOrder.isPending && (
                            <button
                              type="button"
                              onClick={() => removeFlag(t)}
                              className="ml-1 hover:bg-secondary/80 rounded-full p-1"
                              aria-label={`Remove flag ${t}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </Badge>
                      ))}

                      {!canEditOrder || updateOrder.isPending || updateListNoteMutation.isPending ? (
                        flags.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : null
                      ) : (
                        <Badge variant="secondary" className="h-7 px-2.5 py-0.5 text-xs flex items-center">
                          <input
                            ref={flagInputRef}
                            value={flagInput}
                            onChange={(e) => setFlagInput(e.target.value)}
                            onKeyDown={handleFlagKeyDown}
                            placeholder="Add Flag"
                            className="w-[7rem] min-w-[7rem] bg-transparent outline-none text-xs font-semibold placeholder:text-muted-foreground/70"
                          />
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5" data-testid="order-internal-notes">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Internal Notes</div>
                      <div className="text-xs text-muted-foreground">Staff only</div>
                    </div>
                    {canEditOrder && !isAddingOrderInternalNote ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setIsAddingOrderInternalNote(true)}>
                        Add note
                      </Button>
                    ) : null}
                  </div>

                  {orderInternalNotesQuery.isLoading ? (
                    <div className="mt-2 text-sm text-muted-foreground">Loading notes…</div>
                  ) : orderInternalNotesQuery.data && orderInternalNotesQuery.data.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {orderInternalNotesQuery.data.map((note) => (
                        <div key={note.id} className="rounded bg-background/70 px-2.5 py-2 text-sm whitespace-pre-wrap">
                          {note.noteText}
                          <div className="mt-1 text-xs text-muted-foreground">
                            {note.createdByUserName || "Staff"} · {format(new Date(note.createdAt), "PPp")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : !order.notesInternal || isClearlyGeneratedInboundProvenance(order.notesInternal) ? (
                    <div className="mt-2 text-sm text-muted-foreground">No internal notes.</div>
                  ) : null}

                  {order.notesInternal && !isClearlyGeneratedInboundProvenance(order.notesInternal) ? (
                    <details className="mt-2 rounded border border-border/50 bg-background/40 px-2.5 py-2">
                      <summary className="cursor-pointer text-sm font-medium">Existing internal note</summary>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{order.notesInternal}</div>
                    </details>
                  ) : null}

                  {canEditOrder && isAddingOrderInternalNote ? (
                    <div className="mt-3 space-y-2">
                      <Textarea
                        value={orderInternalNoteDraft}
                        onChange={(event) => setOrderInternalNoteDraft(event.target.value)}
                        placeholder="Add an internal note for staff…"
                        rows={2}
                        disabled={addOrderInternalNoteMutation.isPending}
                      />
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => {
                          setOrderInternalNoteDraft("");
                          setIsAddingOrderInternalNote(false);
                        }}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => addOrderInternalNoteMutation.mutate(orderInternalNoteDraft)}
                          disabled={!orderInternalNoteDraft.trim() || addOrderInternalNoteMutation.isPending}
                        >
                          {addOrderInternalNoteMutation.isPending ? "Saving…" : "Save note"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Line Items (Quote-style UI) */}
            <div className="space-y-4" ref={lineItemsSectionRef}>
              <div className="rounded-md border border-border/60 bg-muted/20 px-4 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Operational Summary</span>
                    <Badge variant="outline" className="h-6 px-2 text-xs">
                      {orderOperationalSummary.totalItems} {orderOperationalSummary.totalItems === 1 ? "item" : "items"}
                    </Badge>
                    {orderOperationalSummary.productionRequiredCount > 0 ? (
                      <Badge variant="secondary" className="h-6 px-2 text-xs">
                        {orderOperationalSummary.productionRequiredCount} require production
                      </Badge>
                    ) : null}
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-6 px-2 text-xs",
                        getOrderProofBadgeClass(order?.proofStatus ?? "no_proof_required")
                      )}
                    >
                      {order?.proofStatusLabel ?? "No Proof Needed"}
                    </Badge>
                    {orderOperationalSummary.actionNeededCount > 0 ? (
                      <Badge className="h-6 px-2 text-xs bg-amber-100 text-amber-900 hover:bg-amber-100">
                        {orderOperationalSummary.actionNeededCount} action needed
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="h-6 px-2 text-xs border-emerald-300 text-emerald-800">
                        No immediate action needed
                      </Badge>
                    )}
                    {orderOperationalSummary.inProgressCount > 0 ? (
                      <Badge variant="outline" className="h-6 px-2 text-xs border-sky-300 text-sky-800">
                        {orderOperationalSummary.inProgressCount} in progress
                      </Badge>
                    ) : null}
                  </div>
                  {isAdminOrOwner && canEditOrder && orderOperationalSummary.productionRequiredCount > 0 ? (
                    <div className="text-xs text-muted-foreground">Bulk production handoff is available below in Line Items.</div>
                  ) : null}
                  {order?.proofLineItemId && canOpenProofingFromOrderStatus(order?.proofStatus ?? "no_proof_required") ? (
                    <Button asChild type="button" variant="outline" size="sm" className="h-8">
                      <Link to={buildProofingLineItemPath(order.proofLineItemId)}>Open Proofing</Link>
                    </Button>
                  ) : null}
                </div>
              </div>

              <OrderLineItemsSection
                key={lineItemsEditorResetKey}
                ref={orderLineItemsApiRef}
                orderId={orderId!}
                customerId={order.customerId}
                readOnly={!(isAdminOrOwner && canEditOrder)}
                lineItems={order.lineItems as any}
                showHistoricalCanceledLineItems={orderIsCanceled}
                productionFocusLineItemIds={productionFocus.highlightedIds}
                productionPriorityLineItemIds={productionFocus.prioritizedIds}
                onAfterLineItemsChange={recalculateOrderTotals}
                onDirtyStateChange={setHasDirtyLineItem}
                onDraftLineItemPricingChange={handleDraftLineItemPricingChange}
              />

              {/* Totals */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg font-medium">Totals</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCurrency(displayedOrderTotals.subtotal)}</span>
                    </div>
                    {displayedOrderTotals.discount > 0 && (
                      <div className="flex justify-between text-sm text-red-500">
                        <span>Discount</span>
                        <span>-{formatCurrency(displayedOrderTotals.discount)}</span>
                      </div>
                    )}
                      {currentFulfillmentMethod !== "pickup" && (order as any).shippingCents > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {currentFulfillmentMethod === "deliver" ? "Delivery" : "Shipping"}
                          </span>
                          <span>{formatCurrency(((order as any).shippingCents || 0) / 100)}</span>
                        </div>
                      )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tax</span>
                      <span>{formatCurrency(displayedOrderTotals.tax)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-bold text-lg">
                      <span>Total</span>
                      <span>{formatCurrency(displayedOrderTotals.total)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sidebar */}
          <div className="min-w-0 space-y-6">
            {/* Fulfillment & Shipping */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-medium">Fulfillment</CardTitle>
                  <div className="flex items-center gap-2">
                    <Select
                      value={currentFulfillmentMethod}
                      onValueChange={handleFulfillmentMethodChange}
                      disabled={!canEditOrder}
                    >
                      <SelectTrigger className="h-8 w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pickup">Pickup</SelectItem>
                        <SelectItem value="ship">Ship</SelectItem>
                        <SelectItem value="deliver">Deliver</SelectItem>
                      </SelectContent>
                    </Select>
                    {order.fulfillmentStatus && (
                      <FulfillmentStatusBadge status={order.fulfillmentStatus as any} />
                    )}
                    {canEditOrder && !isEditingFulfillment && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={enterFulfillmentEdit}
                        title="Edit Fulfillment"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {isEditingFulfillment && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={exitAllEditModes}
                      >
                        Done
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {currentFulfillmentMethod === "pickup" ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Pickup notes</label>
                      <Textarea
                        placeholder="Add pickup instructions, contact info, dock hours, etc."
                        defaultValue={order.shippingInstructions ?? ""}
                        disabled={!canEditOrder || !isEditingFulfillment}
                        onBlur={(e) => {
                          const nextValue = normalizeNullableString(e.target.value);
                          if ((order.shippingInstructions ?? null) === nextValue) return;
                          void applyOrderPatch({ shippingInstructions: nextValue });
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      {/* Ship To (order-level blind shipping) */}
                      <div className="space-y-3">
                        <div className="text-sm font-medium">Ship To</div>

                        {isEditingFulfillment && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => {
                                if (order.customer) void autofillShipToFromCustomer(order.customer as CustomerWithContacts);
                              }}
                              disabled={!defaultCustomerShipTo}
                            >
                              Use customer address
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              {defaultCustomerShipTo?.source === "shipping"
                                ? "Customer shipping address"
                                : defaultCustomerShipTo?.source === "billing"
                                  ? "Billing address fallback"
                                  : "No customer address on file"}
                            </span>
                            <Popover open={isShipToAutofillOpen} onOpenChange={setIsShipToAutofillOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 flex-1 justify-between font-normal"
                                  aria-expanded={isShipToAutofillOpen}
                                >
                                  <span className="truncate">Search customers...</span>
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[460px] p-0" align="start">
                                <Command shouldFilter={false}>
                                  <CommandInput
                                    placeholder="Search customers..."
                                    value={shipToAutofillQuery}
                                    onValueChange={setShipToAutofillQuery}
                                  />
                                  <CommandList>
                                    {isShipToAutofillCustomersLoading ? (
                                      <div className="p-4 text-sm text-muted-foreground text-center">Loading customers...</div>
                                    ) : (
                                      <>
                                        <CommandEmpty>No customers found.</CommandEmpty>
                                        {shipToAutofillCustomers.map((customer) => {
                                          const street = customer.shippingStreet1 || "";
                                          const city = customer.shippingCity || "";
                                          const state = customer.shippingState || "";
                                          const postal = customer.shippingPostalCode || "";

                                          const addressLeft = [street, city].filter(Boolean).join(", ");
                                          const addressRight = [state, postal].filter(Boolean).join(" ");
                                          const address = [addressLeft, addressRight].filter(Boolean).join(" • ");

                                          const label = `${customer.companyName || customer.email || "Customer"} — ${address || "No shipping address"}`;
                                          const searchValue = [customer.companyName, customer.email, customer.phone, customer.shippingStreet1, customer.shippingCity]
                                            .filter(Boolean)
                                            .join(" ");

                                          return (
                                            <CommandItem
                                              key={customer.id}
                                              value={searchValue}
                                              onSelect={async () => {
                                                await autofillShipToFromCustomer(customer);
                                                setIsShipToAutofillOpen(false);
                                                setShipToAutofillQuery("");
                                              }}
                                            >
                                              <div className="flex flex-col min-w-0 flex-1">
                                                <div className="font-medium truncate" title={label}>
                                                  {label}
                                                </div>
                                              </div>
                                            </CommandItem>
                                          );
                                        })}
                                      </>
                                    )}
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 ml-auto"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={handleAddNewShipToAddress}
                            >
                              Add new address
                            </Button>
                          </div>
                        )}

                        {!isEditingFulfillment ? (
                          <div className="space-y-1 text-sm text-muted-foreground">
                            {(order.shipToCompany || order.shipToName) && (
                              <div className="text-foreground">
                                {order.shipToCompany || order.shipToName}
                              </div>
                            )}
                            {order.shipToCompany && order.shipToName && order.shipToCompany !== order.shipToName && (
                              <div>{order.shipToName}</div>
                            )}

                            {(order.shipToEmail || order.shipToPhone) && (
                              <div className="grid grid-cols-1 gap-1 md:grid-cols-2 md:gap-3">
                                {order.shipToEmail && (
                                  <span className="min-w-0 truncate font-mono" title={order.shipToEmail}>
                                    {order.shipToEmail}
                                  </span>
                                )}
                                {order.shipToPhone && (
                                  <span className="md:justify-self-end font-mono" title={order.shipToPhone}>
                                    {order.shipToPhone}
                                  </span>
                                )}
                              </div>
                            )}

                            {(order.shipToAddress1 || order.shipToAddress2) && (
                              <div>
                                {order.shipToAddress1 && <div>{order.shipToAddress1}</div>}
                                {order.shipToAddress2 && <div>{order.shipToAddress2}</div>}
                              </div>
                            )}

                            {(order.shipToCity || order.shipToState || order.shipToPostalCode) && (
                              <div>
                                {[order.shipToCity, order.shipToState].filter(Boolean).join(", ")}
                                {order.shipToPostalCode ? ` ${order.shipToPostalCode}` : ""}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Company</label>
                              <Input
                                ref={shipToCompanyInputRef}
                                defaultValue={order.shipToCompany ?? ""}
                                onBlur={(e) => {
                                  if (suppressShipToBlurRef.current) return;
                                  const nextValue = normalizeNullableString(e.target.value);
                                  if ((order.shipToCompany ?? null) === nextValue) return;
                                  void saveShipTo({ shipToCompany: nextValue });
                                }}
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Contact</label>
                              <Input
                                ref={shipToNameInputRef}
                                defaultValue={order.shipToName ?? ""}
                                onBlur={(e) => {
                                  if (suppressShipToBlurRef.current) return;
                                  const nextValue = normalizeNullableString(e.target.value);
                                  if ((order.shipToName ?? null) === nextValue) return;
                                  void saveShipTo({ shipToName: nextValue });
                                }}
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Email</label>
                              <Input
                                ref={shipToEmailInputRef}
                                defaultValue={order.shipToEmail ?? ""}
                                onBlur={(e) => {
                                  if (suppressShipToBlurRef.current) return;
                                  const nextValue = normalizeNullableString(e.target.value);
                                  if ((order.shipToEmail ?? null) === nextValue) return;
                                  void saveShipTo({ shipToEmail: nextValue });
                                }}
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Phone</label>
                              <Input
                                ref={shipToPhoneInputRef}
                                defaultValue={order.shipToPhone ?? ""}
                                onBlur={(e) => {
                                  if (suppressShipToBlurRef.current) return;
                                  const nextValue = normalizeNullableString(e.target.value);
                                  if ((order.shipToPhone ?? null) === nextValue) return;
                                  void saveShipTo({ shipToPhone: nextValue });
                                }}
                              />
                            </div>

                            <div className="space-y-1 md:col-span-2">
                              <label className="text-xs text-muted-foreground">Address 1</label>
                              <Input
                                ref={shipToAddress1InputRef}
                                defaultValue={order.shipToAddress1 ?? ""}
                                onBlur={(e) => {
                                  if (suppressShipToBlurRef.current) return;
                                  const nextValue = normalizeNullableString(e.target.value);
                                  if ((order.shipToAddress1 ?? null) === nextValue) return;
                                  void saveShipTo({ shipToAddress1: nextValue });
                                }}
                              />
                            </div>

                            <div className="space-y-1 md:col-span-2">
                              <label className="text-xs text-muted-foreground">Address 2</label>
                              <Input
                                ref={shipToAddress2InputRef}
                                defaultValue={order.shipToAddress2 ?? ""}
                                onBlur={(e) => {
                                  if (suppressShipToBlurRef.current) return;
                                  const nextValue = normalizeNullableString(e.target.value);
                                  if ((order.shipToAddress2 ?? null) === nextValue) return;
                                  void saveShipTo({ shipToAddress2: nextValue });
                                }}
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">City</label>
                              <Input
                                ref={shipToCityInputRef}
                                defaultValue={order.shipToCity ?? ""}
                                onBlur={(e) => {
                                  if (suppressShipToBlurRef.current) return;
                                  const nextValue = normalizeNullableString(e.target.value);
                                  if ((order.shipToCity ?? null) === nextValue) return;
                                  void saveShipTo({ shipToCity: nextValue });
                                }}
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">State</label>
                              <Input
                                ref={shipToStateInputRef}
                                defaultValue={order.shipToState ?? ""}
                                onBlur={(e) => {
                                  if (suppressShipToBlurRef.current) return;
                                  const nextValue = normalizeNullableString(e.target.value);
                                  if ((order.shipToState ?? null) === nextValue) return;
                                  void saveShipTo({ shipToState: nextValue });
                                }}
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Postal Code</label>
                              <Input
                                ref={shipToPostalCodeInputRef}
                                defaultValue={order.shipToPostalCode ?? ""}
                                onBlur={(e) => {
                                  if (suppressShipToBlurRef.current) return;
                                  const nextValue = normalizeNullableString(e.target.value);
                                  if ((order.shipToPostalCode ?? null) === nextValue) return;
                                  void saveShipTo({ shipToPostalCode: nextValue });
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Shipping / Delivery Price */}
                      {(currentFulfillmentMethod === "ship" || currentFulfillmentMethod === "deliver") && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">
                            {currentFulfillmentMethod === "deliver" ? "Delivery Fee" : "Shipping Price"}
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={shippingDraft}
                              onFocus={() => setIsEditingShippingDraft(true)}
                              onChange={(e) => setShippingDraft(e.target.value)}
                              onBlur={(e) => {
                                const val = e.target.value.trim();
                                if (val === "" || val === "$") {
                                  setShippingDraft("");
                                  void applyOrderPatch({ shippingCents: 0 });
                                } else {
                                  const cleaned = val.replace(/[$,]/g, "");
                                  const dollars = Number.parseFloat(cleaned);
                                  if (Number.isFinite(dollars) && dollars >= 0) {
                                    const cents = Math.round(dollars * 100);
                                    setShippingDraft(dollars > 0 ? dollars.toFixed(2) : "");
                                    void applyOrderPatch({ shippingCents: cents });
                                  } else {
                                    const cents = (order as any)?.shippingCents;
                                    setShippingDraft(typeof cents === "number" && cents > 0 ? (cents / 100).toFixed(2) : "");
                                  }
                                }

                                setIsEditingShippingDraft(false);
                              }}
                              placeholder="0.00"
                              className="pl-7"
                              disabled={!canEditOrder || !isEditingFulfillment}
                            />
                          </div>
                        </div>
                      )}

                      {/* Customer-facing order document actions */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">Order PDF</span>
                          {orderPdfUnavailableReason ? (
                            <span className="text-xs text-muted-foreground text-right">{orderPdfUnavailableReason}</span>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleOrderPdfAction("preview")}
                            disabled={!canUseOrderPdf || isOrderPdfBusy !== null}
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            {isOrderPdfBusy === "preview" ? "Opening..." : "Preview Order"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleOrderPdfAction("download")}
                            disabled={!canUseOrderPdf || isOrderPdfBusy !== null}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            {isOrderPdfBusy === "download" ? "Downloading..." : "Download PDF"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleOpenOrderEmailDialog}
                            disabled={!canUseOrderPdf || sendOrderEmailMutation.isPending}
                          >
                            <Mail className="h-4 w-4 mr-2" />
                            {sendOrderEmailMutation.isPending ? "Sending..." : "Email Order"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleOrderPdfAction("print")}
                            disabled={!canUseOrderPdf || isOrderPdfBusy !== null}
                          >
                            <Printer className="h-4 w-4 mr-2" />
                            {isOrderPdfBusy === "print" ? "Opening..." : "Print Order"}
                          </Button>
                        </div>
                      </div>

                      {/* Packing Slip */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Packing Slip</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleGeneratePackingSlip}
                          disabled={generatePackingSlip.isPending || orderIsCanceled}
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          {generatePackingSlip.isPending ? "Generating..." : "Generate & View"}
                        </Button>
                      </div>

                      {/* Order Traveler — print-friendly whole-order summary */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Order Traveler</span>
                        {orderIsCanceled ? (
                          <Badge variant="outline" className="border-destructive/40 text-destructive">
                            Cancelled
                          </Badge>
                        ) : (
                          <PrintTicketButton orderId={order.id} />
                        )}
                      </div>

                      {/* Manual Status Override (Manager+) */}
                      {isManagerOrHigher && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Manual Status Override</label>
                          <Select
                            value={order.fulfillmentStatus || "pending"}
                            onValueChange={(value) => handleFulfillmentStatusChange(value as any)}
                            disabled={orderIsCanceled}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="packed">Packed</SelectItem>
                              <SelectItem value="shipped">Shipped</SelectItem>
                              <SelectItem value="delivered">Delivered</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <Separator />

                      {/* Shipments */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Shipments ({shipments.length})</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleAddShipment}
                            disabled={orderIsCanceled}
                          >
                            <Truck className="h-4 w-4 mr-2" />
                            Add Shipment
                          </Button>
                        </div>

                        {shipments.length === 0 ? (
                          <div className="text-xs text-muted-foreground">No shipments yet.</div>
                        ) : (
                          <div className="space-y-2">
                            {shipments.map((shipment) => (
                              <div
                                key={shipment.id}
                                className="border rounded-lg p-3 space-y-2"
                              >
                                <div className="flex items-start justify-between">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="text-xs">
                                        {shipment.carrier || 'Carrier'}
                                      </Badge>
                                      {shipment.deliveredAt && (
                                        <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">
                                          Delivered
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-mono">
                                        {shipment.trackingNumber}
                                      </span>
                                      {(shipment.carrier || 'Other') !== "Other" && shipment.trackingNumber && (
                                        <a
                                          href={getTrackingUrl(shipment.carrier || 'Other', shipment.trackingNumber)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-primary hover:underline"
                                        >
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      )}
                                    </div>
                                    {shipment.shippedAt && (
                                      <div className="text-xs text-muted-foreground">
                                        Shipped: {format(new Date(shipment.shippedAt), "MMM d, yyyy h:mm a")}
                                      </div>
                                    )}
                                    {shipment.deliveredAt && (
                                      <div className="text-xs text-muted-foreground">
                                        Delivered: {format(new Date(shipment.deliveredAt), "MMM d, yyyy h:mm a")}
                                      </div>
                                    )}
                                    {shipment.notes && (
                                      <div className="text-xs text-muted-foreground italic mt-1">
                                        {shipment.notes}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {!shipment.deliveredAt && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleMarkDelivered(shipment)}
                                        title="Mark as delivered"
                                      >
                                        <Check className="h-4 w-4" />
                                      </Button>
                                    )}

                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleEditShipment(shipment)}
                                      title="Edit shipment"
                                    >
                                      <Edit className="h-4 w-4" />
                                    </Button>
                              {isAdminOrOwner && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setShipmentToDelete(shipment.id)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                    </>
                  )}
              </CardContent>
            </Card>

            {/* Billing */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg font-medium">Billing</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={billingBadgeVariant}>{billingLabel}</Badge>
                    <Badge variant="outline">{invoiceStateSummary.label}</Badge>
                    {billingOverrideActive && <Badge variant="secondary">Override</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {billingStatus === 'ready' && billingReadyAtValue && (
                  <div className="text-sm text-muted-foreground">
                    Ready since {formatDate(billingReadyAtValue)}
                  </div>
                )}
                {billingOverrideActive && billingOverrideNoteValue && (
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {billingOverrideNoteValue}
                  </div>
                )}

                {billingNotReadyExplanation && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                    {billingNotReadyExplanation}
                  </div>
                )}

                {productionStatusWarning && (
                  <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-100">
                    {productionStatusWarning}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {isAdminOrOwner && (
                    <span title={billingActions.takePaymentHelp ?? undefined}>
                      <Button
                        variant="outline"
                        onClick={() => void handleTakePaymentFromOrder()}
                        disabled={!billingActions.canTakePayment}
                      >
                        <DollarSign className="mr-2 h-4 w-4" />
                        {billingActions.takePaymentLabel}
                      </Button>
                    </span>
                  )}

                  {isAdminOrOwner && (
                    <Button onClick={handleCreateInvoice} disabled={!billingActions.canCreateInvoice}>
                      <FileText className="mr-2 h-4 w-4" />
                      {createOrderInvoice.isPending ? 'Creating…' : 'Create Invoice'}
                    </Button>
                  )}

                  {isAdminOrOwner && !billingOverrideActive && billingStatus !== 'billed' && (
                    <Button variant="secondary" onClick={() => setBillingOverrideDialogOpen(true)}>
                      Set Ready Override
                    </Button>
                  )}

                  {isAdminOrOwner && billingOverrideActive && (
                    <Button variant="outline" onClick={handleClearBillingOverride} disabled={clearBillingOverrideMutation.isPending}>
                      {clearBillingOverrideMutation.isPending ? 'Clearing…' : 'Clear Override'}
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">Design billing visibility</div>
                    {designBillingRows.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Candidate {formatCurrency(designBillingCandidateTotal)} • Sold {formatCurrency(designBillingSoldTotal)}
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Visibility only. This does not create invoice rows or change order totals.
                    {designBillingUnsyncedCount > 0 ? ` ${designBillingUnsyncedCount} line item${designBillingUnsyncedCount === 1 ? '' : 's'} still have no synced design summary.` : ''}
                  </div>
                  {orderDesignBillingVisibilityQuery.isLoading ? (
                    <div className="text-sm text-muted-foreground">Loading design billing visibility…</div>
                  ) : orderDesignBillingVisibilityQuery.isError ? (
                    <div className="text-sm text-destructive">{(orderDesignBillingVisibilityQuery.error as Error).message}</div>
                  ) : designBillingRows.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No line items available for design billing visibility.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Line Item</TableHead>
                          <TableHead>Pricing</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Tracked</TableHead>
                          <TableHead className="text-right">Sold</TableHead>
                          <TableHead className="text-right">Candidate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {designBillingRows.map((row) => {
                          const title = row.description || row.productName || "Line item";
                          const pricingLabel = row.designPricingModeSnapshot
                            ? (DESIGN_PRICING_MODE_LABELS[row.designPricingModeSnapshot] ?? row.designPricingModeSnapshot)
                            : "—";
                          const statusLabel = row.visibilityState === "not_applicable"
                            ? "Not applicable"
                            : row.visibilityState === "no_summary"
                              ? "No summary yet"
                              : row.billingStatus
                                ? (DESIGN_BILLING_STATUS_LABELS[row.billingStatus] ?? row.billingStatus)
                                : row.designCostState
                                  ? (DESIGN_COST_STATE_LABELS[row.designCostState] ?? row.designCostState)
                                  : "Available";

                          return (
                            <TableRow key={row.lineItemId}>
                              <TableCell>
                                <div className="font-medium">{title}</div>
                                <div className="text-xs text-muted-foreground">
                                  Qty {row.quantity}{row.productName ? ` • ${row.productName}` : ""}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div>{pricingLabel}</div>
                                {row.lastSyncedAt && (
                                  <div className="text-xs text-muted-foreground">Synced {formatDate(row.lastSyncedAt)}</div>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant={row.visibilityState === "available" ? "outline" : "secondary"}>{statusLabel}</Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {row.correctedTrackedMinutes == null ? "—" : `${row.correctedTrackedMinutes}m`}
                              </TableCell>
                              <TableCell className="text-right">
                                {row.soldDesignAmount == null ? "—" : formatCurrency(row.soldDesignAmount)}
                              </TableCell>
                              <TableCell className="text-right">
                                {row.billableDesignAmount == null ? "—" : formatCurrency(row.billableDesignAmount)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Invoices</div>
                  {isInvoicesLoading ? (
                    <div className="text-sm text-muted-foreground">Loading invoices…</div>
                  ) : orderInvoices.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No invoices for this order.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderInvoices.map((inv: any) => {
                          const balance = Number(inv.displayRemaining ?? inv.balanceDue ?? Number(inv.total || 0) - Number(inv.amountPaid || 0));
                          return (
                            <TableRow key={inv.id}>
                              <TableCell className="font-medium">
                                <Link to={`/invoices/${inv.id}`} className="hover:underline">
                                  #{inv.invoiceNumber}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{String(inv.displayStatus || inv.status || '').toUpperCase()}</Badge>
                              </TableCell>
                              <TableCell className="text-right">{formatCurrency(balance)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(inv.displayTotal ?? inv.total)}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  {balance > 0 && String(inv.status || '').toLowerCase() !== 'void' ? (
                                    <Button variant="outline" size="sm" asChild>
                                      <Link to={`/invoices/${inv.id}?takePayment=1`}>Take Payment</Link>
                                    </Button>
                                  ) : null}
                                  <Button variant="outline" size="sm" asChild>
                                    <Link to={`/invoices/${inv.id}`}>Open Invoice</Link>
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>

                <Dialog open={paymentInvoiceSelectorOpen} onOpenChange={setPaymentInvoiceSelectorOpen}>
                  <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Select invoice to pay</DialogTitle>
                      <DialogDescription>
                        This order has multiple payable invoices. Choose the invoice to open before taking payment.
                      </DialogDescription>
                    </DialogHeader>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payableInvoiceCandidates.map((candidate) => (
                          <TableRow key={candidate.id}>
                            <TableCell className="font-medium">
                              {candidate.displayNumber || candidate.invoiceNumber || candidate.id}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{candidate.status.toUpperCase()}</Badge>
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(candidate.totalCents / 100)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(candidate.amountPaidCents / 100)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(candidate.remainingBalanceCents / 100)}</TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" onClick={() => handleSelectPayableInvoice(candidate)}>
                                Take Payment
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </DialogContent>
                </Dialog>

                <Dialog open={paymentBlockedDialogOpen} onOpenChange={setPaymentBlockedDialogOpen}>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Payment cannot be taken</DialogTitle>
                      <DialogDescription>
                        {paymentResolution?.blockedReason || 'This order has invoices, but none can currently accept payment.'}
                      </DialogDescription>
                    </DialogHeader>
                    {paymentResolution?.invoiceCandidates.length ? (
                      <div className="space-y-2">
                        <div className="text-sm font-medium">Existing invoices</div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Invoice</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Remaining</TableHead>
                              <TableHead>Reason</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paymentResolution.invoiceCandidates.map((candidate) => (
                              <TableRow key={candidate.id}>
                                <TableCell className="font-medium">
                                  <Link to={`/invoices/${candidate.id}`} className="hover:underline">
                                    {candidate.displayNumber || candidate.invoiceNumber || candidate.id}
                                  </Link>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">{candidate.status.toUpperCase()}</Badge>
                                </TableCell>
                                <TableCell className="text-right">{formatCurrency(candidate.remainingBalanceCents / 100)}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {candidate.blockedReason || 'Not payment-eligible'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : null}
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setPaymentBlockedDialogOpen(false)}>
                        Close
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={billingOverrideDialogOpen} onOpenChange={setBillingOverrideDialogOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Billing Ready Override</DialogTitle>
                      <DialogDescription>
                        Mark this order as ready for billing, regardless of line item status.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                      <Label htmlFor="billingOverrideNote">Note (optional)</Label>
                      <Textarea
                        id="billingOverrideNote"
                        value={billingOverrideNote}
                        onChange={(e) => setBillingOverrideNote(e.target.value)}
                        placeholder="Why is this order ready to bill?"
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setBillingOverrideDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleSetBillingOverride} disabled={setBillingOverrideMutation.isPending}>
                        {setBillingOverrideMutation.isPending ? 'Saving…' : 'Set Override'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            {/* Attachments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-medium">Attachments</CardTitle>
                <CardDescription>
                  Add POs, instructions, shipping docs, etc.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OrderAttachmentsPanel
                  orderId={order.id}
                  locked={false}
                  lineItems={order.lineItems.map((lineItem: any) => ({ id: lineItem.id, description: lineItem.description, sortOrder: lineItem.sortOrder }))}
                />
                {inboundAttachmentAudit.length > 0 && (
                  <div className="mt-4 border-t pt-4" data-testid="order-inbound-attachment-history">
                    <div className="text-sm font-medium">Attached inbound messages</div>
                    <div className="mt-2 space-y-2">
                      {inboundAttachmentAudit.map((entry) => (
                        <div key={entry.id} className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                          <div className="font-medium">{entry.metadata?.subject || entry.note || "Inbound record attached"}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {entry.metadata?.senderEmail || "Unknown sender"}
                            {entry.metadata?.receivedAt ? ` · Received ${format(new Date(entry.metadata.receivedAt), "PPp")}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Source Quote */}
            {(order.quote || order.sourceQuoteNumber) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Source Quote</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    From Quote #{order.quote?.quoteNumber ?? order.sourceQuoteNumber}
                  </p>
                </CardHeader>
                {order.quoteId && (
                  <CardContent>
                    <Link to={`/quotes/${order.quoteId}`}>
                      <Button variant="outline" size="sm" className="w-full text-titan-accent hover:text-titan-accent-hover">
                        View Quote #{order.quote?.quoteNumber ?? order.sourceQuoteNumber}
                      </Button>
                    </Link>
                  </CardContent>
                )}
              </Card>
            )}

            <Card>
              <CardHeader className="py-4 px-6">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setRightPanel(prev => prev === "timeline" ? "collapsed" : "timeline")}
                      className={cn(
                        "text-lg font-medium transition-colors hover:text-foreground cursor-pointer",
                        rightPanel === "timeline" ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      Timeline
                    </button>

                    <div className="h-4 w-px bg-muted-foreground/30" aria-hidden="true" />

                    <button
                      type="button"
                      onClick={() => setRightPanel(prev => prev === "material" ? "collapsed" : "material")}
                      className={cn(
                        "text-lg font-medium transition-colors hover:text-foreground cursor-pointer",
                        rightPanel === "material" ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      Material Usage
                    </button>
                  </div>

                  <div className="ml-auto flex w-full flex-wrap justify-start gap-2 sm:w-auto sm:justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowInventoryReservationsDialog(true)}
                    >
                      Inventory
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowManualReservationsDialog(true)}
                    >
                      Manual
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowPbv2RollupDialog(true)}
                    >
                      Rollup
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {rightPanel !== "collapsed" && (
                <CardContent className="py-4 px-6">
                  {rightPanel === "timeline" && (
                    <TimelinePanel orderId={order.id} quoteId={order.quoteId ?? undefined} />
                  )}
                  {rightPanel === "material" && (
                    <>
                      <CardDescription>Automatic deductions recorded for this order</CardDescription>
                      <div className="mt-3">
                        <MaterialUsageTable orderId={order.id} />
                      </div>
                    </>
                  )}
                </CardContent>
              )}
            </Card>

            {hasOrderDetailSecondaryActions({
              canManageProofPolicy: isAdminOrOwner && !orderIsCanceled,
              proofBypassed,
            }) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Secondary Actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <OrderDetailSecondaryActions
                    canManageProofPolicy={isAdminOrOwner && !orderIsCanceled}
                    proofBypassed={proofBypassed}
                    proofBypassReason={proofBypassReason}
                    isUpdatingProofPolicy={proofPolicyMutation.isPending}
                    onProofBypassReasonChange={setProofBypassReason}
                    onBypassProof={() => proofPolicyMutation.mutate({ policy: "bypass", reason: proofBypassReason })}
                    onRequireProofDefaults={() => proofPolicyMutation.mutate({ policy: "inherit_default" })}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </ContentLayout>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete order {order.orderNumber}? This action cannot be undone.
              All line items will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showReleaseReservationsDialog} onOpenChange={setShowReleaseReservationsDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release inventory reservations?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark all active reservations on this order as released.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowReleaseReservationsDialog(false);
                releaseInventoryMutation.mutate();
              }}
              disabled={releaseInventoryMutation.isPending}
            >
              Release
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showPbv2RollupDialog} onOpenChange={setShowPbv2RollupDialog}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>PBV2 Production Rollup</DialogTitle>
            <DialogDescription>Materials + accepted PBV2 components</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {pbv2RollupQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading rollup…</div>
            ) : pbv2RollupQuery.isError ? (
              <div className="text-sm text-destructive">Failed to load rollup.</div>
            ) : (
              (() => {
                const data = pbv2RollupQuery.data as any;
                const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
                const materials = Array.isArray(data?.materials) ? data.materials : [];
                const components = Array.isArray(data?.components) ? data.components : [];

                return (
                  <div className="space-y-4">
                    {warnings.length > 0 ? (
                      <div className="rounded-md border border-border/60 bg-background/30 p-3">
                        <div className="text-sm font-medium">Warnings</div>
                        <div className="mt-1 space-y-1 text-sm text-muted-foreground">
                          {warnings.map((w: any, idx: number) => (
                            <div key={idx}>
                              {w.lineItemId ? `Line item ${w.lineItemId}: ` : ""}
                              {String(w.message || w.code || "Warning")}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <div className="text-sm font-medium mb-2">Materials</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead>UOM</TableHead>
                            <TableHead className="text-right">Total Qty</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {materials.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={3} className="text-sm text-muted-foreground">
                                No PBV2 materials found.
                              </TableCell>
                            </TableRow>
                          ) : (
                            materials.map((m: any) => (
                              <TableRow key={`${m.skuRef}::${m.uom}`}>
                                <TableCell className="font-mono">{String(m.skuRef || "")}</TableCell>
                                <TableCell className="font-mono">{String(m.uom || "")}</TableCell>
                                <TableCell className="text-right font-mono">{String(m.qty || "")}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-2">Accepted Components</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Title</TableHead>
                            <TableHead>SKU/Product</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {components.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={3} className="text-sm text-muted-foreground">
                                No accepted components.
                              </TableCell>
                            </TableRow>
                          ) : (
                            components.map((c: any, idx: number) => (
                              <TableRow key={`${c.lineItemId || ""}::${c.title || ""}::${idx}`}>
                                <TableCell>{String(c.title || "")}</TableCell>
                                <TableCell className="font-mono">
                                  {String(c.kind || "") === "inlineSku"
                                    ? String(c.skuRef || "")
                                    : String(c.childProductId || "")}
                                </TableCell>
                                <TableCell className="text-right font-mono">{String(c.qty || "")}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })()
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPbv2RollupDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showInventoryReservationsDialog} onOpenChange={setShowInventoryReservationsDialog}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Inventory Reservations</DialogTitle>
            <DialogDescription>
              {inventoryReservationsEnabled
                ? "Derived from PBV2 rollup"
                : "Inventory reservations are disabled in settings."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div />
              {(() => {
                if (!inventoryReservationsEnabled) {
                  return (
                    <Button size="sm" disabled>
                      Reserve
                    </Button>
                  );
                }

                const data = inventoryQuery.data as any;
                const hasActive = Boolean(data?.hasActiveReservations);

                if (!orderId) return null;

                return hasActive ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowReleaseReservationsDialog(true)}
                    disabled={releaseInventoryMutation.isPending || inventoryQuery.isLoading}
                  >
                    Release
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => reserveInventoryMutation.mutate()}
                    disabled={reserveInventoryMutation.isPending || inventoryQuery.isLoading}
                  >
                    Reserve
                  </Button>
                );
              })()}
            </div>

            {!inventoryReservationsEnabled ? (
              <div className="text-sm text-muted-foreground">
                Enable Inventory Reservations in Organization Settings to view and manage reservations for this order.
              </div>
            ) : inventoryQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading reservations…</div>
            ) : inventoryQuery.isError ? (
              <div className="text-sm text-destructive">Failed to load reservations.</div>
            ) : (
              (() => {
                const data = inventoryQuery.data as any;
                const items = Array.isArray(data?.reserved?.items) ? data.reserved.items : [];

                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source Key</TableHead>
                        <TableHead>UOM</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Material</TableHead>
                        <TableHead className="text-right">Component</TableHead>
                        <TableHead className="text-right">Manual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-sm text-muted-foreground">
                            No active reservations.
                          </TableCell>
                        </TableRow>
                      ) : (
                        items.map((it: any) => (
                          <TableRow key={`${it.sourceKey}::${it.uom}`}>
                            <TableCell className="font-mono">{String(it.sourceKey || "")}</TableCell>
                            <TableCell className="font-mono">{String(it.uom || "")}</TableCell>
                            <TableCell className="text-right font-mono">{String(it.qty || "")}</TableCell>
                            <TableCell className="text-right font-mono">{String(it.bySourceType?.PBV2_MATERIAL || "0.00")}</TableCell>
                            <TableCell className="text-right font-mono">{String(it.bySourceType?.PBV2_COMPONENT || "0.00")}</TableCell>
                            <TableCell className="text-right font-mono">{String(it.bySourceType?.MANUAL || "0.00")}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                );
              })()
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInventoryReservationsDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showManualReservationsDialog} onOpenChange={setShowManualReservationsDialog}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manual Reservations</DialogTitle>
            <DialogDescription>Manage manual inventory reservations for this order.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {orderId ? (
              <ManualReservationsCard orderId={orderId} enabled={inventoryReservationsEnabled} />
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualReservationsDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      {/* Shipment Form Dialog */}
      <ShipmentForm
        open={showShipmentForm}
        onOpenChange={setShowShipmentForm}
        orderId={orderId!}
        shipment={editingShipment || undefined}
        mode={editingShipment ? "edit" : "create"}
      />

      {/* Packing Slip Modal */}
      {packingSlipHtml && (
        <PackingSlipModal
          open={showPackingSlipModal}
          onOpenChange={setShowPackingSlipModal}
          packingSlipHtml={packingSlipHtml}
        />
      )}

      <OrderRecipientFallbackDialog
        open={showOrderEmailDialog}
        onOpenChange={setShowOrderEmailDialog}
        contacts={customerContacts as OrderRecipientContactLike[]}
        selectedContactId={order.contact?.id ?? null}
        initialRecipientEmail={
          resolveSelectedOrderContactEmail(customerContacts as OrderRecipientContactLike[], order.contact?.id ?? null)
          || email
        }
        initialRecipientName={contactNameFromContact}
        attachPdfDefault={resolveAttachOrderPdfDefault(preferences)}
        isSending={sendOrderEmailMutation.isPending}
        onSubmit={(payload) => sendOrderEmailMutation.mutate(payload)}
      />

      {/* Delete Shipment Confirmation Dialog */}
      <AlertDialog open={!!shipmentToDelete} onOpenChange={() => setShipmentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shipment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this shipment? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => shipmentToDelete && handleDeleteShipment(shipmentToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showCancelOrderDialog} onOpenChange={(open) => {
        if (cancelOrderMutation.isPending) return;
        setShowCancelOrderDialog(open);
      }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Cancel Order</DialogTitle>
            <DialogDescription>
              Cancellation is permanent for normal operations. The order stays readable and auditable, but production, proofing,
              fulfillment, shipment creation, invoice generation, timers, and active print-ticket workflows will stop.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-titan-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Paid invoices, partial payments, shipped shipments, or picked-up orders will block cancellation and require manual handling.
            </div>

            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Reason</Label>
              <Select
                value={cancelOrderReason}
                onValueChange={(value) => setCancelOrderReason(value as OrderCancellationReason)}
              >
                <SelectTrigger id="cancel-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orderCancellationReasonValues.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {orderCancellationReasonLabels[reason]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cancel-note">Internal note</Label>
              <Textarea
                id="cancel-note"
                value={cancelOrderInternalNote}
                onChange={(event) => setCancelOrderInternalNote(event.target.value)}
                placeholder="Optional context for staff and audit review"
                rows={4}
                maxLength={2000}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCancelOrderDialog(false)}
              disabled={cancelOrderMutation.isPending}
            >
              Keep Order Active
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleCancelOrderConfirm()}
              disabled={cancelOrderMutation.isPending}
            >
              {cancelOrderMutation.isPending ? "Cancelling..." : "Cancel Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Transition Confirmation Dialog */}
      <AlertDialog open={!!pendingStatusTransition} onOpenChange={(open) => !open && cancelStatusTransition()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingStatusTransition?.toStatus === 'canceled' ? 'Cancel Order' : 'Complete Order'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStatusTransition?.toStatus === 'canceled' && (
                <div className="space-y-2">
                  <p>Are you sure you want to cancel this order? This action cannot be undone.</p>
                  <div className="mt-4">
                    <label className="text-sm font-medium">Cancellation Reason (optional)</label>
                    <textarea
                      className="w-full mt-1 p-2 border rounded-md"
                      rows={3}
                      value={cancellationReason}
                      onChange={(e) => setCancellationReason(e.target.value)}
                      placeholder="Enter reason for cancellation..."
                    />
                  </div>
                </div>
              )}
              {pendingStatusTransition?.toStatus === 'completed' && (
                <>
                  {requireLineItemsDone && incompleteLi.length > 0 ? (
                    <p>
                      <strong>{incompleteLi.length} line item(s)</strong> aren't marked complete yet. 
                      Do you want to mark them complete and complete this order?
                    </p>
                  ) : (
                    <p>Are you sure you want to mark this order as completed? This will lock the order from further edits.</p>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelStatusTransition}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmStatusTransition}
              className={pendingStatusTransition?.toStatus === 'canceled' 
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
              }
            >
              {pendingStatusTransition?.toStatus === 'canceled' 
                ? 'Cancel Order' 
                : (requireLineItemsDone && incompleteLi.length > 0 
                    ? 'Mark Complete & Finish Order' 
                    : 'Complete Order'
                  )
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!closeFeeOnlyAfterInvoice} onOpenChange={(open) => !open && setCloseFeeOnlyAfterInvoice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this billing-only order?</AlertDialogTitle>
            <AlertDialogDescription>
              This order has no production work. Mark it operationally complete now? The invoice and payment workflow remain active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              const invoiceId = closeFeeOnlyAfterInvoice?.invoiceId;
              setCloseFeeOnlyAfterInvoice(null);
              if (invoiceId) navigate(`/invoices/${invoiceId}`);
            }}>Complete Later</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                completeOrder.mutate(
                  {},
                  {
                    onSuccess: () => {
                      const invoiceId = closeFeeOnlyAfterInvoice?.invoiceId;
                      setCloseFeeOnlyAfterInvoice(null);
                      if (invoiceId) navigate(`/invoices/${invoiceId}`);
                    },
                  },
                );
              }}
              disabled={completeOrder.isPending}
            >
              {completeOrder.isPending ? 'Completing...' : 'Complete Order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}

function MaterialUsageTable({ orderId }: { orderId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/orders", orderId, "material-usage"],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/material-usage`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch material usage");
      const json = await res.json();
      return json.success ? json.data : json;
    },
  });
  if (isLoading) return <div className="text-sm">Loading usage...</div>;
  if (!data || data.length === 0) return <div className="text-sm text-muted-foreground">No material usage recorded.</div>;
  return (
    <div className="overflow-auto max-h-64">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left">
            <th className="p-2">Material</th>
            <th className="p-2">Qty Used</th>
            <th className="p-2">Unit</th>
            <th className="p-2">Line Item</th>
            <th className="p-2">Date</th>
          </tr>
        </thead>
        <tbody>
          {data.map((u: any) => (
            <tr key={u.id} className="border-t">
              <td className="p-2"><a href={`/materials/${u.materialId}`} className="underline text-primary">{u.materialId.substring(0,8)}</a></td>
              <td className="p-2">{u.quantityUsed}</td>
              <td className="p-2">{u.unitOfMeasure}</td>
              <td className="p-2">{u.orderLineItemId.substring(0,8)}</td>
              <td className="p-2">{new Date(u.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
