import { useState } from "react";
import { useMaterials, Material, calculateRollDerivedValues } from "@/hooks/useMaterials";
import { MaterialForm } from "@/components/MaterialForm";
import { AdjustInventoryForm } from "@/components/AdjustInventoryForm";
import { LowStockBadge } from "@/components/LowStockBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useLocation } from "wouter";
import { Copy, Pencil, Settings } from "lucide-react";
import { useListViewSettings } from "@/hooks/useListViewSettings";
import { ListViewSettings } from "@/components/list/ListViewSettings";

const defaultColumns = [
  { id: "name", label: "Name", visible: true },
  { id: "sku", label: "SKU", visible: true },
  { id: "type", label: "Type", visible: true },
  { id: "stock", label: "Stock", visible: true },
  { id: "unit", label: "Unit", visible: true },
  { id: "cost", label: "Cost/Unit", visible: true },
  { id: "vendor", label: "Vendor", visible: true },
  { id: "alerts", label: "Alerts", visible: true },
  { id: "actions", label: "Actions", visible: true },
];

export default function MaterialsListPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editMaterial, setEditMaterial] = useState<Material | null>(null);
  const [adjustMaterialId, setAdjustMaterialId] = useState<string | null>(null);
  const [duplicateMaterial, setDuplicateMaterial] = useState<Material | null>(null);
  const { data: materials, isLoading } = useMaterials({ search, type: typeFilter, lowStockOnly });
  const [, navigate] = useLocation();
  
  const {
    columns,
    toggleVisibility,
    setColumnOrder,
    setColumnWidth,
  } = useListViewSettings("materials-list", defaultColumns);

  const visibleColumns = columns.filter((c) => c.visible);

  const renderCell = (m: Material, columnId: string) => {
    const stock = parseFloat(m.stockQuantity || "0");
    const min = parseFloat(m.minStockAlert || "0");
    const thickness = m.thickness && m.thicknessUnit 
      ? `${parseFloat(m.thickness)} ${m.thicknessUnit}`
      : null;

    // Calculate roll derived values for display
    const rollDerived = m.type === "roll" && m.width && m.rollLengthFt && m.costPerRoll
      ? calculateRollDerivedValues(
          parseFloat(m.width),
          parseFloat(m.rollLengthFt),
          parseFloat(m.costPerRoll),
          m.edgeWasteInPerSide ? parseFloat(m.edgeWasteInPerSide) : 0,
          m.leadWasteFt ? parseFloat(m.leadWasteFt) : 0,
          m.tailWasteFt ? parseFloat(m.tailWasteFt) : 0
        )
      : null;

    switch (columnId) {
      case "name":
        return <span className="font-medium">{m.name}</span>;
      case "sku":
        return m.sku;
      case "type":
        return <span className="capitalize">{m.type}</span>;
      case "stock":
        if (m.type === "roll" && rollDerived) {
          const totalUsableSqft = stock * rollDerived.usableSqftPerRoll;
          return (
            <span title={`${stock} rolls × ${rollDerived.usableSqftPerRoll} sqft/roll`}>
              {stock} rolls (~{totalUsableSqft.toLocaleString()} sqft)
            </span>
          );
        }
        return stock;
      case "unit":
        return m.unitOfMeasure;
      case "cost":
        if (m.type === "roll" && rollDerived) {
          return (
            <span title={`$${m.costPerRoll}/roll → $${rollDerived.costPerSqft.toFixed(4)}/sqft`}>
              ${rollDerived.costPerSqft.toFixed(4)}/sqft
            </span>
          );
        }
        return m.costPerUnit;
      case "vendor":
        return "—"; // Will be populated when vendor data is loaded
      case "alerts":
        return <LowStockBadge stock={stock} min={min} />;
      case "actions":
        return (
          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={() => setEditMaterial(m)} title="Edit material">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDuplicateMaterial(m)} title="Duplicate material">
              <Copy className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdjustMaterialId(m.id)}>
              Adjust
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Materials</h1>
        <div className="flex gap-2">
          <ListViewSettings
            columns={columns}
            onToggleVisibility={toggleVisibility}
            onReorder={setColumnOrder}
            onWidthChange={setColumnWidth}
          />
          <Button onClick={() => setShowCreate(true)}>New Material</Button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Input placeholder="Search name or SKU" value={search} onChange={e => setSearch(e.target.value)} />
        <Select value={typeFilter} onValueChange={v => setTypeFilter(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="sheet">Sheet</SelectItem>
            <SelectItem value="roll">Roll</SelectItem>
            <SelectItem value="ink">Ink</SelectItem>
            <SelectItem value="consumable">Consumable</SelectItem>
          </SelectContent>
        </Select>
        <Button variant={lowStockOnly ? "destructive" : "outline"} onClick={() => setLowStockOnly(s => !s)}>
          {lowStockOnly ? "Showing Low Stock" : "Show Low Stock"}
        </Button>
      </div>
      <div className="overflow-auto border rounded-md">
        <table className="min-w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left">
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  className="p-2"
                  style={{ width: col.width ? `${col.width}px` : undefined }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="p-4" colSpan={visibleColumns.length}>
                  Loading...
                </td>
              </tr>
            )}
            {materials?.map(m => (
              <tr
                key={m.id}
                className="border-t hover:bg-accent cursor-pointer"
                onClick={() => navigate(`/materials/${m.id}`)}
              >
                {visibleColumns.map((col) => (
                  <td
                    key={col.id}
                    className="p-2"
                    style={{ width: col.width ? `${col.width}px` : undefined }}
                  >
                    {renderCell(m, col.id)}
                  </td>
                ))}
              </tr>
            ))}
            {materials && materials.length === 0 && !isLoading && (
              <tr>
                <td className="p-4" colSpan={visibleColumns.length}>
                  No materials found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <MaterialForm open={showCreate} onOpenChange={setShowCreate} />
      {editMaterial && (
        <MaterialForm
          open={!!editMaterial}
          onOpenChange={(o) => { if (!o) setEditMaterial(null); }}
          material={editMaterial}
        />
      )}
      {adjustMaterialId && (
        <AdjustInventoryForm
          materialId={adjustMaterialId}
          open={!!adjustMaterialId}
          onOpenChange={(o) => { if (!o) setAdjustMaterialId(null); }}
        />
      )}
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
