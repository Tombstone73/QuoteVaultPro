import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useDuplicateMaterial, useMaterials, Material, calculateRollDerivedValues } from "@/hooks/useMaterials";
import { useVendors } from "@/hooks/useVendors";
import { MaterialForm } from "@/components/MaterialForm";
import { AdjustInventoryForm } from "@/components/AdjustInventoryForm";
import { LowStockBadge } from "@/components/LowStockBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Copy, Pencil, Boxes, Plus, ChevronDown, ChevronUp, ClipboardCheck, Eye, Printer, Save, X } from "lucide-react";
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
  TitanIconButton,
} from "@/components/titan";

const defaultColumns = [
  { id: "name", label: "Name", visible: true },
  { id: "sku", label: "SKU", visible: true },
  { id: "type", label: "Type", visible: true },
  { id: "stock", label: "Stock Quantity", visible: true },
  { id: "reorder", label: "Reorder Point", visible: true },
  { id: "unit", label: "Inventory Unit", visible: true },
  { id: "cost", label: "Material Cost", visible: true },
  { id: "vendor", label: "Vendor", visible: true },
  { id: "alerts", label: "Alerts", visible: true },
  { id: "actions", label: "Actions", visible: true },
];

const defaultColumnLabels = new Map(defaultColumns.map((column) => [column.id, column.label]));

type SortDirection = "asc" | "desc";
type SortableColumnId = "name" | "sku" | "type" | "stock" | "reorder" | "unit" | "cost" | "vendor" | "alerts";

const sortableColumnIds = new Set<SortableColumnId>([
  "name",
  "sku",
  "type",
  "stock",
  "reorder",
  "unit",
  "cost",
  "vendor",
  "alerts",
]);

type InventoryCountDraft = {
  stockQuantity: string;
  minStockAlert: string;
  costPerUnit: string;
  vendorCostPerUnit: string;
  costPerRoll: string;
};

type InventoryCountField = keyof InventoryCountDraft;

type SaveResult = {
  id: string;
  name: string;
  success: boolean;
  message?: string;
};

const INVENTORY_COUNT_REASON = "Physical inventory count update";

function getNumberValue(value?: string | null) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNumericText(value?: string | number | null) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return text;
  return String(parsed);
}

function draftFromMaterial(material: Material): InventoryCountDraft {
  return {
    stockQuantity: normalizeNumericText(material.stockQuantity),
    minStockAlert: normalizeNumericText(material.minStockAlert),
    costPerUnit: normalizeNumericText(material.costPerUnit),
    vendorCostPerUnit: normalizeNumericText(material.vendorCostPerUnit),
    costPerRoll: normalizeNumericText(material.costPerRoll),
  };
}

function numericValuesEqual(left?: string | null, right?: string | null) {
  const leftBlank = !String(left ?? "").trim();
  const rightBlank = !String(right ?? "").trim();
  if (leftBlank || rightBlank) return leftBlank && rightBlank;

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return String(left ?? "").trim() === String(right ?? "").trim();
  }

  return Math.abs(leftNumber - rightNumber) < 0.0001;
}

function isDraftDirty(draft: InventoryCountDraft | undefined, original: InventoryCountDraft | undefined) {
  if (!draft || !original) return false;
  return (Object.keys(draft) as InventoryCountField[]).some((field) => !numericValuesEqual(draft[field], original[field]));
}

function parseRequiredNonNegative(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return parsed;
}

function parseOptionalNonNegative(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be blank or a non-negative number`);
  }
  return parsed;
}

function formatUnsavedChanges(count: number) {
  if (count === 0) return "No unsaved changes";
  if (count === 1) return "1 unsaved change";
  return `${count} unsaved changes`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getVendorName(material: Material, vendorNamesById: Map<string, string>) {
  if (material.preferredVendorName?.trim()) return material.preferredVendorName.trim();
  if (!material.preferredVendorId) return "Unassigned";
  return vendorNamesById.get(material.preferredVendorId) ?? "Unassigned";
}

function getInventoryCountPrintMaterials(materials: Material[]) {
  return [...materials].sort((left, right) => {
    const categoryCompare = compareText(left.category || "Uncategorized", right.category || "Uncategorized");
    if (categoryCompare !== 0) return categoryCompare;
    return compareText(left.name || "", right.name || "");
  });
}

function getMaterialUnitCost(material: Material) {
  if (material.type === "roll" && material.width && material.rollLengthFt && material.costPerRoll) {
    return calculateRollDerivedValues(
      getNumberValue(material.width),
      getNumberValue(material.rollLengthFt),
      getNumberValue(material.costPerRoll),
      getNumberValue(material.edgeWasteInPerSide),
      getNumberValue(material.leadWasteFt),
      getNumberValue(material.tailWasteFt)
    ).costPerSqft;
  }

  return getNumberValue(material.costPerUnit);
}

function formatMoney(value?: string | number | null, decimals = 2) {
  const numericValue = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  return `$${safeValue.toFixed(decimals)}`;
}

function getInventoryUnit(material: Material) {
  return material.inventoryUnit || "unit";
}

function getVendorCostUnit(material: Material) {
  return material.vendorCostUnit || getInventoryUnit(material);
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export default function MaterialsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortableColumnId | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [showCreate, setShowCreate] = useState(false);
  const [editMaterial, setEditMaterial] = useState<Material | null>(null);
  const [adjustMaterialId, setAdjustMaterialId] = useState<string | null>(null);
  const duplicateMaterialInFlightRef = useRef(false);
  const [duplicateMaterialInFlight, setDuplicateMaterialInFlight] = useState(false);
  const [countMode, setCountMode] = useState(false);
  const [isSavingInventory, setIsSavingInventory] = useState(false);
  const [printSheetOpen, setPrintSheetOpen] = useState(false);
  const [countDrafts, setCountDrafts] = useState<Record<string, InventoryCountDraft>>({});
  const [countOriginals, setCountOriginals] = useState<Record<string, InventoryCountDraft>>({});
  const [countMaterialNames, setCountMaterialNames] = useState<Record<string, string>>({});
  const { data: materials, isLoading } = useMaterials({ search, type: typeFilter, lowStockOnly });
  const { data: vendors = [] } = useVendors();
  const duplicateMaterialMutation = useDuplicateMaterial();
  
  const {
    columns,
    toggleVisibility,
    setColumnOrder,
    setColumnWidth,
  } = useListViewSettings("materials-list", defaultColumns);

  const normalizedColumns = useMemo(
    () => columns.map((column) => ({
      ...column,
      label: defaultColumnLabels.get(column.id) ?? column.label,
    })),
    [columns]
  );

  const visibleColumns = normalizedColumns.filter((c) => c.visible && (!countMode || c.id !== "actions"));
  const vendorNamesById = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.id, vendor.name])),
    [vendors]
  );
  const materialsById = useMemo(
    () => new Map((materials ?? []).map((material) => [material.id, material])),
    [materials]
  );

  const sortedMaterials = useMemo(() => {
    const list = materials ?? [];

    if (!sortKey) {
      return list;
    }

    const directionMultiplier = sortDirection === "asc" ? 1 : -1;

    return [...list].sort((left, right) => {
      switch (sortKey) {
        case "name":
          return compareText(left.name ?? "", right.name ?? "") * directionMultiplier;
        case "sku":
          return compareText(left.sku ?? "", right.sku ?? "") * directionMultiplier;
        case "type":
          return compareText(left.type ?? "", right.type ?? "") * directionMultiplier;
        case "stock":
          return (getNumberValue(left.stockQuantity) - getNumberValue(right.stockQuantity)) * directionMultiplier;
        case "reorder":
          return (getNumberValue(left.minStockAlert) - getNumberValue(right.minStockAlert)) * directionMultiplier;
        case "unit":
          return compareText(left.inventoryUnit ?? "", right.inventoryUnit ?? "") * directionMultiplier;
        case "cost":
          return (getMaterialUnitCost(left) - getMaterialUnitCost(right)) * directionMultiplier;
        case "vendor":
          return compareText(
            getVendorName(left, vendorNamesById),
            getVendorName(right, vendorNamesById)
          ) * directionMultiplier;
        case "alerts": {
          const leftAlert = getNumberValue(left.minStockAlert) > 0 && getNumberValue(left.stockQuantity) <= getNumberValue(left.minStockAlert) ? 1 : 0;
          const rightAlert = getNumberValue(right.minStockAlert) > 0 && getNumberValue(right.stockQuantity) <= getNumberValue(right.minStockAlert) ? 1 : 0;
          return (leftAlert - rightAlert) * directionMultiplier;
        }
        default:
          return 0;
      }
    });
  }, [materials, sortDirection, sortKey, vendorNamesById]);

  useEffect(() => {
    if (!countMode) {
      const nextDrafts = Object.fromEntries((materials ?? []).map((material) => [material.id, draftFromMaterial(material)]));
      const nextNames = Object.fromEntries((materials ?? []).map((material) => [material.id, material.name]));
      setCountDrafts(nextDrafts);
      setCountOriginals(nextDrafts);
      setCountMaterialNames(nextNames);
      return;
    }

    setCountMaterialNames((current) => ({
      ...current,
      ...Object.fromEntries((materials ?? []).map((material) => [material.id, material.name])),
    }));

    setCountDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const material of materials ?? []) {
        if (!next[material.id]) {
          next[material.id] = draftFromMaterial(material);
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setCountOriginals((current) => {
      let changed = false;
      const next = { ...current };
      for (const material of materials ?? []) {
        if (!next[material.id]) {
          next[material.id] = draftFromMaterial(material);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [countMode, materials]);

  const dirtyRowIds = useMemo(
    () => Object.keys(countDrafts).filter((materialId) => isDraftDirty(countDrafts[materialId], countOriginals[materialId])),
    [countDrafts, countOriginals]
  );

  const dirtyRows = useMemo(
    () => dirtyRowIds.map((id) => ({
      id,
      name: materialsById.get(id)?.name ?? countMaterialNames[id] ?? id,
      draft: countDrafts[id],
      original: countOriginals[id],
    })).filter((row): row is { id: string; name: string; draft: InventoryCountDraft; original: InventoryCountDraft } => Boolean(row.draft && row.original)),
    [countDrafts, countMaterialNames, countOriginals, dirtyRowIds, materialsById]
  );

  const enterCountMode = () => {
    const nextDrafts = Object.fromEntries((materials ?? []).map((material) => [material.id, draftFromMaterial(material)]));
    const nextNames = Object.fromEntries((materials ?? []).map((material) => [material.id, material.name]));
    setCountDrafts(nextDrafts);
    setCountOriginals(nextDrafts);
    setCountMaterialNames(nextNames);
    setCountMode(true);
  };

  const cancelCountMode = () => {
    setCountDrafts(countOriginals);
    setCountMode(false);
  };

  const updateDraftField = (material: Material, field: InventoryCountField, value: string) => {
    setCountDrafts((current) => ({
      ...current,
      [material.id]: {
        ...(current[material.id] ?? draftFromMaterial(material)),
        [field]: value,
      },
    }));
    setCountOriginals((current) => current[material.id] ? current : { ...current, [material.id]: draftFromMaterial(material) });
  };

  const handleDraftInputChange = (material: Material, field: InventoryCountField) => (event: ChangeEvent<HTMLInputElement>) => {
    updateDraftField(material, field, event.target.value);
  };

  const saveInventoryRow = async (materialId: string, draft: InventoryCountDraft, original: InventoryCountDraft) => {
    const patch: Record<string, number | null> = {};

    if (!numericValuesEqual(draft.minStockAlert, original.minStockAlert)) {
      patch.minStockAlert = parseRequiredNonNegative(draft.minStockAlert, "Reorder point");
    }
    if (!numericValuesEqual(draft.costPerUnit, original.costPerUnit)) {
      patch.costPerUnit = parseRequiredNonNegative(draft.costPerUnit, "Internal cost");
    }
    if (!numericValuesEqual(draft.vendorCostPerUnit, original.vendorCostPerUnit)) {
      patch.vendorCostPerUnit = parseOptionalNonNegative(draft.vendorCostPerUnit, "Vendor purchase price");
    }
    if (!numericValuesEqual(draft.costPerRoll, original.costPerRoll)) {
      patch.costPerRoll = parseOptionalNonNegative(draft.costPerRoll, "Vendor roll cost");
    }

    if (!numericValuesEqual(draft.stockQuantity, original.stockQuantity)) {
      const quantity = parseRequiredNonNegative(draft.stockQuantity, "Quantity on hand");
      const adjustmentResponse = await fetch(`/api/materials/${materialId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          adjustmentMode: "set_quantity",
          quantity,
          reason: "other",
          otherReason: INVENTORY_COUNT_REASON,
        }),
      });

      if (!adjustmentResponse.ok) {
        const error = await adjustmentResponse.json().catch(() => ({}));
        throw new Error(error.error || "Failed to adjust quantity");
      }
    }

    if (Object.keys(patch).length > 0) {
      const materialResponse = await fetch(`/api/materials/${materialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });

      if (!materialResponse.ok) {
        const error = await materialResponse.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update material values");
      }
    }
  };

  const saveInventoryChanges = async () => {
    if (dirtyRows.length === 0) {
      toast({ title: "No inventory changes to save" });
      return;
    }

    setIsSavingInventory(true);
    const results: SaveResult[] = [];

    for (const row of dirtyRows) {
      try {
        await saveInventoryRow(row.id, row.draft, row.original);
        results.push({ id: row.id, name: row.name, success: true });
      } catch (error: any) {
        results.push({ id: row.id, name: row.name, success: false, message: error?.message || "Save failed" });
      }
    }

    const failures = results.filter((result) => !result.success);
    const successes = results.filter((result) => result.success);

    await queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/materials/low-stock"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/material-reorder-requests"] });

    if (failures.length > 0) {
      const failedNames = failures
        .map((failure) => `${failure.name}${failure.message ? `: ${failure.message}` : ""}`)
        .slice(0, 5)
        .join("; ");
      setCountOriginals((current) => {
        const next = { ...current };
        for (const result of successes) {
          if (countDrafts[result.id]) next[result.id] = countDrafts[result.id];
        }
        return next;
      });
      toast({
        title: `${successes.length} saved, ${failures.length} failed`,
        description: `Failed rows: ${failedNames}${failures.length > 5 ? ", ..." : ""}`,
        variant: "destructive",
      });
    } else {
      setCountMode(false);
      toast({ title: "Inventory values saved", description: `${successes.length} row${successes.length === 1 ? "" : "s"} updated.` });
    }

    setIsSavingInventory(false);
  };

  const printCurrentInventorySheet = () => {
    printInventoryCountSheet(
      getInventoryCountPrintMaterials(sortedMaterials),
      vendorNamesById,
      new Date().toLocaleDateString()
    );
  };

  const handleSort = (columnId: SortableColumnId) => {
    if (sortKey === columnId) {
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(columnId);
    setSortDirection("asc");
  };

  const handleDuplicateMaterial = async (material: Material) => {
    if (duplicateMaterialInFlightRef.current || duplicateMaterialMutation.isPending) return;
    duplicateMaterialInFlightRef.current = true;
    setDuplicateMaterialInFlight(true);
    try {
      await duplicateMaterialMutation.mutateAsync(material.id);
    } catch {
      // Toast is handled by the mutation hook.
    } finally {
      duplicateMaterialInFlightRef.current = false;
      setDuplicateMaterialInFlight(false);
    }
  };

  const renderSortIcon = (columnId: SortableColumnId) => {
    if (sortKey !== columnId) return null;

    return sortDirection === "asc" ? (
      <ChevronUp className="h-3.5 w-3.5 text-titan-text-primary" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5 text-titan-text-primary" />
    );
  };

  const renderCell = (m: Material, columnId: string) => {
    const stock = parseFloat(m.stockQuantity || "0");
    const min = parseFloat(m.minStockAlert || "0");
    const draft = countDrafts[m.id] ?? draftFromMaterial(m);
    const original = countOriginals[m.id] ?? draftFromMaterial(m);
    const rowIsDirty = isDraftDirty(draft, original);

    const compactNumberInput = (
      field: InventoryCountField,
      label: string,
      options?: { step?: string; disabled?: boolean }
    ) => (
      <Input
        aria-label={`${label} for ${m.name}`}
        type="number"
        min="0"
        step={options?.step ?? "0.01"}
        value={draft[field]}
        disabled={options?.disabled || isSavingInventory}
        onClick={(event) => event.stopPropagation()}
        onChange={handleDraftInputChange(m, field)}
        className={`h-8 min-w-[7rem] px-2 text-sm ${rowIsDirty ? "border-amber-400 bg-amber-50/50" : ""}`}
      />
    );

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
        if (countMode) {
          return (
            <div className="space-y-1" onClick={(event) => event.stopPropagation()}>
              {compactNumberInput("stockQuantity", "Quantity on hand")}
              <div className="text-[11px] text-titan-text-muted">{m.inventoryUnit || "unit"}</div>
            </div>
          );
        }
        if (m.type === "roll" && rollDerived) {
          const totalUsableSqft = stock * rollDerived.usableSqftPerRoll;
          return (
            <span title={`${stock} rolls × ${rollDerived.usableSqftPerRoll} sqft/roll`} className="text-titan-text-primary">
              {stock} rolls (~{totalUsableSqft.toLocaleString()} sqft)
            </span>
          );
        }
        return <span className="text-titan-text-primary">{stock}</span>;
      case "reorder":
        if (countMode) {
          return (
            <div className="space-y-1" onClick={(event) => event.stopPropagation()}>
              {compactNumberInput("minStockAlert", "Reorder point")}
              <div className="text-[11px] text-titan-text-muted">{m.inventoryUnit || "unit"}</div>
            </div>
          );
        }
        return <span className="text-titan-text-primary">{getNumberValue(m.minStockAlert)}</span>;
      case "unit":
        return <span className="text-titan-text-secondary">{m.inventoryUnit}</span>;
      case "cost":
        if (countMode) {
          return (
            <div className="grid min-w-[15rem] gap-1.5" onClick={(event) => event.stopPropagation()}>
              <label className="grid grid-cols-[4.25rem_minmax(7rem,1fr)] items-center gap-2 text-[11px] text-titan-text-muted">
                <span>Internal</span>
                {compactNumberInput("costPerUnit", "Internal cost", { step: "0.0001" })}
              </label>
              <label className="grid grid-cols-[4.25rem_minmax(7rem,1fr)] items-center gap-2 text-[11px] text-titan-text-muted">
                <span>Vendor price</span>
                {compactNumberInput("vendorCostPerUnit", "Vendor purchase price", { step: "0.0001" })}
              </label>
              {m.type === "roll" || m.costPerRoll ? (
                <label className="grid grid-cols-[4.25rem_minmax(7rem,1fr)] items-center gap-2 text-[11px] text-titan-text-muted">
                  <span>Roll</span>
                  {compactNumberInput("costPerRoll", "Vendor roll cost", { step: "0.0001" })}
                </label>
              ) : null}
            </div>
          );
        }
        if (m.type === "roll" && rollDerived) {
          return (
            <div
              title={`Displayed pricing may use sell price unit, vendor cost unit, or derived roll sqft cost depending on material type. ${formatMoney(m.costPerRoll)} / roll derives ${formatMoney(rollDerived.costPerSqft, 4)} / sqft.`}
              className="space-y-0.5"
            >
              <div className="text-titan-text-primary">Derived: {formatMoney(rollDerived.costPerSqft, 4)} / sqft</div>
              <div className="text-xs text-titan-text-secondary">Vendor: {formatMoney(m.costPerRoll)} / roll</div>
            </div>
          );
        }
        return (
          <div
            title="Displayed pricing may use sell price unit, vendor cost unit, or derived roll sqft cost depending on material type."
            className="space-y-0.5"
          >
            <div className="text-titan-text-primary">Cost: {formatMoney(m.costPerUnit)} / {getInventoryUnit(m)}</div>
            {m.vendorCostPerUnit ? (
              <div className="text-xs text-titan-text-secondary">Vendor: {formatMoney(m.vendorCostPerUnit)} / {getVendorCostUnit(m)}</div>
            ) : null}
          </div>
        );
      case "vendor":
        return (
          <div className="space-y-0.5">
            <div className="text-titan-text-secondary">{getVendorName(m, vendorNamesById)}</div>
            {m.vendorProductUrl ? <div className="text-xs text-titan-text-muted">Ordering URL saved</div> : null}
          </div>
        );
      case "alerts":
        return <LowStockBadge stock={stock} min={min} />;
      case "actions":
        return (
          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
            <TitanIconButton icon={Pencil} variant="ghost" onClick={() => setEditMaterial(m)} title="Edit material" />
            <TitanIconButton
              icon={Copy}
              variant="ghost"
              onClick={() => void handleDuplicateMaterial(m)}
              disabled={duplicateMaterialInFlight || duplicateMaterialMutation.isPending}
              title={duplicateMaterialInFlight || duplicateMaterialMutation.isPending ? "Duplicating material..." : "Duplicate material"}
            />
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
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={printCurrentInventorySheet}>
                <Printer className="w-4 h-4 mr-2" />
                Print Inventory Sheet
              </Button>
              <Button variant="outline" onClick={() => setPrintSheetOpen(true)}>
                <Eye className="w-4 h-4 mr-2" />
                Preview Sheet
              </Button>
              <ListViewSettings
                columns={normalizedColumns}
                onToggleVisibility={toggleVisibility}
                onReorder={setColumnOrder}
                onWidthChange={setColumnWidth}
              />
              {countMode ? (
                <>
                  <Button variant="outline" onClick={cancelCountMode} disabled={isSavingInventory}>
                    <X className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                  <Button onClick={saveInventoryChanges} disabled={isSavingInventory || dirtyRows.length === 0}>
                    <Save className="w-4 h-4 mr-2" />
                    {isSavingInventory ? "Saving..." : `Save${dirtyRows.length ? ` (${dirtyRows.length})` : ""}`}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={enterCountMode}>
                    <ClipboardCheck className="w-4 h-4 mr-2" />
                    Edit Inventory
                  </Button>
                  <Button onClick={() => setShowCreate(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Material
                  </Button>
                </>
              )}
            </div>
            {countMode ? (
              <p className="max-w-xl text-right text-xs text-titan-text-muted">
                Update counted quantities and pricing, then save changes. Quantity changes are recorded as inventory adjustments.
              </p>
            ) : null}
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
            {countMode && (
              <div className="flex items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-sm text-amber-900">
                {formatUnsavedChanges(dirtyRows.length)}
              </div>
            )}
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
                    sortable={sortableColumnIds.has(col.id as SortableColumnId)}
                    style={{ width: col.width ? `${col.width}px` : undefined }}
                    onClick={sortableColumnIds.has(col.id as SortableColumnId) ? () => handleSort(col.id as SortableColumnId) : undefined}
                    title={col.id === "cost" ? "Displayed pricing may use sell price unit, vendor cost unit, or derived roll sqft cost depending on material type." : undefined}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span>{col.label}</span>
                      {sortableColumnIds.has(col.id as SortableColumnId) && renderSortIcon(col.id as SortableColumnId)}
                    </span>
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
              
              {!isLoading && sortedMaterials.map(m => (
                <TitanTableRow
                  key={m.id}
                  clickable={!countMode}
                  className={countMode && isDraftDirty(countDrafts[m.id], countOriginals[m.id]) ? "bg-amber-50/40" : undefined}
                  onClick={() => {
                    if (!countMode) navigate(`/materials/${m.id}`);
                  }}
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
      <InventoryCountPrintDialog
        open={printSheetOpen}
        onOpenChange={setPrintSheetOpen}
        materials={sortedMaterials}
        vendorNamesById={vendorNamesById}
      />
    </Page>
  );
}

function InventoryCountPrintDialog({
  open,
  onOpenChange,
  materials,
  vendorNamesById,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materials: Material[];
  vendorNamesById: Map<string, string>;
}) {
  const groupedMaterials = useMemo(() => {
    return getInventoryCountPrintMaterials(materials);
  }, [materials]);

  const printDate = useMemo(() => new Date().toLocaleDateString(), [open]);
  const handlePrint = () => {
    printInventoryCountSheet(groupedMaterials, vendorNamesById, printDate);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader className="inventory-count-print-actions">
          <DialogTitle>Inventory Count Sheet</DialogTitle>
          <DialogDescription>
            Prints the currently filtered materials list, grouped by category.
          </DialogDescription>
        </DialogHeader>
        <div className="inventory-count-print-root space-y-4 rounded-md bg-white text-black">
          <div className="inventory-count-print-heading flex items-end justify-between gap-4 border-b border-black pb-3">
            <div>
              <h2 className="text-xl font-semibold text-black">Inventory Count Sheet</h2>
              <p className="text-sm text-black">Date: {printDate}</p>
            </div>
            <div className="text-right text-sm text-black">
              <div>Materials: {groupedMaterials.length}</div>
              <div>Counted by: ____________________</div>
            </div>
          </div>
          <table className="inventory-count-print-table w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-black p-2 text-left">Material</th>
                <th className="border border-black p-2 text-left">Category</th>
                <th className="border border-black p-2 text-left">Vendor</th>
                <th className="border border-black p-2 text-left">SKU / Item</th>
                <th className="border border-black p-2 text-right">System Qty</th>
                <th className="border border-black p-2 text-left">Counted Qty</th>
                <th className="border border-black p-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {groupedMaterials.map((material, index) => {
                const previous = groupedMaterials[index - 1];
                const category = material.category || "Uncategorized";
                const showCategory = !previous || (previous.category || "Uncategorized") !== category;
                return (
                  <Fragment key={material.id}>
                    {showCategory ? (
                      <tr className="inventory-count-print-category">
                        <td className="border border-black p-2" colSpan={7}>{category}</td>
                      </tr>
                    ) : null}
                    <tr>
                      <td className="border border-black p-2">{material.name}</td>
                      <td className="border border-black p-2">{category}</td>
                      <td className="border border-black p-2">{getVendorName(material, vendorNamesById)}</td>
                      <td className="border border-black p-2">{material.vendorSku || material.sku || ""}</td>
                      <td className="border border-black p-2 text-right">
                        {normalizeNumericText(material.stockQuantity)} {material.inventoryUnit || ""}
                      </td>
                      <td className="border border-black p-2 py-4">&nbsp;</td>
                      <td className="border border-black p-2 py-4">&nbsp;</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter className="inventory-count-print-actions">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildInventoryCountPrintHtml(
  materials: Material[],
  vendorNamesById: Map<string, string>,
  printDate: string
) {
  const rowsHtml = materials.map((material) => {
    const category = material.category || "Uncategorized";
    const vendor = getVendorName(material, vendorNamesById);
    const skuOrItem = material.vendorSku || material.sku || "";
    const systemQty = `${normalizeNumericText(material.stockQuantity)} ${material.inventoryUnit || ""}`.trim();

    return `
      <tr>
        <td>${escapeHtml(material.name)}</td>
        <td>${escapeHtml(category)}</td>
        <td>${escapeHtml(vendor)}</td>
        <td>${escapeHtml(skuOrItem)}</td>
        <td class="numeric">${escapeHtml(systemQty)}</td>
        <td class="blank">&nbsp;</td>
        <td class="blank">&nbsp;</td>
      </tr>
    `;
  }).join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Inventory Count Sheet</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: #fff;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 10.5pt;
        line-height: 1.25;
      }
      body {
        margin: 0.35in;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 18pt;
        line-height: 1.1;
      }
      .meta {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 14px;
        border-bottom: 1px solid #000;
        padding-bottom: 10px;
      }
      .meta p {
        margin: 3px 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        page-break-inside: auto;
      }
      thead {
        display: table-header-group;
      }
      tbody {
        display: table-row-group;
      }
      tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }
      th,
      td {
        border: 1px solid #000;
        padding: 6px;
        vertical-align: top;
      }
      th {
        font-weight: 700;
        text-align: left;
      }
      .numeric {
        text-align: right;
        white-space: nowrap;
      }
      .blank {
        min-height: 24px;
        height: 24px;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="meta">
        <div>
          <h1>Inventory Count Sheet</h1>
          <p>Date: ${escapeHtml(printDate)}</p>
        </div>
        <div>
          <p>Materials: ${escapeHtml(materials.length)}</p>
          <p>Counted by: ____________________</p>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Material</th>
            <th>Category</th>
            <th>Vendor</th>
            <th>SKU / Item</th>
            <th>System Qty</th>
            <th>Counted Qty</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </main>
  </body>
</html>`;
}

function printInventoryCountSheet(
  materials: Material[],
  vendorNamesById: Map<string, string>,
  printDate: string
) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 1000);
  };

  document.body.appendChild(iframe);
  const printDocument = iframe.contentDocument || iframe.contentWindow?.document;
  if (!printDocument) {
    cleanup();
    return;
  }

  printDocument.open();
  printDocument.write(buildInventoryCountPrintHtml(materials, vendorNamesById, printDate));
  printDocument.close();

  window.setTimeout(() => {
    const printWindow = iframe.contentWindow;
    if (!printWindow) {
      cleanup();
      return;
    }

    printWindow.focus();
    printWindow.print();
    cleanup();
  }, 100);
}
