import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Trash2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-medium">Manual Reservations</CardTitle>
            <CardDescription>
              {policyMode === "off"
                ? "Manual reservations are disabled by inventory policy."
                : enabled
                ? "Explicit reservations tied to this order"
                : "Inventory reservations are disabled in settings."}
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setOpen(true)} disabled={!canMutate}>
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {policyMode === "off" ? (
          <div className="text-sm text-muted-foreground">Manual reservations are disabled by inventory policy.</div>
        ) : !enabled ? (
          <div className="text-sm text-muted-foreground">
            Enable Inventory Reservations in Organization Settings to add manual reservations.
          </div>
        ) : reservationsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : reservationsQuery.isError ? (
          <div className="text-sm text-destructive">Failed to load manual reservations.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    No manual reservations.
                  </TableCell>
                </TableRow>
              ) : (
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
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canMutate || deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate({ reservationId: r.id })}
                        title="Remove reservation"
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
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={!canMutate || createMutation.isPending || !materialId || Number(quantity) <= 0}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
