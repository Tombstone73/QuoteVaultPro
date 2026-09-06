import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Building2,
  MapPin,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  User,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  GitMerge,
  Pencil,
  Settings2,
  X,
  Check,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CUSTOMER_PAYMENT_TERMS, type CustomerPaymentTerm } from "@shared/customerCommercialConfiguration";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildCustomerListQueryKey,
  buildCustomerListSearchParams,
  normalizeCustomerListResponse,
  type CustomerListResult,
  type CustomerListSortBy,
  type CustomerListSortDir,
  type CustomerListViewMode,
} from "@/lib/customerListQuery";

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const CUSTOMER_COLUMN_PREFERENCE_PREFIX = "titanos.customers.listColumns";

const paymentTermsLabel = (value: string | null | undefined) =>
  CUSTOMER_PAYMENT_TERMS.find((term) => term.value === value)?.label ?? "Due on Receipt";

function formatCurrency(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(amount) ? amount : 0);
}

function parseCurrencyInput(value: string): number | null {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

type Customer = {
  id: string;
  companyName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  status: string | null;
  customerType: string | null;
  currentBalance: string | null;
  availableCredit: string | null;
  creditExposure?: string | null;
  creditLimit?: string | null;
  creditLimitConfigured?: boolean;
  paymentTerms?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  orderCount?: number;
  lastOrderDate?: string | null;
  contacts?: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; isPrimary: boolean }[];
};

function getContact(customer: Customer) {
  return customer.contacts?.find((c) => c.isPrimary) || customer.contacts?.[0] || null;
}

function getContactName(customer: Customer): string {
  const primary = getContact(customer);
  if (!primary) return "";
  return `${primary.firstName} ${primary.lastName}`.trim();
}

function getContactLabel(customer: Customer): { text: string; muted: boolean } {
  const name = getContactName(customer);
  if (name) return { text: name, muted: false };
  if (customer.email) return { text: customer.email, muted: false };
  if (customer.phone) return { text: customer.phone, muted: false };
  return { text: "No contact listed", muted: true };
}

function getCustomerLocation(customer: Customer): string {
  const city = customer.shippingCity || customer.billingCity || customer.city;
  const state = customer.shippingState || customer.billingState || customer.state;
  return [city, state].filter(Boolean).join(", ");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function getStatusBadgeClass(status: string | null) {
  switch (status) {
    case "active":
      return "bg-green-500/10 text-green-600 border-green-500/20";
    case "suspended":
      return "bg-red-500/10 text-red-600 border-red-500/20";
    case "on_hold":
      return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
    case "inactive":
      return "bg-gray-500/10 text-gray-600 border-gray-500/20";
    default:
      return "bg-gray-500/10 text-gray-500 border-gray-500/20";
  }
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: CustomerListSortDir;
}) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5" />;
  return direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
}

interface CustomerListProps {
  selectedCustomerId?: string;
  onSelectCustomer: (customerId: string) => void;
  onNewCustomer: () => void;
  search: string;
  viewMode?: CustomerListViewMode;
  collapseOnSelect?: boolean;
  onMergeCustomers?: (customerIds: string[]) => void;
  statusFilter?: string;
  onStatusFilterChange?: (value: string) => void;
  typeFilter?: string;
  onTypeFilterChange?: (value: string) => void;
  showFilterControls?: boolean;
  canManageCommercialConfiguration?: boolean;
  preferenceUserId?: string | null;
}

export default function CustomerList({
  selectedCustomerId,
  onSelectCustomer,
  onNewCustomer,
  search,
  viewMode = "split",
  collapseOnSelect = false,
  onMergeCustomers,
  statusFilter: controlledStatusFilter,
  onStatusFilterChange,
  typeFilter: controlledTypeFilter,
  onTypeFilterChange,
  showFilterControls = true,
  canManageCommercialConfiguration = false,
  preferenceUserId,
}: CustomerListProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const selectionEnabled = Boolean(onMergeCustomers || canManageCommercialConfiguration);
  const [localStatusFilter, setLocalStatusFilter] = useState<string>("all");
  const [localTypeFilter, setLocalTypeFilter] = useState<string>("all");
  const statusFilter = controlledStatusFilter ?? localStatusFilter;
  const typeFilter = controlledTypeFilter ?? localTypeFilter;
  const setStatusFilter = onStatusFilterChange ?? setLocalStatusFilter;
  const setTypeFilter = onTypeFilterChange ?? setLocalTypeFilter;
  const [sortBy, setSortBy] = useState<CustomerListSortBy>("name");
  const [sortDir, setSortDir] = useState<CustomerListSortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [bulkDialog, setBulkDialog] = useState<"terms" | "credit" | null>(null);
  const [bulkPaymentTerms, setBulkPaymentTerms] = useState<CustomerPaymentTerm>("due_on_receipt");
  const [bulkCreditLimitDraft, setBulkCreditLimitDraft] = useState("");
  const [bulkCreditLimitNotSet, setBulkCreditLimitNotSet] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [editingCreditCustomerId, setEditingCreditCustomerId] = useState<string | null>(null);
  const [editingTermsCustomerId, setEditingTermsCustomerId] = useState<string | null>(null);
  const [creditLimitDraft, setCreditLimitDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const columnPreferenceKey = `${CUSTOMER_COLUMN_PREFERENCE_PREFIX}.${preferenceUserId || "current"}`;
  const supportedColumns = [
    { id: "company", label: "Company Name", defaultVisible: true },
    { id: "primaryContact", label: "Primary Contact", defaultVisible: true },
    { id: "email", label: "Email", defaultVisible: true },
    { id: "phone", label: "Phone", defaultVisible: true },
    { id: "status", label: "Status", defaultVisible: true },
    { id: "customerType", label: "Customer Type", defaultVisible: true },
    { id: "updatedAt", label: "Last Updated", defaultVisible: true },
    ...(canManageCommercialConfiguration ? [
      { id: "paymentTerms", label: "Terms", defaultVisible: false },
      { id: "credit", label: "Credit", defaultVisible: false },
    ] : []),
  ];
  const defaultVisibleColumns = supportedColumns.filter((column) => column.defaultVisible).map((column) => column.id);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(defaultVisibleColumns);
  const [loadedColumnPreferenceKey, setLoadedColumnPreferenceKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(columnPreferenceKey);
      const parsed = stored ? JSON.parse(stored) : null;
      if (Array.isArray(parsed)) {
        const supportedIds = new Set(supportedColumns.map((column) => column.id));
        const visible = parsed.filter((id): id is string => typeof id === "string" && supportedIds.has(id));
        setVisibleColumns(visible.length > 0 ? visible : defaultVisibleColumns);
      } else {
        setVisibleColumns(defaultVisibleColumns);
      }
    } catch {
      setVisibleColumns(defaultVisibleColumns);
    }
    setLoadedColumnPreferenceKey(columnPreferenceKey);
  // The preference needs to be re-scoped if the authenticated user or allowed columns changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnPreferenceKey, canManageCommercialConfiguration]);

  useEffect(() => {
    if (loadedColumnPreferenceKey !== columnPreferenceKey) return;
    try {
      window.localStorage.setItem(columnPreferenceKey, JSON.stringify(visibleColumns));
    } catch {
      // Browser preference persistence is optional.
    }
  }, [columnPreferenceKey, loadedColumnPreferenceKey, visibleColumns]);

  const isColumnVisible = (columnId: string) => visibleColumns.includes(columnId);
  const toggleColumn = (columnId: string) => setVisibleColumns((current) =>
    current.includes(columnId) ? current.filter((id) => id !== columnId) : [...current, columnId],
  );

  const updateCustomerMutation = useMutation({
    mutationFn: async ({ customerId, patch }: { customerId: string; patch: Record<string, unknown> }) => {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Unable to update customer financial settings.");
      }
      return response.json();
    },
    onSuccess: async (_updated, variables) => {
      setEditError(null);
      setEditingCreditCustomerId(null);
      setEditingTermsCustomerId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/customers"] }),
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${variables.customerId}`] }),
      ]);
    },
    onError: (error: Error) => setEditError(error.message),
  });

  const bulkCommercialUpdateMutation = useMutation({
    mutationFn: async (payload: { operation: "set_payment_terms"; paymentTerms: CustomerPaymentTerm } | { operation: "set_credit_limit"; creditLimit: number | null }) => {
      const response = await fetch("/api/customers/bulk-commercial-configuration", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerIds: Array.from(selectedCustomerIds), ...payload }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Unable to update the selected customers.");
      return body?.data ?? body;
    },
    onSuccess: async (result: { updatedCount?: number }, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      setSelectedCustomerIds(new Set());
      setBulkDialog(null);
      setBulkError(null);
      toast({
        title: variables.operation === "set_payment_terms" ? "Payment terms updated" : "Credit limit updated",
        description: `${result?.updatedCount ?? 0} customer${result?.updatedCount === 1 ? "" : "s"} updated.`,
      });
    },
    onError: (error: Error) => setBulkError(error.message),
  });

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, typeFilter, sortBy, sortDir, pageSize]);

  const queryState = {
    viewMode,
    search,
    status: statusFilter,
    customerType: typeFilter,
    sortBy,
    sortDir,
    page,
    pageSize,
  };

  const { data, isLoading, isFetching } = useQuery<CustomerListResult<Customer>>({
    queryKey: buildCustomerListQueryKey(queryState),
    queryFn: async () => {
      const params = buildCustomerListSearchParams(queryState);
      const response = await fetch(`/api/customers?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customers");
      return normalizeCustomerListResponse<Customer>(await response.json());
    },
  });

  const customers = data?.customers ?? [];
  const pagination = data?.pagination;
  const collapse = Boolean(collapseOnSelect && selectedCustomerId && search.trim().length === 0);
  const rangeStart = pagination && pagination.total > 0 ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const rangeEnd = pagination ? Math.min(pagination.page * pagination.pageSize, pagination.total) : 0;

  const handleSort = (column: CustomerListSortBy, defaultDir: CustomerListSortDir = "asc") => {
    if (sortBy === column) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortDir(defaultDir);
  };

  const handleSplitSort = (value: string) => {
    const [nextSortBy, nextSortDir] = value.split(":") as [CustomerListSortBy, CustomerListSortDir];
    setSortBy(nextSortBy);
    setSortDir(nextSortDir);
  };

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
  };

  const toggleCustomerSelection = (customerId: string) => setSelectedCustomerIds((current) => {
    const next = new Set(current);
    if (next.has(customerId)) next.delete(customerId); else next.add(customerId);
    return next;
  });

  const visibleCustomerIds = customers.map((customer) => customer.id).filter(Boolean);
  const selectedVisibleCount = visibleCustomerIds.filter((customerId) => selectedCustomerIds.has(customerId)).length;
  const allVisibleSelected = visibleCustomerIds.length > 0 && selectedVisibleCount === visibleCustomerIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const visibleSelectionState: boolean | "indeterminate" = allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false;
  const toggleVisibleCustomerSelection = () => setSelectedCustomerIds((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visibleCustomerIds.forEach((customerId) => next.delete(customerId));
    else visibleCustomerIds.forEach((customerId) => next.add(customerId));
    return next;
  });

  const openBulkDialog = (dialog: "terms" | "credit") => {
    setBulkError(null);
    setBulkDialog(dialog);
  };

  const applyBulkCreditLimit = () => {
    const creditLimit = bulkCreditLimitNotSet ? null : parseCurrencyInput(bulkCreditLimitDraft);
    if (creditLimit === null && !bulkCreditLimitNotSet) {
      setBulkError("Enter a non-negative amount with no more than two decimal places.");
      return;
    }
    bulkCommercialUpdateMutation.mutate({ operation: "set_credit_limit", creditLimit });
  };

  const renderPaginationFooter = () => {
    if (collapse || !pagination) return null;

    return (
      <div data-testid="customer-pagination-footer" className="border-t border-border/40 px-3 py-2 flex items-center justify-between gap-2 flex-shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={pagination.totalPages <= 1 || !pagination.hasPreviousPage || isFetching}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft className="w-3.5 h-3.5 mr-1" />
          Prev
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {isFetching && !isLoading ? "Updating..." : `${pagination.page} / ${pagination.totalPages}`}
        </span>
        <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
          <SelectTrigger className="h-7 w-[76px] text-xs">
            <SelectValue aria-label="Customers per page" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={pagination.totalPages <= 1 || !pagination.hasNextPage || isFetching}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
          <ChevronRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      </div>
    );
  };

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <Building2 className="w-12 h-12 mb-3 text-muted-foreground" />
      <h3 className="font-medium mb-1 text-foreground">No customers found</h3>
      <p className="text-sm mb-4 text-muted-foreground">
        {search || statusFilter !== "all" || typeFilter !== "all"
          ? "Try adjusting your filters"
          : "Get started by adding your first customer"}
      </p>
      {!search && statusFilter === "all" && typeFilter === "all" && (
        <Button onClick={onNewCustomer} size="sm">
          <Plus className="w-4 h-4 mr-2" />
          Add Customer
        </Button>
      )}
    </div>
  );

  const loadingState = (
    <div className="flex items-center justify-center py-12">
      <div className="flex items-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading customers...</span>
      </div>
    </div>
  );

  const filterControls = (
    <>
      {showFilterControls && (
    <div className="p-2 border-b border-border/40">
      <div className={viewMode === "enhanced" ? "grid grid-cols-2 md:grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="business">Business</SelectItem>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="retail">Retail</SelectItem>
            <SelectItem value="wholesale">Wholesale</SelectItem>
            <SelectItem value="corporate">Corporate</SelectItem>
          </SelectContent>
        </Select>

        {viewMode === "split" && (
          <Select value={`${sortBy}:${sortDir}`} onValueChange={handleSplitSort}>
            <SelectTrigger className="h-8 text-xs col-span-2">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name:asc">Company A-Z</SelectItem>
              <SelectItem value="name:desc">Company Z-A</SelectItem>
              <SelectItem value="updatedAt:desc">Recently Updated</SelectItem>
              <SelectItem value="createdAt:desc">Recently Created</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
      )}
      {!showFilterControls && viewMode === "split" && (
        <div className="flex justify-end border-b border-border/40 px-2 py-1.5">
          <Select value={`${sortBy}:${sortDir}`} onValueChange={handleSplitSort}>
            <SelectTrigger aria-label="Customer sort" className="h-7 w-[142px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name:asc">Company A-Z</SelectItem>
              <SelectItem value="name:desc">Company Z-A</SelectItem>
              <SelectItem value="updatedAt:desc">Recently Updated</SelectItem>
              <SelectItem value="createdAt:desc">Recently Created</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {viewMode === "enhanced" && (
        <div className="flex justify-end border-b border-border/40 px-2 py-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" aria-label="Manage customer list columns">
                <Settings2 className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {supportedColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={isColumnVisible(column.id)}
                  onCheckedChange={() => toggleColumn(column.id)}
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {pagination && (
        <p className="text-[11px] text-muted-foreground mt-1.5 px-0.5">
          {pagination.total === 0
            ? "No customers"
            : pagination.totalPages > 1
              ? `Showing ${rangeStart}-${rangeEnd} of ${pagination.total} customers`
              : `${pagination.total} customer${pagination.total !== 1 ? "s" : ""}`}
        </p>
      )}
      {selectionEnabled && <div data-testid="customer-selection-toolbar" className="mt-2 flex flex-wrap items-center gap-2 px-2">
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={toggleVisibleCustomerSelection} disabled={visibleCustomerIds.length === 0}>
          {allVisibleSelected ? "Deselect page" : "Select page"}
        </Button>
        {selectedCustomerIds.size > 0 && <>
          <span className="text-xs text-muted-foreground">{selectedCustomerIds.size} selected</span>
          {canManageCommercialConfiguration && <>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openBulkDialog("terms")}>Set Terms</Button>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openBulkDialog("credit")}>Set Credit Limit</Button>
          </>}
          {selectedCustomerIds.size === 2 && <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onMergeCustomers(Array.from(selectedCustomerIds))}><GitMerge className="w-3.5 h-3.5 mr-1" />Merge</Button>}
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSelectedCustomerIds(new Set())}>Clear Selection</Button>
        </>}
      </div>}
    </>
  );

  const splitList = (
    <div className="p-2 space-y-1">
      {customers.map((customer) => {
        const contactLabel = getContactLabel(customer);
        const location = getCustomerLocation(customer);
        const status = customer.status || "active";

        return (
          <button
            key={customer.id}
            onClick={() => onSelectCustomer(customer.id)}
            className={`
              w-full text-left px-3 py-2 rounded-md border transition-all
              ${selectedCustomerId === customer.id ? "bg-muted border-primary" : "bg-card/50 border-border/40 hover:bg-muted/50"}
            `}
          >
            <div className="flex items-center gap-2">
              {selectionEnabled && <span onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`Select ${customer.companyName}`} checked={selectedCustomerIds.has(customer.id)} onCheckedChange={() => toggleCustomerSelection(customer.id)} /></span>}
              <Avatar className="w-8 h-8 flex-shrink-0">
                <AvatarFallback className="bg-primary/20 text-primary text-xs">
                  {customer.companyName?.[0] || "C"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate text-foreground">{customer.companyName}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${getStatusBadgeClass(status)}`}>
                    {status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <span className={`flex items-center gap-0.5 truncate ${contactLabel.muted ? "opacity-50 italic" : ""}`}>
                    <User className="w-3 h-3 flex-shrink-0" />
                    {contactLabel.text}
                  </span>
                  {location && (
                    <>
                      <span className="text-muted-foreground/60">.</span>
                      <span className="flex items-center gap-0.5 truncate">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        {location}
                      </span>
                    </>
                  )}
                  {customer.orderCount !== undefined && customer.orderCount > 0 && (
                    <>
                      <span className="text-muted-foreground/60">.</span>
                      <span className="flex items-center gap-0.5">
                        <ShoppingCart className="w-3 h-3" />
                        {customer.orderCount}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );

  const sortHeader = (label: string, column: CustomerListSortBy, defaultDir: CustomerListSortDir = "asc") => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-1.5 text-xs font-medium"
      onClick={() => handleSort(column, defaultDir)}
    >
      {label}
      <SortIcon active={sortBy === column} direction={sortDir} />
    </Button>
  );

  const enhancedTable = (
    <Table data-testid="customer-enhanced-table">
      <TableHeader>
        <TableRow>
          {selectionEnabled && <TableHead className="w-10" onClick={(event) => event.stopPropagation()}><Checkbox aria-label="Select visible customers" checked={visibleSelectionState} onCheckedChange={toggleVisibleCustomerSelection} /></TableHead>}
          {isColumnVisible("company") && <TableHead>{sortHeader("Company Name", "name")}</TableHead>}
          {isColumnVisible("primaryContact") && <TableHead>{sortHeader("Primary Contact", "primaryContact")}</TableHead>}
          {isColumnVisible("email") && <TableHead>{sortHeader("Email", "email")}</TableHead>}
          {isColumnVisible("phone") && <TableHead>{sortHeader("Phone", "phone")}</TableHead>}
          {isColumnVisible("status") && <TableHead>{sortHeader("Status", "status")}</TableHead>}
          {isColumnVisible("customerType") && <TableHead>{sortHeader("Customer Type", "customerType")}</TableHead>}
          {isColumnVisible("updatedAt") && <TableHead>{sortHeader("Last Updated", "updatedAt", "desc")}</TableHead>}
          {canManageCommercialConfiguration && isColumnVisible("paymentTerms") && <TableHead className="w-[150px]">Terms</TableHead>}
          {canManageCommercialConfiguration && isColumnVisible("credit") && <TableHead className="w-[210px]">Credit</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => {
          const contact = getContact(customer);
          const contactName = getContactName(customer);
          const email = contact?.email || customer.email || "-";
          const phone = contact?.phone || customer.phone || "-";
          const status = customer.status || "active";

          return (
            <TableRow
              key={customer.id}
              className="cursor-pointer"
              onClick={() => onSelectCustomer(customer.id)}
              data-state={selectedCustomerId === customer.id ? "selected" : undefined}
            >
              {selectionEnabled && <TableCell onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`Select ${customer.companyName}`} checked={selectedCustomerIds.has(customer.id)} onCheckedChange={() => toggleCustomerSelection(customer.id)} /></TableCell>}
              {isColumnVisible("company") && <TableCell className="font-medium">{customer.companyName}</TableCell>}
              {isColumnVisible("primaryContact") && <TableCell>{contactName || "-"}</TableCell>}
              {isColumnVisible("email") && <TableCell className="max-w-[220px] truncate">{email}</TableCell>}
              {isColumnVisible("phone") && <TableCell>{phone}</TableCell>}
              {isColumnVisible("status") && <TableCell>
                <Badge variant="outline" className={`capitalize ${getStatusBadgeClass(status)}`}>
                  {status.replace("_", " ")}
                </Badge>
              </TableCell>}
              {isColumnVisible("customerType") && <TableCell className="capitalize">{customer.customerType || "-"}</TableCell>}
              {isColumnVisible("updatedAt") && <TableCell>{formatDate(customer.updatedAt || customer.createdAt)}</TableCell>}
              {canManageCommercialConfiguration && isColumnVisible("paymentTerms") && (
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Select
                    value={customer.paymentTerms || "due_on_receipt"}
                    disabled={updateCustomerMutation.isPending}
                    onValueChange={(paymentTerms) => {
                      setEditingTermsCustomerId(customer.id);
                      setEditError(null);
                      updateCustomerMutation.mutate({ customerId: customer.id, patch: { paymentTerms } });
                    }}
                  >
                    <SelectTrigger aria-label={`Payment terms for ${customer.companyName}`} className="h-7 min-w-[128px] border-transparent bg-transparent px-1 text-xs hover:border-input">
                      <SelectValue>{paymentTermsLabel(customer.paymentTerms)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_PAYMENT_TERMS.map((term) => <SelectItem key={term.value} value={term.value}>{term.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {editingTermsCustomerId === customer.id && editError && <p role="alert" className="mt-1 max-w-[180px] text-[10px] text-destructive">{editError}</p>}
                </TableCell>
              )}
              {canManageCommercialConfiguration && isColumnVisible("credit") && (
                <TableCell onClick={(event) => event.stopPropagation()}>
                  {editingCreditCustomerId === customer.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        aria-label={`Credit limit for ${customer.companyName}`}
                        value={creditLimitDraft}
                        inputMode="decimal"
                        className="h-7 w-24 text-xs"
                        onChange={(event) => { setCreditLimitDraft(event.target.value); setEditError(null); }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={updateCustomerMutation.isPending}
                        aria-label={`Save credit limit for ${customer.companyName}`}
                        onClick={() => {
                          const creditLimit = parseCurrencyInput(creditLimitDraft);
                          if (creditLimit === null) {
                            setEditError("Enter a non-negative amount with no more than two decimal places.");
                            return;
                          }
                          updateCustomerMutation.mutate({ customerId: customer.id, patch: { creditLimit } });
                        }}
                      >
                        {updateCustomerMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Cancel credit limit edit" onClick={() => { setEditingCreditCustomerId(null); setEditError(null); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <span title={`${formatCurrency(customer.creditExposure)} used of ${customer.creditLimitConfigured ? formatCurrency(customer.creditLimit) : "no configured"} credit limit`} className="text-xs">
                        {formatCurrency(customer.creditExposure)} / {customer.creditLimitConfigured ? formatCurrency(customer.creditLimit) : "Not set"}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`Edit credit limit for ${customer.companyName}`}
                        onClick={() => { setEditingCreditCustomerId(customer.id); setCreditLimitDraft(customer.creditLimit || "0.00"); setEditError(null); }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {editingCreditCustomerId === customer.id && editError && <p role="alert" className="mt-1 max-w-[180px] text-[10px] text-destructive">{editError}</p>}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <div className="flex flex-col">
      {!collapse && filterControls}

      {!collapse && (
        <div data-testid="customer-list-body">
          {isLoading ? loadingState : customers.length === 0 ? emptyState : viewMode === "enhanced" ? enhancedTable : splitList}
        </div>
      )}

      {isFetching && !isLoading && customers.length > 0 && (
        <div className="border-t border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Refreshing customers
        </div>
      )}

      {renderPaginationFooter()}

      <Dialog open={bulkDialog === "terms"} onOpenChange={(open) => { if (!open) { setBulkDialog(null); setBulkError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set payment terms</DialogTitle>
            <DialogDescription>Set payment terms for {selectedCustomerIds.size} customer{selectedCustomerIds.size === 1 ? "" : "s"}.</DialogDescription>
          </DialogHeader>
          <Select value={bulkPaymentTerms} onValueChange={(value) => { setBulkPaymentTerms(value as CustomerPaymentTerm); setBulkError(null); }}>
            <SelectTrigger aria-label="Bulk payment terms"><SelectValue /></SelectTrigger>
            <SelectContent>{CUSTOMER_PAYMENT_TERMS.map((term) => <SelectItem key={term.value} value={term.value}>{term.label}</SelectItem>)}</SelectContent>
          </Select>
          {bulkError && <p role="alert" className="text-sm text-destructive">{bulkError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkDialog(null)}>Cancel</Button>
            <Button type="button" disabled={bulkCommercialUpdateMutation.isPending} onClick={() => bulkCommercialUpdateMutation.mutate({ operation: "set_payment_terms", paymentTerms: bulkPaymentTerms })}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialog === "credit"} onOpenChange={(open) => { if (!open) { setBulkDialog(null); setBulkError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set credit limit</DialogTitle>
            <DialogDescription>Set a credit limit for {selectedCustomerIds.size} customer{selectedCustomerIds.size === 1 ? "" : "s"}. This does not change current balances.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input aria-label="Bulk credit limit" value={bulkCreditLimitDraft} inputMode="decimal" disabled={bulkCreditLimitNotSet} onChange={(event) => { setBulkCreditLimitDraft(event.target.value); setBulkError(null); }} placeholder="0.00" />
            <div className="flex items-center gap-2">
              <Checkbox id="bulk-credit-limit-not-set" checked={bulkCreditLimitNotSet} onCheckedChange={(checked) => { setBulkCreditLimitNotSet(checked === true); setBulkError(null); }} />
              <label htmlFor="bulk-credit-limit-not-set" className="text-sm">Set credit limit to Not set</label>
            </div>
          </div>
          {bulkError && <p role="alert" className="text-sm text-destructive">{bulkError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkDialog(null)}>Cancel</Button>
            <Button type="button" disabled={bulkCommercialUpdateMutation.isPending} onClick={applyBulkCreditLimit}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
