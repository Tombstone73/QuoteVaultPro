import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { PageShell } from "@/components/ui/PageShell";
import { TitanCard } from "@/components/ui/TitanCard";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import CustomerList from "@/components/CustomerList";
import { SplitCustomerDetail } from "@/components/customers/SplitCustomerDetail";
import { EnhancedCustomerView } from "@/components/customers/EnhancedCustomerView";
import CustomerForm from "@/components/customer-form";
import { useAuth } from "@/hooks/useAuth";

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
    } catch {}
  }, [viewMode, user?.id]);

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    // Smooth scroll to enhanced view when in enhanced mode
    try {
      const el = document.getElementById('enhanced-view-anchor');
      if (viewMode === 'enhanced' && el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch {}
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
    <PageShell>
      {/* Sticky global search + view toggle */}
      <TitanCard className="p-3 sticky top-0 z-40 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            <Input
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              style={{ backgroundColor: 'var(--bg-surface-soft)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </div>
          <button
            onClick={handleNewCustomer}
            className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm"
            style={{
              backgroundColor: 'var(--accent-primary)',
              color: '#ffffff',
            }}
          >
            + New Customer
          </button>
          <div className="inline-flex items-center rounded-full border px-1 py-0.5" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface-soft)' }}>
            <button
              onClick={() => setViewMode('split')}
              className={`text-xs px-3 py-1 rounded-full transition ${viewMode === 'split' ? 'shadow-sm' : ''}`}
              style={viewMode === 'split'
                ? { backgroundColor: 'var(--accent-primary)', color: '#ffffff' }
                : { color: 'var(--text-muted)' }}
            >
              Split
            </button>
            <button
              onClick={() => setViewMode('enhanced')}
              className={`text-xs px-3 py-1 rounded-full transition ${viewMode === 'enhanced' ? 'shadow-sm' : ''}`}
              style={viewMode === 'enhanced'
                ? { backgroundColor: 'var(--accent-primary)', color: '#ffffff' }
                : { color: 'var(--text-muted)' }}
            >
              Enhanced
            </button>
          </div>
        </div>
      </TitanCard>
      {viewMode === "split" ? (
        <div className="grid grid-cols-[360px,1fr] gap-4 h-[calc(100vh-120px)]">
          <TitanCard className="p-0 overflow-hidden flex flex-col">
            <CustomerList 
              selectedCustomerId={selectedCustomerId || undefined}
              onSelectCustomer={handleSelectCustomer}
              onNewCustomer={handleNewCustomer}
              search={search}
            />
          </TitanCard>
          <TitanCard className="p-6 overflow-y-auto">
            <SplitCustomerDetail customerId={selectedCustomerId} onEdit={handleEdit} />
          </TitanCard>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Search + scrollable customers with sortable columns */}
          <TitanCard className="p-0 overflow-hidden">
            <CustomerList 
              selectedCustomerId={selectedCustomerId || undefined}
              onSelectCustomer={handleSelectCustomer}
              onNewCustomer={handleNewCustomer}
              search={search}
              collapseOnSelect
            />
          </TitanCard>

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
      <CustomerForm open={showNewCustomerForm} onOpenChange={setShowNewCustomerForm} />
    </PageShell>
  );
}
