import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow, format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CustomerForm from "@/components/customer-form";
import ContactForm from "@/components/contact-form";
import { CustomerIdentityBlock } from "./CustomerIdentityBlock";
import { CustomerActionsMenu } from "./CustomerActionsMenu";
import TransactionsTab from "./TransactionsTab";
import StatementTabComponent from "./StatementTab";
import {
  Building2,
  Mail,
  Phone,
  MapPin,
  FolderOpen,
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  Clock,
  Star,
  Briefcase,
  AlertTriangle,
  FileText,
  ShoppingCart,
  Search,
  Eye,
  Download,
  MoreHorizontal,
  Package,
  Edit,
  Receipt,
  Users,
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  RotateCcw,
  GripVertical,
  Settings2,
  Plus,
  Link2,
  UserCheck,
  UserMinus,
  Contact2,
  Loader2,
  Save,
  Filter,
  Check,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useCustomer, type CustomerWithRelations } from "@/hooks/useCustomer";
import { useAuth } from "@/hooks/useAuth";
import { documentNumberMatchesSearch, resolveDocumentDisplayNumber } from "@shared/documentNumbering";
import { useOrders, type Order } from "@/hooks/useOrders";
import { useApproveInvoicesForAccounting, useInvoices, useInvoicesPage, type InvoiceListItem } from "@/hooks/useInvoices";
import { useTableColumnConfig, type ColumnConfig } from "@/hooks/useTableColumnConfig";
import {
  CUSTOMER_INVOICE_SORT_FIELDS,
  DEFAULT_CUSTOMER_INVOICE_TABLE_SORT,
  clearCustomerInvoiceTableSortPreference,
  customerInvoiceSortApiField,
  persistCustomerInvoiceTableSortPreference,
  readCustomerInvoiceTableSortPreference,
  type CustomerInvoiceSortField,
  type CustomerInvoiceTableSortPreference,
} from "@/lib/customerInvoiceTablePreferences";
import { ROUTES } from "@/config/routes";
import { cn } from "@/lib/utils";
import BackNavControls from "@/components/BackNavControls";
import { ContactFlagPill } from "@/components/ContactFlagPill";
import { apiRequest } from "@/lib/queryClient";
import { InvoiceSendQuickAction } from "@/components/invoices/InvoiceSendQuickAction";
import { canCloseJobOverride, CloseJobOverrideDialog, getOrderJobStatus, type CloseJobOverrideTarget } from "@/components/orders/CloseJobOverrideDialog";
import {
  buildLinkExistingContactPayload,
  canSubmitLinkContact,
  getContactMoveConfirmationState,
  normalizeContactPickerResult,
  type NormalizedContactPickerResult,
} from "./contactLinkingUi";
import { InvoiceRecipientContactControl } from "./InvoiceRecipientContactControl";

// ============================================================
// TYPE DEFINITIONS
// ============================================================

type TabType = "orders" | "quotes" | "invoices" | "transactions" | "statement";
type TimePeriod = "month" | "year" | "all";
type LayoutMode = "full" | "embedded";

interface EnhancedCustomerViewProps {
  customerId: string;
  layoutMode?: LayoutMode;
  onBack?: () => void;
  onSectionHome?: () => void;
  notFoundFallback?: ReactNode;
}

interface CustomerActivitySummary {
  openOrderCount: number;
  lastOrderDate: string | null;
  overdueInvoiceCount: number;
  lastInvoiceDate: string | null;
  lastPaymentDate: string | null;
  recentPortalProfileUpdate?: {
    updatedAt: string;
    updatedBy: string | null;
    fieldCount: number;
  } | null;
}

interface CustomerHeaderProps {
  customer: CustomerWithRelations;
  layoutMode: LayoutMode;
  onBack?: () => void;
  onSectionHome?: () => void;
  onSwitchTab?: (tab: string) => void;
  activitySummary?: CustomerActivitySummary | null;
}

// duplicate removed — kept for back-compat during merge

interface StatCardConfig {
  key: string;
  label: string;
  value: string | number;
  trend?: number | null;
  trendType?: "up" | "down";
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  highlight?: boolean;
  subtext?: string;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num || 0);
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "MMM d, yyyy");
  } catch {
    return "-";
  }
}

function getStatusStyle(status: string): string {
  const s = (status || "").toLowerCase().replace(/_/g, "");
  switch (s) {
    case "completed":
    case "paid":
      return "bg-titan-success-bg text-titan-success border-titan-success/30";
    case "inproduction":
    case "new":
    case "scheduled":
    case "sent":
      return "bg-titan-accent/15 text-titan-accent border-titan-accent/30";
    case "shipped":
    case "delivered":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "readyforpickup":
      return "bg-teal-500/15 text-teal-400 border-teal-500/30";
    case "onhold":
    case "pending":
    case "draft":
    case "pendingapproval":
      return "bg-titan-warning-bg text-titan-warning border-titan-warning/30";
    case "canceled":
    case "rejected":
    case "overdue":
      return "bg-titan-error-bg text-titan-error border-titan-error/30";
    default:
      return "bg-titan-bg-card-elevated text-titan-text-secondary border-titan-border-subtle";
  }
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function CustomerHeader({
  customer,
  layoutMode,
  onBack,
  onSectionHome,
  onSwitchTab,
  activitySummary,
}: CustomerHeaderProps) {
  const [showEditForm, setShowEditForm] = useState(false);
  const [showLocalStorageDialog, setShowLocalStorageDialog] = useState(false);
  const [localCompanyFolderPath, setLocalCompanyFolderPath] = useState(customer.localCompanyFolderPath ?? "");
  const primaryContact = customer.contacts?.find((c) => c.isPrimary) || customer.contacts?.[0];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const cityState = useMemo(() => {
    const parts = [customer.shippingCity, customer.shippingState]
      .filter(Boolean)
      .join(", ");
    return parts || null;
  }, [customer]);

  const isEmbedded = layoutMode === "embedded";
  const normalizedSavedPath = (customer.localCompanyFolderPath ?? "").trim();
  const normalizedDraftPath = localCompanyFolderPath.trim();
  const hasPathChanges = normalizedDraftPath !== normalizedSavedPath;
  const hasLocalStoragePath = normalizedSavedPath.length > 0;
  
  // Generate account number display (show first 12 chars of ID, or hide if empty/null)
  const accountNumber = customer.id ? customer.id.slice(0, 12).toUpperCase() : null;

  useEffect(() => {
    setLocalCompanyFolderPath(customer.localCompanyFolderPath ?? "");
  }, [customer.id, customer.localCompanyFolderPath]);

  const updateLocalCompanyFolderPathMutation = useMutation({
    mutationFn: async (path: string) => {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          localCompanyFolderPath: path.length > 0 ? path : null,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to update local company folder path");
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customer.id}`] });
      setShowLocalStorageDialog(false);
      toast({
        title: "Saved",
        description: "Customer production folder reference updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSaveLocalCompanyFolderPath = async () => {
    await updateLocalCompanyFolderPathMutation.mutateAsync(normalizedDraftPath);
  };

  const previewCustomerPortalMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/portal/preview/start", {
        customerId: customer.id,
        returnTo: `${window.location.pathname}${window.location.search}`,
      });
      return response.json() as Promise<{ success: boolean; data?: { redirectTo?: string } }>;
    },
    onSuccess: (payload) => {
      window.location.href = payload.data?.redirectTo || "/portal?preview=1";
    },
    onError: (error: Error) => {
      toast({
        title: "Preview unavailable",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className={cn(
      "bg-titan-bg-card border border-titan-border-subtle shadow-titan-card",
      isEmbedded ? "rounded-titan-lg px-3 py-2" : "rounded-titan-xl px-4 py-2.5"
    )}>
      <div className="flex items-center justify-between gap-4">
        {/* LEFT: Company & Contact Info */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          {layoutMode === "full" && (
            <BackNavControls
              onBack={() => (onBack ? onBack() : navigate(ROUTES.customers.list))}
              onSectionHome={() => (onSectionHome ? onSectionHome() : navigate(ROUTES.customers.list))}
              sectionLabel="Customers"
              className="flex-shrink-0"
            />
          )}

          <CustomerIdentityBlock
            customer={customer}
            mode={isEmbedded ? "compact" : "full"}
            showAccountNumber={isEmbedded}
          />

          {/* Legacy dead-code path kept for reference — no longer rendered */}
          {false && (
            <div className="flex items-center gap-2.5 mt-0.5 text-[11px] text-titan-text-muted flex-wrap">
              {(primaryContact?.email || customer.email) && (
                <a
                  href={`mailto:${primaryContact?.email || customer.email}`}
                  className="flex items-center gap-1 hover:text-titan-accent transition-colors"
                >
                  <Mail className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate max-w-[160px]">{primaryContact?.email || customer.email}</span>
                </a>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Financial Tags + Actions - all inline */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Financial Info Pills - horizontal */}
          <div className="flex items-center gap-3">
            {/* Account Number - only show if exists and not embedded */}
            {!isEmbedded && accountNumber && (
              <div className="text-right">
                <div className="text-[9px] text-titan-text-muted uppercase tracking-wide">Acct</div>
                <div className="text-[11px] font-semibold text-titan-text-primary">{accountNumber}</div>
              </div>
            )}
            
            {/* Credit Limit */}
            <div className="text-right">
              <div className="text-[9px] text-titan-text-muted uppercase tracking-wide">Limit</div>
              <div className="text-[11px] font-semibold text-titan-text-primary">{customer.creditLimitConfigured ? formatCurrency(customer.creditLimit) : "Not set"}</div>
            </div>
            
            {/* Invoice-derived financial exposure */}
            <div className="text-right">
              <div className="text-[9px] text-titan-text-muted uppercase tracking-wide">Outstanding A/R</div>
              <div className="text-[11px] font-semibold text-titan-success">{formatCurrency(customer.outstandingAr ?? "0")}</div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-titan-text-muted uppercase tracking-wide">Pending Billing</div>
              <div className="text-[11px] font-semibold text-titan-warning">{formatCurrency(customer.pendingBilling ?? "0")}</div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-titan-text-muted uppercase tracking-wide">Credit Exposure</div>
              <div className="text-[11px] font-semibold text-titan-text-primary">{formatCurrency(customer.creditExposure ?? "0")}</div>
            </div>
            {Number(customer.unbilledOpenOrders ?? 0) > 0 && <div className="text-right">
              <div className="text-[9px] text-titan-text-muted uppercase tracking-wide">Unbilled Orders</div>
              <div className="text-[11px] font-semibold text-titan-warning">{formatCurrency(customer.unbilledOpenOrders ?? "0")}</div>
            </div>}
            <div className="text-right">
              <div className="text-[9px] text-titan-text-muted uppercase tracking-wide">Open Work</div>
              <div className="text-[11px] font-semibold text-titan-text-primary">{formatCurrency(customer.openWork ?? "0")}</div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-titan-text-muted uppercase tracking-wide">Available</div>
              <div className={`text-[11px] font-semibold ${customer.overLimitCents ? "text-destructive" : "text-titan-success"}`}>{customer.availableCredit === null ? "—" : formatCurrency(customer.availableCredit)}</div>
            </div>
          </div>

          {customer.overLimitCents ? <div className="text-[11px] font-semibold text-destructive">OVER CREDIT LIMIT by {formatCurrency((customer.overLimitCents / 100).toFixed(2))}</div> : null}

          {/* Vertical divider */}
          <div className="w-px h-6 bg-titan-border-subtle" />

          {/* Structured Actions Menu */}
          <CustomerActionsMenu
            customerId={customer.id}
            embedded={isEmbedded}
            onEditCustomer={() => setShowEditForm(true)}
            onLocalStorage={!isEmbedded ? () => setShowLocalStorageDialog(true) : undefined}
            onSwitchTab={onSwitchTab}
          />
          {!isEmbedded && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => previewCustomerPortalMutation.mutate()}
              disabled={previewCustomerPortalMutation.isPending}
              className="h-8"
            >
              {previewCustomerPortalMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="mr-1.5 h-3.5 w-3.5" />
              )}
              Preview Customer Portal
            </Button>
          )}
        </div>
      </div>
      
      {/* Activity badges — only when meaningful data exists */}
      {activitySummary && (activitySummary.openOrderCount > 0 || activitySummary.overdueInvoiceCount > 0 || activitySummary.lastOrderDate || activitySummary.lastPaymentDate || activitySummary.recentPortalProfileUpdate) && (
        <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-titan-border-subtle/50 flex-wrap">
          {activitySummary.recentPortalProfileUpdate && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <UserCheck className="w-2.5 h-2.5" />
              Profile updated via portal {formatDate(activitySummary.recentPortalProfileUpdate.updatedAt)}
            </span>
          )}
          {activitySummary.openOrderCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30">
              <Briefcase className="w-2.5 h-2.5" />
              Open Jobs: {activitySummary.openOrderCount}
            </span>
          )}
          {activitySummary.overdueInvoiceCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/30">
              <AlertTriangle className="w-2.5 h-2.5" />
              Overdue: {activitySummary.overdueInvoiceCount}
            </span>
          )}
          {activitySummary.lastOrderDate && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-titan-text-secondary border border-titan-border-subtle">
              <Clock className="w-2.5 h-2.5" />
              Last Order: {formatDate(activitySummary.lastOrderDate)}
            </span>
          )}
          {activitySummary.lastPaymentDate && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-titan-text-secondary border border-titan-border-subtle">
              <DollarSign className="w-2.5 h-2.5" />
              Last Payment: {formatDate(activitySummary.lastPaymentDate)}
            </span>
          )}
        </div>
      )}

      <CustomerForm 
        open={showEditForm} 
        onOpenChange={setShowEditForm}
        customer={customer as any}
      />

      <Dialog open={showLocalStorageDialog} onOpenChange={setShowLocalStorageDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Local storage path</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="local-company-folder-path">Local company folder path</Label>
              <div className="relative">
                <FolderOpen className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-titan-text-muted" />
                <Input
                  id="local-company-folder-path"
                  value={localCompanyFolderPath}
                  onChange={(event) => setLocalCompanyFolderPath(event.target.value)}
                  placeholder="\\print-server\customers\Acme Printing"
                  className="pl-10"
                />
              </div>
              <p className="text-sm text-titan-text-muted">
                This reference is the downstream production destination for the customer. It does not control canonical upload storage.
              </p>
            </div>

            <div className="rounded-lg border border-titan-border-subtle bg-titan-bg-card-elevated/60 px-3 py-2 text-xs text-titan-text-muted">
              Status:{" "}
              <span className="font-medium text-titan-text-primary">
                {customer.customerProductionFolderReference?.status ?? (hasLocalStoragePath ? "configured" : "missing")}
              </span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLocalCompanyFolderPath(customer.localCompanyFolderPath ?? "")}
                disabled={!hasPathChanges || updateLocalCompanyFolderPathMutation.isPending}
              >
                Reset
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLocalCompanyFolderPath("")}
                disabled={normalizedDraftPath.length === 0 || updateLocalCompanyFolderPathMutation.isPending}
              >
                Clear
              </Button>
            </div>

            <Button
              type="button"
              size="sm"
              onClick={handleSaveLocalCompanyFolderPath}
              disabled={!hasPathChanges || updateLocalCompanyFolderPathMutation.isPending}
            >
              {updateLocalCompanyFolderPathMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving
                </>
              ) : (
                <>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  Save path
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// CONTACTS PANEL COMPONENT
// ============================================================

interface ContactsPanelProps {
  customer: CustomerWithRelations;
  layoutMode: LayoutMode;
}

type ContactPickerResult = NormalizedContactPickerResult;

interface LinkExistingContactResponse {
  contact: ContactPickerResult;
  fromCustomer: { id: string; companyName: string } | null;
  toCustomer: { id: string; companyName: string } | null;
  moved: boolean;
  requiresMoveConfirmation: boolean;
  setPrimary: boolean;
}

function ContactsPanel({ customer, layoutMode }: ContactsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [linkAsPrimary, setLinkAsPrimary] = useState(false);
  const [moveConfirmed, setMoveConfirmed] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<CustomerWithRelations["contacts"][0] | null>(null);
  const [editForm, setEditForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    title: "",
    isPrimary: false,
  });

  const isEmbedded = layoutMode === "embedded";
  const contacts = customer.contacts || [];
  const contactSearchTerm = contactSearch.trim();
  const contactPickerQuery = useQuery<ContactPickerResult[]>({
    queryKey: ["contacts", "link-picker", customer.id, contactSearchTerm],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "25",
        sortBy: "lastName",
        sortDir: "asc",
      });
      if (contactSearchTerm) params.set("search", contactSearchTerm);

      const response = await fetch(`/api/contacts?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to search contacts");
      const data = await response.json();
      return (Array.isArray(data.contacts) ? data.contacts : []).map(normalizeContactPickerResult);
    },
    enabled: showLinkDialog,
  });
  const linkableContacts = useMemo(
    () => (contactPickerQuery.data || []).filter((contact) => {
      const linkedCustomerIds = contact.linkedCustomers.map((linkedCustomer) => linkedCustomer.id);
      return contact.customerId !== customer.id && !linkedCustomerIds.includes(customer.id);
    }),
    [contactPickerQuery.data, customer.id],
  );
  const selectedContact = linkableContacts.find((contact) => contact.id === selectedContactId) || null;
  const selectedContactMoveState = getContactMoveConfirmationState(selectedContact, {
    id: customer.id,
    companyName: customer.companyName,
  });
  const selectedContactRequiresMoveConfirmation = selectedContactMoveState.requiresMoveConfirmation;

  const refreshCustomerContactData = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/customers/${customer.id}`] });
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
  };

  // Set primary contact mutation
  const setPrimaryMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const response = await fetch(`/api/customers/${customer.id}/contacts/${contactId}/set-primary`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to set primary contact");
      return response.json();
    },
    onSuccess: () => {
      refreshCustomerContactData();
      toast({ title: "Success", description: "Primary contact updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update contact mutation
  const updateContactMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editForm }) => {
      const response = await fetch(`/api/customer-contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update contact");
      return response.json();
    },
    onSuccess: () => {
      refreshCustomerContactData();
      setShowEditDialog(false);
      setEditingContact(null);
      toast({ title: "Success", description: "Contact updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateInvoiceRecipientMutation = useMutation({
    mutationFn: async ({ contactId, isBilling }: { contactId: string; isBilling: boolean }) => {
      const response = await fetch(`/api/customer-contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relationshipCustomerId: customer.id,
          isBilling,
        }),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to update invoice recipient");
      }
      return response.json();
    },
    onSuccess: (_result, variables) => {
      queryClient.setQueryData<CustomerWithRelations>(
        [`/api/customers/${customer.id}`],
        (current) => current ? {
          ...current,
          contacts: current.contacts.map((contact) => contact.id === variables.contactId
            ? { ...contact, isBilling: variables.isBilling }
            : contact),
        } : current,
      );
      refreshCustomerContactData();
      toast({
        title: "Invoice recipients updated",
        description: variables.isBilling
          ? "This contact will receive invoices."
          : "This contact will no longer automatically receive invoices.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to update invoice recipient", description: error.message, variant: "destructive" });
    },
  });

  // Unlink contact mutation (removes from company, doesn't delete)
  const unlinkContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const response = await fetch(`/api/customers/${customer.id}/contacts/${contactId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to unlink contact");
      return response.json();
    },
    onSuccess: () => {
      refreshCustomerContactData();
      toast({ title: "Success", description: "Contact removed from company" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const linkExistingContactMutation = useMutation({
    mutationFn: async ({
      contactId,
      setPrimary,
      confirmMove,
    }: {
      contactId: string;
      setPrimary: boolean;
      confirmMove: boolean;
    }) => {
      const response = await fetch(`/api/customers/${customer.id}/contacts/${contactId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ setPrimary, confirmMove }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to link contact");
      }

      return response.json() as Promise<LinkExistingContactResponse>;
    },
    onSuccess: (result) => {
      refreshCustomerContactData();
      if (result.fromCustomer?.id) {
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${result.fromCustomer.id}`] });
      }
      if (result.toCustomer?.id) {
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${result.toCustomer.id}`] });
      }
      const fromCompany = result.fromCustomer?.companyName;
      const toCompany = result.toCustomer?.companyName || customer.companyName;
      toast({
        title: "Contact linked",
        description: result.moved && fromCompany
          ? `Moved from ${fromCompany} to ${toCompany}${result.setPrimary ? " and set as primary" : ""}.`
          : `Linked to ${toCompany}${result.setPrimary ? " and set as primary" : ""}.`,
      });
      setShowLinkDialog(false);
      setContactSearch("");
      setSelectedContactId(null);
      setLinkAsPrimary(false);
      setMoveConfirmed(false);
    },
    onError: (error: Error) => {
      toast({ title: "Unable to link contact", description: error.message, variant: "destructive" });
    },
  });
  const canConfirmLink =
    canSubmitLinkContact(
      Boolean(selectedContactId),
      linkExistingContactMutation.isPending,
      selectedContactRequiresMoveConfirmation,
      moveConfirmed,
    );

  const handleEditClick = (contact: CustomerWithRelations["contacts"][0]) => {
    setEditingContact(contact);
    setEditForm({
      firstName: contact.firstName || "",
      lastName: contact.lastName || "",
      email: contact.email || "",
      phone: contact.phone || "",
      title: contact.title || "",
      isPrimary: contact.isPrimary || false,
    });
    setShowEditDialog(true);
  };

  const handleSaveContact = () => {
    if (!editingContact) return;
    updateContactMutation.mutate({ id: editingContact.id, data: editForm });
  };

  const handleLinkDialogOpenChange = (open: boolean) => {
    setShowLinkDialog(open);
    if (!open) {
      setContactSearch("");
      setSelectedContactId(null);
      setLinkAsPrimary(false);
      setMoveConfirmed(false);
    }
  };

  const handleConfirmLinkContact = () => {
    if (!selectedContactId) {
      toast({
        title: "Choose a contact",
        description: "Select an existing contact before linking.",
        variant: "destructive",
      });
      return;
    }
    if (selectedContactRequiresMoveConfirmation && !moveConfirmed) {
      toast({
        title: "Confirm contact move",
        description: "Acknowledge that this will reassign the contact from its current customer before linking.",
        variant: "destructive",
      });
      return;
    }
    linkExistingContactMutation.mutate(
      buildLinkExistingContactPayload(
        selectedContactId,
        linkAsPrimary,
        selectedContactRequiresMoveConfirmation,
        moveConfirmed,
      ),
    );
  };

  if (isEmbedded) return null; // Don't show in embedded mode

  return (
    <>
      <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl p-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Contact2 className="w-5 h-5 text-titan-text-secondary" />
            <h3 className="text-titan-base font-semibold text-titan-text-primary">Contacts</h3>
            <span className="text-titan-xs text-titan-text-muted">({contacts.length})</span>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-titan-xs border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              onClick={() => setShowLinkDialog(true)}
            >
              <Link2 className="w-3.5 h-3.5 mr-1" />
              Link Existing Contact
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-titan-xs border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Contact
            </Button>
          </div>
        </div>

        {/* Contacts List */}
        {contacts.length === 0 ? (
          <div className="py-6 text-center text-titan-text-muted text-titan-sm">
            No contacts yet. Add a primary contact to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center justify-between p-3 rounded-titan-lg bg-titan-bg-card-elevated hover:bg-titan-bg-table-row transition-colors cursor-pointer"
                onClick={() => navigate(ROUTES.contacts.detail(contact.id))}
              >
                {/* Contact Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-titan-sm font-medium text-titan-text-primary">
                      {contact.firstName} {contact.lastName}
                    </span>
                    {contact.isPrimary && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-titan-accent/15 text-titan-accent">
                        Primary
                      </span>
                    )}
                    {contact.flags?.map((flag) => (
                      <ContactFlagPill key={flag} flag={flag} />
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-titan-xs text-titan-text-muted">
                    {contact.title && <span>{contact.title}</span>}
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} className="hover:text-titan-accent">
                        {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`} className="hover:text-titan-accent">
                        {contact.phone}
                      </a>
                    )}
                  </div>
                </div>

                {/* Invoice recipient and row actions */}
                <div className="flex items-center gap-1">
                  <InvoiceRecipientContactControl
                    contactId={contact.id}
                    contactName={`${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "contact"}
                    email={contact.email}
                    checked={contact.isBilling === true}
                    pending={updateInvoiceRecipientMutation.isPending}
                    onCheckedChange={(isBilling) => updateInvoiceRecipientMutation.mutate({
                      contactId: contact.id,
                      isBilling,
                    })}
                  />
                  <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-titan-text-muted hover:text-titan-text-primary hover:bg-titan-bg-card"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-titan-bg-card border-titan-border">
                    <DropdownMenuItem
                      onClick={() => handleEditClick(contact)}
                      className="text-titan-text-primary hover:bg-titan-bg-card-elevated cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5 mr-2" />
                      Edit Contact
                    </DropdownMenuItem>
                    {!contact.isPrimary && (
                      <DropdownMenuItem
                        onClick={() => setPrimaryMutation.mutate(contact.id)}
                        disabled={setPrimaryMutation.isPending}
                        className="text-titan-text-primary hover:bg-titan-bg-card-elevated cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5 mr-2" />
                        Make Primary
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator className="bg-titan-border-subtle" />
                    <DropdownMenuItem
                      onClick={() => unlinkContactMutation.mutate(contact.id)}
                      disabled={unlinkContactMutation.isPending}
                      className="text-titan-error hover:bg-titan-error/10 cursor-pointer"
                    >
                      <UserMinus className="w-3.5 h-3.5 mr-2" />
                      Remove from Company
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ContactForm
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        customerId={customer.id}
      />

      <Dialog open={showLinkDialog} onOpenChange={handleLinkDialogOpenChange}>
        <DialogContent className="bg-titan-bg-card border-titan-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-titan-text-primary">Link Existing Contact</DialogTitle>
          </DialogHeader>
          <p className="text-titan-sm text-titan-text-muted">
            Contacts belong to one customer at a time. Linking moves the selected contact to {customer.companyName}.
          </p>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-titan-text-secondary">Search Contacts</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-titan-text-muted" />
                <Input
                  value={contactSearch}
                  onChange={(event) => {
                    setContactSearch(event.target.value);
                    setSelectedContactId(null);
                    setMoveConfirmed(false);
                  }}
                  placeholder="Search by name, email, phone, or company"
                  className="pl-9 bg-titan-bg-input border-titan-border-subtle text-titan-text-primary"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-titan-lg border border-titan-border-subtle">
              {contactPickerQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 px-4 py-8 text-titan-sm text-titan-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching contacts...
                </div>
              ) : contactPickerQuery.isError ? (
                <div className="px-4 py-8 text-center text-titan-sm text-titan-error">
                  Failed to search contacts. Try again.
                </div>
              ) : linkableContacts.length === 0 ? (
                <div className="px-4 py-8 text-center text-titan-sm text-titan-text-muted">
                  {contactSearchTerm ? "No linkable contacts match your search." : "No linkable contacts found."}
                </div>
              ) : (
                <div className="divide-y divide-titan-border-subtle">
                  {linkableContacts.map((contact) => {
                    const fullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Unnamed contact";
                    const selected = selectedContactId === contact.id;
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => {
                          setSelectedContactId(contact.id);
                          setMoveConfirmed(false);
                        }}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-titan-bg-card-elevated",
                          selected && "bg-titan-accent/10",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1 h-3 w-3 shrink-0 rounded-full border border-titan-border-subtle",
                            selected && "border-titan-accent bg-titan-accent",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-titan-sm font-medium text-titan-text-primary">{fullName}</span>
                            {contact.isPrimary ? (
                              <span className="rounded bg-titan-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-titan-accent">
                                Primary at source company
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-titan-xs text-titan-text-muted">
                            {contact.companyName || "Unknown company"}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-titan-xs text-titan-text-muted">
                            {contact.email ? <span>{contact.email}</span> : null}
                            {contact.phone ? <span>{contact.phone}</span> : null}
                            {contact.mobile ? <span>{contact.mobile}</span> : null}
                            {contact.title ? <span>{contact.title}</span> : null}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedContact && selectedContactMoveState.sourceCustomerName !== "another customer" ? (
              <div className="rounded-titan-lg border border-titan-border-subtle bg-titan-bg-card-elevated p-3">
                <div className="flex items-start gap-2">
                  <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-titan-text-muted" />
                  <div className="grid gap-2">
                    <div className="text-titan-sm font-medium text-titan-text-primary">
                      {selectedContactMoveState.warningText}
                    </div>
                    <p className="text-titan-xs text-titan-text-muted">
                      Contacts can be linked to multiple customers. The original customer relationship will stay in place.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-titan-lg border border-titan-border-subtle p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="linkAsPrimary"
                  checked={linkAsPrimary}
                  onCheckedChange={(checked) => setLinkAsPrimary(checked === true)}
                />
                <div className="grid gap-1">
                  <Label htmlFor="linkAsPrimary" className="cursor-pointer text-titan-sm text-titan-text-primary">
                    Set as primary contact
                  </Label>
                  <p className="text-titan-xs text-titan-text-muted">
                    This will replace the current primary contact for {customer.companyName}.
                  </p>
                </div>
              </div>
            </div>

            {selectedContact ? (
              <div className="rounded-titan-lg bg-titan-bg-card-elevated px-3 py-2 text-titan-xs text-titan-text-muted">
                {selectedContactMoveState.selectedSummary}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleLinkDialogOpenChange(false)}
              disabled={linkExistingContactMutation.isPending}
              className="border-titan-border-subtle text-titan-text-secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmLinkContact}
              disabled={!canConfirmLink}
              className="bg-titan-accent hover:bg-titan-accent/90 text-white"
            >
              {linkExistingContactMutation.isPending ? "Linking..." : "Link Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Contact Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-titan-bg-card border-titan-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-titan-text-primary">Edit Contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-titan-text-secondary">First Name</Label>
                <Input
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                  className="bg-titan-bg-input border-titan-border-subtle text-titan-text-primary"
                />
              </div>
              <div>
                <Label className="text-titan-text-secondary">Last Name</Label>
                <Input
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                  className="bg-titan-bg-input border-titan-border-subtle text-titan-text-primary"
                />
              </div>
            </div>
            <div>
              <Label className="text-titan-text-secondary">Email</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="bg-titan-bg-input border-titan-border-subtle text-titan-text-primary"
              />
            </div>
            <div>
              <Label className="text-titan-text-secondary">Phone</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                className="bg-titan-bg-input border-titan-border-subtle text-titan-text-primary"
              />
            </div>
            <div>
              <Label className="text-titan-text-secondary">Role / Title</Label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="bg-titan-bg-input border-titan-border-subtle text-titan-text-primary"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              className="border-titan-border-subtle text-titan-text-secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveContact}
              disabled={updateContactMutation.isPending}
              className="bg-titan-accent hover:bg-titan-accent/90 text-white"
            >
              {updateContactMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type PortalStatus = "DISABLED" | "PENDING_INVITE" | "ACTIVE" | "SUSPENDED";

interface PortalAccessRecord {
  id: string;
  contactId: string | null;
  userId: string | null;
  status: PortalStatus;
  email: string;
  displayName: string | null;
  inviteSentAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

function portalStatusLabel(status: PortalStatus): string {
  if (status === "PENDING_INVITE") return "Pending Invite";
  if (status === "ACTIVE") return "Active";
  if (status === "SUSPENDED") return "Suspended";
  return "Disabled";
}

function portalStatusClass(status: PortalStatus): string {
  if (status === "ACTIVE") return "bg-emerald-500/15 text-emerald-700";
  if (status === "PENDING_INVITE") return "bg-amber-500/15 text-amber-700";
  if (status === "SUSPENDED") return "bg-red-500/15 text-red-700";
  return "bg-titan-bg-table-row text-titan-text-muted";
}

function PortalAccessPanel({ customer, layoutMode }: ContactsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [devFixtureSetupUrl, setDevFixtureSetupUrl] = useState<string | null>(null);
  const isEmbedded = layoutMode === "embedded";
  const contacts = customer.contacts || [];
  const queryKey = [`/api/customers/${customer.id}/portal-access`];
  const canUseDevFixtureSetup =
    typeof window !== "undefined" &&
    window.location.hostname === "dev.printershero.com" &&
    String(customer.companyName || "").trim().startsWith("DEV TEST ONLY - Stage 18P");

  const { data: portalAccessData, isLoading } = useQuery<{ success: boolean; data: PortalAccessRecord[] }>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`/api/customers/${customer.id}/portal-access`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load portal access");
      return response.json();
    },
    enabled: !isEmbedded,
  });

  const records = portalAccessData?.data || [];
  const accessByContact = new Map(records.filter((record) => record.contactId).map((record) => [record.contactId, record]));

  const portalMutation = useMutation({
    mutationFn: async ({ path, label }: { path: string; label: string }) => {
      const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `${label} failed`);
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customer.id}`] });
      toast({ title: "Portal access updated", description: variables.label });
    },
    onError: (error: Error) => {
      toast({ title: "Portal access error", description: error.message, variant: "destructive" });
    },
  });

  const runAction = (path: string, label: string) => portalMutation.mutate({ path, label });

  const devFixtureSetupMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const response = await fetch(`/api/customers/${customer.id}/contacts/${contactId}/dev-stage18p-portal-setup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmDevFixtureSetup: true }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "DEV fixture portal setup failed");
      return payload as { data?: { portalSetupUrl?: string } };
    },
    onSuccess: (payload) => {
      const setupUrl = payload.data?.portalSetupUrl;
      if (!setupUrl) {
        toast({ title: "DEV fixture setup error", description: "No setup link was returned.", variant: "destructive" });
        return;
      }
      setDevFixtureSetupUrl(setupUrl);
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "DEV fixture setup link created", description: "No invite email was sent." });
    },
    onError: (error: Error) => {
      toast({ title: "DEV fixture setup error", description: error.message, variant: "destructive" });
    },
  });

  if (isEmbedded) return null;

  return (
    <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-titan-text-secondary" />
          <h3 className="text-titan-base font-semibold text-titan-text-primary">Portal Access</h3>
          <span className="text-titan-xs text-titan-text-muted">({records.length})</span>
        </div>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-titan-text-muted" />}
      </div>

      {contacts.length === 0 ? (
        <div className="py-6 text-center text-titan-text-muted text-titan-sm">
          Add a contact with an email address before creating portal access.
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map((contact) => {
            const access = accessByContact.get(contact.id);
            const status = access?.status || "DISABLED";
            const actionDisabled = portalMutation.isPending || !contact.email;

            return (
              <div
                key={contact.id}
                className="grid gap-3 rounded-titan-lg bg-titan-bg-card-elevated p-3 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-titan-sm font-medium text-titan-text-primary">
                      {contact.firstName} {contact.lastName}
                    </span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", portalStatusClass(status))}>
                      {portalStatusLabel(status)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-titan-xs text-titan-text-muted">{contact.email || "Email required"}</div>
                </div>

                <div className="text-titan-xs text-titan-text-muted">
                  <div>Created: {formatDate(access?.createdAt)}</div>
                  <div>Invite: {formatDate(access?.inviteSentAt)}</div>
                </div>

                <div className="text-titan-xs text-titan-text-muted">
                  <div>Last Login</div>
                  <div className="text-titan-text-secondary">{formatDate(access?.lastLoginAt)}</div>
                </div>

                <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                  {(!access || access.status === "DISABLED") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-titan-xs"
                      disabled={actionDisabled}
                      onClick={() =>
                        runAction(
                          `/api/customers/${customer.id}/contacts/${contact.id}/portal-access`,
                          "Portal invite created and sent",
                        )
                      }
                    >
                      <Mail className="mr-1 h-3.5 w-3.5" />
                      Create Access
                    </Button>
                  )}

                  {canUseDevFixtureSetup && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-titan-xs"
                      disabled={actionDisabled || devFixtureSetupMutation.isPending}
                      onClick={() => devFixtureSetupMutation.mutate(contact.id)}
                    >
                      Create DEV Setup Link
                    </Button>
                  )}

                  {access?.status === "PENDING_INVITE" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-titan-xs"
                        disabled={portalMutation.isPending}
                        onClick={() => runAction(`/api/customer-portal-access/${access.id}/resend-invite`, "Portal invite resent")}
                      >
                        <Mail className="mr-1 h-3.5 w-3.5" />
                        Resend
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-titan-xs"
                        disabled={portalMutation.isPending}
                        onClick={() => runAction(`/api/customer-portal-access/${access.id}/cancel-invite`, "Portal invite cancelled")}
                      >
                        Disable
                      </Button>
                    </>
                  )}

                  {access?.status === "ACTIVE" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-titan-xs"
                        disabled={portalMutation.isPending}
                        onClick={() => runAction(`/api/customer-portal-access/${access.id}/reset-password`, "Password reset sent")}
                      >
                        Reset Password
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-titan-xs"
                        disabled={portalMutation.isPending}
                        onClick={() => runAction(`/api/customer-portal-access/${access.id}/suspend`, "Portal access suspended")}
                      >
                        Suspend
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-titan-xs"
                        disabled={portalMutation.isPending}
                        onClick={() => runAction(`/api/customer-portal-access/${access.id}/disable`, "Portal access disabled")}
                      >
                        Disable
                      </Button>
                    </>
                  )}

                  {access?.status === "SUSPENDED" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-titan-xs"
                        disabled={portalMutation.isPending}
                        onClick={() => runAction(`/api/customer-portal-access/${access.id}/activate`, "Portal access activated")}
                      >
                        Activate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-titan-xs"
                        disabled={portalMutation.isPending}
                        onClick={() => runAction(`/api/customer-portal-access/${access.id}/reset-password`, "Password reset sent")}
                      >
                        Reset Password
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(devFixtureSetupUrl)} onOpenChange={(open) => !open && setDevFixtureSetupUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>DEV Stage 18P Portal Setup</DialogTitle>
            <DialogDescription>
              This one-time link is available only for the labelled DEV fixture and no invite email was sent.
            </DialogDescription>
          </DialogHeader>
          <Input value={devFixtureSetupUrl || ""} readOnly aria-label="DEV portal setup link" />
          {devFixtureSetupUrl && (
            <Button asChild>
              <a href={devFixtureSetupUrl}>Open DEV Setup Link</a>
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ stat, compact }: { stat: StatCardConfig; compact?: boolean }) {
  const IconComponent = stat.icon;
  const isPositive = stat.trendType === "up";

  return (
    <div
      className={cn(
        "rounded-titan-md border transition-all",
        compact ? "px-2 py-1.5" : "px-2.5 py-2",
        stat.highlight
          ? "bg-titan-accent/10 border-titan-accent/20"
          : "bg-titan-bg-card border-titan-border-subtle"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-medium text-titan-text-muted uppercase tracking-wider truncate">
          {stat.label}
        </span>
        <div
          className={cn(
            "rounded-titan-sm flex items-center justify-center flex-shrink-0",
            compact ? "w-4 h-4" : "w-5 h-5",
            stat.iconBg
          )}
        >
          <IconComponent className={cn("text-white", compact ? "w-2 h-2" : "w-2.5 h-2.5")} />
        </div>
      </div>
      <div className={cn(
        "font-bold text-titan-text-primary leading-tight",
        compact ? "text-sm" : "text-base"
      )}>
        {stat.value}
      </div>
      {stat.trend !== undefined && stat.trend !== null && (
        <div
          className={cn(
            "flex items-center gap-0.5 text-[9px] mt-0.5",
            isPositive ? "text-titan-success" : "text-titan-error"
          )}
        >
          {isPositive ? (
            <TrendingUp className="w-2 h-2" />
          ) : (
            <TrendingDown className="w-2 h-2" />
          )}
          {Math.abs(stat.trend).toFixed(1)}%
        </div>
      )}
      {stat.subtext && (
        <div className="text-[9px] text-titan-text-muted truncate mt-0.5">{stat.subtext}</div>
      )}
    </div>
  );
}

function CustomerStatsGrid({
  customer,
  orders,
  quotes,
  invoices,
  period,
  layoutMode,
  onPeriodChange,
}: {
  customer: CustomerWithRelations;
  orders: Order[];
  quotes: any[];
  invoices: any[];
  period: TimePeriod;
  layoutMode: LayoutMode;
  onPeriodChange: (p: TimePeriod) => void;
}) {
  const isEmbedded = layoutMode === "embedded";

  // Load visible stats from localStorage
  const [visibleStats, setVisibleStats] = useState<string[]>(() => {
    if (isEmbedded) return ["quotes", "orders", "sales", "avgOrder"];
    try {
      const saved = localStorage.getItem("customer_stats_visible");
      return saved ? JSON.parse(saved) : ["quotes", "orders", "sales", "avgOrder", "pending", "lastContact", "rank"];
    } catch {
      return ["quotes", "orders", "sales", "avgOrder", "pending", "lastContact", "rank"];
    }
  });

  // Persist visible stats to localStorage
  useEffect(() => {
    if (!isEmbedded) {
      localStorage.setItem("customer_stats_visible", JSON.stringify(visibleStats));
    }
  }, [visibleStats, isEmbedded]);

  const stats = useMemo<StatCardConfig[]>(() => {
    const totalSales = orders.reduce(
      (sum, o) => sum + parseFloat(o.total || "0"),
      0
    );
    const avgOrder = orders.length > 0 ? totalSales / orders.length : 0;
    const pendingQuotes = quotes.filter(
      (q) => q.status === "pending_approval" || q.status === "draft"
    ).length;

    const lastActivity = [...orders, ...quotes]
      .map((item) => new Date(item.createdAt))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const lastContactStr = lastActivity
      ? formatDistanceToNow(lastActivity, { addSuffix: false })
      : "Never";

    const baseStats: StatCardConfig[] = [
      {
        key: "quotes",
        label: "QUOTES",
        value: quotes.length.toString(),
        trend: 8.5,
        trendType: "up" as const,
        icon: FileText,
        iconBg: "bg-amber-500",
      },
      {
        key: "orders",
        label: "ORDERS",
        value: orders.length.toString(),
        trend: 15.2,
        trendType: "up" as const,
        icon: ShoppingCart,
        iconBg: "bg-purple-500",
      },
      {
        key: "sales",
        label: "SALES",
        value: `$${(totalSales / 1000).toFixed(1)}k`,
        trend: 12.3,
        trendType: "up" as const,
        icon: DollarSign,
        iconBg: "bg-teal-500",
      },
      {
        key: "avgOrder",
        label: "AVG ORDER",
        value: `$${(avgOrder / 1000).toFixed(1)}k`,
        trend: -2.1,
        trendType: "down" as const,
        icon: TrendingUp,
        iconBg: "bg-blue-500",
      },
    ];

    if (isEmbedded) {
      return baseStats;
    }

    return [
      ...baseStats,
      {
        key: "pending",
        label: "PENDING QUOTES",
        value: pendingQuotes.toString(),
        icon: Clock,
        iconBg: "bg-orange-500",
        highlight: true,
      },
      {
        key: "lastContact",
        label: "LAST CONTACT",
        value: lastContactStr,
        subtext: "Follow-up recommended",
        icon: Calendar,
        iconBg: "bg-pink-500",
        highlight: true,
      },
      {
        key: "rank",
        label: "CUSTOMER RANK",
        value: "#12",
        subtext: "of 247",
        icon: Star,
        iconBg: "bg-emerald-500",
        highlight: true,
      },
    ];
  }, [customer, orders, quotes, invoices, period, isEmbedded]);

  // Filter stats based on visibility
  const visibleStatsData = stats.filter((stat) => visibleStats.includes(stat.key));

  // All possible stat keys for the visibility controls
  const allStatKeys = stats.map((s) => ({ key: s.key, label: s.label }));

  const toggleStatVisibility = (key: string) => {
    setVisibleStats((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const selectAllStats = () => {
    setVisibleStats(allStatKeys.map((s) => s.key));
  };

  const resetStatsVisibility = () => {
    setVisibleStats(["quotes", "orders", "sales", "avgOrder", "pending", "lastContact", "rank"]);
  };

  return (
    <div className={cn(
      "grid gap-1.5",
      isEmbedded ? "grid-cols-4" : "grid-flow-col auto-cols-[minmax(80px,1fr)]"
    )}>
      {/* First slot: Overview Controls Card (only in full mode) */}
      {!isEmbedded && (
        <div
          className="rounded-titan-md border bg-titan-bg-card border-titan-border-subtle px-2.5 py-2 flex flex-col justify-between"
        >
          {/* Top row: Overview label + settings gear */}
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-medium text-titan-text-muted uppercase tracking-wider">
              OVERVIEW
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button className="w-5 h-5 rounded-titan-sm bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors">
                  <Settings2 className="w-2.5 h-2.5 text-white" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3 bg-titan-bg-card border-titan-border" align="start">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-titan-text-primary">Visible Stats</h4>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={selectAllStats}
                        className="h-6 px-2 text-xs text-titan-text-secondary hover:text-titan-text-primary"
                      >
                        All
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={resetStatsVisibility}
                        className="h-6 px-2 text-xs text-titan-text-secondary hover:text-titan-text-primary"
                      >
                        Reset
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {allStatKeys.map((stat) => (
                      <div key={stat.key} className="flex items-center gap-2">
                        <Checkbox
                          id={`stat-${stat.key}`}
                          checked={visibleStats.includes(stat.key)}
                          onCheckedChange={() => toggleStatVisibility(stat.key)}
                        />
                        <label
                          htmlFor={`stat-${stat.key}`}
                          className="text-sm text-titan-text-primary cursor-pointer flex-1"
                        >
                          {stat.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Time period selector pills - horizontal compact */}
          <div className="flex gap-1">
            {(["month", "year", "all"] as const).map((p) => (
              <button
                key={p}
                onClick={() => onPeriodChange(p)}
                className={cn(
                  "px-2 py-1 rounded-titan-sm text-[10px] font-medium transition-colors",
                  period === p
                    ? "bg-titan-accent text-white shadow-titan-sm"
                    : "bg-titan-bg-card-elevated text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-highlight"
                )}
              >
                {p === "month" ? "Month" : p === "year" ? "Year" : "All"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Visible stat cards */}
      {visibleStatsData.map((stat) => (
        <StatCard key={stat.key} stat={stat} compact={isEmbedded} />
      ))}
    </div>
  );
}

function OrdersTable({
  orders,
  searchQuery,
  statusFilter,
  compact,
  customerName,
  quoteCount,
  invoiceFilter,
}: {
  orders: Order[];
  searchQuery: string;
  statusFilter: string;
  compact?: boolean;
  customerName?: string;
  quoteCount?: number;
  invoiceFilter?: "all" | "no_invoice" | "has_invoice";
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [overrideTarget, setOverrideTarget] = useState<CloseJobOverrideTarget | null>(null);
  const isAdminOrOwner = Boolean(isAdmin || ["owner", "admin"].includes(String(user?.role || "").toLowerCase()));
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  
  // Column visibility configuration
  const allColumns = [
    { id: "orderNumber", label: "Order #", defaultVisible: true, sortable: true, resizable: true, minWidth: 100 },
    { id: "poNumber", label: "PO #", defaultVisible: true, sortable: true, resizable: true, minWidth: 100 },
    { id: "date", label: "Date", defaultVisible: true, sortable: true, resizable: true, minWidth: 100 },
    { id: "product", label: "Product", defaultVisible: true, sortable: true, resizable: true, minWidth: 150 },
    { id: "amount", label: "Amount", defaultVisible: true, sortable: true, resizable: true, minWidth: 100 },
    { id: "status", label: "Status", defaultVisible: true, sortable: true, resizable: true, minWidth: 100 },
    { id: "invoice", label: "Invoice", defaultVisible: true, sortable: false, resizable: true, minWidth: 130 },
    { id: "actions", label: "Actions", defaultVisible: true, sortable: false, resizable: false, minWidth: 320 },
  ];
  
  const defaultVisibleColumns = allColumns
    .filter(col => col.defaultVisible)
    .map(col => col.id);
  
  const defaultColumnOrder = allColumns.map(col => col.id);
  
  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("customerOrders_visibleColumns");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return Array.from(new Set([...parsed, "invoice"]));
        }
      }
    } catch (e) {
      console.error("Failed to load column preferences:", e);
    }
    return defaultVisibleColumns;
  });
  
  // Column order
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("customerOrders_columnOrder");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return Array.from(new Set([...parsed, ...defaultColumnOrder]));
        }
      }
    } catch (e) {
      console.error("Failed to load column order:", e);
    }
    return defaultColumnOrder;
  });
  
  // Column sizing
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem("customerOrders_columnSizing");
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to load column sizing:", e);
    }
    return {};
  });
  
  // Sorting state: array of {id: string, desc: boolean}
  const [sorting, setSorting] = useState<Array<{id: string, desc: boolean}>>([]);
  
  // Drag and drop state
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = useState<number>(0);
  const [resizeStartWidth, setResizeStartWidth] = useState<number>(0);
  
  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem("customerOrders_visibleColumns", JSON.stringify(visibleColumns));
  }, [visibleColumns]);
  
  useEffect(() => {
    localStorage.setItem("customerOrders_columnOrder", JSON.stringify(columnOrder));
  }, [columnOrder]);
  
  useEffect(() => {
    localStorage.setItem("customerOrders_columnSizing", JSON.stringify(columnSizing));
  }, [columnSizing]);
  
  const toggleColumn = (columnId: string) => {
    setVisibleColumns(prev => 
      prev.includes(columnId)
        ? prev.filter(id => id !== columnId)
        : [...prev, columnId]
    );
  };
  
  const selectAll = () => {
    setVisibleColumns(allColumns.map(col => col.id));
  };
  
  const resetToDefault = () => {
    setVisibleColumns(defaultVisibleColumns);
    setColumnOrder(defaultColumnOrder);
    setColumnSizing({});
    setSorting([]);
  };
  
  // Sorting handlers
  const handleSort = (columnId: string, shiftKey: boolean) => {
    const column = allColumns.find(col => col.id === columnId);
    if (!column?.sortable) return;
    
    setSorting(prev => {
      const existing = prev.find(s => s.id === columnId);
      
      if (shiftKey) {
        // Multi-sort: shift+click adds/modifies this column in the sort order
        if (existing) {
          if (existing.desc) {
            // Remove from sorting
            return prev.filter(s => s.id !== columnId);
          } else {
            // Toggle to desc
            return prev.map(s => s.id === columnId ? { ...s, desc: true } : s);
          }
        } else {
          // Add as asc
          return [...prev, { id: columnId, desc: false }];
        }
      } else {
        // Single sort: replace all sorting with this column
        if (existing && prev.length === 1) {
          if (existing.desc) {
            // Remove sorting
            return [];
          } else {
            // Toggle to desc
            return [{ id: columnId, desc: true }];
          }
        } else {
          // Set as asc
          return [{ id: columnId, desc: false }];
        }
      }
    });
  };
  
  // Drag and drop handlers
  const handleDragStart = (columnId: string) => {
    setDraggedColumn(columnId);
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  
  const handleDrop = (targetColumnId: string) => {
    if (!draggedColumn || draggedColumn === targetColumnId) {
      setDraggedColumn(null);
      return;
    }
    
    setColumnOrder(prev => {
      const newOrder = [...prev];
      const draggedIndex = newOrder.indexOf(draggedColumn);
      const targetIndex = newOrder.indexOf(targetColumnId);
      
      // Remove dragged column
      newOrder.splice(draggedIndex, 1);
      // Insert before target
      const insertIndex = draggedIndex < targetIndex ? targetIndex : targetIndex;
      newOrder.splice(insertIndex, 0, draggedColumn);
      
      return newOrder;
    });
    
    setDraggedColumn(null);
  };
  
  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnId);
    setResizeStartX(e.clientX);
    const currentWidth = columnSizing[columnId] || 150;
    setResizeStartWidth(currentWidth);
  };
  
  useEffect(() => {
    if (!resizingColumn) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX;
      const column = allColumns.find(col => col.id === resizingColumn);
      const minWidth = column?.minWidth || 80;
      const newWidth = Math.max(minWidth, resizeStartWidth + delta);
      
      setColumnSizing(prev => ({
        ...prev,
        [resizingColumn]: newWidth,
      }));
    };
    
    const handleMouseUp = () => {
      setResizingColumn(null);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, resizeStartX, resizeStartWidth, allColumns]);

  const filteredOrders = useMemo(() => {
    let result = orders.filter((order: any) => {
      const matchesSearch =
        !searchQuery ||
        documentNumberMatchesSearch({
          query: searchQuery,
          displayNumber: order.displayNumber,
          numberCore: order.numberCore,
          legacyNumber: order.orderNumber,
        }) ||
        order.poNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.label?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || order.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    
    // Apply sorting
    if (sorting.length > 0) {
      result = [...result].sort((a: any, b: any) => {
        for (const sort of sorting) {
          let aVal: any;
          let bVal: any;
          
          switch (sort.id) {
            case "orderNumber":
              aVal = (a.numberCore ?? Number.parseInt(String(a.orderNumber || ""), 10)) || 0;
              bVal = (b.numberCore ?? Number.parseInt(String(b.orderNumber || ""), 10)) || 0;
              break;
            case "poNumber":
              aVal = a.poNumber || "";
              bVal = b.poNumber || "";
              break;
            case "date":
              aVal = new Date(a.createdAt).getTime();
              bVal = new Date(b.createdAt).getTime();
              break;
            case "product":
              const aProduct = a.lineItems?.[0]?.description || a.lineItems?.[0]?.productName || "";
              const bProduct = b.lineItems?.[0]?.description || b.lineItems?.[0]?.productName || "";
              aVal = aProduct.toLowerCase();
              bVal = bProduct.toLowerCase();
              break;
            case "amount":
              aVal = parseFloat(a.total || "0");
              bVal = parseFloat(b.total || "0");
              break;
            case "status":
              aVal = a.status || "";
              bVal = b.status || "";
              break;
            default:
              continue;
          }
          
          if (aVal < bVal) return sort.desc ? 1 : -1;
          if (aVal > bVal) return sort.desc ? -1 : 1;
        }
        return 0;
      });
    }
    
    return result;
  }, [orders, searchQuery, statusFilter, sorting]);

  const createFirstInvoiceMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetch(`/api/orders/${orderId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || "Failed to create invoice");
      return data as { data?: { displayNumber?: string | null; invoiceNumber?: string | number | null }; created?: boolean };
    },
    onSuccess: (result, orderId) => {
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      const invoiceNumber = result.data?.displayNumber || result.data?.invoiceNumber;
      toast({
        title: result.created === false ? "Invoice already exists" : "Invoice created",
        description: invoiceNumber
          ? `${result.created === false ? "Using existing" : "Created"} invoice ${invoiceNumber}.`
          : result.created === false ? "The Order was refreshed with its existing invoice." : "The first invoice was created from the Order.",
      });
    },
    onError: (error: Error) => toast({ title: "Invoice not created", description: error.message, variant: "destructive" }),
  });

  if (filteredOrders.length === 0) {
    const isFiltered = searchQuery || statusFilter !== "all" || invoiceFilter !== "all";
    return (
      <div className="py-12 text-center text-titan-text-secondary">
        {isFiltered ? (
          <>
            <p className="text-sm">No orders match your filters.</p>
            <button
              type="button"
              onClick={() => {}}
              className="mt-2 text-xs text-titan-accent hover:underline"
            >
              Clear filters
            </button>
          </>
        ) : (
          <>
            <p className="text-sm">
              No orders yet{customerName ? ` for ${customerName}` : ""}.{" "}
              {quoteCount && quoteCount > 0
                ? `This customer has ${quoteCount} quote${quoteCount === 1 ? "" : "s"} available.`
                : ""}
            </p>
          </>
        )}
      </div>
    );
  }

  // Helper to render sort icon
  const renderSortIcon = (columnId: string) => {
    const sortIndex = sorting.findIndex(s => s.id === columnId);
    if (sortIndex === -1) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    
    const sort = sorting[sortIndex];
    const showIndex = sorting.length > 1;
    
    return (
      <div className="flex items-center gap-1">
        {sort.desc ? (
          <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUp className="w-3 h-3" />
        )}
        {showIndex && (
          <span className="text-[10px] font-bold">{sortIndex + 1}</span>
        )}
      </div>
    );
  };
  
  // Get ordered and visible columns
  const orderedVisibleColumns = columnOrder
    .filter(id => visibleColumns.includes(id))
    .filter(id => !(compact && id === "product")); // Hide product in compact mode

  return (
    <>
      <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
              {orderedVisibleColumns.map((columnId) => {
                const column = allColumns.find(col => col.id === columnId);
                if (!column) return null;
                
                const width = columnSizing[columnId] || (column.minWidth + 50);
                
                return (
                  <th
                    key={columnId}
                    className={cn(
                      "relative px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider select-none",
                      column.sortable && "cursor-pointer hover:bg-titan-bg-card-highlight",
                      draggedColumn === columnId && "opacity-50"
                    )}
                    style={{ width: `${width}px` }}
                    draggable={column.id !== "actions"}
                    onDragStart={() => handleDragStart(columnId)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(columnId)}
                    onClick={(e) => column.sortable && handleSort(columnId, e.shiftKey)}
                  >
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-2">
                        {column.id !== "actions" && (
                          <GripVertical className="w-3 h-3 opacity-30 cursor-grab" />
                        )}
                        <span>{column.label}</span>
                      </div>
                      {column.sortable && renderSortIcon(columnId)}
                    </div>
                    
                    {/* Resize handle */}
                    {column.resizable && (
                      <div
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 group"
                        onMouseDown={(e) => handleResizeStart(e, columnId)}
                      >
                        <div className="absolute right-0 top-0 h-full w-1 group-hover:bg-blue-500" />
                      </div>
                    )}
                  </th>
                );
              })}
              <th className="px-4 py-3 w-12">
                <div className="flex items-center justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-titan-text-muted hover:text-titan-text-primary hover:bg-titan-bg-card-highlight"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowColumnSettings(true);
                    }}
                    aria-label="Edit columns"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </Button>
                </div>
              </th>
            </tr>
          </thead>
        <tbody>
          {filteredOrders.map((order: any) => {
            const lineItems = order.lineItems || [];
            const firstProduct = lineItems[0]?.description || lineItems[0]?.productName || "—";
            
            const renderCell = (columnId: string) => {
              const column = allColumns.find(col => col.id === columnId);
              if (!column) return null;
              
              const width = columnSizing[columnId] || (column.minWidth + 50);
              
              switch (columnId) {
                case "orderNumber":
                  return (
                    <td key={columnId} className="px-4 py-3" style={{ width: `${width}px` }}>
                      <span className="text-titan-sm font-medium text-titan-accent">
                        {resolveDocumentDisplayNumber({
                          displayNumber: order.displayNumber,
                          numberCore: order.numberCore,
                          legacyNumber: order.orderNumber,
                        }) || order.orderNumber}
                      </span>
                    </td>
                  );
                
                case "poNumber":
                  return (
                    <td key={columnId} className="px-4 py-3" style={{ width: `${width}px` }}>
                      <span className="text-titan-sm font-mono text-titan-text-secondary">
                        {order.poNumber || "—"}
                      </span>
                    </td>
                  );
                  
                case "date":
                  return (
                    <td key={columnId} className="px-4 py-3 text-titan-sm text-titan-text-secondary" style={{ width: `${width}px` }}>
                      {formatDate(order.createdAt)}
                    </td>
                  );
                  
                case "product":
                  return (
                    <td key={columnId} className="px-4 py-3" style={{ width: `${width}px` }}>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-purple-500/20 rounded-titan-sm flex items-center justify-center">
                          <Package className="w-3 h-3 text-purple-400" />
                        </div>
                        <span className="text-titan-sm text-titan-text-primary truncate" style={{ maxWidth: `${width - 60}px` }}>
                          {firstProduct}
                        </span>
                      </div>
                    </td>
                  );
                  
                case "amount":
                  return (
                    <td key={columnId} className="px-4 py-3 text-titan-sm font-medium text-titan-success" style={{ width: `${width}px` }}>
                      {formatCurrency(order.total)}
                    </td>
                  );
                  
                case "status":
                  return (
                    <td key={columnId} className="px-4 py-3" style={{ width: `${width}px` }}>
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-titan-xs font-medium border",
                          getStatusStyle(order.status)
                        )}
                      >
                        {formatStatusLabel(order.status)}
                      </span>
                    </td>
                  );

                case "invoice": {
                  const linkedInvoices = order.invoiceSummary?.invoices ?? [];
                  const primaryInvoice = linkedInvoices[0];
                  if (!primaryInvoice) {
                    return <td key={columnId} className="px-4 py-3" style={{ width: `${width}px` }}><span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-titan-xs font-medium text-slate-700">No Invoice</span></td>;
                  }
                  const invoiceLabel = primaryInvoice.displayNumber || String(primaryInvoice.invoiceNumber ?? "Invoice");
                  return <td key={columnId} className="px-4 py-3" onClick={(event) => event.stopPropagation()} style={{ width: `${width}px` }}><div className="flex items-center gap-1.5"><button type="button" className="text-titan-sm font-medium text-titan-accent hover:underline" onClick={() => navigate(ROUTES.invoices.detail(primaryInvoice.id))}>{invoiceLabel}</button>{linkedInvoices.length > 1 ? <span className="text-xs text-titan-text-secondary">+{linkedInvoices.length - 1}</span> : null}</div></td>;
                }
                  
                case "actions":
                  return (
                    <td key={columnId} className="px-4 py-3" onClick={(e) => e.stopPropagation()} style={{ width: `${width}px` }}>
                      <div className="flex min-w-max flex-wrap items-center gap-2">
                        {(order.invoiceSummary?.invoiceCount ?? 0) === 0 ? <Button variant="outline" size="sm" disabled={!order.invoiceCreationEligibility?.canCreate || createFirstInvoiceMutation.isPending} title={order.invoiceCreationEligibility?.canCreate ? "Create the first linked invoice" : order.invoiceCreationEligibility?.reason || "This Order cannot create an invoice."} onClick={() => createFirstInvoiceMutation.mutate(order.id)}>{createFirstInvoiceMutation.isPending ? "Creating…" : "Create Invoice"}</Button> : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(ROUTES.orders.detail(order.id))}
                          aria-label={`View order ${order.orderNumber}`}
                        >
                          <Eye className="mr-1.5 h-4 w-4" />View Order
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => window.open(ROUTES.orders.traveler(order.id), "_blank", "noopener,noreferrer")} aria-label={`Open traveler for order ${order.orderNumber}`}>
                          <Ticket className="mr-1.5 h-4 w-4" />Traveler
                        </Button>
                        {canCloseJobOverride({ orderId: order.id, orderState: order.state, orderFulfillmentStatus: order.fulfillmentStatus }, isAdminOrOwner) ? (
                          <Button variant="outline" size="sm" onClick={() => setOverrideTarget({
                            orderId: order.id,
                            orderNumber: order.orderNumber,
                            jobName: order.label,
                            purchaseOrderNumber: order.poNumber,
                            customerName: customerName || null,
                            jobStatus: getOrderJobStatus({ orderId: order.id, orderState: order.state, orderStatus: order.status, orderStatusPillValue: order.statusPillValue, orderFulfillmentStatus: order.fulfillmentStatus }),
                          })}>
                            <ShieldCheck className="mr-1.5 h-4 w-4" />Close Job Override
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  );
                  
                default:
                  return null;
              }
            };

            return (
              <tr
                key={order.id}
                className="border-b border-titan-border-subtle last:border-0 hover:bg-titan-bg-table-row transition-colors cursor-pointer"
                onClick={() => navigate(ROUTES.orders.detail(order.id))}
              >
                {orderedVisibleColumns.map(columnId => renderCell(columnId))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    <Dialog open={showColumnSettings} onOpenChange={setShowColumnSettings}>
      <DialogContent className="bg-titan-bg-card border-titan-border">
        <DialogHeader>
          <DialogTitle className="text-titan-text-primary">Edit Columns</DialogTitle>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Choose which columns to show in this table.
          </p>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {allColumns.map(column => (
            <div key={column.id} className="flex items-center space-x-3">
              <Checkbox
                id={`column-${column.id}`}
                checked={visibleColumns.includes(column.id)}
                onCheckedChange={() => toggleColumn(column.id)}
                className="border-titan-border-subtle data-[state=checked]:bg-titan-accent data-[state=checked]:border-titan-accent"
              />
              <label
                htmlFor={`column-${column.id}`}
                className="text-titan-sm text-titan-text-primary cursor-pointer flex-1"
              >
                {column.label}
              </label>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-4 border-t border-titan-border-subtle">
          <Button
            variant="outline"
            size="sm"
            onClick={selectAll}
            className="flex-1 border-titan-border-subtle text-titan-text-primary hover:bg-titan-bg-card-highlight"
          >
            Select All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={resetToDefault}
            className="flex-1 border-titan-border-subtle text-titan-text-primary hover:bg-titan-bg-card-highlight"
          >
            Reset to Default
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <CloseJobOverrideDialog target={overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)} />
  </>
  );
}

function QuotesTable({
  quotes,
  searchQuery,
  statusFilter,
  compact,
  customerName,
}: {
  quotes: any[];
  searchQuery: string;
  statusFilter: string;
  compact?: boolean;
  customerName?: string;
}) {
  const navigate = useNavigate();

  const filteredQuotes = useMemo(() => {
    return quotes.filter((quote) => {
      const matchesSearch =
        !searchQuery ||
        documentNumberMatchesSearch({
          query: searchQuery,
          displayNumber: quote.displayNumber,
          numberCore: quote.numberCore,
          legacyNumber: quote.quoteNumber,
        });
      const matchesStatus =
        statusFilter === "all" || quote.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [quotes, searchQuery, statusFilter]);

  if (filteredQuotes.length === 0) {
    const isFiltered = searchQuery || statusFilter !== "all";
    return (
      <div className="py-12 text-center text-titan-text-secondary">
        {isFiltered ? (
          <p className="text-sm">No quotes match your filters.</p>
        ) : (
          <p className="text-sm">
            No quotes yet{customerName ? ` for ${customerName}` : ""}.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Quote #
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Date
            </th>
            {!compact && (
              <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                Description
              </th>
            )}
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Total
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredQuotes.map((quote: any) => {
            const firstLine = quote.lineItems?.[0]?.description || "Quote items";

            return (
              <tr
                key={quote.id}
                className="border-b border-titan-border-subtle last:border-0 hover:bg-titan-bg-table-row transition-colors cursor-pointer"
                onClick={() => navigate(ROUTES.quotes.detail(quote.id))}
              >
                <td className="px-4 py-3">
                  <span className="text-titan-sm font-medium text-titan-accent">
                    {resolveDocumentDisplayNumber({
                      displayNumber: quote.displayNumber,
                      numberCore: quote.numberCore,
                      legacyNumber: quote.quoteNumber,
                    }) || "Draft"}
                  </span>
                </td>
                <td className="px-4 py-3 text-titan-sm text-titan-text-secondary">
                  {formatDate(quote.createdAt)}
                </td>
                {!compact && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-amber-500/20 rounded-titan-sm flex items-center justify-center">
                        <FileText className="w-3 h-3 text-amber-400" />
                      </div>
                      <span className="text-titan-sm text-titan-text-primary truncate max-w-[250px]">
                        {firstLine}
                      </span>
                    </div>
                  </td>
                )}
                <td className="px-4 py-3 text-titan-sm font-medium text-titan-success">
                  {formatCurrency(quote.totalPrice)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-titan-xs font-medium border",
                      getStatusStyle(quote.status || "draft")
                    )}
                  >
                    {formatStatusLabel(quote.status || "draft")}
                  </span>
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
                      onClick={() => navigate(ROUTES.quotes.detail(quote.id))}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {!compact && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated">
                          <Download className="w-4 h-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-titan-bg-card border-titan-border">
                            <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Convert to Order</DropdownMenuItem>
                            <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Send Email</DropdownMenuItem>
                            <DropdownMenuItem className="text-titan-text-primary hover:bg-titan-bg-card-elevated">Duplicate</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CUSTOMER_INVOICE_COLUMNS: ColumnConfig[] = [
  { id: "invoiceNumber", label: "Invoice #", visible: true, order: 0, locked: true },
  { id: "jobOrder", label: "Job / Order", visible: true, order: 1 },
  { id: "poNumber", label: "PO #", visible: true, order: 2 },
  { id: "orderNumber", label: "Order #", visible: true, order: 3 },
  { id: "invoiceDate", label: "Invoice Date", visible: true, order: 4 },
  { id: "lastSent", label: "Last Sent", visible: true, order: 5 },
  { id: "dueDate", label: "Due Date", visible: true, order: 6 },
  { id: "approval", label: "Approval", visible: true, order: 7 },
  { id: "jobStatus", label: "Job Status", visible: true, order: 8 },
  { id: "total", label: "Total", visible: true, order: 9 },
  { id: "balance", label: "Balance", visible: true, order: 10 },
  { id: "invoiceStatus", label: "Invoice Status", visible: true, order: 11 },
  { id: "actions", label: "Actions", visible: true, order: 12, locked: true },
];

function InvoicesTable({
  customerId,
  searchQuery,
  statusFilter,
  customerName,
}: {
  customerId: string;
  searchQuery: string;
  statusFilter: string;
  customerName?: string;
}) {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const approveInvoices = useApproveInvoicesForAccounting();
  const organizationId = user?.lastActiveOrgId;
  const columnConfig = useTableColumnConfig(`customer_detail_invoices:org_${organizationId || "unknown"}:user_${user?.id || "anonymous"}`, CUSTOMER_INVOICE_COLUMNS);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<CloseJobOverrideTarget | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortPreference, setSortPreference] = useState<CustomerInvoiceTableSortPreference>(() => readCustomerInvoiceTableSortPreference(user?.id, organizationId));
  const isAdminOrOwner = Boolean(isAdmin || ["owner", "admin"].includes(String(user?.role || "").toLowerCase()));

  // Layout and sort settings are personal operator preferences. They are
  // deliberately keyed without a customer id so a backlog workflow carries
  // across Customer A, Customer B, and browser navigation.
  useEffect(() => {
    setSortPreference(readCustomerInvoiceTableSortPreference(user?.id, organizationId));
  }, [organizationId, user?.id]);

  useEffect(() => {
    setPage(1);
  }, [customerId, searchQuery, statusFilter]);

  const updateSort = (sortBy: CustomerInvoiceSortField) => {
    const next: CustomerInvoiceTableSortPreference = {
      version: 1,
      sortBy,
      sortDir: sortPreference.sortBy === sortBy && sortPreference.sortDir === "asc" ? "desc" : "asc",
    };
    setSortPreference(next);
    persistCustomerInvoiceTableSortPreference(user?.id, organizationId, next);
    setPage(1);
  };

  const resetTable = () => {
    columnConfig.reset();
    clearCustomerInvoiceTableSortPreference(user?.id, organizationId);
    setSortPreference(DEFAULT_CUSTOMER_INVOICE_TABLE_SORT);
    setPage(1);
  };

  const invoicePage = useInvoicesPage({
    customerId,
    status: statusFilter === "all" ? undefined : statusFilter,
    search: searchQuery || undefined,
    sortBy: customerInvoiceSortApiField(sortPreference.sortBy),
    sortDir: sortPreference.sortDir,
    page,
    pageSize,
  });
  const invoices = invoicePage.data?.items ?? [];
  const pagination = invoicePage.data?.pagination;
  const visibleColumns = columnConfig.columns.filter((column) => column.visible);

  const approvalLabel = (invoice: any) => {
    const currentVersion = Number(invoice.invoiceVersion || 1);
    if (invoice.accountingApprovedAt && !invoice.accountingApprovalRevokedAt && Number(invoice.accountingApprovedVersion || 0) === currentVersion) return "Approved for Accounting";
    if (invoice.accountingApprovalRevokedAt || (invoice.accountingApprovedAt && Number(invoice.accountingApprovedVersion || 0) !== currentVersion)) return "Needs Reapproval";
    return "Not Approved";
  };
  const canApprove = (invoice: any) => !["void", "canceled", "cancelled"].includes(String(invoice.status || "").toLowerCase())
    && String(invoice.importSource || "").toLowerCase() !== "quickbooks"
    && !invoice.isHistorical
    && approvalLabel(invoice) !== "Approved for Accounting";
  const approve = async (invoice: any) => {
    try {
      await approveInvoices.mutateAsync([invoice.id]);
      toast({ title: "Approved for Accounting" });
    } catch (error) {
      toast({ variant: "destructive", title: "Accounting approval failed", description: error instanceof Error ? error.message : "Unable to approve the invoice." });
    }
  };

  if (!invoicePage.isLoading && invoices.length === 0) {
    const isFiltered = searchQuery || statusFilter !== "all";
    return (
      <div className="py-12 text-center text-titan-text-secondary">
        {isFiltered ? (
          <p className="text-sm">No invoices match your filters.</p>
        ) : (
          <p className="text-sm">
            No invoices yet{customerName ? ` for ${customerName}` : ""}.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-3">
      <p className="text-sm text-titan-text-secondary">Invoice layout and sorting apply across all customers.</p>
      <Button variant="outline" size="sm" onClick={() => setColumnsOpen(true)}><Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Columns</Button>
    </div>
    <div className="overflow-x-auto rounded-titan-xl border border-titan-border-subtle bg-titan-bg-card">
      <table className="min-w-max w-full">
        <thead>
          <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
            {visibleColumns.map((column) => {
              const sortable = (CUSTOMER_INVOICE_SORT_FIELDS as readonly string[]).includes(column.id);
              const active = sortPreference.sortBy === column.id;
              return <th key={column.id} className={cn("whitespace-nowrap px-3 py-3 text-left text-titan-xs font-semibold uppercase tracking-wider text-titan-text-muted", column.id === "actions" && "sticky right-0 z-10 bg-titan-bg-card-elevated")}>
                {sortable ? <Button variant="ghost" size="sm" className="h-auto px-0 py-0 text-titan-xs font-semibold uppercase tracking-wider text-titan-text-muted hover:text-titan-text-primary" onClick={() => updateSort(column.id as CustomerInvoiceSortField)} aria-label={`Sort by ${column.label}`}>
                  {column.label}{active ? (sortPreference.sortDir === "asc" ? <ArrowUp className="ml-1 h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="ml-1 h-3.5 w-3.5" aria-hidden="true" />) : <ArrowUpDown className="ml-1 h-3.5 w-3.5 opacity-50" aria-hidden="true" />}
                </Button> : column.label}
              </th>;
            })}
          </tr>
        </thead>
        <tbody>
          {invoicePage.isLoading ? <tr><td className="px-3 py-8 text-center text-titan-text-secondary" colSpan={visibleColumns.length}>Loading invoices…</td></tr> : null}
          {invoices.map((inv: InvoiceListItem) => (
            <tr
              key={inv.id}
              className="border-b border-titan-border-subtle last:border-0 hover:bg-titan-bg-table-row transition-colors cursor-pointer"
              onClick={() => navigate(ROUTES.invoices.detail(inv.id))}
            >
              {visibleColumns.map((column) => {
                switch (column.id) {
                  case "invoiceNumber": return <td key={column.id} className="whitespace-nowrap px-3 py-3"><span className="text-titan-sm font-medium text-titan-accent">{resolveDocumentDisplayNumber({ displayNumber: inv.displayNumber, numberCore: inv.numberCore, legacyNumber: inv.invoiceNumber }) || inv.invoiceNumber}</span></td>;
                  case "jobOrder": return <td key={column.id} className="max-w-56 px-3 py-3 text-titan-sm text-titan-text-secondary">{inv.jobName || inv.orderName || inv.orderNumber || "—"}</td>;
                  case "poNumber": return <td key={column.id} className="whitespace-nowrap px-3 py-3 text-titan-sm text-titan-text-secondary">{inv.purchaseOrderNumber || "—"}</td>;
                  case "orderNumber": return <td key={column.id} className="whitespace-nowrap px-3 py-3 text-titan-sm text-titan-text-secondary">{inv.orderNumber || "—"}</td>;
                  case "invoiceDate": return <td key={column.id} className="whitespace-nowrap px-3 py-3 text-titan-sm text-titan-text-secondary">{formatDate(inv.issueDate || inv.createdAt)}</td>;
                  case "lastSent": return <td key={column.id} className="whitespace-nowrap px-3 py-3 text-titan-sm text-titan-text-secondary">{inv.lastSentAt ? formatDate(inv.lastSentAt) : "Not sent"}</td>;
                  case "dueDate": return <td key={column.id} className="whitespace-nowrap px-3 py-3 text-titan-sm text-titan-text-secondary">{formatDate(inv.dueDate)}</td>;
                  case "approval": return <td key={column.id} className="whitespace-nowrap px-3 py-3 text-titan-sm text-titan-text-secondary">{approvalLabel(inv)}</td>;
                  case "jobStatus": return <td key={column.id} className="whitespace-nowrap px-3 py-3 text-titan-sm text-titan-text-secondary">{getOrderJobStatus(inv)}</td>;
                  case "total": return <td key={column.id} className="whitespace-nowrap px-3 py-3 text-right text-titan-sm font-medium text-titan-text-primary">{formatCurrency(inv.displayTotal || inv.total)}</td>;
                  case "balance": return <td key={column.id} className="whitespace-nowrap px-3 py-3 text-right text-titan-sm font-medium text-titan-warning">{formatCurrency(inv.displayRemaining ?? inv.balanceDue ?? inv.total)}</td>;
                  case "invoiceStatus": return <td key={column.id} className="whitespace-nowrap px-3 py-3"><span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-titan-xs font-medium border", getStatusStyle(inv.status))}>{inv.displayStatus || formatStatusLabel(inv.status)}</span></td>;
                  case "actions": return <td key={column.id} className="sticky right-0 z-10 bg-titan-bg-card px-3 py-3" onClick={(event) => event.stopPropagation()}><div className="flex min-w-max flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={() => navigate(ROUTES.invoices.detail(inv.id))} aria-label={`View invoice ${inv.invoiceNumber}`}><Eye className="mr-1.5 h-4 w-4" />View</Button>{isAdminOrOwner && canApprove(inv) ? <Button variant="outline" size="sm" disabled={approveInvoices.isPending} onClick={() => void approve(inv)}><Check className="mr-1.5 h-4 w-4" />Approve</Button> : null}{isAdminOrOwner && String(inv.importSource || "").toLowerCase() !== "quickbooks" ? <InvoiceSendQuickAction invoiceId={inv.id} invoiceNumber={inv.invoiceNumber} alreadySent={Boolean(inv.lastSentAt)} /> : null}{canCloseJobOverride(inv, isAdminOrOwner) ? <Button variant="outline" size="sm" onClick={() => setOverrideTarget({ orderId: inv.orderId, orderNumber: inv.orderNumber, jobName: inv.jobName || inv.orderName, purchaseOrderNumber: inv.purchaseOrderNumber, customerName: inv.companyName || customerName || null, invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, jobStatus: getOrderJobStatus(inv) })}><ShieldCheck className="mr-1.5 h-4 w-4" />Close Job Override</Button> : null}</div></td>;
                  default: return null;
                }
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {pagination ? <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3 text-sm text-titan-text-secondary"><span>{pagination.totalCount === 0 ? "0 invoices" : `${(pagination.page - 1) * pagination.pageSize + 1}-${Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of ${pagination.totalCount} invoices`}</span><div className="flex items-center gap-2"><Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger className="h-8 w-[118px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25 per page</SelectItem><SelectItem value="50">50 per page</SelectItem><SelectItem value="100">100 per page</SelectItem></SelectContent></Select><Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><span>Page {pagination.page} of {pagination.totalPages}</span><Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Next</Button></div></div> : null}
    <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Configure Invoice Columns</DialogTitle><DialogDescription>Changes apply to Customer → Invoices for every customer you open.</DialogDescription></DialogHeader><div className="space-y-2 py-2">{columnConfig.columns.map((column) => <div key={column.id} className="flex items-center gap-3"><Checkbox id={`customer-invoice-column-${column.id}`} checked={column.visible} disabled={column.locked} onCheckedChange={(value) => columnConfig.setColumnVisibility(column.id, Boolean(value))} /><Label htmlFor={`customer-invoice-column-${column.id}`} className="text-sm">{column.label}{column.locked ? " (required)" : ""}{sortPreference.sortBy === column.id ? ` · sorted ${sortPreference.sortDir}` : ""}</Label><div className="ml-auto flex items-center gap-1"><Button variant="outline" size="icon" className="h-8 w-8" disabled={!columnConfig.canMoveColumn(column.id, "up")} onClick={() => columnConfig.moveColumn(column.id, "up")} aria-label={`Move ${column.label} up`}><ArrowUp className="h-4 w-4" /></Button><Button variant="outline" size="icon" className="h-8 w-8" disabled={!columnConfig.canMoveColumn(column.id, "down")} onClick={() => columnConfig.moveColumn(column.id, "down")} aria-label={`Move ${column.label} down`}><ArrowDown className="h-4 w-4" /></Button></div></div>)}</div><DialogFooter><Button variant="outline" onClick={resetTable}><RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />Reset to default</Button><Button onClick={() => setColumnsOpen(false)}>Close</Button></DialogFooter></DialogContent></Dialog>
    <CloseJobOverrideDialog target={overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)} />
    </>
  );
}

// StatementTab is now imported from ./StatementTab

// ============================================================
// LOADING SKELETON
// ============================================================

function LoadingSkeleton({ layoutMode }: { layoutMode: LayoutMode }) {
  const isEmbedded = layoutMode === "embedded";

  return (
    <div className={cn("space-y-6", isEmbedded ? "p-4" : "p-6")}>
      {/* Header skeleton */}
      <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl p-5">
        <div className="flex items-center gap-4">
          <Skeleton className="w-14 h-14 rounded-titan-lg bg-titan-bg-card-elevated" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48 bg-titan-bg-card-elevated" />
            <Skeleton className="h-4 w-32 bg-titan-bg-card-elevated" />
            <Skeleton className="h-3 w-64 bg-titan-bg-card-elevated" />
          </div>
        </div>
      </div>

      {/* Stats skeleton */}
      <div className={cn("grid gap-3", isEmbedded ? "grid-cols-4" : "grid-cols-7")}>
        {Array.from({ length: isEmbedded ? 4 : 7 }).map((_, i) => (
          <div key={i} className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg p-4">
            <div className="flex justify-between mb-3">
              <Skeleton className="h-3 w-16 bg-titan-bg-card-elevated" />
              <Skeleton className="h-8 w-8 rounded-titan-md bg-titan-bg-card-elevated" />
            </div>
            <Skeleton className="h-8 w-20 mb-1 bg-titan-bg-card-elevated" />
            <Skeleton className="h-3 w-24 bg-titan-bg-card-elevated" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl p-4">
        <div className="flex gap-2 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-titan-md bg-titan-bg-card-elevated" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded bg-titan-bg-card-elevated" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function EnhancedCustomerView({
  customerId,
  layoutMode = "full",
  onBack,
  onSectionHome,
  notFoundFallback,
}: EnhancedCustomerViewProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>("orders");
  const [period, setPeriod] = useState<TimePeriod>("month");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [invoiceFilter, setInvoiceFilter] = useState<"all" | "no_invoice" | "has_invoice">("all");

  const isEmbedded = layoutMode === "embedded";

  // Data fetching
  const { data: customer, isLoading: isLoadingCustomer } = useCustomer(customerId);
  const { data: orders = [], isLoading: isLoadingOrders } = useOrders({
    customerId,
    invoice: invoiceFilter === "all" ? undefined : invoiceFilter,
  });
  const { data: invoices = [], isLoading: isLoadingInvoices } = useInvoices({
    customerId,
  });

  // Historical customer URLs remain useful after a merge: resolve the
  // archived source record to the retained canonical survivor.
  useEffect(() => {
    if (customer?.mergedIntoCustomerId && customer.mergedIntoCustomerId !== customerId) {
      navigate(ROUTES.customers.detail(customer.mergedIntoCustomerId), { replace: true });
    }
  }, [customer?.mergedIntoCustomerId, customerId, navigate]);

  // Quotes from customer data
  const quotes = customer?.quotes || [];

  // Activity summary (lightweight — open jobs, overdue invoices, last dates)
  const { data: activitySummary = null } = useQuery<CustomerActivitySummary>({
    queryKey: ["/api/customers", customerId, "activity"],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${customerId}/activity`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch customer activity");
      return res.json();
    },
    staleTime: 60_000,
    enabled: !!customerId,
  });

  // Tab configuration with counts
  const tabs = [
    { key: "orders" as const, label: "Orders", count: orders.length },
    { key: "quotes" as const, label: "Quotes", count: quotes.length },
    { key: "invoices" as const, label: "Invoices", count: invoices.length },
    ...(!isEmbedded ? [{ key: "transactions" as const, label: "Transactions" }] : []),
    ...(!isEmbedded ? [{ key: "statement" as const, label: "Statement" }] : []),
  ];

  // Loading state
  if (isLoadingCustomer) {
    return <LoadingSkeleton layoutMode={layoutMode} />;
  }

  // Not found state
  if (!customer) {
    if (notFoundFallback) {
      return <>{notFoundFallback}</>;
    }

    return (
      <div className={cn(
        "flex items-center justify-center",
        isEmbedded ? "p-4 min-h-[300px]" : "p-6 min-h-[400px]"
      )}>
        <div className="text-center">
          <Building2 className="w-16 h-16 text-titan-text-secondary mx-auto mb-4" />
          <h2 className="text-titan-xl font-semibold text-titan-text-primary mb-2">
            Customer Not Found
          </h2>
          <p className="text-titan-text-secondary mb-4">
            The customer you're looking for doesn't exist or has been removed.
          </p>
          {!isEmbedded && (
            <div className="flex items-center justify-center">
              <BackNavControls
                onBack={() => (onBack ? onBack() : navigate(ROUTES.customers.list))}
                sectionLabel="Customers"
                onSectionHome={() => (onSectionHome ? onSectionHome() : navigate(ROUTES.customers.list))}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "w-full space-y-6",
      isEmbedded ? "p-4" : "p-6"
    )}>
      {/* Customer Header Card */}
      <CustomerHeader
        customer={customer}
        layoutMode={layoutMode}
        onBack={onBack}
        onSectionHome={onSectionHome}
        onSwitchTab={(tab) => setActiveTab(tab as TabType)}
        activitySummary={activitySummary}
      />

      {/* Stats Cards Grid */}
      <CustomerStatsGrid
        customer={customer}
        orders={orders}
        quotes={quotes}
        invoices={invoices}
        period={period}
        layoutMode={layoutMode}
        onPeriodChange={setPeriod}
      />

      {/* Contacts Panel - Only in full mode */}
      <ContactsPanel customer={customer} layoutMode={layoutMode} />

      {/* Portal Access Panel - Only in full mode */}
      <PortalAccessPanel customer={customer} layoutMode={layoutMode} />

      {/* Activity Section */}
      <div className="mt-4">
        {/* Compact Header Bar: Search Left, Tabs Center, Status Right */}
        <div className="flex items-center justify-between gap-4 rounded-t-2xl bg-[#111827] border border-slate-800 px-4 py-2">
          {/* Left: Search Input */}
          <div className="flex items-center">
            {activeTab !== "transactions" && activeTab !== "statement" && (
              <div className="relative w-64 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder={`Search ${activeTab}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm bg-slate-900/50 border-slate-700 text-white placeholder:text-slate-500 rounded-lg"
                />
              </div>
            )}
          </div>

          {/* Center: Tabs */}
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    setSearchQuery("");
                    setStatusFilter("all");
                    setInvoiceFilter("all");
                  }}
                  className={cn(
                    "px-3 py-1 text-sm font-medium rounded-full flex items-center gap-2 transition-colors",
                    activeTab === tab.key
                      ? "bg-blue-600 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  )}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span
                      className={cn(
                        "text-xs px-1.5 py-0.5 rounded-full",
                        activeTab === tab.key
                          ? "bg-white/20"
                          : "bg-slate-700"
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Right: Status Filter */}
          <div className="flex items-center">
            {activeTab !== "transactions" && activeTab !== "statement" && (
              <div className="flex items-center gap-2">
                {activeTab === "orders" ? <Select value={invoiceFilter} onValueChange={(value) => setInvoiceFilter(value as "all" | "no_invoice" | "has_invoice")}><SelectTrigger className="w-[165px] h-9 text-sm bg-slate-900/50 border-slate-700 text-white rounded-lg"><SelectValue placeholder="Invoice: All" /></SelectTrigger><SelectContent className="bg-slate-900 border-slate-700"><SelectItem value="all" className="text-white">Invoice: All</SelectItem><SelectItem value="no_invoice" className="text-white">Invoice: No Invoice</SelectItem><SelectItem value="has_invoice" className="text-white">Invoice: Has Invoice</SelectItem></SelectContent></Select> : null}
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px] h-9 text-sm bg-slate-900/50 border-slate-700 text-white rounded-lg">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700">
                    <SelectItem value="all" className="text-white">All Status</SelectItem>
                    {activeTab === "orders" && <><SelectItem value="new" className="text-white">New</SelectItem><SelectItem value="in_production" className="text-white">In Production</SelectItem><SelectItem value="completed" className="text-white">Completed</SelectItem><SelectItem value="shipped" className="text-white">Shipped</SelectItem></>}
                    {activeTab === "quotes" && <><SelectItem value="draft" className="text-white">Draft</SelectItem><SelectItem value="pending_approval" className="text-white">Pending</SelectItem><SelectItem value="approved" className="text-white">Approved</SelectItem><SelectItem value="rejected" className="text-white">Rejected</SelectItem></>}
                    {activeTab === "invoices" && <><SelectItem value="draft" className="text-white">Draft</SelectItem><SelectItem value="sent" className="text-white">Sent</SelectItem><SelectItem value="paid" className="text-white">Paid</SelectItem><SelectItem value="overdue" className="text-white">Overdue</SelectItem></>}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* Table Container - Seamlessly Connected */}
        <div className="bg-titan-bg-card border border-slate-800 border-t-0 rounded-b-2xl overflow-hidden shadow-titan-card">
          <div className={cn("min-h-[300px]", isEmbedded && "min-h-[200px]")}>
            {activeTab === "orders" && (
              isLoadingOrders ? (
                <div className="p-8 text-center text-titan-text-secondary">
                  Loading orders...
                </div>
              ) : (
                <OrdersTable
                  orders={orders}
                  searchQuery={searchQuery}
                  statusFilter={statusFilter}
                  compact={isEmbedded}
                  customerName={customer.companyName}
                  quoteCount={quotes.length}
                  invoiceFilter={invoiceFilter}
                />
              )
            )}
            {activeTab === "quotes" && (
              <QuotesTable
                quotes={quotes}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                compact={isEmbedded}
                customerName={customer.companyName}
              />
            )}
            {activeTab === "invoices" && (
              isLoadingInvoices ? (
                <div className="p-8 text-center text-titan-text-secondary">
                  Loading invoices...
                </div>
              ) : (
                <InvoicesTable
                  customerId={customer.id}
                  searchQuery={searchQuery}
                  statusFilter={statusFilter}
                  customerName={customer.companyName}
                />
              )
            )}
            {activeTab === "transactions" && <TransactionsTab customerId={customer.id} customer={customer} />}
            {activeTab === "statement" && <StatementTabComponent customerId={customer.id} customer={customer} />}
          </div>
        </div>
      </div>
    </div>
  );
}
