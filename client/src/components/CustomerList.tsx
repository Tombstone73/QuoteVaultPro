import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
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
}

export default function CustomerList({
  selectedCustomerId,
  onSelectCustomer,
  onNewCustomer,
  search,
  viewMode = "split",
  collapseOnSelect = false,
}: CustomerListProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<CustomerListSortBy>("name");
  const [sortDir, setSortDir] = useState<CustomerListSortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

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

  const renderPaginationFooter = () => {
    if (collapse || !pagination) return null;

    return (
      <div className="border-t border-border/40 px-3 py-2 flex items-center justify-between gap-2">
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
      {pagination && (
        <p className="text-[11px] text-muted-foreground mt-1.5 px-0.5">
          {pagination.total === 0
            ? "No customers"
            : pagination.totalPages > 1
              ? `Showing ${rangeStart}-${rangeEnd} of ${pagination.total} customers`
              : `${pagination.total} customer${pagination.total !== 1 ? "s" : ""}`}
        </p>
      )}
    </div>
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{sortHeader("Company Name", "name")}</TableHead>
          <TableHead>{sortHeader("Primary Contact", "primaryContact")}</TableHead>
          <TableHead>{sortHeader("Email", "email")}</TableHead>
          <TableHead>{sortHeader("Phone", "phone")}</TableHead>
          <TableHead>{sortHeader("Status", "status")}</TableHead>
          <TableHead>{sortHeader("Customer Type", "customerType")}</TableHead>
          <TableHead>{sortHeader("Last Updated", "updatedAt", "desc")}</TableHead>
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
              <TableCell className="font-medium">{customer.companyName}</TableCell>
              <TableCell>{contactName || "-"}</TableCell>
              <TableCell className="max-w-[220px] truncate">{email}</TableCell>
              <TableCell>{phone}</TableCell>
              <TableCell>
                <Badge variant="outline" className={`capitalize ${getStatusBadgeClass(status)}`}>
                  {status.replace("_", " ")}
                </Badge>
              </TableCell>
              <TableCell className="capitalize">{customer.customerType || "-"}</TableCell>
              <TableCell>{formatDate(customer.updatedAt || customer.createdAt)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {!collapse && filterControls}

      {!collapse && (
        <div className="flex-1 min-h-0 overflow-y-auto">
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
    </div>
  );
}
