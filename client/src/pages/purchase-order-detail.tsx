import { useState } from "react";
import { useRoute } from "wouter";
import { usePurchaseOrder, useSendPurchaseOrder, useDeletePurchaseOrder } from "@/hooks/usePurchaseOrders";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { ReceivePurchaseOrderItemsForm } from "@/components/ReceivePurchaseOrderItemsForm";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

export default function PurchaseOrderDetailPage() {
  const [match, params] = useRoute("/purchase-orders/:id");
  const id = params?.id;
  const { data: po } = usePurchaseOrder(id);
  const sendMutation = useSendPurchaseOrder(id || "");
  const deleteMutation = useDeletePurchaseOrder();
  const [showEdit, setShowEdit] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

  if (!po) return <div>Loading purchase order...</div>;

  const canSend = po.status === 'draft';
  const canReceive = ['sent','partially_received'].includes(po.status);
  const canDelete = po.status === 'draft';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Purchase Order {po.poNumber}</h1>
        <div className="flex gap-2">
          {canSend && <Button disabled={sendMutation.isPending} onClick={()=> sendMutation.mutate()}>Send</Button>}
          {canReceive && <Button variant="secondary" onClick={()=> setShowReceive(true)}>Receive Items</Button>}
          {canDelete && <Button variant="destructive" disabled={deleteMutation.isPending} onClick={()=> deleteMutation.mutate(po.id)}>Delete</Button>}
          <Button variant="outline" onClick={()=> setShowEdit(true)}>Edit</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Vendor & scheduling info.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="font-medium">Vendor:</span> {po.vendor?.name}</div>
          <div><span className="font-medium">Status:</span> {po.status}</div>
          <div><span className="font-medium">Issue Date:</span> {po.issueDate.substring(0,10)}</div>
          <div><span className="font-medium">Expected Date:</span> {po.expectedDate?.substring(0,10) || '-'}</div>
          <div><span className="font-medium">Subtotal:</span> ${parseFloat(po.subtotal).toFixed(2)}</div>
          <div><span className="font-medium">Grand Total:</span> ${parseFloat(po.grandTotal).toFixed(2)}</div>
          <div className="col-span-2"><span className="font-medium">Notes:</span> {po.notes || '-'}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
          <CardDescription>Ordered vs received quantities.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Ordered</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Unit Cost</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lineItems.map(li => (
                <TableRow key={li.id}>
                  <TableCell>{li.description}</TableCell>
                  <TableCell>{li.materialId ? li.materialId.substring(0,8) : '-'}</TableCell>
                  <TableCell>{parseFloat(li.quantityOrdered).toFixed(2)}</TableCell>
                  <TableCell>{parseFloat(li.quantityReceived).toFixed(2)}</TableCell>
                  <TableCell>${parseFloat(li.unitCost).toFixed(4)}</TableCell>
                  <TableCell>${parseFloat(li.lineTotal).toFixed(4)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PurchaseOrderForm open={showEdit} onOpenChange={setShowEdit} purchaseOrder={po} />
      {canReceive && <ReceivePurchaseOrderItemsForm open={showReceive} onOpenChange={setShowReceive} purchaseOrder={po} />}
    </div>
  );
}
