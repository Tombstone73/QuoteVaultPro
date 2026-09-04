import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Building2, LayoutGrid, SplitSquareHorizontal } from "lucide-react";
import CustomerList from "@/components/CustomerList";
import { CustomerMergeDialog } from "@/components/CustomerMergeDialog";
import { EnhancedCustomerView } from "@/features/customers";
import CustomerForm from "@/components/customer-form";
import { useAuth } from "@/hooks/useAuth";
import { Page, PageHeader, ContentLayout, DataCard } from "@/components/titan";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/config/routes";
import { useSmartBack } from "@/hooks/useSmartBack";
import BackNavControls from "@/components/BackNavControls";

// ============================================================
// VIEW MODE TYPES AND STORAGE
// ============================================================

const VIEW_MODE_KEY = "titanos.customers.viewMode";
type CustomersViewMode = "split" | "enhanced";

function getStoredViewMode(): CustomersViewMode {
  if (typeof window === "undefined") return "split";
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    return stored === "enhanced" ? "enhanced" : "split";
  } catch {
    return "split";
  }
}

function setStoredViewMode(mode: CustomersViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Silently fail if localStorage is not available
  }
}

// ============================================================
// VIEW MODE TOGGLE COMPONENT
// ============================================================

interface ViewModeToggleProps {
  viewMode: CustomersViewMode;
  onChangeViewMode: (mode: CustomersViewMode) => void;
}

function ViewModeToggle({ viewMode, onChangeViewMode }: ViewModeToggleProps) {
  return (
    <div className="inline-flex items-center rounded-titan-lg border border-titan-border bg-titan-bg-card-elevated p-0.5">
      <button
        onClick={() => onChangeViewMode("split")}
        className={cn(
          "flex h-7 items-center gap-1.5 px-2.5 rounded-titan-md text-titan-sm font-medium transition-all",
          viewMode === "split"
            ? "bg-titan-accent text-white shadow-titan-sm"
            : "text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card"
        )}
        title="Split view: List + inline detail panel"
      >
        <SplitSquareHorizontal className="w-4 h-4" />
        Split
      </button>
      <button
        onClick={() => onChangeViewMode("enhanced")}
        className={cn(
          "flex h-7 items-center gap-1.5 px-2.5 rounded-titan-md text-titan-sm font-medium transition-all",
          viewMode === "enhanced"
            ? "bg-titan-accent text-white shadow-titan-sm"
            : "text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card"
        )}
        title="Enhanced view: Click to navigate to full detail page"
      >
        <LayoutGrid className="w-4 h-4" />
        Enhanced
      </button>
    </div>
  );
}

// ============================================================
// EMPTY STATE COMPONENT
// ============================================================

function EmptyDetailPanel() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
      <div className="w-16 h-16 rounded-titan-xl bg-titan-bg-card-elevated flex items-center justify-center mb-4">
        <Building2 className="w-8 h-8 text-titan-text-muted" />
      </div>
      <h3 className="text-titan-lg font-medium mb-2 text-titan-text-secondary">
        No Customer Selected
      </h3>
      <p className="text-titan-sm text-titan-text-muted max-w-xs">
        Select a customer from the list to view their details, orders, quotes, and invoices.
      </p>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

interface CustomersProps {
  embedded?: boolean;
}

export default function Customers({ embedded = false }: CustomersProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { onSmartBack } = useSmartBack();
  
  // View mode state with localStorage persistence
  const [viewMode, setViewMode] = useState<CustomersViewMode>(getStoredViewMode);
  
  // Selected customer for split view
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  
  // Form state
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  
  // Search state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [mergeCustomerIds, setMergeCustomerIds] = useState<string[]>([]);
  const canManageCommercialConfiguration = Boolean(
    user?.isAdmin || ["owner", "admin"].includes(String(user?.role || "").toLowerCase()),
  );

  // Fetch customer for editing
  const { data: editingCustomer } = useQuery({
    queryKey: [`/api/customers/${editingCustomerId}`],
    queryFn: async () => {
      if (!editingCustomerId) return null;
      const res = await fetch(`/api/customers/${editingCustomerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch customer");
      return res.json();
    },
    enabled: !!editingCustomerId && showNewCustomerForm,
  });

  // Handle view mode changes with persistence
  const handleChangeViewMode = useCallback((mode: CustomersViewMode) => {
    setViewMode(mode);
    setStoredViewMode(mode);
    // When switching to enhanced and a customer is already selected, navigate to their detail page
    if (mode === "enhanced" && selectedCustomerId) {
      navigate(ROUTES.customers.detail(selectedCustomerId));
    }
    // Intentionally preserve selectedCustomerId so switching back to split restores the panel
  }, [selectedCustomerId, navigate]);

  // Handle customer selection
  const handleSelectCustomer = useCallback((customerId: string) => {
    if (viewMode === "split") {
      setSelectedCustomerId(customerId);
    } else {
      // Enhanced mode: navigate to full page
      navigate(ROUTES.customers.detail(customerId));
    }
  }, [viewMode, navigate]);

  // Handle new customer
  const handleNewCustomer = useCallback(() => {
    setEditingCustomerId(null);
    setShowNewCustomerForm(true);
  }, []);

  // Handle edit customer
  const handleEdit = useCallback((customerId: string) => {
    setEditingCustomerId(customerId);
    setShowNewCustomerForm(true);
  }, []);

  // Handle form close
  const handleFormClose = useCallback((open: boolean) => {
    setShowNewCustomerForm(open);
    if (!open) {
      setEditingCustomerId(null);
    }
  }, []);

  // Embedded mode (used within other pages)
  if (embedded) {
    return (
      <div>
        <div className="flex items-start">
          <div className="w-[400px] border-r border-titan-border-subtle flex-shrink-0">
            <CustomerList
              selectedCustomerId={selectedCustomerId || undefined}
              onSelectCustomer={handleSelectCustomer}
              onNewCustomer={handleNewCustomer}
              search={search}
              viewMode="split"
              canManageCommercialConfiguration={canManageCommercialConfiguration}
              preferenceUserId={user?.id}
            />
          </div>
          <div className="flex-1">
            {selectedCustomerId ? (
              <EnhancedCustomerView 
                customerId={selectedCustomerId} 
                layoutMode="embedded" 
                notFoundFallback={<EmptyDetailPanel />}
              />
            ) : (
              <EmptyDetailPanel />
            )}
          </div>
        </div>
        <CustomerForm 
          open={showNewCustomerForm} 
          onOpenChange={handleFormClose}
          customer={editingCustomer}
        />
      </div>
    );
  }

  // Full page mode
  return (
    <Page>
      <PageHeader
        title="Customers"
        subtitle="Manage your customer relationships and accounts"
        className="mb-3 pb-0"
        backButton={
          <BackNavControls onBack={onSmartBack} />
        }
        actions={
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <ViewModeToggle 
              viewMode={viewMode} 
              onChangeViewMode={handleChangeViewMode} 
            />
            
            {/* New Customer Button */}
            <Button 
              size="sm" 
              onClick={handleNewCustomer}
              className="h-8 bg-titan-accent hover:bg-titan-accent-hover px-3 text-titan-sm font-medium"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Customer
            </Button>
          </div>
        }
      />

      <ContentLayout className="space-y-2">
        {/* Compact desktop toolbar; wraps naturally on narrow screens. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1 basis-[45%] max-w-2xl">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-titan-text-muted" />
            <Input
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 bg-titan-bg-input border-titan-border-subtle text-titan-text-primary placeholder:text-titan-text-muted rounded-titan-md"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger aria-label="Customer status" className="h-9 w-[132px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="on_hold">On Hold</SelectItem></SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger aria-label="Customer type" className="h-9 w-[132px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Types</SelectItem><SelectItem value="business">Business</SelectItem><SelectItem value="individual">Individual</SelectItem><SelectItem value="retail">Retail</SelectItem><SelectItem value="wholesale">Wholesale</SelectItem><SelectItem value="corporate">Corporate</SelectItem></SelectContent>
          </Select>
        </div>

        {/* Customer List/Detail View */}
        {viewMode === "split" ? (
          // SPLIT MODE: Two-column layout
          <div className="grid grid-cols-[360px,1fr] gap-3 items-start">
            {/* Left Panel: Customer List */}
            <DataCard noPadding className="bg-titan-bg-card border-titan-border-subtle">
              <CustomerList
                selectedCustomerId={selectedCustomerId || undefined}
                onSelectCustomer={handleSelectCustomer}
                onNewCustomer={handleNewCustomer}
                search={search}
                viewMode="split"
                onMergeCustomers={setMergeCustomerIds}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                typeFilter={typeFilter}
                onTypeFilterChange={setTypeFilter}
                showFilterControls={false}
                canManageCommercialConfiguration={canManageCommercialConfiguration}
                preferenceUserId={user?.id}
              />
            </DataCard>
            
            {/* Right Panel: Customer Detail */}
            <DataCard noPadding className="bg-titan-bg-card border-titan-border-subtle">
              {selectedCustomerId ? (
                <EnhancedCustomerView 
                  customerId={selectedCustomerId} 
                  layoutMode="embedded"
                  notFoundFallback={<EmptyDetailPanel />}
                />
              ) : (
                <EmptyDetailPanel />
              )}
            </DataCard>
          </div>
        ) : (
          // ENHANCED MODE: List only, clicking navigates to full page
          <DataCard noPadding className="bg-titan-bg-card border-titan-border-subtle">
            <CustomerList
              selectedCustomerId={undefined}
              onSelectCustomer={handleSelectCustomer}
              onNewCustomer={handleNewCustomer}
              search={search}
              viewMode="enhanced"
              onMergeCustomers={setMergeCustomerIds}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              typeFilter={typeFilter}
              onTypeFilterChange={setTypeFilter}
              showFilterControls={false}
              canManageCommercialConfiguration={canManageCommercialConfiguration}
              preferenceUserId={user?.id}
            />
          </DataCard>
        )}
      </ContentLayout>

      {/* Customer Form Modal */}
      <CustomerForm 
        open={showNewCustomerForm} 
        onOpenChange={handleFormClose}
        customer={editingCustomer}
      />
      <CustomerMergeDialog customerIds={mergeCustomerIds} open={mergeCustomerIds.length >= 2} onOpenChange={(open) => { if (!open) setMergeCustomerIds([]); }} />
    </Page>
  );
}
