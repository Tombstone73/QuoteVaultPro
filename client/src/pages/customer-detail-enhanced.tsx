/**
 * Customer Detail Page (Full Page Mode)
 * 
 * This page uses the canonical EnhancedCustomerView component in "full" layout mode.
 * Route: /customers/:id
 */

import { useParams, useNavigate } from "react-router-dom";
import { EnhancedCustomerView } from "@/features/customers";
import { ROUTES } from "@/config/routes";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Handle back navigation
  const handleBack = () => {
    navigate(ROUTES.customers.list);
  };

  if (!id) {
    return (
      <div className="p-6 text-center text-titan-text-secondary">
        Invalid customer ID
      </div>
    );
  }

  return (
    <EnhancedCustomerView
      customerId={id}
      layoutMode="full"
      onBack={handleBack}
    />
  );
}
