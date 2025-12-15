import { useState } from "react";
import { useMaterial, useMaterialUsage, useMaterialAdjustments, useDeleteMaterial } from "@/hooks/useMaterials";
import { useLocation } from "wouter";
import { AdjustInventoryForm } from "@/components/AdjustInventoryForm";
import { MaterialForm } from "@/components/MaterialForm";
import { LowStockBadge } from "@/components/LowStockBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { Copy } from "lucide-react";

// Thickness unit labels for display
const THICKNESS_UNITS: Record<string, string> = {
  in: 'in',
  mm: 'mm',
  mil: 'mil',
  gauge: 'ga',
};

interface Props { params: { id: string }; }
export default function MaterialDetailPage({ params }: Props) {
  const { user } = useAuth();
  const { data: material, isLoading } = useMaterial(params.id);
  const { data: usage } = useMaterialUsage(params.id);
  const { data: adjustments } = useMaterialAdjustments(params.id);
  const deleteMutation = useDeleteMaterial();
  const [, navigate] = useLocation();
  const [showEdit, setShowEdit] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);

  if (isLoading) return <div className="p-6">Loading...</div>;
  if (!material) return <div className="p-6">Material not found.</div>;

  const stock = parseFloat(material.stockQuantity || "0");
  const min = parseFloat(material.minStockAlert || "0");
  const isPrivileged = user?.role === 'owner' || user?.role === 'admin';

  async function handleDelete() {
    if (!confirm("Delete this material?")) return;
    try {
      // `material` is guarded above, but keep this safe for TS and future refactors.
      const materialId = material?.id;
      if (!materialId) return;
      await deleteMutation.mutateAsync(materialId);
      navigate('/materials');
    } catch (e:any) {
      // toast via hook already inside mutation
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">{material.name} <span className="text-sm text-muted-foreground">{material.sku}</span></h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={()=> setShowEdit(true)}>Edit</Button>
          <Button variant="outline" onClick={()=> setShowDuplicate(true)} title="Duplicate material">
            <Copy className="h-4 w-4 mr-1" /> Duplicate
          </Button>
          <Button onClick={()=> setShowAdjust(true)}>Adjust Inventory</Button>
          {isPrivileged && <Button variant="destructive" onClick={handleDelete}>Delete</Button>}
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-4 space-y-2">
          <h2 className="font-medium">Material Info</h2>
          <div className="text-sm space-y-1">
            <div><strong>Type:</strong> {material.type}</div>
            <div><strong>Unit:</strong> {material.unitOfMeasure}</div>
            <div><strong>Cost/Unit:</strong> {material.costPerUnit}</div>
            {material.color && <div><strong>Color:</strong> {material.color}</div>}
            {material.width && <div><strong>Width:</strong> {material.width}</div>}
            {material.height && <div><strong>Height:</strong> {material.height}</div>}
            {material.thickness && (
              <div>
                <strong>Thickness:</strong> {material.thickness}
                {material.thicknessUnit && ` ${THICKNESS_UNITS[material.thicknessUnit] || material.thicknessUnit}`}
              </div>
            )}
            {material.specsJson && <pre className="bg-muted p-2 rounded text-xs max-h-40 overflow-auto">{JSON.stringify(material.specsJson, null, 2)}</pre>}
          </div>
        </Card>
        <Card className="p-4 space-y-2">
          <h2 className="font-medium flex items-center gap-2">Stock Levels {<LowStockBadge stock={stock} min={min}/>}</h2>
          <div className="text-sm space-y-1">
            <div><strong>On Hand:</strong> {stock}</div>
            <div><strong>Min Alert:</strong> {min}</div>
            <div><strong>Updated:</strong> {new Date(material.updatedAt).toLocaleString()}</div>
          </div>
        </Card>
        <Card className="p-4 space-y-2">
          <h2 className="font-medium">Recent Adjustments</h2>
          <div className="space-y-1 max-h-48 overflow-auto text-xs">
            {adjustments?.slice(0,8).map(a => (
              <div key={a.id} className="flex justify-between border-b py-1">
                <span className="capitalize">{a.type.replace('_',' ')}</span>
                <span>{a.quantityChange}</span>
              </div>
            )) || <div>No adjustments.</div>}
          </div>
        </Card>
      </div>
      <Card className="p-4">
        <h2 className="font-medium mb-2">Usage History</h2>
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left">
                <th className="p-2">Order</th>
                <th className="p-2">Line Item</th>
                <th className="p-2">Qty Used</th>
                <th className="p-2">Unit</th>
                <th className="p-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {usage?.map(u => (
                <tr key={u.id} className="border-t">
                  <td className="p-2"><a className="text-primary underline" href={`/orders/${u.orderId}`}>{u.orderId.substring(0,8)}</a></td>
                  <td className="p-2">{u.orderLineItemId.substring(0,8)}</td>
                  <td className="p-2">{u.quantityUsed}</td>
                  <td className="p-2">{u.unitOfMeasure}</td>
                  <td className="p-2">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {usage && usage.length === 0 && <tr><td className="p-4" colSpan={5}>No usage recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <MaterialForm open={showEdit} onOpenChange={setShowEdit} material={material} />
      <MaterialForm open={showDuplicate} onOpenChange={setShowDuplicate} material={material} isDuplicate={true} />
      <AdjustInventoryForm materialId={material.id} open={showAdjust} onOpenChange={setShowAdjust} />
    </div>
  );
}
