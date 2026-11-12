import { useMemo } from "react";
import { useWorkspaceLocation as useLocation, useWorkspaceNavigate as useNavigate } from "@/contexts/WorkspaceContext";
import { useWorkspaceTitle } from "@/features/workspaces/WorkspaceTitle";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { Page, PageHeader, ContentLayout } from "@/components/titan";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function PurchaseOrderNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialVendorId = useMemo(() => new URLSearchParams(location.search).get("vendorId"), [location.search]);
  useWorkspaceTitle("New Purchase Order");

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
          onSaved={(po) => navigate(`/purchase-orders/${po.id}`, {
            replace: true, state: { titanWorkspaceSaved: true, titanWorkspaceTitle: po.poNumber },
          })}
        />
      </ContentLayout>
    </Page>
  );
}
