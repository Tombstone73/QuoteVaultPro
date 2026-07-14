import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDeletePurchaseOrder, usePurchaseOrder, useSendPurchaseOrder } from "@/hooks/usePurchaseOrders";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { ReceivePurchaseOrderItemsForm } from "@/components/ReceivePurchaseOrderItemsForm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, ContentLayout, DataCard } from "@/components/titan";
import { ArrowLeft, PackageCheck, Send, Trash2 } from "lucide-react";

export default function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: po, isLoading } = usePurchaseOrder(id);
  const issueMutation = useSendPurchaseOrder(id || "");
  const deleteMutation = useDeletePurchaseOrder();
  const [showReceive, setShowReceive] = useState(false);

  if (isLoading || !po) {
    return (
      <Page>
        <ContentLayout>
          <DataCard title="Purchase Order" description="Loading purchase order...">
            <div className="text-sm text-titan-text-secondary">Loading...</div>
          </DataCard>
        </ContentLayout>
      </Page>
    );
  }

  const purchaseOrder = po;
  const canIssue = purchaseOrder.status === "draft";
  const canReceive = ["sent", "issued", "partially_received"].includes(purchaseOrder.status);
  const canDelete = purchaseOrder.status === "draft";

  async function handleDelete() {
    if (!window.confirm(`Delete draft purchase order ${purchaseOrder.poNumber}? This cannot be undone.`)) return;
    await deleteMutation.mutateAsync(purchaseOrder.id);
    navigate("/purchase-orders");
  }

  return (
    <Page>
      <PageHeader
        title={`Purchase Order ${purchaseOrder.poNumber}`}
        subtitle="Edit the draft, issue it to the vendor, and receive ordered items"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("/purchase-orders")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Badge variant="outline" className="flex items-center px-3 capitalize">{purchaseOrder.status}</Badge>
            {canIssue && (
              <Button disabled={issueMutation.isPending} onClick={() => issueMutation.mutate()}>
                <Send className="mr-2 h-4 w-4" />
                {issueMutation.isPending ? "Issuing..." : "Issue PO"}
              </Button>
            )}
            {canReceive && (
              <Button variant="secondary" onClick={() => setShowReceive(true)}>
                <PackageCheck className="mr-2 h-4 w-4" />
                Receive Items
              </Button>
            )}
            {canDelete && (
              <Button variant="destructive" disabled={deleteMutation.isPending} onClick={handleDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Draft
              </Button>
            )}
          </div>
        }
      />
      <ContentLayout>
        <PurchaseOrderForm
          purchaseOrder={purchaseOrder}
          onCancel={() => navigate("/purchase-orders")}
          onSaved={() => undefined}
        />
      </ContentLayout>
      {canReceive && <ReceivePurchaseOrderItemsForm open={showReceive} onOpenChange={setShowReceive} purchaseOrder={purchaseOrder} />}
    </Page>
  );
}
