import { OrderCreditHoldBanner } from "@/components/orders/OrderCreditHoldBanner";
import { BillingOwnershipReviewPanel, useBillingOwnershipReview } from '@/components/invoices/BillingOwnershipReviewPanel';
import type { BillingOwnershipOverrideContext } from '@shared/billingOwnershipReview';
import { type ReactNode, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { OrderPaymentBadge } from '@/components/orders/OrderPaymentBadge';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { AlertTriangle, Calendar, Package, Trash2, Edit, Check, X, Plus, UserCog, Truck, ExternalLink, FileText, ChevronDown, Mail, Phone, ChevronsUpDown, Download, Printer, Paperclip, Clock, Wrench, StickyNote } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import { ContactSelect } from "@/components/ContactSelect";
import { useAuth } from "@/hooks/useAuth";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { useOrder, useCancelOrder, useDeleteOrder, useUpdateOrder, useUpdateOrderTaxTreatment, useBulkUpdateOrderLineItemStatus, useTransitionOrderStatus, getAllowedNextStatuses, isOrderEditable, useOrderWorkflow, useOrderCancellationEligibility } from "@/hooks/useOrders";
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
import { ListDetailNavigator } from "@/components/navigation/ListDetailNavigator";
import { parseDetailReturnPath, parseOrderDetailReturnPath, resolveOrderDetailBackPath, useListDetailNavigation } from "@/lib/listDetailNavigation";
import { buildProofingLineItemPath } from "@/lib/proofingNavigation";
import { getOrderProofBadgeClass } from "@/lib/orderProofUi";
import { canOpenProofingFromOrderStatus } from "@shared/orderProofStatus";
import { isCanceledOrder } from "@shared/operationalState";
import { isOrderCommerciallyEditable } from "@shared/orderCommercialEditability";
import { ROUTES } from "@/config/routes";
import { downloadAuthenticatedPdf, openAuthenticatedPdfForPrint, openAuthenticatedPdfPreview } from "@/lib/authenticatedPdfPreview";
import { apiFetch } from "@/lib/queryClient";
import { hasEnteredShipToAddress, resolveCustomerShipTo } from "@/lib/customerShipTo";
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
import {
  effectiveOrderFulfillmentMethod,
  fulfillmentMethodSemanticallyChanged,
} from "@shared/orderFulfillmentMethod";

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
  blindShipping?: boolean | null;
  blindShippingAddressSource?: "customer" | "custom" | null;
  blindShippingAddress?: BlindShippingAddress | null;

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

type BlindShippingAddress = {
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
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

type FulfillmentMethod = "pickup" | "ship" | "deliver";
const isFulfillmentMethod = (value: string): value is FulfillmentMethod =>
  ["pickup", "ship", "deliver"].includes(value);

// Date display style for Due Date and Promised Date in the order details card
// Future: This will be configurable via organization preferences
const DATE_DISPLAY_STYLE: "short" | "numeric" = "short";

function hasAnyStagedChanges(stagedPatch: Record<string, any>): boolean {
  return Object.keys(stagedPatch).length > 0;
}

function formatCustomerPaymentTerms(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    due_on_receipt: "Due on receipt",
    net_15: "Net 15",
    net_30: "Net 30",
    net_45: "Net 45",
    custom: "Custom terms",
  };
  return labels[value || ""] || value || "—";
}

const ORDER_DETAIL_DEV_DIAGNOSTICS =
  typeof process !== "undefined" && process.env?.NODE_ENV === "development";

function OrderUtilitySection({
  title,
  badge,
  icon,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
}: {
  title: string;
  badge?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange} className="rounded-lg border bg-card">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
            {badge}
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <div className="p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

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
  const orderId = params.id;
  const listNavigation = useListDetailNavigation("order", orderId);
  const detailReturnTo = parseDetailReturnPath(searchParams) ?? parseOrderDetailReturnPath(searchParams);
  const orderDetailPath = `${ROUTES.orders.detail(orderId ?? "")}${location.search}`;
  const orderBackPath = resolveOrderDetailBackPath(
    detailReturnTo,
    location.state && (location.state as { referrer?: unknown }).referrer,
    listNavigation.backPath,
    `${location.pathname}${location.search}${location.hash}`,
  );
  const isOrderEditRoute = location.pathname.endsWith("/edit");
  const { registerGuard, guardedNavigate, getGuardDiagnostics } = useNavigationGuard();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const billingOwnershipReview = useBillingOwnershipReview('orders', orderId);
  const [ownershipOverrideContext, setOwnershipOverrideContext] = useState<BillingOwnershipOverrideContext | null>(null);
  const [ownershipOverrideOpen, setOwnershipOverrideOpen] = useState(false);
  const [ownershipOverrideReason, setOwnershipOverrideReason] = useState('');
  const [ownershipOverridePending, setOwnershipOverridePending] = useState(false);
  const [ownershipOverrideError, setOwnershipOverrideError] = useState('');
  const [ownerDisplayDraft, setOwnerDisplayDraft] = useState<Record<string, any>>({});
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
  const newlyRequiredProofLineIdsRef = useRef<string[]>([]);
  const newlyRequiredProofLineIds = [
    ...((location.state as { newlyRequiredProofLineIds?: string[] } | null)?.newlyRequiredProofLineIds ?? []),
    ...newlyRequiredProofLineIdsRef.current,
  ];

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
  const [isEditingFulfillment, setIsEditingFulfillment] = useState(false);
  const [isFulfillmentExpanded, setIsFulfillmentExpanded] = useState(false);
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
  const requestedPanel = searchParams.get("panel");
  useEffect(() => {
    if (requestedPanel === "timeline") setRightPanel("timeline");
  }, [orderId, requestedPanel]);

  const [showReleaseReservationsDialog, setShowReleaseReservationsDialog] = useState(false);
  const [showPbv2RollupDialog, setShowPbv2RollupDialog] = useState(false);
  const [showInventoryReservationsDialog, setShowInventoryReservationsDialog] = useState(false);
  const [showManualReservationsDialog, setShowManualReservationsDialog] = useState(false);

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
    const timer = setTimeout(() => {
      setShipToAutofillDebounced(shipToAutofillQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [shipToAutofillQuery]);

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
  const { data: orderAttachments = [] } = useQuery<Array<{ id: string }>>({
    queryKey: [`/api/orders/${orderId}/attachments`],
    queryFn: async () => {
      const response = await apiFetch(`/api/orders/${encodeURIComponent(orderId ?? "")}/attachments`);
      if (!response.ok) throw new Error("Failed to load order attachments");
      const payload = await response.json();
      return Array.isArray(payload?.data) ? payload.data : [];
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
      ...(Object.hasOwn(pendingOrderPatch, "customerId") ? { customer: ownerDisplayDraft.customer } : {}),
      ...(Object.hasOwn(pendingOrderPatch, "contactId") ? { contact: ownerDisplayDraft.contact } : {}),
    } as OrderDetailOrder;
  }
  // Explicit null in the unsaved Order draft owns both picker scope and the save payload.
  const contactSearchCustomerId = order?.customerId ?? null;
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

  const [taxSettingsOpen, setTaxSettingsOpen] = useState(false);
  const [taxTreatmentDraft, setTaxTreatmentDraft] = useState<"auto" | "exempt" | "rate">("auto");
  const [taxRatePercentDraft, setTaxRatePercentDraft] = useState("");
  const [taxOverrideReasonDraft, setTaxOverrideReasonDraft] = useState("");
  const updateOrderTaxTreatment = useUpdateOrderTaxTreatment(orderId!);

  const orderTaxMode = (order as any)?.taxOverrideMode === "exempt" || (order as any)?.taxOverrideMode === "rate"
    ? (order as any).taxOverrideMode as "exempt" | "rate"
    : "auto";
  const orderTaxRate = Number((order as any)?.taxRate ?? 0) || 0;
  const orderTaxOverrideRate = Number((order as any)?.taxRateOverride ?? 0) || 0;
  const taxTreatmentLabel = orderTaxMode === "exempt"
    ? "Order exempt"
    : orderTaxMode === "rate"
      ? `Override ${(orderTaxOverrideRate * 100).toFixed(3)}%`
      : `Auto ${(orderTaxRate * 100).toFixed(3)}%`;
  const openTaxSettings = () => {
    setTaxTreatmentDraft(orderTaxMode);
    setTaxRatePercentDraft(orderTaxMode === "rate" ? String(orderTaxOverrideRate * 100) : String(orderTaxRate * 100));
    setTaxOverrideReasonDraft(String((order as any)?.taxOverrideReason ?? ""));
    setTaxSettingsOpen(true);
  };
  const projectedTaxRate = taxTreatmentDraft === "exempt"
    ? 0
    : taxTreatmentDraft === "rate"
      ? (Number(taxRatePercentDraft) || 0) / 100
      : orderTaxRate;
  const projectedTax = (Number((order as any)?.taxableSubtotal ?? 0) || 0) * projectedTaxRate;

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
  const [isOrderInternalNotesOpen, setIsOrderInternalNotesOpen] = useState(false);
  const [orderInternalNoteToDelete, setOrderInternalNoteToDelete] = useState<OrderInternalNoteRow | null>(null);

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

  const deleteOrderInternalNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const response = await apiFetch(`/api/orders/${encodeURIComponent(orderId ?? "")}/internal-notes/${encodeURIComponent(noteId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Failed to delete order internal note");
      return payload.data as { id: string };
    },
    onSuccess: async () => {
      setOrderInternalNoteToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["orders", "internalNotes", orderId] });
      await queryClient.invalidateQueries({ queryKey: ["orders", orderId, "audit"] });
      toast({ title: "Internal note removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove internal note", description: error.message, variant: "destructive" });
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
  const [billingOverrideDialogOpen, setBillingOverrideDialogOpen] = useState(false);
  const [billingOverrideNote, setBillingOverrideNote] = useState('');
  const [orderInvoiceSelectorOpen, setOrderInvoiceSelectorOpen] = useState(false);
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
  
  // Completion is operational history, not a blanket commercial lock. Server
  // mutation routes independently authorize every correction.
  const requireLineItemsDone = (preferences?.orders?.requireAllLineItemsDoneToComplete
    ?? preferences?.orders?.requireLineItemsDoneToComplete
    ?? true); // Default strict
  const canEditOrder = Boolean(order && (baseCanEditOrder || (isAdminOrOwner && isOrderCommerciallyEditable(order))));
  // Safe header metadata is correctable even after cancellation; the server
  // still blocks cancelled commercial/customer-identity recovery.
  const canEditSafeOrderMetadata = Boolean(order);
  const canAppendOrderInternalNote = Boolean(order);
  const canEditCommercialPricing = Boolean(order && isAdminOrOwner && isOrderCommerciallyEditable(order));
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
    if (!canEditSafeOrderMetadata) return;
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
    setIsEditingFulfillment(false);
    // Open customer picker immediately
    setIsCustomerPickerOpen(true);
  };

  const enterFulfillmentEdit = () => {
    if (!canEditSafeOrderMetadata) return;
    setIsEditingCustomer(false);
    setIsEditingFulfillment(true);
    setIsFulfillmentExpanded(true);
  };

  const handleFulfillmentMethodChange = (value: string) => {
    if (!canEditOrder) return;
    if (!isFulfillmentMethod(value)) return;
    // A controlled Select can receive a legacy persisted spelling.  Compare
    // against the persisted operational meaning, not the raw string, so
    // selecting the value already shown to staff never creates a phantom
    // terminal-fulfillment transition.
    const persistedShippingMethod = (orderRaw as OrderDetailOrder | undefined)?.shippingMethod;
    if (!fulfillmentMethodSemanticallyChanged(persistedShippingMethod, value)) {
      setPendingOrderPatch((previous) => {
        if (previous.shippingMethod === undefined) return previous;
        const { shippingMethod: _ignored, ...withoutMethod } = previous;
        return withoutMethod;
      });
      return;
    }
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

  const currentFulfillmentMethod: FulfillmentMethod = effectiveOrderFulfillmentMethod(order?.shippingMethod);
  // An explicit Order setting takes precedence, while existing Customer defaults
  // remain effective until staff make a per-Order choice.
  const blindShippingEnabled = typeof order?.blindShipping === "boolean"
    ? order.blindShipping
    : (order as any)?.customer?.blindShipping === true;
  const blindShippingAddress = order?.blindShippingAddress ?? {};
  const hasCustomBlindShippingAddress = Object.values(blindShippingAddress)
    .some((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  // Existing Order-level sender snapshots predate the source column and are
  // therefore custom by definition. New blind shipments default to the linked
  // Customer return address, which is resolved server-side for fulfillment.
  const blindShippingAddressSource = order?.blindShippingAddressSource
    ?? (hasCustomBlindShippingAddress ? "custom" : "customer");
  const blindShippingCustomer = order?.customer as CustomerWithContacts | null | undefined;
  const blindShippingCustomerAddress = blindShippingCustomer ? {
    company: blindShippingCustomer.companyName ?? null,
    name: null,
    address1: blindShippingCustomer.billingStreet1 ?? null,
    address2: blindShippingCustomer.billingStreet2 ?? null,
    city: blindShippingCustomer.billingCity ?? null,
    state: blindShippingCustomer.billingState ?? null,
    postalCode: blindShippingCustomer.billingPostalCode ?? null,
    country: blindShippingCustomer.billingCountry ?? null,
    phone: blindShippingCustomer.phone ?? null,
    email: blindShippingCustomer.email ?? null,
  } satisfies BlindShippingAddress : null;
  const hasBlindShippingCustomerAddress = Boolean(
    blindShippingCustomerAddress?.address1
    || blindShippingCustomerAddress?.city
    || blindShippingCustomerAddress?.postalCode,
  );
  const blindShippingCustomerAddressLines = blindShippingCustomerAddress
    ? [
      blindShippingCustomerAddress.company,
      blindShippingCustomerAddress.address1,
      blindShippingCustomerAddress.address2,
      [blindShippingCustomerAddress.city, blindShippingCustomerAddress.state, blindShippingCustomerAddress.postalCode].filter(Boolean).join(", "),
      blindShippingCustomerAddress.country,
    ].filter((line): line is string => Boolean(line?.trim()))
    : [];
  const updateBlindShippingAddress = (field: keyof BlindShippingAddress, value: string) => {
    const nextAddress = { ...blindShippingAddress, [field]: normalizeNullableString(value) };
    const hasAddressValue = Object.values(nextAddress).some((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
    void applyOrderPatch({
      blindShipping: true,
      blindShippingAddressSource: "custom",
      blindShippingAddress: hasAddressValue ? nextAddress : null,
    });
  };

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
  const {
    data: customerContacts = [],
  } = useQuery({
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

  const stageOrderOwner = (
    changes: { customerId?: string | null; contactId?: string | null },
    display: Record<string, any> = {},
  ) => {
    if (!canEditSafeOrderMetadata) return;
    setOwnershipOverrideContext(null);
    setPendingOrderPatch((previous) => ({ ...previous, ...changes }));
    setOwnerDisplayDraft((previous) => ({ ...previous, ...display }));
    setIsCustomerPickerOpen(false);
  };

  const removeCustomerFromOrder = () => {
    stageOrderOwner({ customerId: null }, { customer: null });
    setIsEditingCustomer(false);
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

      if (!canEditSafeOrderMetadata) return;
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
        if (!canEditSafeOrderMetadata) return;
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
      if (!canEditSafeOrderMetadata) return;
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
    if (!order.customerId && !order.contactId) {
      toast({ title: "Select a customer or contact for this order.", variant: "destructive" });
      return;
    }
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
            setOwnershipOverrideContext(error?.details?.billingOwnershipOverride ?? null);
            return { ok: false, error: error?.message || "Failed to save order" };
          }
        },
      });

      if (!result.ok) {
        // A line-item mutation can have committed before a later header PATCH
        // is rejected.  Drop transient total previews and reload the Order so
        // the Lines and Totals panels always describe the same authoritative
        // server snapshot.  Keep the rejected header draft for a safe retry.
        setDraftLineItemTotalsCents({});
        try {
          await queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
          await queryClient.refetchQueries({ queryKey: ["orders", "detail", orderId], type: "active" });
        } catch (refreshError) {
          console.error("[OrderSave] Failed to restore authoritative Order after a rejected save", refreshError);
        }

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
      const postSavePath = isOrderEditRoute ? orderDetailPath : ROUTES.orders.list;
      navigate(postSavePath, {
        state: {
          ...((location.state && typeof location.state === "object") ? location.state : {}),
          newlyRequiredProofLineIds: [
            ...((location.state as { newlyRequiredProofLineIds?: string[] } | null)?.newlyRequiredProofLineIds ?? []),
            ...newlyRequiredProofLineIdsRef.current,
          ],
        },
      });
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

  const handleOwnershipOverride = async () => {
    if (!orderId || !order || !ownershipOverrideContext) return;
    setOwnershipOverridePending(true); setOwnershipOverrideError('');
    try {
      const response = await apiFetch(`/api/orders/${orderId}/billing-ownership-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ownershipOverrideContext, customerId: order.customerId ?? null, contactId: order.contactId ?? null,
          reason: ownershipOverrideReason.trim(), confirmed: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to override billing ownership.');
      setPendingOrderPatch(previous => { const { customerId, contactId, ...rest } = previous; return rest; });
      setOwnershipOverrideContext(null); setOwnershipOverrideOpen(false); setOwnershipOverrideReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders', 'detail', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['billing-ownership-review'] }),
      ]);
      toast({ title: 'Billing ownership overridden', description: 'QuickBooks was not changed. Accounting reconciliation and reapproval are required.' });
    } catch (error: any) { setOwnershipOverrideError(error.message); } finally { setOwnershipOverridePending(false); }
  };

  const handleCancelOrderEdits = async () => {
    setOwnershipOverrideContext(null);
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
   * Line mutations recalculate Order financials and the editable Invoice in
   * their own server transaction. The browser must only discard its preview
   * and reload that authoritative result; writing a second client-derived
   * subtotal/total can resurrect a removed line or use a stale tax snapshot.
   */
  const recalculateOrderTotals = async () => {
    if (!orderId) return;
    try {
      setDraftLineItemTotalsCents({});
    } catch (error) {
      console.error("[recalculateOrderTotals] Failed to clear draft totals:", error);
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
  // Invoice creation remains subject to the existing canonical backend checks.
  // This only controls whether the compact Order-header shortcut is useful.
  const canCreateInvoiceFromOrder = !isInvoicesLoading
    && !createOrderInvoice.isPending
    && !orderIsCanceled
    && invoiceEligibleForCreation
    && orderInvoices.length === 0;
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

  const customerCompanyName: string | null = contactSearchCustomerId
    ? order.customer?.companyName || order.billToCompany || null
    : null;
  const defaultCustomerShipTo = resolveCustomerShipTo(order.customer);
  const contactNameFromContact: string | null = (() => {
    const c: any = order.contact;
    if (!c) return null;
    const name = (c.name || c.fullName || c.displayName || `${c.firstName || ""} ${c.lastName || ""}`).trim();
    return name || null;
  })();
  const contactLinePhone: string | null = (order.contact as any)?.phone || (order.contact as any)?.phoneNumber || (order.contact as any)?.mobile || null;

  // Keep the two context summaries semantically separate. A Contact can be
  // selected without a Customer, but its identity must never be presented as
  // Customer data or duplicated above the Contact summary.
  const customerContextEmail: string | null = order.customer?.email || order.billToEmail || null;
  const customerContextPhone: string | null = order.customer?.phone || order.billToPhone || null;

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
        <header className="mb-5 border-b border-border/60 pb-3">
          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 xl:shrink-0">
            <BackNavControls
              onBack={() => guardedNavigate(orderBackPath)}
              onSectionHome={() => guardedNavigate("/orders")}
              sectionLabel="Orders"
            />

            <div className="flex flex-col justify-center min-w-0">
              <h1 className="text-titan-xl font-semibold tracking-tight text-titan-text-primary">
                {`Order ${titleText}`}
              </h1>
            </div>
            <div className="flex items-center">
            {(order.state === 'closed' || order.status === 'operationally_complete') ? <OrderStatusBadge status={order.status} state={order.state} /> : <OrderStatusPillSelector
              orderId={order.id}
              currentState={order.state as OrderState}
              currentPillId={order.statusPillId}
              currentPillValue={order.statusPillValue}
              disabled={checkIfTerminalState(order.state as OrderState) && !canEditOrder}
              className="h-9 w-[220px] rounded-full text-sm"
            />}
            </div>

            <ListDetailNavigator
              label="order"
              position={listNavigation.position}
              total={listNavigation.total}
              loading={listNavigation.isLoading}
              canPrevious={listNavigation.canPrevious}
              canNext={listNavigation.canNext}
              onPrevious={() => void listNavigation.go(-1)}
              onNext={() => void listNavigation.go(1)}
            />
          </div>

            <div className="flex w-fit max-w-full min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-1 xl:ml-auto" aria-label="Order controls">
            {isOrderEditRoute && (
              <Button asChild variant="outline" size="sm" className="h-10 rounded-md px-3 text-xs font-semibold">
                <Link to={orderDetailPath} state={location.state}>
                  View Order
                </Link>
              </Button>
            )}

            {!isInvoicesLoading && orderInvoices.length === 1 ? (
              <Button asChild type="button" variant="outline" size="sm" className="h-10 rounded-md px-3 text-xs font-semibold">
                <Link to={`/invoices/${orderInvoices[0].id}`}>
                  Invoice
                </Link>
              </Button>
            ) : !isInvoicesLoading && orderInvoices.length > 1 ? (
              <Button type="button" variant="outline" size="sm" className="h-10 rounded-md px-3 text-xs font-semibold" onClick={() => setOrderInvoiceSelectorOpen(true)}>
                Invoices
              </Button>
            ) : !isInvoicesLoading && isAdminOrOwner && canCreateInvoiceFromOrder ? (
              <Button type="button" variant="outline" size="sm" className="h-10 rounded-md px-3 text-xs font-semibold" onClick={handleCreateInvoice} disabled={createOrderInvoice.isPending}>
                {createOrderInvoice.isPending ? "Creating…" : "Create Invoice"}
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 rounded-md px-3 text-xs font-semibold"
              onClick={() => guardedNavigate(ROUTES.fulfillment.order(order.id), {
                state: { referrer: buildReferrer(location), orderReturnState: location.state },
              })}
            >
              Fulfillment
            </Button>
            {!orderIsCanceled && <PrintTicketButton orderId={order.id} label="Print Traveler" showIcon={false} className="h-10 rounded-md px-3 text-xs font-semibold" />}

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
        </header>

        <Dialog open={orderInvoiceSelectorOpen} onOpenChange={setOrderInvoiceSelectorOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Invoices for Order {titleText}</DialogTitle>
              <DialogDescription>Select an invoice to view its billing and payment activity.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {orderInvoices.map((invoice: any) => {
                const balance = Number(invoice.displayRemaining ?? invoice.balanceDue ?? Number(invoice.total || 0) - Number(invoice.amountPaid || 0));
                return (
                  <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-medium">Invoice {invoice.invoiceNumber ?? invoice.id}</div>
                      <div className="text-sm text-muted-foreground">
                        {String(invoice.displayStatus || invoice.status || "").replace(/_/g, " ")} · Balance {formatCurrency(balance)}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline" onClick={() => setOrderInvoiceSelectorOpen(false)}>
                      <Link to={`/invoices/${invoice.id}`}>View Invoice</Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>

        <OrderCreditHoldBanner orderId={order.id} hold={order.creditHold} canOverride={isAdminOrOwner} />
        <BillingOwnershipReviewPanel hold={billingOwnershipReview.data?.hold} canResolve={isAdminOrOwner} />
        {ownershipOverrideContext && isAdminOrOwner && !billingOwnershipReview.data?.hold && (
          <div className="my-3 rounded-md border p-3 space-y-2 text-sm">
            <p>Normal Save is blocked by prior QuickBooks synchronization. An authorized ownership override requires accounting to correct QuickBooks manually.</p>
            <Button type="button" variant="outline" disabled={isSavingOrder || hasDirtyLineItem} onClick={() => { setOwnershipOverrideError(''); setOwnershipOverrideOpen(true); }}>Override Billing Ownership</Button>
          </div>
        )}
        <Dialog open={ownershipOverrideOpen} onOpenChange={next => { if (!ownershipOverridePending) setOwnershipOverrideOpen(next); }}>
          <DialogContent><DialogHeader><DialogTitle>Override Billing Ownership</DialogTitle>
            <DialogDescription>This Invoice was previously synchronized to QuickBooks. Only the staged billing owner will change in PrintersHero; totals and other edits are not changed by this override. QuickBooks will NOT be updated. Accounting must manually correct its customer/billing party. Automatic and manual QuickBooks sync will remain held until that correction is acknowledged, then accounting approval is required.</DialogDescription></DialogHeader>
            <Label htmlFor="ownership-override-reason">Reason</Label>
            <Textarea id="ownership-override-reason" value={ownershipOverrideReason} maxLength={2000} disabled={ownershipOverridePending} onChange={event => setOwnershipOverrideReason(event.target.value)} />
            {ownershipOverrideError && <p role="alert">{ownershipOverrideError}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={ownershipOverridePending} onClick={() => setOwnershipOverrideOpen(false)}>Cancel</Button>
              <Button type="button" disabled={ownershipOverridePending || !ownershipOverrideReason.trim()} onClick={() => void handleOwnershipOverride()}>Confirm local ownership override</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {isOrderEditRoute && orderIsCanceled && (
          <div className="mb-4 rounded-titan-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Cancelled order corrections are restricted</div>
                <div>
                  Add append-only internal notes as needed. Commercial and operational corrections require the dedicated recovery workflow.
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
          <div className="space-y-4 lg:space-y-5">
          {/* Main Content */}
          <div className="min-w-0 space-y-4">
            <Card className="border-0 bg-transparent shadow-none">
              <CardContent className="p-0">
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(20rem,1fr)_minmax(24rem,1.2fr)_minmax(18rem,0.8fr)]">
                  {/* Customer + Contact */}
                  <section className={cn("grid gap-4 rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4", !isEditingCustomer && "sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2")} aria-label="Customer and contact">
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
                                          // A Contact linked only to the old Customer must not resolve the save back to it.
                                          stageOrderOwner(
                                            customer.id === order.customerId ? { customerId: customer.id } : { customerId: customer.id, contactId: null },
                                            customer.id === order.customerId ? { customer } : { customer, contact: null },
                                          );
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
                          {contactSearchCustomerId && canEditSafeOrderMetadata && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                              disabled={updateOrder.isPending}
                              onClick={removeCustomerFromOrder}
                              aria-label="Remove customer"
                            >
                              <X className="mr-1 h-3 w-3" />
                              Remove customer
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Customer</div>
                            <HoverCard openDelay={150} closeDelay={50}>
                              <HoverCardTrigger asChild>
                                {contactSearchCustomerId && order.customer?.id && customerCompanyName ? (
                                  <Link
                                    to={`/customers/${order.customer.id}`}
                                    state={{ referrer: buildReferrer(location) }}
                                    className="block truncate text-lg font-semibold leading-6 text-foreground hover:underline"
                                    title={customerCompanyName}
                                  >
                                    {customerCompanyName}
                                  </Link>
                                ) : (
                                  <span
                                    tabIndex={0}
                                    className="block truncate text-lg font-semibold leading-6 text-foreground"
                                    title={customerCompanyName || "No customer selected"}
                                  >
                                    {customerCompanyName || "No customer selected"}
                                  </span>
                                )}
                              </HoverCardTrigger>
                              <HoverCardContent className="w-[340px] max-w-[90vw] p-3" align="start" side="bottom">
                                <div className="space-y-2">
                                  <div className="text-sm font-semibold text-foreground">{customerCompanyName || "No customer selected"}</div>
                                  {hasBillAddress && (
                                    <div className="text-sm">
                                      <div className="font-medium text-foreground">Billing</div>
                                      <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                                        {[billAddressLine1, billAddressLine2].filter(Boolean).join("\n") || "—"}
                                      </div>
                                    </div>
                                  )}
                                  {(customerContextEmail || customerContextPhone) && (
                                    <div className="text-xs text-muted-foreground">
                                      {customerContextEmail && <div className="font-mono break-words">{customerContextEmail}</div>}
                                      {customerContextPhone && <div className="font-mono break-words">{formatPhoneForDisplay(customerContextPhone)}</div>}
                                    </div>
                                  )}
                                  {contactSearchCustomerId && order.customer && (order.customer.paymentTerms || typeof order.customer.isTaxExempt === "boolean") && (
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
                                      {order.customer.paymentTerms && (
                                        <>
                                          <dt className="text-muted-foreground">Terms</dt>
                                          <dd className="text-right text-foreground">{formatCustomerPaymentTerms(order.customer.paymentTerms)}</dd>
                                        </>
                                      )}
                                      {typeof order.customer.isTaxExempt === "boolean" && (
                                        <>
                                          <dt className="text-muted-foreground">Tax status</dt>
                                          <dd className="text-right text-foreground">{order.customer.isTaxExempt ? "Exempt" : "Taxable"}</dd>
                                        </>
                                      )}
                                    </dl>
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
                              aria-label="Change customer"
                              title="Change customer"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}

                      {hasBillAddress && (
                        <div className="space-y-0.5 text-sm leading-5 text-foreground/80">
                          {billAddressLine1 && <div>{billAddressLine1}</div>}
                          {billAddressLine2 && <div>{billAddressLine2}</div>}
                        </div>
                      )}

                      {customerContextEmail && (
                        <div className="text-sm leading-5">
                          <a
                            href={`mailto:${customerContextEmail}`}
                            className="text-foreground/80 hover:text-foreground hover:underline"
                            title={customerContextEmail}
                          >
                            {customerContextEmail}
                          </a>
                        </div>
                      )}

                      {customerContextPhone && (
                        <div className="text-sm leading-5">
                          <a
                            href={phoneToTelHref(customerContextPhone)}
                            className="text-foreground/80 hover:text-foreground hover:underline"
                            title={customerContextPhone}
                          >
                            {formatPhoneForDisplay(customerContextPhone)}
                          </a>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      {isEditingCustomer ? (
                        <ContactSelect
                          value={order.contactId ?? null}
                          customerId={contactSearchCustomerId}
                          label="Contact"
                          placeholder="Search contacts..."
                          disabled={!canEditSafeOrderMetadata || updateOrder.isPending}
                          onChange={(contactId, contact) => {
                            if (!contactId && !contactSearchCustomerId) {
                              toast({ title: "Select a customer or contact for this order.", variant: "destructive" });
                              return;
                            }
                            stageOrderOwner(contactSearchCustomerId
                              ? { contactId }
                              : { customerId: null, contactId }, { contact: contact ?? null, customer: order.customer });
                          }}
                        />
                      ) : order.contact?.id && contactNameFromContact ? (
                        <div className="space-y-1">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Contact</div>
                          <Link
                            to={`/contacts/${order.contact.id}`}
                            state={{ referrer: buildReferrer(location) }}
                            className="inline-flex max-w-full items-center gap-1 truncate text-base font-semibold leading-5 text-foreground hover:underline"
                            aria-label={`Open ${contactNameFromContact}`}
                          >
                            <span className="truncate">{contactNameFromContact}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </Link>
                          {order.contact?.email && (
                          <a href={`mailto:${order.contact.email}`} className="block text-sm leading-5 text-foreground/80 hover:text-foreground hover:underline" title={order.contact.email}>
                              {order.contact.email}
                            </a>
                          )}
                          {contactLinePhone && (
                          <a href={phoneToTelHref(contactLinePhone)} className="block text-sm leading-5 text-foreground/80 hover:text-foreground hover:underline" title={contactLinePhone}>
                              {formatPhoneForDisplay(contactLinePhone)}
                            </a>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Contact</div>
                          <p className="text-sm text-muted-foreground">No contact selected</p>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Order meta */}
                  <section className="min-w-0 space-y-3 rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4" aria-label="Order details">
                    {/* TitanOS State Architecture */}
                    {(showPaymentStatus || showRoutedTo) && (
                      <div
                        className={cn(
                          "grid grid-cols-1 gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5",
                          showPaymentStatus && showRoutedTo ? "md:grid-cols-2" : "md:grid-cols-1"
                        )}
                      >
                        {showPaymentStatus && (
                          <div>
                            <label className="text-sm font-medium text-muted-foreground">Payment</label>
                            <div className="mt-1">
                              <OrderPaymentBadge summary={order.paymentSummary} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">Payment status</p>
                          </div>
                        )}

                        {showRoutedTo && (
                          <div>
                            <label className="text-sm font-medium text-muted-foreground">Routed To</label>
                            <div className="mt-1">
                              <Badge
                                variant="outline"
                                className="bg-purple-100 text-purple-800 border-purple-300"
                              >
                                {order.routingTarget === "fulfillment" ? "Fulfillment" : "Invoicing"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">Next workflow stage</p>
                          </div>
                        )}
                      </div>
                    )}
                
                {order.status === 'operationally_complete' && (
                  <div className="space-y-1">
                    <OrderStatusBadge status={order.status} />
                    <p className="text-sm text-muted-foreground">Nothing remains to produce, ship, deliver, or pick up. Invoice balances and payment remain separate.</p>
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

                <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                  <div className="flex min-w-0 items-center gap-2">
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
                      className="h-8 min-w-0 flex-1"
                      disabled={!canEditSafeOrderMetadata || updateOrder.isPending}
                      placeholder="—"
                    />
                  </div>

                  <div className="flex min-w-0 items-center gap-2">
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
                      disabled={!canEditSafeOrderMetadata || updateOrder.isPending}
                      placeholder="—"
                    />
                  </div>

                </div>

                <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {order.createdAt ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Order Date</span>
                      <span className="text-sm whitespace-nowrap">{formatOrderDate(order.createdAt, DATE_DISPLAY_STYLE === "short" ? "short" : "numeric")}</span>
                    </div>
                  ) : null}
                  <div className="flex min-w-0 items-center gap-2">
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
                        {canEditSafeOrderMetadata && (
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

                  <div className="flex min-w-0 items-center gap-2">
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
                        {canEditSafeOrderMetadata && (
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

                <div className="flex min-h-8 flex-wrap items-center gap-1.5" role="group" aria-label="Flags">
                  {flags.length > 0 ? <span className="mr-1 text-sm font-medium text-muted-foreground">Flags</span> : null}
                      {flags.map((t) => (
                        <Badge key={t} variant="secondary" className="h-7 px-2.5 py-0.5 text-xs flex items-center gap-1">
                          {t}
                          {canEditSafeOrderMetadata && !updateOrder.isPending && (
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

                      {!canEditSafeOrderMetadata || updateOrder.isPending || updateListNoteMutation.isPending ? null : (
                        <Badge variant="secondary" className="h-7 px-2.5 py-0.5 text-xs flex items-center">
                          <input
                            ref={flagInputRef}
                            value={flagInput}
                            onChange={(e) => setFlagInput(e.target.value)}
                            onKeyDown={handleFlagKeyDown}
                            placeholder={flags.length === 0 ? "+ Add Flag" : "Add Flag"}
                            className="w-[7rem] min-w-[7rem] bg-transparent outline-none text-xs font-semibold placeholder:text-muted-foreground/70"
                          />
                        </Badge>
                      )}
                </div>

                <Collapsible open={isOrderInternalNotesOpen || isAddingOrderInternalNote} onOpenChange={(open) => {
                  setIsOrderInternalNotesOpen(open);
                  if (!open) setIsAddingOrderInternalNote(false);
                }}>
                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2" data-testid="order-internal-notes">
                  <div className="flex items-center justify-between gap-3">
                    <CollapsibleTrigger asChild>
                      <button type="button" className="flex min-w-0 items-center gap-2 text-left">
                        <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">Internal Notes</span>
                          <span className="block text-xs text-muted-foreground">
                            {orderInternalNotesQuery.isLoading ? "Loading…" : `${orderInternalNotesQuery.data?.length ?? 0} note${(orderInternalNotesQuery.data?.length ?? 0) === 1 ? "" : "s"}`}
                          </span>
                        </span>
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", (isOrderInternalNotesOpen || isAddingOrderInternalNote) && "rotate-180")} />
                      </button>
                    </CollapsibleTrigger>
                    {canAppendOrderInternalNote && !isAddingOrderInternalNote ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setIsOrderInternalNotesOpen(true); setIsAddingOrderInternalNote(true); }}>
                        Add note
                      </Button>
                    ) : null}
                  </div>

                  <CollapsibleContent className="mt-2">
                  {orderInternalNotesQuery.data && orderInternalNotesQuery.data.length > 0 ? (
                      <div className="mt-2 space-y-2">
                      {orderInternalNotesQuery.data.map((note) => (
                        <div key={note.id} className="rounded border border-border/50 bg-background/40 px-2.5 py-2 text-sm">
                          <div className="whitespace-pre-wrap">{note.noteText}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {note.createdByUserName || "Staff"} · {format(new Date(note.createdAt), "PPp")}
                          </div>
                          {canAppendOrderInternalNote ? (
                            <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => setOrderInternalNoteToDelete(note)}>
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      ))}
                      </div>
                  ) : !order.notesInternal || isClearlyGeneratedInboundProvenance(order.notesInternal) ? <span className="sr-only">No internal notes.</span> : null}

                  {order.notesInternal && !isClearlyGeneratedInboundProvenance(order.notesInternal) ? (
                    <div className="mt-2 rounded border border-border/50 bg-background/40 px-2.5 py-2 text-sm text-muted-foreground whitespace-pre-wrap">{order.notesInternal}</div>
                  ) : null}

                  {canAppendOrderInternalNote && isAddingOrderInternalNote ? (
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
                  </CollapsibleContent>
                </div>
                </Collapsible>
                <AlertDialog open={orderInternalNoteToDelete !== null} onOpenChange={(open) => { if (!open && !deleteOrderInternalNoteMutation.isPending) setOrderInternalNoteToDelete(null); }}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete internal note?</AlertDialogTitle>
                      <AlertDialogDescription>This removes the note from the active Order notes list. Its deletion remains recorded in the Order timeline.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleteOrderInternalNoteMutation.isPending}>Cancel</AlertDialogCancel>
                      <AlertDialogAction disabled={deleteOrderInternalNoteMutation.isPending} onClick={(event) => { event.preventDefault(); if (orderInternalNoteToDelete) deleteOrderInternalNoteMutation.mutate(orderInternalNoteToDelete.id); }}>
                        {deleteOrderInternalNoteMutation.isPending ? "Deleting…" : "Delete note"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                  </section>

                  <section className="min-w-0 space-y-3 rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4" aria-label="Commercial and fulfillment">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Commercial &amp; Fulfillment</div>
                    <div className="grid gap-3">
                      <div className="grid min-w-0 gap-1.5">
                        <label className="text-sm font-medium text-muted-foreground">Priority</label>
                        <Select value={order.priority} onValueChange={handlePriorityChange} disabled={!canEditSafeOrderMetadata || updateOrder.isPending}>
                          <SelectTrigger className="h-9 min-w-0"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="rush">Rush</SelectItem>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="low">Low</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid min-w-0 gap-1.5">
                        <label className="text-sm font-medium text-muted-foreground">Fulfillment</label>
                        <Select value={currentFulfillmentMethod} onValueChange={handleFulfillmentMethodChange} disabled={!canEditOrder}>
                          <SelectTrigger className="h-9 min-w-0" aria-label="Fulfillment method"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pickup">Pickup</SelectItem>
                            <SelectItem value="ship">Ship</SelectItem>
                            <SelectItem value="deliver">Deliver</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center justify-between gap-2 border-t border-border/50 pt-3 text-sm text-muted-foreground">
                      <span className="min-w-0 truncate">{currentFulfillmentMethod === "pickup" ? "Pickup by customer" : (order.shipToCompany || order.shipToName || "Ship to address pending")}</span>
                      {canEditSafeOrderMetadata ? <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 px-2" onClick={enterFulfillmentEdit}>Edit</Button> : null}
                    </div>
                  </section>
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
                        {orderOperationalSummary.productionRequiredCount} production items
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
                commercialPricingEditable={canEditCommercialPricing}
                lineItems={order.lineItems as any}
                showHistoricalCanceledLineItems={orderIsCanceled}
                productionFocusLineItemIds={productionFocus.highlightedIds}
                productionPriorityLineItemIds={productionFocus.prioritizedIds}
                newProofRequirementLineItemIds={newlyRequiredProofLineIds}
                onProofRequirementAdded={(lineItemId) => {
                  if (!newlyRequiredProofLineIdsRef.current.includes(lineItemId)) newlyRequiredProofLineIdsRef.current.push(lineItemId);
                }}
                onAfterLineItemsChange={recalculateOrderTotals}
                onDirtyStateChange={setHasDirtyLineItem}
                onDraftLineItemPricingChange={handleDraftLineItemPricingChange}
              />

            </div>
          </div>

          {/* Inline fulfillment and lower-order utilities */}
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(280px,1fr)_minmax(240px,0.75fr)_minmax(320px,1fr)]">
            {/* Fulfillment stays in the Order flow; detailed shipment work lives in Fulfillment. */}
            <Collapsible
              open={isFulfillmentExpanded || isEditingFulfillment}
              onOpenChange={(open) => {
                setIsFulfillmentExpanded(open);
                if (!open && isEditingFulfillment) exitAllEditModes();
              }}
            >
            <Card>
              <CardHeader className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-medium">Fulfillment</CardTitle>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Select value={currentFulfillmentMethod} onValueChange={handleFulfillmentMethodChange} disabled={!canEditOrder}>
                      <SelectTrigger className="h-8 w-[140px]" aria-label="Fulfillment method">
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
                    {canEditSafeOrderMetadata && !isEditingFulfillment && (
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
                    {!isEditingFulfillment && (
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 px-2">
                          {isFulfillmentExpanded ? "Collapse" : "Details"}
                        </Button>
                      </CollapsibleTrigger>
                    )}
                  </div>
                </div>
                {!isFulfillmentExpanded && !isEditingFulfillment && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {currentFulfillmentMethod === "pickup" ? (
                      <span>{order.shippingInstructions ? "Pickup · instructions on file" : "Pickup"}</span>
                    ) : (
                      <>
                        <span>{order.shipToCompany || order.shipToName || "Ship To pending"}</span>
                        {order.shipToCity || order.shipToState ? <span>{[order.shipToCity, order.shipToState].filter(Boolean).join(", ")}</span> : null}
                        {(order as any).shippingCents > 0 ? <span>{formatCurrency(((order as any).shippingCents || 0) / 100)}</span> : null}
                        {blindShippingEnabled ? <span>{blindShippingAddressSource === "customer" ? "Blind shipping · Customer address" : "Blind shipping · Custom sender on file"}</span> : null}
                      </>
                    )}
                  </div>
                )}
              </CardHeader>
              <CollapsibleContent>
              <CardContent className="space-y-3 px-4 pb-4 pt-0">
                {currentFulfillmentMethod === "pickup" ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Pickup notes</label>
                      <Textarea
                        placeholder="Add pickup instructions, contact info, dock hours, etc."
                        defaultValue={order.shippingInstructions ?? ""}
                        disabled={!canEditSafeOrderMetadata || !isEditingFulfillment}
                        onBlur={(e) => {
                          const nextValue = normalizeNullableString(e.target.value);
                          if ((order.shippingInstructions ?? null) === nextValue) return;
                          void applyOrderPatch({ shippingInstructions: nextValue });
                        }}
                      />
                    </div>
                  ) : (
                    <div className="grid gap-3 xl:grid-cols-2">
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

                        {!isEditingFulfillment || !canEditOrder ? (
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

                      {(isEditingFulfillment || order.shippingInstructions) ? <div className="space-y-2 xl:col-span-full">
                        <label className="text-sm font-medium">Shipping instructions</label>
                        <Textarea
                          placeholder="Add delivery instructions, dock hours, contact information, etc."
                          defaultValue={order.shippingInstructions ?? ""}
                          disabled={!canEditSafeOrderMetadata || !isEditingFulfillment}
                          onBlur={(e) => {
                            const nextValue = normalizeNullableString(e.target.value);
                            if ((order.shippingInstructions ?? null) === nextValue) return;
                            void applyOrderPatch({ shippingInstructions: nextValue });
                          }}
                        />
                      </div> : null}

                      <div className="rounded-md border border-border/60 p-3 xl:col-start-2 xl:row-start-1">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            checked={blindShippingEnabled}
                            disabled={!canEditSafeOrderMetadata || !isEditingFulfillment}
                            onChange={(event) => void applyOrderPatch(event.target.checked
                              ? { blindShipping: true, blindShippingAddressSource }
                              : { blindShipping: false })}
                          />
                          Blind shipping
                        </label>
                        <p className="mt-1 text-xs text-muted-foreground">Use a separate sender address. The Ship To destination remains unchanged.</p>
                        {blindShippingEnabled && isEditingFulfillment && (
                          <div className="mt-3 space-y-3">
                            <div className="text-sm font-medium">Shipper / Return Address</div>
                            <RadioGroup
                              value={blindShippingAddressSource}
                              onValueChange={(value) => {
                                if (value !== "customer" && value !== "custom") return;
                                void applyOrderPatch({ blindShipping: true, blindShippingAddressSource: value });
                              }}
                              className="gap-2"
                            >
                              <label className="flex items-center gap-2 text-sm">
                                <RadioGroupItem value="customer" disabled={!canEditSafeOrderMetadata} />
                                Use Customer Address
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <RadioGroupItem value="custom" disabled={!canEditSafeOrderMetadata} />
                                Custom Address
                              </label>
                            </RadioGroup>

                            {blindShippingAddressSource === "customer" ? (
                              hasBlindShippingCustomerAddress ? (
                                <address className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm not-italic">
                                  <div className="mb-1 font-medium">{blindShippingCustomer?.companyName || "Customer address"}</div>
                                  {blindShippingCustomerAddressLines.map((line) => <div key={line}>{line}</div>)}
                                </address>
                              ) : (
                                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                                  No usable Customer address is available. Choose Custom Address before completing blind shipping.
                                </p>
                              )
                            ) : (
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {([
                                  ["company", "Company"], ["name", "Contact name"], ["address1", "Address"], ["address2", "Address line 2"],
                                  ["city", "City"], ["state", "State"], ["postalCode", "Postal code"], ["country", "Country"],
                                  ["phone", "Phone"], ["email", "Email"],
                                ] as Array<[keyof BlindShippingAddress, string]>).map(([field, label]) => (
                                  <div key={field} className="space-y-1">
                                    <label className="text-xs text-muted-foreground">{label}</label>
                                    <Input
                                      type={field === "email" ? "email" : "text"}
                                      defaultValue={blindShippingAddress[field] ?? ""}
                                      onBlur={(event) => updateBlindShippingAddress(field, event.target.value)}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {blindShippingEnabled && !isEditingFulfillment && (
                          <div className="mt-2 text-sm text-muted-foreground">
                            {blindShippingAddressSource === "customer" ? "Blind shipping · Customer address" : "Blind shipping · Custom sender on file"}
                          </div>
                        )}
                      </div>

                      {/* Shipping / Delivery Price */}
                      {(currentFulfillmentMethod === "ship" || currentFulfillmentMethod === "deliver") && (
                        <div className="space-y-2 xl:col-span-full">
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

                    </div>
                  )}
              </CardContent>
              </CollapsibleContent>
            </Card>
            </Collapsible>

            <div className="contents">
              {/* Totals */}
              <Card className="h-fit">
                <CardHeader className="px-4 py-3">
                  <CardTitle className="text-base font-medium">Totals</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(displayedOrderTotals.subtotal)}</span></div>
                    {displayedOrderTotals.discount > 0 && <div className="flex justify-between text-sm text-red-500"><span>Discount</span><span>-{formatCurrency(displayedOrderTotals.discount)}</span></div>}
                    {currentFulfillmentMethod !== "pickup" && (order as any).shippingCents > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">{currentFulfillmentMethod === "deliver" ? "Delivery" : "Shipping"}</span><span>{formatCurrency(((order as any).shippingCents || 0) / 100)}</span></div>}
                    <div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">Tax · {taxTreatmentLabel}</span><span className="flex items-center gap-2">{formatCurrency(displayedOrderTotals.tax)}{isAdminOrOwner && canEditOrder ? <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={openTaxSettings} aria-label="Edit tax settings">Edit</Button> : null}</span></div>
                    <Separator />
                    <div className="flex justify-between font-bold text-lg"><span>Total</span><span>{formatCurrency(displayedOrderTotals.total)}</span></div>
                  </div>
                </CardContent>
              </Card>

            <div className="space-y-2">
            <OrderUtilitySection title="Order Documents" icon={<FileText className="h-4 w-4 text-muted-foreground" />}>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => void handleOrderPdfAction("preview")} disabled={!canUseOrderPdf || isOrderPdfBusy !== null} aria-label="Preview Order" title="Preview Order">
                  <FileText className="mr-1.5 h-4 w-4" /> Preview
                </Button>
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => void handleOrderPdfAction("download")} disabled={!canUseOrderPdf || isOrderPdfBusy !== null} aria-label="Download Order PDF" title="Download Order PDF">
                  <Download className="mr-1.5 h-4 w-4" /> Download
                </Button>
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={handleOpenOrderEmailDialog} disabled={!canUseOrderPdf || sendOrderEmailMutation.isPending} aria-label="Email Order" title="Email Order">
                  <Mail className="mr-1.5 h-4 w-4" /> Email
                </Button>
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => void handleOrderPdfAction("print")} disabled={!canUseOrderPdf || isOrderPdfBusy !== null} aria-label="Print Order" title="Print Order">
                  <Printer className="mr-1.5 h-4 w-4" /> Print
                </Button>
              </div>
              {orderPdfUnavailableReason ? <p className="mt-2 text-xs text-muted-foreground">{orderPdfUnavailableReason}</p> : null}
            </OrderUtilitySection>
            {/* Attachments */}
            <OrderUtilitySection
              title="Attachments"
              badge={<Badge variant="outline">{orderAttachments.length}</Badge>}
              icon={<Paperclip className="h-4 w-4 text-muted-foreground" />}
            >
              <p className="mb-3 text-sm text-muted-foreground">Add POs, instructions, shipping docs, and other order files.</p>
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
            </OrderUtilitySection>

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

            <OrderUtilitySection
              title="Timeline"
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              open={rightPanel === "timeline"}
              onOpenChange={(open) => setRightPanel(open ? "timeline" : "collapsed")}
            >
              <TimelinePanel orderId={order.id} quoteId={order.quoteId ?? undefined} />
            </OrderUtilitySection>

            <OrderUtilitySection
              title="Material Usage"
              icon={<Package className="h-4 w-4 text-muted-foreground" />}
              open={rightPanel === "material"}
              onOpenChange={(open) => setRightPanel(open ? "material" : "collapsed")}
            >
              <CardDescription>Automatic deductions recorded for this order</CardDescription>
              <div className="mt-3"><MaterialUsageTable orderId={order.id} /></div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowInventoryReservationsDialog(true)}>Inventory</Button>
                <Button size="sm" variant="outline" onClick={() => setShowManualReservationsDialog(true)}>Manual</Button>
                <Button size="sm" variant="outline" onClick={() => setShowPbv2RollupDialog(true)}>Rollup</Button>
              </div>
            </OrderUtilitySection>

            {(hasOrderDetailSecondaryActions({
              canManageProofPolicy: isAdminOrOwner && !orderIsCanceled,
              proofBypassed,
            }) || (isAdminOrOwner && billingStatus !== "billed")) && (
              <OrderUtilitySection title="Secondary Actions" icon={<Wrench className="h-4 w-4 text-muted-foreground" />}>
                {hasOrderDetailSecondaryActions({
                  canManageProofPolicy: isAdminOrOwner && !orderIsCanceled,
                  proofBypassed,
                }) && (
                  <OrderDetailSecondaryActions
                      canManageProofPolicy={isAdminOrOwner && !orderIsCanceled}
                      proofBypassed={proofBypassed}
                      proofBypassReason={proofBypassReason}
                      isUpdatingProofPolicy={proofPolicyMutation.isPending}
                      onProofBypassReasonChange={setProofBypassReason}
                      onBypassProof={() => proofPolicyMutation.mutate({ policy: "bypass", reason: proofBypassReason })}
                      onRequireProofDefaults={() => proofPolicyMutation.mutate({ policy: "inherit_default" })}
                    />
                )}
                {isAdminOrOwner && billingStatus !== "billed" && (
                  <div className="mt-3 border-t border-border/50 pt-3">
                    <div className="text-sm font-medium">Billing administration</div>
                    <p className="mt-1 text-sm text-muted-foreground">Use only when an authorized exception requires billing readiness to be overridden.</p>
                    {!billingOverrideActive ? (
                      <Button className="mt-2" variant="secondary" size="sm" onClick={() => setBillingOverrideDialogOpen(true)}>
                        Set Ready Override
                      </Button>
                    ) : (
                      <Button className="mt-2" variant="outline" size="sm" onClick={handleClearBillingOverride} disabled={clearBillingOverrideMutation.isPending}>
                        {clearBillingOverrideMutation.isPending ? "Clearing…" : "Clear Override"}
                      </Button>
                    )}
                  </div>
                )}
                {isAdminOrOwner && (
                  <details className="mt-3 border-t border-border/50 pt-3">
                    <summary className="cursor-pointer text-sm font-medium">Design billing diagnostics</summary>
                    <div className="mt-2 text-sm text-muted-foreground">Visibility only. This does not create invoice rows or change order totals.</div>
                    {orderDesignBillingVisibilityQuery.isLoading ? (
                      <div className="mt-2 text-sm text-muted-foreground">Loading design billing visibility…</div>
                    ) : orderDesignBillingVisibilityQuery.isError ? (
                      <div className="mt-2 text-sm text-destructive">{(orderDesignBillingVisibilityQuery.error as Error).message}</div>
                    ) : designBillingRows.length === 0 ? (
                      <div className="mt-2 text-sm text-muted-foreground">No line items available for design billing visibility.</div>
                    ) : (
                      <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border/50">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Line Item</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Tracked</TableHead>
                              <TableHead className="text-right">Sold</TableHead>
                              <TableHead className="text-right">Candidate</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {designBillingRows.map((row) => (
                              <TableRow key={row.lineItemId}>
                                <TableCell>
                                  <div className="font-medium">{row.description || row.productName || "Line item"}</div>
                                  <div className="text-xs text-muted-foreground">Qty {row.quantity}{row.productName ? ` · ${row.productName}` : ""}</div>
                                </TableCell>
                                <TableCell>{row.billingStatus ? (DESIGN_BILLING_STATUS_LABELS[row.billingStatus] ?? row.billingStatus) : "Not billable"}</TableCell>
                                <TableCell className="text-right">{row.correctedTrackedMinutes == null ? "—" : `${row.correctedTrackedMinutes}m`}</TableCell>
                                <TableCell className="text-right">{row.soldDesignAmount == null ? "—" : formatCurrency(row.soldDesignAmount)}</TableCell>
                                <TableCell className="text-right">{row.billableDesignAmount == null ? "—" : formatCurrency(row.billableDesignAmount)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </details>
                )}
              </OrderUtilitySection>
            )}
            </div>
            </div>
          </div>
        </div>
      </ContentLayout>

      <Dialog open={billingOverrideDialogOpen} onOpenChange={setBillingOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Billing Ready Override</DialogTitle>
            <DialogDescription>Mark this order as ready for billing, regardless of line-item status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="billingOverrideNote">Note (optional)</Label>
            <Textarea id="billingOverrideNote" value={billingOverrideNote} onChange={(event) => setBillingOverrideNote(event.target.value)} placeholder="Why is this order ready to bill?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillingOverrideDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSetBillingOverride} disabled={setBillingOverrideMutation.isPending}>
              {setBillingOverrideMutation.isPending ? "Saving…" : "Set Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={taxSettingsOpen} onOpenChange={(open) => !updateOrderTaxTreatment.isPending && setTaxSettingsOpen(open)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Tax Settings</DialogTitle>
            <DialogDescription>Set the tax treatment for this Order without changing Customer or Product defaults.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex cursor-pointer gap-3 rounded-md border p-3">
              <input type="radio" name="tax-treatment" checked={taxTreatmentDraft === "auto"} onChange={() => setTaxTreatmentDraft("auto")} />
              <span><span className="block font-medium">Automatic</span><span className="text-sm text-muted-foreground">Uses Customer and organization tax settings.</span></span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-md border p-3">
              <input type="radio" name="tax-treatment" checked={taxTreatmentDraft === "exempt"} onChange={() => setTaxTreatmentDraft("exempt")} />
              <span><span className="block font-medium">Tax Exempt for This Order</span><span className="text-sm text-muted-foreground">Applies a 0% rate to this transaction only.</span></span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-md border p-3">
              <input type="radio" name="tax-treatment" checked={taxTreatmentDraft === "rate"} onChange={() => setTaxTreatmentDraft("rate")} />
              <span className="flex-1"><span className="block font-medium">Override Tax Rate</span><span className="text-sm text-muted-foreground">Applies only to taxable lines on this Order.</span></span>
            </label>
            {taxTreatmentDraft === "rate" ? (
              <div className="space-y-2 pl-7">
                <Label htmlFor="order-tax-rate">Rate (%)</Label>
                <Input id="order-tax-rate" type="number" min="0" max="100" step="0.001" value={taxRatePercentDraft} onChange={(event) => setTaxRatePercentDraft(event.target.value)} />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="order-tax-reason">Reason {taxTreatmentDraft === "auto" ? "(optional)" : "(required)"}</Label>
              <Textarea id="order-tax-reason" value={taxOverrideReasonDraft} onChange={(event) => setTaxOverrideReasonDraft(event.target.value)} maxLength={2000} placeholder="Why is this Order tax treatment being overridden?" />
            </div>
            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="flex justify-between"><span>Taxable subtotal</span><span>{formatCurrency(Number((order as any)?.taxableSubtotal ?? 0) || 0)}</span></div>
              <div className="mt-1 flex justify-between"><span>Projected tax</span><span>{formatCurrency(projectedTax)}</span></div>
              <p className="mt-2 text-xs text-muted-foreground">The server recalculates the authoritative total and any live Order-backed Invoice when you apply this setting.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTaxSettingsOpen(false)} disabled={updateOrderTaxTreatment.isPending}>Cancel</Button>
            <Button
              type="button"
              disabled={updateOrderTaxTreatment.isPending || (taxTreatmentDraft !== "auto" && taxOverrideReasonDraft.trim().length < 3) || (taxTreatmentDraft === "rate" && (!(Number(taxRatePercentDraft) >= 0) || Number(taxRatePercentDraft) > 100))}
              onClick={() => {
                void (async () => {
                  try {
                    await updateOrderTaxTreatment.mutateAsync({
                      mode: taxTreatmentDraft,
                      rate: taxTreatmentDraft === "rate" ? Number(taxRatePercentDraft) / 100 : null,
                      reason: taxTreatmentDraft === "auto" ? null : taxOverrideReasonDraft.trim(),
                    });
                    setTaxSettingsOpen(false);
                  } catch {
                    // The mutation owns the user-safe error toast.
                  }
                })();
              }}
            >
              {updateOrderTaxTreatment.isPending ? "Applying..." : "Apply Tax Settings"}
            </Button>
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
          || order.contact?.email
          || customerContextEmail
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
