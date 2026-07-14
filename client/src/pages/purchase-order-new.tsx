import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { Page, PageHeader, ContentLayout } from "@/components/titan";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function PurchaseOrderNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialVendorId = useMemo(() => new URLSearchParams(location.search).get("vendorId"), [location.search]);

  return (
    <Page>
      <PageHeader
        title="New Purchase Order"
        subtitle="Build and save a draft vendor purchase order"
        actions={
          <Button variant="outline" onClick={() => navigate("/purchase-orders")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to POs
          </Button>
        }
      />
      <ContentLayout>
        <PurchaseOrderForm
          initialVendorId={initialVendorId}
          onCancel={() => navigate("/purchase-orders")}
          onSaved={(po) => navigate(`/purchase-orders/${po.id}`)}
        />
      </ContentLayout>
    </Page>
  );
}
