import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Building2, LayoutGrid, SplitSquareHorizontal } from "lucide-react";
import CustomerList from "@/components/CustomerList";
import { EnhancedCustomerView } from "@/features/customers";
import CustomerForm from "@/components/customer-form";
import { useAuth } from "@/hooks/useAuth";
import { Page, PageHeader, ContentLayout, DataCard } from "@/components/titan";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/config/routes";

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
          "flex items-center gap-1.5 px-3 py-1.5 rounded-titan-md text-titan-sm font-medium transition-all",
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
          "flex items-center gap-1.5 px-3 py-1.5 rounded-titan-md text-titan-sm font-medium transition-all",
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
  
  // View mode state with localStorage persistence
  const [viewMode, setViewMode] = useState<CustomersViewMode>(getStoredViewMode);
  
  // Selected customer for split view
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  
  // Form state
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  
  // Search state
  const [search, setSearch] = useState("");

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
    // Clear selection when switching to enhanced mode
    if (mode === "enhanced") {
      setSelectedCustomerId(null);
    }
  }, []);

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
      <div className="h-[calc(100vh-180px)]">
        <div className="h-full flex overflow-hidden">
          <div className="w-[400px] border-r border-titan-border-subtle flex-shrink-0">
            <CustomerList
              selectedCustomerId={selectedCustomerId || undefined}
              onSelectCustomer={handleSelectCustomer}
              onNewCustomer={handleNewCustomer}
              search={search}
            />
          </div>
          <div className="flex-1 overflow-hidden">
            {selectedCustomerId ? (
              <EnhancedCustomerView 
                customerId={selectedCustomerId} 
                layoutMode="embedded" 
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
        className="pb-3"
        actions={
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <ViewModeToggle 
              viewMode={viewMode} 
              onChangeViewMode={handleChangeViewMode} 
            />
            
            {/* New Customer Button */}
            <Button 
              size="sm" 
              onClick={handleNewCustomer}
              className="bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md text-titan-sm font-medium"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Customer
            </Button>
          </div>
        }
      />

      <ContentLayout className="space-y-3">
        {/* Search Bar */}
        <div className="flex flex-row items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-titan-text-muted" />
            <Input
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 bg-titan-bg-input border-titan-border-subtle text-titan-text-primary placeholder:text-titan-text-muted rounded-titan-md"
            />
          </div>
        </div>

        {/* Customer List/Detail View */}
        {viewMode === "split" ? (
          // SPLIT MODE: Two-column layout
          <div className="grid grid-cols-[360px,1fr] gap-3 h-[calc(100vh-280px)]">
            {/* Left Panel: Customer List */}
            <DataCard noPadding className="overflow-hidden flex flex-col bg-titan-bg-card border-titan-border-subtle">
              <CustomerList
                selectedCustomerId={selectedCustomerId || undefined}
                onSelectCustomer={handleSelectCustomer}
                onNewCustomer={handleNewCustomer}
                search={search}
              />
            </DataCard>
            
            {/* Right Panel: Customer Detail */}
            <DataCard noPadding className="overflow-y-auto bg-titan-bg-card border-titan-border-subtle">
              {selectedCustomerId ? (
                <EnhancedCustomerView 
                  customerId={selectedCustomerId} 
                  layoutMode="embedded"
                />
              ) : (
                <EmptyDetailPanel />
              )}
            </DataCard>
          </div>
        ) : (
          // ENHANCED MODE: List only, clicking navigates to full page
          <DataCard noPadding className="overflow-hidden bg-titan-bg-card border-titan-border-subtle">
            <CustomerList
              selectedCustomerId={undefined}
              onSelectCustomer={handleSelectCustomer}
              onNewCustomer={handleNewCustomer}
              search={search}
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
    </Page>
  );
}
