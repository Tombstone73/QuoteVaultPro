import { useMemo, useState } from "react";
import { format } from "date-fns";
<<<<<<< HEAD
import { Trash2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
=======
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

<<<<<<< HEAD
import { useMaterials } from "@/hooks/useMaterials";
import {
  useManualReservations,
  useCreateManualReservation,
  useDeleteManualReservation,
  type ManualReservation,
} from "@/hooks/useManualReservations";

export default function ManualReservationsCard(props: {
  orderId: string;
  enabled: boolean;
  policyMode: "off" | "advisory" | "enforced";
}) {
  const { orderId, enabled, policyMode } = props;

  const reservationsQuery = useManualReservations(orderId, enabled);
  const createMutation = useCreateManualReservation(orderId);
  const deleteMutation = useDeleteManualReservation(orderId);

  const { data: materials } = useMaterials();

  const [open, setOpen] = useState(false);
  const [materialId, setMaterialId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");

  const canMutate = enabled && policyMode !== "off";

  const materialOptions = useMemo(() => {
    const list = Array.isArray(materials) ? materials : [];
    return list
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((m) => ({ id: m.id, name: m.name, sku: m.sku }));
  }, [materials]);

  const onSave = async () => {
    const qty = Number(quantity);
    if (!materialId) return;
    if (!Number.isFinite(qty) || qty <= 0) return;

    await createMutation.mutateAsync({ materialId, quantity: qty });
    setOpen(false);
    setMaterialId("");
    setQuantity("");
  };

  const rows: ManualReservation[] = Array.isArray(reservationsQuery.data) ? reservationsQuery.data : [];
=======
import { useToast } from "@/hooks/use-toast";
import { useMaterials } from "@/hooks/useMaterials";
import {
  useCreateManualReservation,
  useDeleteManualReservation,
  useManualReservations,
} from "@/hooks/useManualReservations";

import {
  convertReservationInputToBaseQty,
  getAllowedInputUomsForMaterial,
} from "@shared/uomConversions";

const DATE_DISPLAY_STYLE: "short" | "numeric" = "short";

export function ManualReservationsCard(props: {
  orderId: string;
  enabled: boolean;
}) {
  const { orderId, enabled } = props;
  const { toast } = useToast();

  const manualReservationsQuery = useManualReservations(orderId, enabled);
  const materialsQuery = useMaterials();

  const createMutation = useCreateManualReservation(orderId, enabled);
  const deleteMutation = useDeleteManualReservation(orderId, enabled);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [materialId, setMaterialId] = useState<string>("");
  const [inputUom, setInputUom] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");

  const materials = useMemo(() => {
    const list = materialsQuery.data ?? [];
    return [...list].sort((a, b) => {
      const an = String(a.name || "").toLowerCase();
      const bn = String(b.name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return String(a.sku || "").localeCompare(String(b.sku || ""));
    });
  }, [materialsQuery.data]);

  const reservations = (manualReservationsQuery.data as any)?.data ?? [];

  const selectedMaterial = useMemo(() => {
    return materials.find((m) => m.id === materialId) ?? null;
  }, [materials, materialId]);

  const allowedInputUoms = useMemo(() => {
    if (!selectedMaterial) return [];
    return getAllowedInputUomsForMaterial({
      type: selectedMaterial.type,
      unitOfMeasure: selectedMaterial.unitOfMeasure,
      width: selectedMaterial.width,
    });
  }, [selectedMaterial]);

  const conversion = useMemo(() => {
    if (!selectedMaterial) return null;
    const qty = Number(quantity);
    const effectiveInputUom = inputUom || selectedMaterial.unitOfMeasure;

    return convertReservationInputToBaseQty({
      material: {
        type: selectedMaterial.type,
        unitOfMeasure: selectedMaterial.unitOfMeasure,
        width: selectedMaterial.width,
      },
      inputUom: effectiveInputUom,
      inputQuantity: qty,
    });
  }, [selectedMaterial, quantity, inputUom]);

  const disabledReason = !enabled ? "Disabled by inventory policy" : null;
  const controlsDisabled = Boolean(disabledReason);

  const conversionBlocksSave = Boolean(
    selectedMaterial &&
      conversion &&
      !conversion.ok &&
      conversion.code === "missing_width" &&
      String(inputUom || selectedMaterial.unitOfMeasure) !== String(selectedMaterial.unitOfMeasure),
  );

  const onCreate = async () => {
    const qty = Number(quantity);
    if (!materialId) {
      toast({ title: "Material is required", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ title: "Quantity must be > 0", variant: "destructive" });
      return;
    }

    if (!selectedMaterial) {
      toast({ title: "Material is required", variant: "destructive" });
      return;
    }

    if (!conversion || !conversion.ok) {
      toast({ title: "Invalid quantity/unit", description: conversion?.message ?? "Unable to convert", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        materialId,
        quantity: qty,
        inputUom: String(inputUom || selectedMaterial.unitOfMeasure),
      });
      toast({ title: "Manual reservation added" });
      setDialogOpen(false);
      setMaterialId("");
      setInputUom("");
      setQuantity("");
    } catch (e: any) {
      toast({ title: "Add failed", description: String(e?.message || "Unknown error"), variant: "destructive" });
    }
  };

  const onDelete = async (reservationId: string) => {
    try {
      await deleteMutation.mutateAsync(reservationId);
      toast({ title: "Manual reservation removed" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e?.message || "Unknown error"), variant: "destructive" });
    }
  };
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-medium">Manual Reservations</CardTitle>
            <CardDescription>
<<<<<<< HEAD
              {policyMode === "off"
                ? "Manual reservations are disabled by inventory policy."
                : enabled
                ? "Explicit reservations tied to this order"
                : "Inventory reservations are disabled in settings."}
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setOpen(true)} disabled={!canMutate}>
            <Plus className="h-4 w-4 mr-2" />
=======
              {enabled ? "Order-scoped reservations (not PBV2-derived)" : "Disabled by inventory policy"}
            </CardDescription>
          </div>

          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={controlsDisabled}
          >
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
            Add
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
<<<<<<< HEAD
        {policyMode === "off" ? (
          <div className="text-sm text-muted-foreground">Manual reservations are disabled by inventory policy.</div>
        ) : !enabled ? (
          <div className="text-sm text-muted-foreground">
            Enable Inventory Reservations in Organization Settings to add manual reservations.
          </div>
        ) : reservationsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : reservationsQuery.isError ? (
=======
        {!enabled ? (
          <div className="text-sm text-muted-foreground">Disabled by inventory policy.</div>
        ) : manualReservationsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading manual reservations…</div>
        ) : manualReservationsQuery.isError ? (
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
          <div className="text-sm text-destructive">Failed to load manual reservations.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
<<<<<<< HEAD
=======
                <TableHead>SKU</TableHead>
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>By</TableHead>
<<<<<<< HEAD
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
=======
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
                    No manual reservations.
                  </TableCell>
                </TableRow>
              ) : (
<<<<<<< HEAD
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.material?.name ? (
                        <div>
                          <div className="font-medium">{r.material.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{r.material.sku}</div>
                        </div>
                      ) : (
                        <span className="font-mono text-sm">{r.id.slice(0, 8)}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono">{r.uom}</TableCell>
                    <TableCell className="text-right font-mono">{r.qty}</TableCell>
                    <TableCell className="text-sm">{format(new Date(r.createdAt), "PP p")}</TableCell>
                    <TableCell className="text-sm">{r.createdBy?.displayName ?? "—"}</TableCell>
=======
                reservations.map((r: any) => (
                  <TableRow key={String(r.id)}>
                    <TableCell>{String(r.materialName || "") || <span className="text-muted-foreground">(unknown)</span>}</TableCell>
                    <TableCell className="font-mono">{String(r.sourceKey || "")}</TableCell>
                    <TableCell className="font-mono">{String(r.uom || "")}</TableCell>
                    <TableCell className="text-right font-mono">{String(r.qty || "")}</TableCell>
                    <TableCell>
                      {(() => {
                        const dt = new Date(String(r.createdAt));
                        if (Number.isNaN(dt.getTime())) return "";
                        return format(dt, DATE_DISPLAY_STYLE === "numeric" ? "MM/dd/yyyy" : "MMM d, yyyy");
                      })()}
                    </TableCell>
                    <TableCell>
                      {String(r.createdByName || "") || String(r.createdByEmail || "") || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
<<<<<<< HEAD
                        disabled={!canMutate || deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate({ reservationId: r.id })}
                        title="Remove reservation"
=======
                        onClick={() => onDelete(String(r.id))}
                        disabled={controlsDisabled || deleteMutation.isPending}
                        aria-label="Delete manual reservation"
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

<<<<<<< HEAD
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add manual reservation</DialogTitle>
            <DialogDescription>Select a material and quantity to reserve for this order.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Material</Label>
              <Select value={materialId} onValueChange={setMaterialId} disabled={!canMutate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select material" />
                </SelectTrigger>
                <SelectContent>
                  {materialOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.sku})
=======
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add manual reservation</DialogTitle>
            <DialogDescription>
              Select a material and quantity to reserve for this order.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Material</Label>
              <Select
                value={materialId}
                onValueChange={(next) => {
                  setMaterialId(next);
                  const m = materials.find((x) => x.id === next);
                  if (m) setInputUom(String(m.unitOfMeasure));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={materialsQuery.isLoading ? "Loading materials…" : "Select material"} />
                </SelectTrigger>
                <SelectContent>
                  {materials.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No materials
                    </SelectItem>
                  ) : (
                    materials.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({m.sku})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {selectedMaterial ? (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">
                  Stock unit: <span className="font-mono text-foreground">{String(selectedMaterial.unitOfMeasure)}</span>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Input unit</Label>
              <Select
                value={String(inputUom || "")}
                onValueChange={setInputUom}
                disabled={!selectedMaterial || allowedInputUoms.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={!selectedMaterial ? "Select a material first" : "Select input unit"} />
                </SelectTrigger>
                <SelectContent>
                  {allowedInputUoms.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

<<<<<<< HEAD
            <div className="grid gap-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={!canMutate}
                placeholder="0"
              />
=======
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                inputMode="decimal"
                placeholder="1.00"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              {conversionBlocksSave ? (
                <div className="text-xs text-destructive">
                  Cannot convert without material width. Add width on the material to enable this unit.
                </div>
              ) : selectedMaterial && conversion && conversion.ok ? (
                <div className="text-xs text-muted-foreground">
                  Will reserve: <span className="font-mono text-foreground">{conversion.convertedQty.toFixed(2)} {conversion.baseUom}</span>
                </div>
              ) : selectedMaterial && conversion && !conversion.ok && conversion.code === "invalid_quantity" ? (
                <div className="text-xs text-muted-foreground">Enter a quantity to see the conversion.</div>
              ) : null}
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
            </div>
          </div>

          <DialogFooter>
<<<<<<< HEAD
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={!canMutate || createMutation.isPending || !materialId || Number(quantity) <= 0}>
=======
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={onCreate}
              disabled={
                controlsDisabled ||
                createMutation.isPending ||
                materialsQuery.isLoading ||
                !selectedMaterial ||
                conversionBlocksSave ||
                !conversion ||
                !conversion.ok
              }
            >
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
