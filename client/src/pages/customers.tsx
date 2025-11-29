import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus } from "lucide-react";
import CustomerList from "@/components/CustomerList";
import { SplitCustomerDetail } from "@/components/customers/SplitCustomerDetail";
import EnhancedCustomerView from "@/components/customers/EnhancedCustomerView";
import CustomerForm from "@/components/customer-form";
import { useAuth } from "@/hooks/useAuth";
import { Page, PageHeader, ContentLayout, FilterPanel, DataCard } from "@/components/titan";

interface CustomersProps {
  embedded?: boolean;
}

export default function Customers({ embedded = false }: CustomersProps) {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const enhancedRef = (typeof window !== 'undefined') ? (document.getElementById('enhanced-view-anchor') as HTMLElement | null) : null;
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [search, setSearch] = useState("");

  const getStorageKey = () => {
    return user?.id ? `customer_view_mode_${user.id}` : "customer_view_mode_default";
  };

  const [viewMode, setViewMode] = useState<"split" | "enhanced">(() => {
    try {
      const key = user?.id ? `customer_view_mode_${user.id}` : "customer_view_mode_default";
      const stored = localStorage.getItem(key);
      return (stored === "enhanced" || stored === "split") ? stored : "split";
    } catch {
      return "split";
    }
  });

  useEffect(() => {
    try {
      const key = getStorageKey();
      localStorage.setItem(key, viewMode);
    } catch { }
  }, [viewMode, user?.id]);

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    // Smooth scroll to enhanced view when in enhanced mode
    try {
      const el = document.getElementById('enhanced-view-anchor');
      if (viewMode === 'enhanced' && el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch { }
  };

  const handleNewCustomer = () => {
    setShowNewCustomerForm(true);
  };

  const handleToggleView = () => {
    setViewMode(v => v === "split" ? "enhanced" : "split");
  };

  const handleEdit = () => {
    setShowNewCustomerForm(true);
  };

  if (embedded) {
    return (
      <div className="h-[calc(100vh-180px)]">
        <div className="h-full flex overflow-hidden">
          <div className="w-[400px] border-r border-white/10 flex-shrink-0">
            <CustomerList
              selectedCustomerId={selectedCustomerId || undefined}
              onSelectCustomer={handleSelectCustomer}
              onNewCustomer={handleNewCustomer}
              search={search}
            />
          </div>
          <div className="flex-1 overflow-hidden p-4">
            <SplitCustomerDetail customerId={selectedCustomerId} onEdit={handleEdit} />
          </div>
        </div>
        <CustomerForm open={showNewCustomerForm} onOpenChange={setShowNewCustomerForm} />
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Customers"
        subtitle="Manage your customer relationships and accounts"
        actions={
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="inline-flex items-center rounded-full border border-border bg-muted/50 px-1 py-0.5">
              <button
                onClick={() => setViewMode('split')}
                className={`text-xs px-3 py-1 rounded-full transition ${viewMode === 'split' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Split
              </button>
              <button
                onClick={() => setViewMode('enhanced')}
                className={`text-xs px-3 py-1 rounded-full transition ${viewMode === 'enhanced' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Enhanced
              </button>
            </div>
            <Button onClick={handleNewCustomer}>
              <Plus className="w-4 h-4 mr-2" />
              New Customer
            </Button>
          </div>
        }
      />

      <ContentLayout>
        {/* Search Filter */}
        <FilterPanel title="Search Customers" description="Find customers by company name">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </FilterPanel>

        {/* Customer List/Detail View */}
        {viewMode === "split" ? (
          <div className="grid grid-cols-[360px,1fr] gap-4 h-[calc(100vh-280px)]">
            <DataCard noPadding className="overflow-hidden flex flex-col">
              <CustomerList
                selectedCustomerId={selectedCustomerId || undefined}
                onSelectCustomer={handleSelectCustomer}
                onNewCustomer={handleNewCustomer}
                search={search}
              />
            </DataCard>
            <DataCard className="overflow-y-auto">
              <SplitCustomerDetail customerId={selectedCustomerId} onEdit={handleEdit} />
            </DataCard>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Customer list - hide when customer selected and no search */}
            <DataCard noPadding className={`overflow-hidden ${(viewMode === "enhanced" && selectedCustomerId && search.trim().length === 0) ? "hidden" : ""}`}>
              <CustomerList
                selectedCustomerId={selectedCustomerId || undefined}
                onSelectCustomer={handleSelectCustomer}
                onNewCustomer={handleNewCustomer}
                search={search}
                collapseOnSelect
              />
            </DataCard>

            {/* Enhanced view displayed after selecting a company */}
            {selectedCustomerId && (
              <>
                <div id="enhanced-view-anchor"></div>
                <EnhancedCustomerView
                  customerId={selectedCustomerId}
                  onEdit={handleEdit}
                  onToggleView={handleToggleView}
                  onSelectCustomer={handleSelectCustomer}
                />
              </>
            )}
          </div>
        )}
      </ContentLayout>

      <CustomerForm open={showNewCustomerForm} onOpenChange={setShowNewCustomerForm} />
    </Page>
  );
}
