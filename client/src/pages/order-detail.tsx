import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { ArrowLeft, Calendar, Package, DollarSign, Trash2, Edit, Check, X, Plus, UserCog, Truck, ExternalLink, FileText, ChevronDown, Mail, Phone, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { useOrder, useDeleteOrder, useUpdateOrder, useUpdateOrderLineItem, useCreateOrderLineItem, useDeleteOrderLineItem, useUpdateOrderLineItemStatus, useBulkUpdateOrderLineItemStatus, useTransitionOrderStatus, getAllowedNextStatuses, areLineItemsEditable, isOrderEditable } from "@/hooks/useOrders";
import { OrderAttachmentsPanel } from "@/components/OrderAttachmentsPanel";
import { useQuery } from "@tanstack/react-query";
import { OrderLineItemDialog } from "@/components/order-line-item-dialog";
import type { OrderLineItem as HookOrderLineItem, OrderWithRelations as HookOrderWithRelations } from "@/hooks/useOrders";
import { OrderStatusBadge, OrderPriorityBadge, LineItemStatusBadge } from "@/components/order-status-badge";
import { FulfillmentStatusBadge } from "@/components/FulfillmentStatusBadge";
import { ShipmentForm } from "@/components/ShipmentForm";
import { PackingSlipModal } from "@/components/PackingSlipModal";
import { useShipments, useDeleteShipment, useUpdateShipment, useGeneratePackingSlip, useSendShipmentEmail, useUpdateFulfillmentStatus } from "@/hooks/useShipments";
import type { Shipment } from "@shared/schema";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Page, ContentLayout, DataCard, StatusPill } from "@/components/titan";
import { TimelinePanel } from "@/components/TimelinePanel";
import { getDisplayOrderNumber } from "@/lib/orderUtils";
import { cn, formatPhoneForDisplay, phoneToTelHref } from "@/lib/utils";
// TitanOS State Architecture
import { OrderStatusPillSelector } from "@/components/OrderStatusPillSelector";
import { 
  CompleteProductionButton, 
  CloseOrderButton, 
  ReopenOrderButton 
} from "@/components/StateTransitionButtons";
import type { OrderState } from "@/hooks/useOrderState";
import { isTerminalState as checkIfTerminalState } from "@/hooks/useOrderState";

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
  paymentStatus?: string;
  routingTarget?: string | null;
};

type OrderDetailOrder = HookOrderWithRelations & OrderAddressSnapshotFields;
type OrderDetailLineItem = HookOrderWithRelations["lineItems"][number];

const fulfillmentMethods = ["pickup", "ship", "deliver"] as const;
type FulfillmentMethod = (typeof fulfillmentMethods)[number];
const isFulfillmentMethod = (value: string): value is FulfillmentMethod =>
  fulfillmentMethods.some((method) => method === value);

// Date display style for Due Date and Promised Date in the order details card
// Future: This will be configurable via organization preferences
const DATE_DISPLAY_STYLE: "short" | "numeric" = "short";

export default function OrderDetail() {
  const { user } = useAuth();
  const { preferences } = useOrgPreferences();
  const params = useParams();
  const navigate = useNavigate();
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
  const [showLineItemDialog, setShowLineItemDialog] = useState(false);
  const [editingLineItem, setEditingLineItem] = useState<(OrderDetailLineItem & { product: any; productVariant?: any }) | null>(null);
  const [lineItemToDelete, setLineItemToDelete] = useState<string | null>(null);

  // Order flags (stored in orders.label as comma-separated values)
  const [flags, setFlags] = useState<string[]>([]);
  const [flagInput, setFlagInput] = useState("");
  const flagInputRef = useRef<HTMLInputElement | null>(null);
  
  // Inline price editing state
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [editingPriceType, setEditingPriceType] = useState<'unit' | 'total' | null>(null);
  const [tempPrice, setTempPrice] = useState("");
  
  // Inline status editing state
  const [editingStatusItemId, setEditingStatusItemId] = useState<string | null>(null);
  const [tempStatus, setTempStatus] = useState("");

  // Fulfillment state
  const [showShipmentForm, setShowShipmentForm] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [showPackingSlipModal, setShowPackingSlipModal] = useState(false);
  const [shipmentToDelete, setShipmentToDelete] = useState<string | null>(null);
  
  // Status transition confirmation state
  const [pendingStatusTransition, setPendingStatusTransition] = useState<{ toStatus: string; requiresReason: boolean } | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  
  // Per-section edit states (replaces global editMode)
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [isEditingFulfillment, setIsEditingFulfillment] = useState(false);
  const [isShipToAutofillOpen, setIsShipToAutofillOpen] = useState(false);
  const [shipToAutofillQuery, setShipToAutofillQuery] = useState("");
  const [shipToAutofillDebounced, setShipToAutofillDebounced] = useState("");

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

  const [showCustomerAddress, setShowCustomerAddress] = useState(true);

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
  const order = orderRaw as OrderDetailOrder | undefined;
  const deleteOrder = useDeleteOrder();
  const updateOrder = useUpdateOrder(orderId!);
  const transitionStatus = useTransitionOrderStatus(orderId!);
  const updateLineItem = useUpdateOrderLineItem(orderId!);
  const updateLineItemStatus = useUpdateOrderLineItemStatus(orderId!);
  const bulkUpdateLineItemStatus = useBulkUpdateOrderLineItemStatus(orderId!);
  const createLineItem = useCreateOrderLineItem(orderId!);
  const deleteLineItem = useDeleteOrderLineItem(orderId!);

  // Fulfillment hooks
  const { data: shipments = [] } = useShipments(orderId!);
  const deleteShipmentMutation = useDeleteShipment(orderId!);
  const updateShipmentMutation = useUpdateShipment(orderId!);
  const generatePackingSlip = useGeneratePackingSlip(orderId!);
  const updateFulfillmentStatus = useUpdateFulfillmentStatus(orderId!);

  // Check if user is admin or owner
  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';
  const isManagerOrHigher = isAdminOrOwner || user?.role === 'manager';
  
  // Check editability based on order status
  const canEditLineItems = order ? areLineItemsEditable(order.status) : false;
  const baseCanEditOrder = order ? isOrderEditable(order.status) : false;
  const allowedNextStatuses = order ? getAllowedNextStatuses(order.status) : [];
  const isTerminal = allowedNextStatuses.length === 0;
  
  // Admin/Owner override: allow editing terminal orders if setting enabled
  const allowCompletedOrderEdits = preferences?.orders?.allowCompletedOrderEdits || false;
  const requireLineItemsDone = (preferences?.orders?.requireAllLineItemsDoneToComplete
    ?? preferences?.orders?.requireLineItemsDoneToComplete
    ?? true); // Default strict
  const canEditOrder = baseCanEditOrder || (isTerminal && isAdminOrOwner && allowCompletedOrderEdits);
  
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
    void updateOrder.mutateAsync({ shippingMethod: value });
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

  const exitAllEditModes = () => {
    setIsEditingCustomer(false);
    setIsEditingContact(false);
    setIsEditingFulfillment(false);
  };

  // Calculate incomplete line items for completion workflow
  const incompleteLi = order?.lineItems?.filter(li => li.status !== 'done' && li.status !== 'canceled') || [];

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

  // Customer change mutation
  const changeCustomerMutation = useMutation({
    mutationFn: async (customerId: string) => {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }), // Backend will auto-set contact to primary
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update customer");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
      toast({
        title: "Success",
        description: "Customer updated successfully",
      });
      setIsCustomerPickerOpen(false);
      exitAllEditModes(); // Exit edit mode after successful update
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Contact change mutation
  const changeContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update contact");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
      toast({
        title: "Success",
        description: "Contact updated successfully",
      });
      setIsContactPickerOpen(false);
      exitAllEditModes(); // Exit edit mode after successful update
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

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
      setPendingStatusTransition({ toStatus: newStatus, requiresReason: true });
      return;
    }
    
    if (newStatus === 'completed') {
      // Check if there are incomplete line items and strict mode is enabled
      if (requireLineItemsDone && incompleteLi.length > 0) {
        // Show dialog offering to mark items done
        setPendingStatusTransition({ toStatus: newStatus, requiresReason: false });
        return;
      }
      // If not strict OR all items done, show regular confirmation
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
      // If completing and there are incomplete items in strict mode, mark them done first
      if (pendingStatusTransition.toStatus === 'completed' && requireLineItemsDone && incompleteLi.length > 0) {
        // Mark all incomplete items as done
        await bulkUpdateLineItemStatus.mutateAsync({ status: 'done' });
        
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

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await updateOrder.mutateAsync({ priority: newPriority });
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleDueDateEdit = () => {
    setTempDueDate(order?.dueDate ? format(new Date(order.dueDate), 'yyyy-MM-dd') : '');
    setEditingDueDate(true);
  };

  const handleDueDateSave = async () => {
    try {
      // Convert string to Date or null
      const dateValue = tempDueDate ? new Date(tempDueDate) : null;
      await updateOrder.mutateAsync({ dueDate: dateValue });
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
    setTempPromisedDate(order?.promisedDate ? format(new Date(order.promisedDate), 'yyyy-MM-dd') : '');
    setEditingPromisedDate(true);
  };

  const handlePromisedDateSave = async () => {
    try {
      // Convert string to Date or null
      const dateValue = tempPromisedDate ? new Date(tempPromisedDate) : null;
      await updateOrder.mutateAsync({ promisedDate: dateValue });
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
    setFlags(parseFlagsFromLabel(order?.label ?? null));
  }, [order?.label]);

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

      try {
        await updateOrder.mutateAsync({ label: formatFlagsToLabel(next) });
      } catch {
        // Error toast handled by mutation
        setFlags(parseFlagsFromLabel(order?.label ?? null));
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
        try {
          await updateOrder.mutateAsync({ label: formatFlagsToLabel(next) });
        } catch {
          // Error toast handled by mutation
          setFlags(parseFlagsFromLabel(order?.label ?? null));
        }
      })();
    }
  };

  const removeFlag = (flag: string) => {
    void (async () => {
      const next = flags.filter((f) => f !== flag);
      setFlags(next);
      try {
        await updateOrder.mutateAsync({ label: formatFlagsToLabel(next) });
      } catch {
        // Error toast handled by mutation
        setFlags(parseFlagsFromLabel(order?.label ?? null));
      }
    })();
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
      await updateOrder.mutateAsync(payload);
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const autofillShipToFromCustomer = async (customer: CustomerWithContacts) => {
    const payload: ShipToUpdatePayload = {
      shipToCompany: customer.companyName || null,
      shipToAddress1: customer.shippingStreet1 || null,
      shipToAddress2: customer.shippingStreet2 || null,
      shipToCity: customer.shippingCity || null,
      shipToState: customer.shippingState || null,
      shipToPostalCode: customer.shippingPostalCode || null,
      shipToCountry: customer.shippingCountry || null,
    };

    if (customer.email) {
      payload.shipToEmail = customer.email;
    }
    if (customer.phone) {
      payload.shipToPhone = customer.phone;
    }

    await saveShipTo(payload);
  };

  const handleAddLineItem = () => {
    setEditingLineItem(null);
    setShowLineItemDialog(true);
  };

  const handleEditLineItem = (lineItem: OrderDetailLineItem & { product: any; productVariant?: any }) => {
    console.log("handleEditLineItem called with:", lineItem);
    console.log("productVariantId:", lineItem.productVariantId, "Type:", typeof lineItem.productVariantId);
    setEditingLineItem(lineItem);
    setShowLineItemDialog(true);
  };

  const handleDeleteLineItem = async (lineItemId: string) => {
    try {
      await deleteLineItem.mutateAsync(lineItemId);
      setLineItemToDelete(null);
      
      // Recalculate order totals
      await recalculateOrderTotals();
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleSaveLineItem = async (data: any) => {
    if (editingLineItem) {
      // Edit existing
      await updateLineItem.mutateAsync({ id: editingLineItem.id, data });
    } else {
      // Create new
      await createLineItem.mutateAsync(data);
    }
    
    // Recalculate order totals
    await recalculateOrderTotals();
  };

  const recalculateOrderTotals = async () => {
    if (!order) return;
    
    // Fetch fresh order data
    const response = await fetch(`/api/orders/${orderId}`, { credentials: "include" });
    if (!response.ok) return;
    const freshOrder = await response.json();
    
    // Calculate new totals from line items
    const subtotal = freshOrder.lineItems.reduce((sum: number, item: any) => {
      return sum + parseFloat(item.totalPrice);
    }, 0);
    
    const discount = parseFloat(freshOrder.discount) || 0;
    const tax = parseFloat(freshOrder.tax) || 0;
    const total = subtotal - discount + tax;
    
    // Update order totals
    await updateOrder.mutateAsync({
      subtotal: subtotal.toFixed(2),
      total: total.toFixed(2),
    });
  };

  // Inline price editing handlers
  const handleEditPrice = (itemId: string, priceType: 'unit' | 'total', currentValue: string) => {
    if (!canEditLineItems) return; // Block price edits when not in 'new' status
    setEditingPriceItemId(itemId);
    setEditingPriceType(priceType);
    setTempPrice(currentValue);
  };

  const handleSavePrice = async (item: OrderDetailLineItem) => {
    if (!tempPrice || !editingPriceType) return;

    try {
      const newPrice = parseFloat(tempPrice);
      if (isNaN(newPrice) || newPrice < 0) {
        toast({
          title: "Invalid Price",
          description: "Please enter a valid price",
          variant: "destructive",
        });
        return;
      }

      let unitPrice: number;
      let totalPrice: number;

      if (editingPriceType === 'unit') {
        // User edited unit price, recalculate total
        unitPrice = newPrice;
        totalPrice = unitPrice * item.quantity;
      } else {
        // User edited total, recalculate unit price
        totalPrice = newPrice;
        unitPrice = totalPrice / item.quantity;
      }

      await updateLineItem.mutateAsync({
        id: item.id,
        data: {
          unitPrice: unitPrice.toFixed(2),
          totalPrice: totalPrice.toFixed(2),
        },
      });

      // Recalculate order totals
      await recalculateOrderTotals();

      setEditingPriceItemId(null);
      setEditingPriceType(null);
      setTempPrice("");
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleCancelPrice = () => {
    setEditingPriceItemId(null);
    setEditingPriceType(null);
    setTempPrice("");
  };

  // Inline status editing handlers
  const handleEditStatus = (itemId: string, currentStatus: string) => {
    setEditingStatusItemId(itemId);
    setTempStatus(currentStatus);
  };

  const handleSaveStatus = async (itemId: string) => {
    if (!tempStatus) return;

    try {
      await updateLineItemStatus.mutateAsync({
        lineItemId: itemId,
        status: tempStatus,
      });

      setEditingStatusItemId(null);
      setTempStatus("");
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleCancelStatus = () => {
    setEditingStatusItemId(null);
    setTempStatus("");
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
      await generatePackingSlip.mutateAsync();
      setShowPackingSlipModal(true);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to generate packing slip", 
        variant: "destructive" 
      });
    }
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
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-titan-accent"></div>
            <span className="text-titan-text-secondary">Loading order...</span>
          </div>
        </div>
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
    <Page>
      <div className="flex items-center justify-between mb-6 pb-3">
        <div className="flex items-center gap-4 min-w-0">
          <Link to="/orders">
            <Button
              variant="ghost"
              size="sm"
              className="text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>

          <div className="flex flex-col justify-center min-w-0">
            <h1 className="text-titan-xl font-semibold tracking-tight text-titan-text-primary">
              {`Order ${titleText}`}
            </h1>
            <p className="text-titan-sm text-titan-text-muted mt-1">
              {`Created ${formatDate(order.createdAt)}`}
            </p>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-4">
          <OrderStatusPillSelector
            orderId={order.id}
            currentState={order.state as OrderState}
            currentPillValue={order.statusPillValue}
            disabled={checkIfTerminalState(order.state as OrderState) && !canEditOrder}
            className="h-10 w-[260px] rounded-full text-base"
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Mark Completed Button */}
          {isAdminOrOwner && !isTerminal && allowedNextStatuses.includes('completed') && (
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                // If strict mode and incomplete items, show dialog
                if (requireLineItemsDone && incompleteLi.length > 0) {
                  setPendingStatusTransition({ toStatus: 'completed', requiresReason: false });
                  return;
                }
                // Otherwise show regular confirmation
                setPendingStatusTransition({ toStatus: 'completed', requiresReason: false });
              }}
              disabled={transitionStatus.isPending}
              className="rounded-titan-md bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="w-4 h-4 mr-2" />
              Mark Completed
            </Button>
          )}

          {isAdminOrOwner && order.state === 'open' && (
            <CompleteProductionButton orderId={order.id} />
          )}
        </div>
      </div>

      <ContentLayout>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-4">
            {isSameBillShipAddress ? (
              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column: Customer Information */}
                    <div className="space-y-2">
                      {isEditingCustomer ? (
                        <div className="space-y-2">
                          <Popover open={isCustomerPickerOpen} onOpenChange={(open) => {
                            setIsCustomerPickerOpen(open);
                            if (!open) exitAllEditModes();
                          }}>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={isCustomerPickerOpen}
                                className="w-full justify-between font-normal h-9"
                              >
                                <span className="truncate">
                                  {customerCompanyName || "Select customer..."}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0" align="start">
                              <Command shouldFilter={true}>
                                <CommandInput placeholder="Search customers..." autoFocus />
                                <CommandList>
                                  <CommandEmpty>No customers found.</CommandEmpty>
                                  {customers.map((customer: any) => {
                                    const searchValue = [customer.companyName, customer.email].filter(Boolean).join(' ');
                                    return (
                                      <CommandItem
                                        key={customer.id}
                                        value={searchValue}
                                        onSelect={() => {
                                          changeCustomerMutation.mutate(customer.id);
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
                            {order.customer?.id && customerCompanyName ? (
                              <Link
                                to={`/customers/${order.customer.id}`}
                                className="block truncate text-sm font-semibold leading-5 text-foreground hover:underline"
                                title={customerCompanyName}
                              >
                                {customerCompanyName}
                              </Link>
                            ) : (
                              <div className="block truncate text-sm font-semibold leading-5 text-foreground">
                                {customerCompanyName || '—'}
                              </div>
                            )}
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

                    {/* Right Column: Contact Information */}
                    <div className="space-y-2">
                      {isEditingContact ? (
                        <div className="space-y-2">
                          <Popover open={isContactPickerOpen} onOpenChange={(open) => {
                            setIsContactPickerOpen(open);
                            if (!open) exitAllEditModes();
                          }}>
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
                                    {!order?.customerId 
                                      ? "Select a customer first" 
                                      : "No contacts found."}
                                  </CommandEmpty>
                                  {filteredContacts.map((contact: any) => {
                                    const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
                                    return (
                                      <CommandItem
                                        key={contact.id}
                                        value={contactName}
                                        onSelect={() => {
                                          changeContactMutation.mutate(contact.id);
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
                            <Link
                              to={`/contacts/${order.contact.id}`}
                              className="text-sm font-semibold text-foreground hover:underline flex-1 min-w-0 truncate"
                              title={contactNameFromContact}
                            >
                              {contactNameFromContact}
                            </Link>
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
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column: Customer Information */}
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="min-w-0 flex-1">
                          {order.customer?.id && customerCompanyName ? (
                            <Link
                              to={`/customers/${order.customer.id}`}
                              className="block truncate text-sm font-semibold leading-5 text-foreground hover:underline"
                              title={customerCompanyName}
                            >
                              {customerCompanyName}
                            </Link>
                          ) : (
                            <div className="block truncate text-sm font-semibold leading-5 text-foreground">
                              {customerCompanyName || order.billToCompany || '—'}
                            </div>
                          )}
                        </div>
                        {canEditOrder && !isEditingCustomer && (
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
                        {isEditingCustomer && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 text-xs"
                            onClick={exitAllEditModes}
                          >
                            Done
                          </Button>
                        )}
                      </div>

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

                    {/* Right Column: Contact Information */}
                    <div className="space-y-2">
                      {isEditingContact ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>Contact</Label>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 shrink-0 text-xs"
                              onClick={exitAllEditModes}
                            >
                              Done
                            </Button>
                          </div>
                          <Popover open={isContactPickerOpen} onOpenChange={setIsContactPickerOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={isContactPickerOpen}
                                className="w-full justify-between"
                                disabled={!order?.customerId}
                              >
                                {!order?.customerId
                                  ? "Select a customer first"
                                  : order.contact?.id && contactNameFromContact
                                  ? contactNameFromContact
                                  : "Select contact..."}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-full p-0" align="start">
                              <Command shouldFilter={false}>
                                <CommandInput 
                                  placeholder="Search contacts..." 
                                  value={contactSearchQuery}
                                  onValueChange={setContactSearchQuery}
                                  autoFocus
                                />
                                <CommandList>
                                  <CommandEmpty>
                                    {!order?.customerId
                                      ? "Select a customer first"
                                      : "No contacts found."}
                                  </CommandEmpty>
                                  {filteredContacts.map((contact: any) => (
                                    <CommandItem
                                      key={contact.id}
                                      onSelect={() => {
                                        changeContactMutation.mutate(contact.id);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          order.contact?.id === contact.id
                                            ? "opacity-100"
                                            : "opacity-0"
                                        )}
                                      />
                                      {contact.firstName && contact.lastName
                                        ? `${contact.firstName} ${contact.lastName}`
                                        : contact.email || contact.id}
                                    </CommandItem>
                                  ))}
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>
                      ) : order.contact?.id && contactNameFromContact ? (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <Link
                              to={`/contacts/${order.contact.id}`}
                              className="text-sm font-semibold text-foreground hover:underline flex-1 min-w-0 truncate"
                              title={contactNameFromContact}
                            >
                              {contactNameFromContact}
                            </Link>
                            {canEditOrder && !isEditingContact && (
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
                      ) : canEditOrder ? (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">—</span>
                          {!isEditingContact && (
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
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Order Details */}
            <Card className="bg-titan-bg-card border-titan-border-subtle">
              <CardContent className="space-y-4">
                {/* TitanOS State Architecture */}
                {(showPaymentStatus || showRoutedTo) && (
                  <div className={cn(
                    "grid grid-cols-1 gap-4 p-4 bg-muted/50 rounded-lg border border-border",
                    showPaymentStatus && showRoutedTo ? "md:grid-cols-2" : "md:grid-cols-1"
                  )}>
                    {showPaymentStatus && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Payment</label>
                        <div className="mt-2">
                          <Badge variant="outline" className={
                            order.paymentStatus === 'paid' 
                              ? 'bg-green-100 text-green-800 border-green-300'
                              : order.paymentStatus === 'partial'
                              ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                              : 'bg-gray-100 text-gray-800 border-gray-300'
                          }>
                            {order.paymentStatus === 'paid' && 'Paid'}
                            {order.paymentStatus === 'partial' && 'Partial'}
                            {order.paymentStatus === 'unpaid' && 'Unpaid'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Payment status
                        </p>
                      </div>
                    )}
                    
                    {showRoutedTo && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Routed To</label>
                        <div className="mt-2">
                          <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-300">
                            {order.routingTarget === 'fulfillment' ? 'Fulfillment' : 'Invoicing'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Next workflow stage
                        </p>
                      </div>
                    )}
                  </div>
                )}
                
                {/* State Transition Actions */}
                {isAdminOrOwner && (
                  <div className="flex gap-2 flex-wrap">
                    {order.state === 'production_complete' && (
                      <CloseOrderButton orderId={order.id} />
                    )}
                    
                    {order.state === 'closed' && (
                      <ReopenOrderButton orderId={order.id} />
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                        <div className="text-sm whitespace-nowrap">{formatDate(order.dueDate)}</div>
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
                        <div className="text-sm whitespace-nowrap">{formatDate(order.promisedDate)}</div>
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

                      {!canEditOrder || updateOrder.isPending ? (
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

                {order.notesInternal && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Internal Notes</label>
                    <div className="mt-1 text-sm p-3 bg-muted rounded-md whitespace-pre-wrap">
                      {order.notesInternal}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Line Items */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg font-medium">
                      Order Items
                      {!canEditLineItems && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          Locked
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription>{order.lineItems.length} items</CardDescription>
                  </div>
                  {isAdminOrOwner && canEditLineItems && (
                    <Button onClick={handleAddLineItem} size="sm">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Item
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Specs</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      {isAdminOrOwner && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.lineItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{item.product.name}</div>
                            {item.productVariant && (
                              <div className="text-xs text-muted-foreground">
                                {item.productVariant.name}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {item.width && item.height ? (
                              <div>{item.width}" × {item.height}"</div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                            {item.sqft && (
                              <div className="text-xs text-muted-foreground">
                                {parseFloat(item.sqft).toFixed(2)} sq ft
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{item.quantity.toLocaleString()}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {isAdminOrOwner && editingStatusItemId === item.id ? (
                            <div className="flex items-center gap-1">
                              <Select value={tempStatus} onValueChange={setTempStatus}>
                                <SelectTrigger className="h-8 w-[120px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="queued">Queued</SelectItem>
                                  <SelectItem value="printing">Printing</SelectItem>
                                  <SelectItem value="finishing">Finishing</SelectItem>
                                  <SelectItem value="done">Done</SelectItem>
                                  <SelectItem value="canceled">Canceled</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleSaveStatus(item.id)}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleCancelStatus}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div 
                              className={cn(
                                "inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors",
                                isAdminOrOwner && "cursor-pointer hover:bg-accent/50 hover:ring-1 hover:ring-border"
                              )}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (isAdminOrOwner) {
                                  handleEditStatus(item.id, item.status);
                                }
                              }}
                            >
                              <LineItemStatusBadge status={item.status} className="font-medium" />
                              {isAdminOrOwner && (
                                <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isAdminOrOwner && editingPriceItemId === item.id && editingPriceType === 'unit' ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={tempPrice}
                                onChange={(e) => setTempPrice(e.target.value)}
                                className="h-7 w-24 text-right"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSavePrice(item);
                                  if (e.key === 'Escape') handleCancelPrice();
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleSavePrice(item)}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleCancelPrice}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div 
                              className={isAdminOrOwner ? "cursor-pointer hover:bg-muted/50 px-2 py-1 rounded" : ""}
                              onClick={() => isAdminOrOwner && handleEditPrice(item.id, 'unit', item.unitPrice)}
                            >
                              {formatCurrency(item.unitPrice)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {isAdminOrOwner && editingPriceItemId === item.id && editingPriceType === 'total' ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={tempPrice}
                                onChange={(e) => setTempPrice(e.target.value)}
                                className="h-7 w-24 text-right"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSavePrice(item);
                                  if (e.key === 'Escape') handleCancelPrice();
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleSavePrice(item)}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleCancelPrice}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div 
                              className={isAdminOrOwner ? "cursor-pointer hover:bg-muted/50 px-2 py-1 rounded" : ""}
                              onClick={() => isAdminOrOwner && handleEditPrice(item.id, 'total', item.totalPrice)}
                            >
                              {formatCurrency(item.totalPrice)}
                            </div>
                          )}
                        </TableCell>
                        {isAdminOrOwner && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleEditLineItem(item)}
                                disabled={!canEditLineItems}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setLineItemToDelete(item.id)}
                                disabled={!canEditLineItems}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Separator className="my-4" />

                {/* Totals */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(order.subtotal)}</span>
                  </div>
                  {parseFloat(order.discount) > 0 && (
                    <div className="flex justify-between text-sm text-red-500">
                      <span>Discount</span>
                      <span>-{formatCurrency(order.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span>{formatCurrency(order.tax)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span>{formatCurrency(order.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
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
                          void updateOrder.mutateAsync({ shippingInstructions: nextValue });
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      {/* Ship To (order-level blind shipping) */}
                      <div className="space-y-3">
                        <div className="text-sm font-medium">Ship To</div>

                        {isEditingFulfillment && (
                          <div className="flex items-center gap-2">
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

                      {/* Packing Slip */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Packing Slip</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleGeneratePackingSlip}
                          disabled={generatePackingSlip.isPending}
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          {generatePackingSlip.isPending ? "Generating..." : "Generate & View"}
                        </Button>
                      </div>

                      {/* Manual Status Override (Manager+) */}
                      {isManagerOrHigher && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Manual Status Override</label>
                          <Select
                            value={order.fulfillmentStatus || "pending"}
                            onValueChange={(value) => handleFulfillmentStatusChange(value as any)}
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
                                        {shipment.carrier}
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
                                      {shipment.carrier !== "Other" && shipment.trackingNumber && (
                                        <a
                                          href={getTrackingUrl(shipment.carrier, shipment.trackingNumber)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-primary hover:underline"
                                        >
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Shipped: {format(new Date(shipment.shippedAt), "MMM d, yyyy h:mm a")}
                                    </div>
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

            {/* Attachments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-medium">Attachments</CardTitle>
                <CardDescription>
                  Add POs, instructions, shipping docs, etc.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OrderAttachmentsPanel orderId={order.id} locked={false} />
              </CardContent>
            </Card>

            {/* Source Quote */}
            {order.quote && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Source Quote</CardTitle>
                </CardHeader>
                <CardContent>
                  <Link to={`/quotes/${order.quoteId}`}>
                    <Button variant="outline" size="sm" className="w-full text-titan-accent hover:text-titan-accent-hover">
                      View Quote #{order.quote.quoteNumber}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="py-4 px-6">
                <div className="flex items-center justify-between">
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

      {/* Delete Line Item Confirmation Dialog */}
      <AlertDialog open={!!lineItemToDelete} onOpenChange={() => setLineItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Line Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this line item? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => lineItemToDelete && handleDeleteLineItem(lineItemToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Line Item Add/Edit Dialog */}
      <OrderLineItemDialog
        open={showLineItemDialog}
        onOpenChange={setShowLineItemDialog}
        lineItem={editingLineItem ? {
          ...editingLineItem,
          productVariantId: editingLineItem.productVariantId,
          product: editingLineItem.product,
          productVariant: editingLineItem.productVariant,
        } : undefined}
        orderId={orderId!}
        onSave={handleSaveLineItem}
        mode={editingLineItem ? "edit" : "add"}
      />

      {/* Shipment Form Dialog */}
      <ShipmentForm
        open={showShipmentForm}
        onOpenChange={setShowShipmentForm}
        orderId={orderId!}
        shipment={editingShipment || undefined}
        mode={editingShipment ? "edit" : "create"}
      />

      {/* Packing Slip Modal */}
      {order.packingSlipHtml && (
        <PackingSlipModal
          open={showPackingSlipModal}
          onOpenChange={setShowPackingSlipModal}
          packingSlipHtml={order.packingSlipHtml}
        />
      )}

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
                      <strong>{incompleteLi.length} line item(s)</strong> aren't marked Done yet. 
                      Do you want to mark them as Done and complete this order?
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
                    ? 'Mark Done & Complete' 
                    : 'Complete Order'
                  )
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
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
