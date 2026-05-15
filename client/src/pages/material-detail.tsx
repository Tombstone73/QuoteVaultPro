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

const ROLL_UNIT_WARNING =
  "Roll inventory units are currently ambiguous. Stock quantity, vendor cost, and usage reservations may not all use the same unit. Review before relying on automated inventory depletion.";
const SHEET_SQFT_WARNING =
  "Sheet materials priced by sqft still need explicit conversion/yield handling before inventory depletion can be trusted.";

function effectiveMaterialUnits(material: any) {
  const catalogUnit = material.unitOfMeasure;
  const inventoryUnit = material.inventoryUnit || catalogUnit;
  const sellPriceUnit = material.sellPriceUnit || catalogUnit;
  const wholesalePriceUnit = material.wholesalePriceUnit || sellPriceUnit || catalogUnit;
  const vendorCostUnit = material.vendorCostUnit || catalogUnit;
  const consumptionUnit = material.consumptionUnit || sellPriceUnit || catalogUnit;
  return { catalogUnit, inventoryUnit, sellPriceUnit, wholesalePriceUnit, vendorCostUnit, consumptionUnit };
}

function formatMaterialWeight(material: any) {
  if (!material.weightValue || !material.weightUnit || !material.weightBasis) return "Not configured";
  const numericValue = Number.parseFloat(String(material.weightValue));
  const displayValue = Number.isFinite(numericValue) ? numericValue.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(material.weightValue);
  return `${displayValue} ${material.weightUnit} / ${String(material.weightBasis).replace("_", " ")}`;
}

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
  const units = effectiveMaterialUnits(material);
  const showRollUnitWarning =
    material.type === "roll" &&
    ["sqft", "linear_ft", "ft"].includes(String(units.inventoryUnit)) &&
    Number.isFinite(stock) &&
    stock > 0;
  const showSheetSqftWarning = material.type === "sheet" && units.inventoryUnit === "sqft";

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
      {(showRollUnitWarning || showSheetSqftWarning) ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {showRollUnitWarning ? ROLL_UNIT_WARNING : SHEET_SQFT_WARNING}
        </div>
      ) : null}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-4 space-y-2">
          <h2 className="font-medium">Material Info</h2>
          <div className="text-sm space-y-1">
            <div><strong>Type:</strong> {material.type}</div>
            <div><strong>Catalog Unit:</strong> {units.catalogUnit}</div>
            <div><strong>Inventory Unit:</strong> {units.inventoryUnit}</div>
            <div><strong>Sell Price Unit:</strong> {units.sellPriceUnit}</div>
            <div><strong>Wholesale Price Unit:</strong> {units.wholesalePriceUnit}</div>
            <div><strong>Vendor Cost Unit:</strong> {units.vendorCostUnit}</div>
            <div><strong>Consumption Unit:</strong> {units.consumptionUnit}</div>
            <div><strong>Weight:</strong> {formatMaterialWeight(material)}</div>
            <div><strong>Base Sell Price:</strong> {material.costPerUnit} per Sell Price Unit</div>
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
            <div><strong>Stock Quantity:</strong> {stock} per Inventory Unit</div>
            <div><strong>Minimum Stock Alert:</strong> {min} per Inventory Unit</div>
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
                <th className="p-2">Usage Unit</th>
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
