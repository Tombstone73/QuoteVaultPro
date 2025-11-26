import { useState } from "react";
import { useLocation } from "wouter";
import CustomerList from "@/components/CustomerList";
import CustomerDetailPanel from "@/components/CustomerDetailPanel";
import CustomerForm from "@/components/customer-form";

interface CustomersProps {
  embedded?: boolean;
}

export default function Customers({ embedded = false }: CustomersProps) {
  const [location, setLocation] = useLocation();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [enhancedView, setEnhancedView] = useState(false);

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
  };

  const handleNewCustomer = () => {
    setShowNewCustomerForm(true);
  };

  // Both embedded and full page mode use split layout
  return (
    <div className={embedded ? "h-[calc(100vh-180px)]" : "h-screen"}>
      <div className="h-full flex overflow-hidden bg-background">
        {/* Left Panel - Customer List (hidden in enhanced view) */}
        {!enhancedView && (
          <div className="w-[400px] border-r border-white/10 flex-shrink-0">
            <CustomerList 
              selectedCustomerId={selectedCustomerId || undefined}
              onSelectCustomer={handleSelectCustomer}
              onNewCustomer={handleNewCustomer}
            />
          </div>
        )}

        {/* Right Panel - Customer Detail */}
        <div className="flex-1 overflow-hidden">
          <CustomerDetailPanel 
            customerId={selectedCustomerId}
            onEdit={() => {
              // Edit is handled within the CustomerDetailPanel
            }}
            viewMode={enhancedView ? "enhanced" : "split"}
            onToggleView={() => setEnhancedView(v => !v)}
          />
        </div>
      </div>

      {/* New Customer Form */}
      <CustomerForm
        open={showNewCustomerForm}
        onOpenChange={setShowNewCustomerForm}
      />
    </div>
  );
}


