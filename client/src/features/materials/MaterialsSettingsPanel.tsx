import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Copy, Pencil, Plus } from "lucide-react";

import { MaterialForm } from "@/components/MaterialForm";
import { AdjustInventoryForm } from "@/components/AdjustInventoryForm";
import { RequestMaterialReorderDialog } from "@/components/RequestMaterialReorderDialog";
import { ReceiveMaterialReorderDialog } from "@/components/ReceiveMaterialReorderDialog";
import { useToast } from "@/hooks/use-toast";
import {
  Material,
  calculateRollDerivedValues,
  useMaterials,
  useMaterialReorderRequests,
  useMarkMaterialReorderRequestOrdered,
  useCancelMaterialReorderRequest,
  type MaterialReorderRequest,
} from "@/hooks/useMaterials";
import { useVendors } from "@/hooks/useVendors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  deriveMaterialConfigurationStatus,
  deriveMaterialInventoryStatus,
  type MaterialInventoryStatus,
} from "@shared/materialInventory";

type StatusFilter =
  | "all"
  | "healthy"
  | "low_stock"
  | "out_of_stock"
  | "on_order"
  | "needs_configuration"
  | "inactive";

type ReorderAction = "ordered" | "cancel";

const STATUS_META: Record<MaterialInventoryStatus, { label: string; className: string }> = {
  healthy: { label: "Healthy", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  low_stock: { label: "Low Stock", className: "bg-amber-50 text-amber-700 border-amber-200" },
  out_of_stock: { label: "Out of Stock", className: "bg-rose-50 text-rose-700 border-rose-200" },
  on_order: { label: "On Order", className: "bg-sky-50 text-sky-700 border-sky-200" },
  needs_configuration: { label: "Needs Configuration", className: "bg-violet-50 text-violet-700 border-violet-200" },
  inactive: { label: "Inactive", className: "bg-slate-100 text-slate-700 border-slate-200" },
};

type VendorSummary = {
  id: string;
  name: string;
  salesRepName?: string | null;
  salesRepEmail?: string | null;
  salesRepPhone?: string | null;
  leadTimeText?: string | null;
  defaultLeadTimeDays?: number | null;
};

function getVendorRecord(vendorId: string | null | undefined, vendors: VendorSummary[]) {
  if (!vendorId) return null;
  return vendors.find((vendor) => vendor.id === vendorId) || null;
}

function formatVendorLeadTime(vendor: VendorSummary | null) {
  if (!vendor) return null;
  if (vendor.leadTimeText?.trim()) return vendor.leadTimeText.trim();
  if (vendor.defaultLeadTimeDays) return `${vendor.defaultLeadTimeDays} days`;
  return null;
}

function getVendorName(material: Material, vendors: VendorSummary[]) {
  if (!material.preferredVendorId) return "Unassigned";
  return vendors.find((vendor) => vendor.id === material.preferredVendorId)?.name || "Unassigned";
}

function renderVendorSummary(vendor: VendorSummary | null) {
  if (!vendor) return <span>Unassigned</span>;

  const secondary = [vendor.salesRepName, vendor.salesRepEmail || vendor.salesRepPhone, formatVendorLeadTime(vendor)]
    .filter(Boolean)
    .join(" | ");

  return (
    <div className="space-y-1">
      <div className="font-medium text-titan-text-primary">{vendor.name}</div>
      {secondary ? <div className="text-xs text-titan-text-muted">{secondary}</div> : null}
    </div>
  );
}

function formatRequestedBy(request: MaterialReorderRequest) {
  return request.requestedByName || "-";
}

function canRequestReorder(material: Material, status: MaterialInventoryStatus, openRequestCount: number) {
  if (material.isActive === false) return false;
  if (openRequestCount > 0) return false;
  return status === "low_stock" || status === "out_of_stock" || status === "needs_configuration";
}

export function MaterialsSettingsPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editMaterial, setEditMaterial] = useState<Material | null>(null);
  const [duplicateMaterial, setDuplicateMaterial] = useState<Material | null>(null);
  const [adjustMaterial, setAdjustMaterial] = useState<Material | null>(null);
  const [requestReorderMaterial, setRequestReorderMaterial] = useState<Material | null>(null);
  const [receiveRequest, setReceiveRequest] = useState<MaterialReorderRequest | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: ReorderAction; request: MaterialReorderRequest } | null>(null);

  const { data: materials = [], isLoading, error } = useMaterials({
    search,
    type: typeFilter,
    includeInactive: true,
  });
  const { data: reorderRequests = [] } = useMaterialReorderRequests();
  const { data: vendors = [] } = useVendors({ isActive: undefined });
  const markOrderedMutation = useMarkMaterialReorderRequestOrdered();
  const cancelRequestMutation = useCancelMaterialReorderRequest();

  const openReorderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    reorderRequests
      .filter((request) => request.status === "requested" || request.status === "ordered")
      .forEach((request) => {
        counts.set(request.materialId, (counts.get(request.materialId) || 0) + 1);
      });
    return counts;
  }, [reorderRequests]);

  const materialRows = useMemo(() => {
    return materials.map((material) => {
      const openRequestCount = openReorderCounts.get(material.id) || 0;
      const configuration = deriveMaterialConfigurationStatus(material);
      const inventoryStatus = deriveMaterialInventoryStatus(material, openRequestCount);
      return {
        material,
        configuration,
        inventoryStatus,
        openRequestCount,
      };
    });
  }, [materials, openReorderCounts]);

  const filteredMaterials = useMemo(() => {
    return materialRows.filter((row) => {
      if (statusFilter !== "all" && row.inventoryStatus !== statusFilter) return false;
      return true;
    });
  }, [materialRows, statusFilter]);

  const counts = useMemo(() => {
    return {
      total: materialRows.length,
      needsConfiguration: materialRows.filter((row) => row.inventoryStatus === "needs_configuration").length,
      onOrder: materialRows.filter((row) => row.inventoryStatus === "on_order").length,
      lowOrOut: materialRows.filter((row) => row.inventoryStatus === "low_stock" || row.inventoryStatus === "out_of_stock").length,
    };
  }, [materialRows]);

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

  async function handleConfirmAction() {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === "ordered") {
        await markOrderedMutation.mutateAsync(confirmAction.request.id);
      } else {
        await cancelRequestMutation.mutateAsync(confirmAction.request.id);
      }
      setConfirmAction(null);
    } catch {
      // mutation hook handles toast
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <DataCard title="Catalog Materials" description="Permanent material records in this org.">
          <div className="text-2xl font-semibold text-titan-text-primary">{counts.total}</div>
        </DataCard>
        <DataCard title="Needs Configuration" description="Materials missing critical go-live setup.">
          <div className="text-2xl font-semibold text-titan-text-primary">{counts.needsConfiguration}</div>
        </DataCard>
        <DataCard title="Low / Out" description="Materials that need purchasing attention.">
          <div className="text-2xl font-semibold text-titan-text-primary">{counts.lowOrOut}</div>
        </DataCard>
        <DataCard title="On Order" description="Materials with an open reorder request.">
          <div className="text-2xl font-semibold text-titan-text-primary">{counts.onOrder}</div>
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
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="healthy">Healthy</SelectItem>
              <SelectItem value="low_stock">Low Stock</SelectItem>
              <SelectItem value="out_of_stock">Out of Stock</SelectItem>
              <SelectItem value="on_order">On Order</SelectItem>
              <SelectItem value="needs_configuration">Needs Configuration</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
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
              <TitanTableHead>Material Name</TitanTableHead>
              <TitanTableHead>SKU</TitanTableHead>
              <TitanTableHead>Category / Type</TitanTableHead>
              <TitanTableHead>Unit</TitanTableHead>
              <TitanTableHead>Quantity On Hand</TitanTableHead>
              <TitanTableHead>Min Stock Alert</TitanTableHead>
              <TitanTableHead>Status</TitanTableHead>
              <TitanTableHead>Supplier / Vendor</TitanTableHead>
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

            {!isLoading && !error ? filteredMaterials.map(({ material, configuration, inventoryStatus, openRequestCount }) => {
              const statusMeta = STATUS_META[inventoryStatus];
              const stock = Number(material.stockQuantity || 0);
              const min = Number(material.minStockAlert || 0);
              const rollDerived =
                material.type === "roll" && material.width && material.rollLengthFt && material.costPerRoll
                  ? calculateRollDerivedValues(
                      parseFloat(material.width),
                      parseFloat(material.rollLengthFt),
                      parseFloat(material.costPerRoll),
                      material.edgeWasteInPerSide ? parseFloat(material.edgeWasteInPerSide) : 0,
                      material.leadWasteFt ? parseFloat(material.leadWasteFt) : 0,
                      material.tailWasteFt ? parseFloat(material.tailWasteFt) : 0,
                    )
                  : null;

              return (
                <TitanTableRow key={material.id} clickable onClick={() => navigate(`/materials/${material.id}`)}>
                  <TitanTableCell>
                    <div className="space-y-1">
                      <div className="font-medium text-titan-text-primary">{material.name}</div>
                      {configuration.needsConfiguration ? (
                        <div className="text-xs text-titan-text-muted">Missing: {configuration.missing.join(", ")}</div>
                      ) : null}
                    </div>
                  </TitanTableCell>
                  <TitanTableCell>{material.sku}</TitanTableCell>
                  <TitanTableCell>
                    <div className="space-y-1">
                      <div>{material.category || "Uncategorized"}</div>
                      <div className="text-xs capitalize text-titan-text-muted">{material.type}</div>
                    </div>
                  </TitanTableCell>
                  <TitanTableCell>{material.unitOfMeasure}</TitanTableCell>
                  <TitanTableCell>
                    {material.type === "roll" && rollDerived
                      ? `${stock} rolls (~${(stock * rollDerived.usableSqftPerRoll).toLocaleString()} sqft)`
                      : stock}
                  </TitanTableCell>
                  <TitanTableCell>{min > 0 ? min : "-"}</TitanTableCell>
                  <TitanTableCell>
                    <Badge variant="outline" className={statusMeta.className}>{statusMeta.label}</Badge>
                    {openRequestCount > 1 ? <div className="mt-1 text-xs text-titan-text-muted">{openRequestCount} open requests</div> : null}
                  </TitanTableCell>
                  <TitanTableCell>{renderVendorSummary(getVendorRecord(material.preferredVendorId, vendors))}</TitanTableCell>
                  <TitanTableCell>
                    <div className="flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
                      <TitanIconButton icon={Pencil} variant="ghost" onClick={() => setEditMaterial(material)} title="Edit material" />
                      <TitanIconButton icon={Copy} variant="ghost" onClick={() => setDuplicateMaterial(material)} title="Duplicate material" />
                      <Button size="sm" variant="outline" onClick={() => setAdjustMaterial(material)}>Adjust</Button>
                      {canRequestReorder(material, inventoryStatus, openRequestCount) ? (
                        <Button size="sm" variant="outline" onClick={() => setRequestReorderMaterial(material)}>Request Reorder</Button>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => handleToggleActive(material)}>
                        {material.isActive === false ? "Activate" : "Deactivate"}
                      </Button>
                    </div>
                  </TitanTableCell>
                </TitanTableRow>
              );
            }) : null}
          </TitanTableBody>
        </TitanTable>
      </TitanTableContainer>

      <DataCard title="Reorder Requests" description="Simple operational loop for requested, ordered, received, and cancelled material reorders.">
        <TitanTableContainer>
          <TitanTable>
            <TitanTableHeader>
              <TitanTableRow>
                <TitanTableHead>Material</TitanTableHead>
                <TitanTableHead>Current Quantity</TitanTableHead>
                <TitanTableHead>Requested Quantity</TitanTableHead>
                <TitanTableHead>Status</TitanTableHead>
                <TitanTableHead>Vendor / Supplier</TitanTableHead>
                <TitanTableHead>Requested Date</TitanTableHead>
                <TitanTableHead>Requested By</TitanTableHead>
                <TitanTableHead>Actions</TitanTableHead>
              </TitanTableRow>
            </TitanTableHeader>
            <TitanTableBody>
              {reorderRequests.length === 0 ? (
                <TitanTableEmpty
                  colSpan={8}
                  icon={<Boxes className="h-10 w-10" />}
                  message="No reorder requests yet"
                />
              ) : reorderRequests.map((request) => (
                <TitanTableRow key={request.id}>
                  <TitanTableCell>
                    <div className="space-y-1">
                      <div className="font-medium text-titan-text-primary">{request.materialName}</div>
                      {request.materialSku ? <div className="text-xs text-titan-text-muted">{request.materialSku}</div> : null}
                    </div>
                  </TitanTableCell>
                  <TitanTableCell>{request.currentMaterialQuantity ?? request.currentStockQuantity ?? "-"}</TitanTableCell>
                  <TitanTableCell>{request.requestedQuantity}</TitanTableCell>
                  <TitanTableCell>
                    <Badge variant="outline" className={STATUS_META[request.status === "ordered" ? "on_order" : request.status === "received" ? "healthy" : request.status === "cancelled" ? "inactive" : "low_stock"].className}>
                      {request.status}
                    </Badge>
                  </TitanTableCell>
                  <TitanTableCell>{renderVendorSummary(getVendorRecord(request.vendorId, vendors))}</TitanTableCell>
                  <TitanTableCell>{new Date(request.requestedAt).toLocaleDateString()}</TitanTableCell>
                  <TitanTableCell>{formatRequestedBy(request)}</TitanTableCell>
                  <TitanTableCell>
                    <div className="flex flex-wrap gap-1">
                      {request.status === "requested" ? (
                        <Button size="sm" variant="outline" onClick={() => setConfirmAction({ type: "ordered", request })}>Mark Ordered</Button>
                      ) : null}
                      {(request.status === "requested" || request.status === "ordered") ? (
                        <Button size="sm" variant="outline" onClick={() => setReceiveRequest(request)}>Receive</Button>
                      ) : null}
                      {(request.status === "requested" || request.status === "ordered") ? (
                        <Button size="sm" variant="outline" onClick={() => setConfirmAction({ type: "cancel", request })}>Cancel</Button>
                      ) : null}
                    </div>
                  </TitanTableCell>
                </TitanTableRow>
              ))}
            </TitanTableBody>
          </TitanTable>
        </TitanTableContainer>
      </DataCard>

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
      {adjustMaterial ? (
        <AdjustInventoryForm
          materialId={adjustMaterial.id}
          material={adjustMaterial}
          open={!!adjustMaterial}
          onOpenChange={(open) => !open && setAdjustMaterial(null)}
        />
      ) : null}
      {requestReorderMaterial ? (
        <RequestMaterialReorderDialog
          open={!!requestReorderMaterial}
          onOpenChange={(open) => !open && setRequestReorderMaterial(null)}
          material={requestReorderMaterial}
          vendors={vendors}
        />
      ) : null}
      {receiveRequest ? (
        <ReceiveMaterialReorderDialog
          open={!!receiveRequest}
          onOpenChange={(open) => !open && setReceiveRequest(null)}
          reorderRequest={receiveRequest}
        />
      ) : null}

      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === "ordered" ? "Mark Reorder Ordered" : "Cancel Reorder Request"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === "ordered"
                ? `Mark the reorder request for ${confirmAction?.request.materialName} as ordered. This will not change stock quantity.`
                : `Cancel the reorder request for ${confirmAction?.request.materialName}. This will not change stock quantity.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Open</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction}>
              {confirmAction?.type === "ordered" ? "Mark Ordered" : "Cancel Request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}