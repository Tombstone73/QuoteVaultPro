import { useState } from "react";
import { useMaterials, Material } from "@/hooks/useMaterials";
import { MaterialForm } from "@/components/MaterialForm";
import { AdjustInventoryForm } from "@/components/AdjustInventoryForm";
import { LowStockBadge } from "@/components/LowStockBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useLocation } from "wouter";
import { Copy } from "lucide-react";

export default function MaterialsListPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [adjustMaterialId, setAdjustMaterialId] = useState<string | null>(null);
  const [duplicateMaterial, setDuplicateMaterial] = useState<Material | null>(null);
  const { data: materials, isLoading } = useMaterials({ search, type: typeFilter, lowStockOnly });
  const [, navigate] = useLocation();

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Materials</h1>
        <Button onClick={()=> setShowCreate(true)}>New Material</Button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Input placeholder="Search name or SKU" value={search} onChange={e=> setSearch(e.target.value)} />
        <Select value={typeFilter} onValueChange={v=> setTypeFilter(v)}>
          <SelectTrigger><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="sheet">Sheet</SelectItem>
            <SelectItem value="roll">Roll</SelectItem>
            <SelectItem value="ink">Ink</SelectItem>
            <SelectItem value="consumable">Consumable</SelectItem>
          </SelectContent>
        </Select>
        <Button variant={lowStockOnly?"destructive":"outline"} onClick={()=> setLowStockOnly(s=> !s)}>{lowStockOnly?"Showing Low Stock":"Show Low Stock"}</Button>
      </div>
      <div className="overflow-auto border rounded-md">
        <table className="min-w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left">
              <th className="p-2">Name</th>
              <th className="p-2">SKU</th>
              <th className="p-2">Type</th>
              <th className="p-2">Stock</th>
              <th className="p-2">Unit</th>
              <th className="p-2">Cost/Unit</th>
              <th className="p-2">Vendor</th>
              <th className="p-2">Alerts</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="p-4" colSpan={9}>Loading...</td></tr>}
            {materials?.map(m => {
              const stock = parseFloat(m.stockQuantity || "0");
              const min = parseFloat(m.minStockAlert || "0");
              return (
                <tr key={m.id} className="border-t hover:bg-accent cursor-pointer" onClick={()=> navigate(`/materials/${m.id}`)}>
                  <td className="p-2 font-medium">{m.name}</td>
                  <td className="p-2">{m.sku}</td>
                  <td className="p-2 capitalize">{m.type}</td>
                  <td className="p-2">{stock}</td>
                  <td className="p-2">{m.unitOfMeasure}</td>
                  <td className="p-2">{m.costPerUnit}</td>
                  <td className="p-2">—</td>
                  <td className="p-2"><LowStockBadge stock={stock} min={min}/></td>
                  <td className="p-2" onClick={e=> e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={()=> setAdjustMaterialId(m.id)}>Adjust</Button>
                      <Button size="sm" variant="ghost" onClick={()=> setDuplicateMaterial(m)} title="Duplicate material">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {materials && materials.length === 0 && !isLoading && <tr><td className="p-4" colSpan={9}>No materials found.</td></tr>}
          </tbody>
        </table>
      </div>
      <MaterialForm open={showCreate} onOpenChange={setShowCreate} />
      {adjustMaterialId && <AdjustInventoryForm materialId={adjustMaterialId} open={!!adjustMaterialId} onOpenChange={(o)=> { if(!o) setAdjustMaterialId(null); }}/>}
      {duplicateMaterial && (
        <MaterialForm 
          open={!!duplicateMaterial} 
          onOpenChange={(o) => { if (!o) setDuplicateMaterial(null); }} 
          material={duplicateMaterial} 
          isDuplicate={true} 
        />
      )}
    </div>
  );
}
