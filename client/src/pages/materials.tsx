import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMaterials, Material, calculateRollDerivedValues } from "@/hooks/useMaterials";
import { MaterialForm } from "@/components/MaterialForm";
import { AdjustInventoryForm } from "@/components/AdjustInventoryForm";
import { LowStockBadge } from "@/components/LowStockBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ROUTES } from "@/config/routes";
import { Copy, Pencil, Boxes, Plus } from "lucide-react";
import { useListViewSettings } from "@/hooks/useListViewSettings";
import { ListViewSettings } from "@/components/list/ListViewSettings";
import {
  Page,
  PageHeader,
  ContentLayout,
  DataCard,
  TitanSearchInput,
  TitanTableContainer,
  TitanTable,
  TitanTableHeader,
  TitanTableHead,
  TitanTableBody,
  TitanTableRow,
  TitanTableCell,
  TitanTableEmpty,
  TitanTableLoading,
  TitanButton,
  TitanIconButton,
} from "@/components/titan";

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
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editMaterial, setEditMaterial] = useState<Material | null>(null);
  const [adjustMaterialId, setAdjustMaterialId] = useState<string | null>(null);
  const [duplicateMaterial, setDuplicateMaterial] = useState<Material | null>(null);
  const { data: materials, isLoading } = useMaterials({ search, type: typeFilter, lowStockOnly });
  
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
        return <span className="font-medium text-titan-text-primary">{m.name}</span>;
      case "sku":
        return <span className="text-titan-text-secondary">{m.sku}</span>;
      case "type":
        return <span className="capitalize text-titan-text-secondary">{m.type}</span>;
      case "stock":
        if (m.type === "roll" && rollDerived) {
          const totalUsableSqft = stock * rollDerived.usableSqftPerRoll;
          return (
            <span title={`${stock} rolls × ${rollDerived.usableSqftPerRoll} sqft/roll`} className="text-titan-text-primary">
              {stock} rolls (~{totalUsableSqft.toLocaleString()} sqft)
            </span>
          );
        }
        return <span className="text-titan-text-primary">{stock}</span>;
      case "unit":
        return <span className="text-titan-text-secondary">{m.unitOfMeasure}</span>;
      case "cost":
        if (m.type === "roll" && rollDerived) {
          return (
            <span title={`$${m.costPerRoll}/roll → $${rollDerived.costPerSqft.toFixed(4)}/sqft`} className="text-titan-text-primary">
              ${rollDerived.costPerSqft.toFixed(4)}/sqft
            </span>
          );
        }
        return <span className="text-titan-text-primary">{m.costPerUnit}</span>;
      case "vendor":
        return <span className="text-titan-text-muted">—</span>;
      case "alerts":
        return <LowStockBadge stock={stock} min={min} />;
      case "actions":
        return (
          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
            <TitanIconButton icon={Pencil} variant="ghost" onClick={() => setEditMaterial(m)} title="Edit material" />
            <TitanIconButton icon={Copy} variant="ghost" onClick={() => setDuplicateMaterial(m)} title="Duplicate material" />
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
    <Page>
      <PageHeader
        title="Materials"
        subtitle="Manage inventory and track stock levels"
        actions={
          <div className="flex gap-2">
            <ListViewSettings
              columns={columns}
              onToggleVisibility={toggleVisibility}
              onReorder={setColumnOrder}
              onWidthChange={setColumnWidth}
            />
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Material
            </Button>
          </div>
        }
      />

      <ContentLayout>
        {/* Filters */}
        <DataCard>
          <div className="flex gap-4 flex-wrap">
            <TitanSearchInput
              placeholder="Search name or SKU..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              containerClassName="flex-1 min-w-[200px]"
            />
            <Select value={typeFilter} onValueChange={v => setTypeFilter(v)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="sheet">Sheet</SelectItem>
                <SelectItem value="roll">Roll</SelectItem>
                <SelectItem value="ink">Ink</SelectItem>
                <SelectItem value="consumable">Consumable</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              variant={lowStockOnly ? "destructive" : "outline"} 
              onClick={() => setLowStockOnly(s => !s)}
            >
              {lowStockOnly ? "Showing Low Stock" : "Show Low Stock"}
            </Button>
          </div>
        </DataCard>

        {/* Materials Table */}
        <TitanTableContainer>
          <TitanTable>
            <TitanTableHeader>
              <TitanTableRow>
                {visibleColumns.map((col) => (
                  <TitanTableHead
                    key={col.id}
                    style={{ width: col.width ? `${col.width}px` : undefined }}
                  >
                    {col.label}
                  </TitanTableHead>
                ))}
              </TitanTableRow>
            </TitanTableHeader>
            <TitanTableBody>
              {isLoading && (
                <TitanTableLoading colSpan={visibleColumns.length} message="Loading materials..." />
              )}
              
              {!isLoading && (!materials || materials.length === 0) && (
                <TitanTableEmpty
                  colSpan={visibleColumns.length}
                  icon={<Boxes className="w-12 h-12" />}
                  message="No materials found"
                  action={
                    <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add first material
                    </Button>
                  }
                />
              )}
              
              {!isLoading && materials?.map(m => (
                <TitanTableRow
                  key={m.id}
                  clickable
                  onClick={() => navigate(`/materials/${m.id}`)}
                >
                  {visibleColumns.map((col) => (
                    <TitanTableCell
                      key={col.id}
                      style={{ width: col.width ? `${col.width}px` : undefined }}
                    >
                      {renderCell(m, col.id)}
                    </TitanTableCell>
                  ))}
                </TitanTableRow>
              ))}
            </TitanTableBody>
          </TitanTable>
        </TitanTableContainer>
      </ContentLayout>

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
    </Page>
  );
}
