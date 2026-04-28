import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Copy, Pencil, Plus } from "lucide-react";

import { MaterialForm } from "@/components/MaterialForm";
import { AdjustInventoryForm } from "@/components/AdjustInventoryForm";
import { LowStockBadge } from "@/components/LowStockBadge";
import { useToast } from "@/hooks/use-toast";
import { Material, calculateRollDerivedValues, useMaterials } from "@/hooks/useMaterials";
import { useVendors } from "@/hooks/useVendors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DataCard,
  TitanSearchInput,
  TitanTable,
  TitanTableBody,
  TitanTableCell,
  TitanTableContainer,
  TitanTableEmpty,
  TitanTableHead,
  TitanTableHeader,
  TitanTableLoading,
  TitanTableRow,
  TitanIconButton,
} from "@/components/titan";

type StatusFilter = "all" | "active" | "inactive";

function getVendorName(material: Material, vendors: Array<{ id: string; name: string }>) {
  if (!material.preferredVendorId) return "Unassigned";
  return vendors.find((vendor) => vendor.id === material.preferredVendorId)?.name || "Unassigned";
}

export function MaterialsSettingsPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editMaterial, setEditMaterial] = useState<Material | null>(null);
  const [duplicateMaterial, setDuplicateMaterial] = useState<Material | null>(null);
  const [adjustMaterialId, setAdjustMaterialId] = useState<string | null>(null);

  const { data: materials = [], isLoading, error } = useMaterials({
    search,
    type: typeFilter,
    lowStockOnly,
    includeInactive: true,
  });
  const { data: vendors = [] } = useVendors({ isActive: undefined });

  const filteredMaterials = useMemo(() => {
    return materials.filter((material) => {
      if (statusFilter === "active" && material.isActive === false) return false;
      if (statusFilter === "inactive" && material.isActive !== false) return false;
      return true;
    });
  }, [materials, statusFilter]);

  const counts = useMemo(() => {
    const active = materials.filter((material) => material.isActive !== false).length;
    const inactive = materials.length - active;
    const lowStock = materials.filter((material) => {
      const stock = parseFloat(material.stockQuantity || "0");
      const min = parseFloat(material.minStockAlert || "0");
      return stock <= min && min > 0;
    }).length;

    return {
      total: materials.length,
      active,
      inactive,
      lowStock,
    };
  }, [materials]);

  async function handleToggleActive(material: Material) {
    try {
      const response = await fetch(`/api/materials/${material.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: material.isActive === false }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || "Failed to update material status");
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/materials/low-stock"] });
      toast({
        title: material.isActive === false ? "Material activated" : "Material deactivated",
        description: material.name,
      });
    } catch (err: any) {
      toast({
        title: "Unable to update material",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <DataCard title="Catalog Materials" description="Permanent material records in this org.">
          <div className="text-2xl font-semibold text-titan-text-primary">{counts.total}</div>
        </DataCard>
        <DataCard title="Active" description="Selectable for new product setup.">
          <div className="text-2xl font-semibold text-titan-text-primary">{counts.active}</div>
        </DataCard>
        <DataCard title="Inactive" description="Hidden from new selections but retained for history.">
          <div className="text-2xl font-semibold text-titan-text-primary">{counts.inactive}</div>
        </DataCard>
        <DataCard title="Low Stock" description="At or below the configured reorder threshold.">
          <div className="text-2xl font-semibold text-titan-text-primary">{counts.lowStock}</div>
        </DataCard>
      </div>

      <DataCard title="Filter Materials" description="Search and manage permanent material records.">
        <div className="flex flex-wrap gap-3">
          <TitanSearchInput
            placeholder="Search name or SKU..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            containerClassName="min-w-[220px] flex-1"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[160px]">
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
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={lowStockOnly ? "destructive" : "outline"} onClick={() => setLowStockOnly((value) => !value)}>
            {lowStockOnly ? "Showing Low Stock" : "Show Low Stock"}
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Material
          </Button>
        </div>
      </DataCard>

      <TitanTableContainer>
        <TitanTable>
          <TitanTableHeader>
            <TitanTableRow>
              <TitanTableHead>Name</TitanTableHead>
              <TitanTableHead>SKU</TitanTableHead>
              <TitanTableHead>Category</TitanTableHead>
              <TitanTableHead>Type</TitanTableHead>
              <TitanTableHead>Status</TitanTableHead>
              <TitanTableHead>Inventory</TitanTableHead>
              <TitanTableHead>Cost</TitanTableHead>
              <TitanTableHead>Supplier</TitanTableHead>
              <TitanTableHead>Actions</TitanTableHead>
            </TitanTableRow>
          </TitanTableHeader>
          <TitanTableBody>
            {isLoading ? <TitanTableLoading colSpan={9} message="Loading materials..." /> : null}

            {!isLoading && error ? (
              <TitanTableEmpty
                colSpan={9}
                icon={<AlertTriangle className="h-12 w-12" />}
                message={error instanceof Error ? error.message : "Failed to load materials"}
                action={
                  <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/materials"] })}>
                    Retry
                  </Button>
                }
              />
            ) : null}

            {!isLoading && !error && filteredMaterials.length === 0 ? (
              <TitanTableEmpty
                colSpan={9}
                icon={<Boxes className="h-12 w-12" />}
                message="No materials found"
                action={
                  <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add material
                  </Button>
                }
              />
            ) : null}

            {!isLoading && !error
              ? filteredMaterials.map((material) => {
                  const stock = parseFloat(material.stockQuantity || "0");
                  const min = parseFloat(material.minStockAlert || "0");
                  const rollDerived =
                    material.type === "roll" && material.width && material.rollLengthFt && material.costPerRoll
                      ? calculateRollDerivedValues(
                          parseFloat(material.width),
                          parseFloat(material.rollLengthFt),
                          parseFloat(material.costPerRoll),
                          material.edgeWasteInPerSide ? parseFloat(material.edgeWasteInPerSide) : 0,
                          material.leadWasteFt ? parseFloat(material.leadWasteFt) : 0,
                          material.tailWasteFt ? parseFloat(material.tailWasteFt) : 0
                        )
                      : null;

                  return (
                    <TitanTableRow key={material.id} clickable onClick={() => navigate(`/materials/${material.id}`)}>
                      <TitanTableCell>
                        <div className="space-y-1">
                          <div className="font-medium text-titan-text-primary">{material.name}</div>
                          {material.color ? <div className="text-xs text-titan-text-muted">{material.color}</div> : null}
                        </div>
                      </TitanTableCell>
                      <TitanTableCell>{material.sku}</TitanTableCell>
                      <TitanTableCell>{material.category || "Uncategorized"}</TitanTableCell>
                      <TitanTableCell className="capitalize">{material.type}</TitanTableCell>
                      <TitanTableCell>
                        <Badge variant={material.isActive === false ? "secondary" : "default"}>
                          {material.isActive === false ? "Inactive" : "Active"}
                        </Badge>
                      </TitanTableCell>
                      <TitanTableCell>
                        <div className="space-y-1">
                          <div className="text-titan-text-primary">
                            {material.type === "roll" && rollDerived
                              ? `${stock} rolls (~${(stock * rollDerived.usableSqftPerRoll).toLocaleString()} sqft)`
                              : `${stock} ${material.unitOfMeasure}`}
                          </div>
                          <LowStockBadge stock={stock} min={min} />
                        </div>
                      </TitanTableCell>
                      <TitanTableCell>
                        <div className="space-y-1">
                          <div className="text-titan-text-primary">${material.costPerUnit}</div>
                          {material.vendorCostPerUnit ? (
                            <div className="text-xs text-titan-text-muted">Vendor ${material.vendorCostPerUnit}</div>
                          ) : null}
                        </div>
                      </TitanTableCell>
                      <TitanTableCell>{getVendorName(material, vendors)}</TitanTableCell>
                      <TitanTableCell>
                        <div className="flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
                          <TitanIconButton icon={Pencil} variant="ghost" onClick={() => setEditMaterial(material)} title="Edit material" />
                          <TitanIconButton icon={Copy} variant="ghost" onClick={() => setDuplicateMaterial(material)} title="Duplicate material" />
                          <Button size="sm" variant="outline" onClick={() => setAdjustMaterialId(material.id)}>
                            Adjust
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleToggleActive(material)}>
                            {material.isActive === false ? "Activate" : "Deactivate"}
                          </Button>
                        </div>
                      </TitanTableCell>
                    </TitanTableRow>
                  );
                })
              : null}
          </TitanTableBody>
        </TitanTable>
      </TitanTableContainer>

      <MaterialForm open={showCreate} onOpenChange={setShowCreate} />
      {editMaterial ? <MaterialForm open={!!editMaterial} onOpenChange={(open) => !open && setEditMaterial(null)} material={editMaterial} /> : null}
      {duplicateMaterial ? (
        <MaterialForm
          open={!!duplicateMaterial}
          onOpenChange={(open) => !open && setDuplicateMaterial(null)}
          material={duplicateMaterial}
          isDuplicate
        />
      ) : null}
      {adjustMaterialId ? (
        <AdjustInventoryForm
          materialId={adjustMaterialId}
          open={!!adjustMaterialId}
          onOpenChange={(open) => !open && setAdjustMaterialId(null)}
        />
      ) : null}
    </div>
  );
}