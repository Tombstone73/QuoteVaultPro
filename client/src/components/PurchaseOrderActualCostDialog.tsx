import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { purchaseOrderRequest, type PurchaseOrder } from "@/hooks/usePurchaseOrders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { purchaseHeaderCharges } from "@shared/purchaseOrderWorkflow";

export function PurchaseOrderActualCostDialog({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState(po.lineItems[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const headerCharges = purchaseHeaderCharges(po);
  const headerCharge = headerCharges.find(item => item.key === scope);
  const charge = scope === "freight" || scope === "tax" ? scope : undefined;
  const otherChargeId = scope.startsWith("other:") ? scope.slice("other:".length) : undefined;
  const line = po.lineItems.find(item => item.id === scope);
  const previous = po.actualCosts[scope];
  const unplanned = Boolean(charge && headerCharge && Number(headerCharge.amount) === 0 && !previous);
  const [version] = useState(po.version);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim() || undefined;
    try {
      await purchaseOrderRequest("/api/purchase-orders/" + po.id + "/actual-costs", {
        expectedVersion: version, lineId: line?.id, charge, otherChargeId,
        unplannedHeaderCharge: unplanned ? data.get("unplannedHeaderCharge") === "on" : undefined,
        quantity: field("quantity"), unitCost: field("unitCost"), total: field("total"),
        final: field("confirmation") === "final", reason: field("reason"), reference: field("reference"), date: field("date"),
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not record actual cost.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
      <DialogHeader><DialogTitle>Record actual vendor cost</DialogTitle>
        <DialogDescription>Enter a total or the actual quantity and unit cost in purchase units.</DialogDescription></DialogHeader>
      <label className="grid gap-1 text-sm">Line or header charge
        <select aria-label="Line or header charge" className="rounded-md border bg-background p-2" value={scope} onChange={event => setScope(event.target.value)} disabled={saving}>
          {po.lineItems.map(line => <option key={line.id} value={line.id}>{line.description}</option>)}
          {headerCharges.map(item => <option key={item.key} value={item.key}>{item.description} (header)</option>)}
        </select>
      </label>
      <form key={scope} onSubmit={save} className="space-y-3">
        <fieldset disabled={saving} className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {!headerCharge && <>
              <label className="grid gap-1 text-sm">Actual quantity<Input type="number" step="0.01" min="0.01" name="quantity" defaultValue={previous?.quantity ?? ""} /></label>
              <label className="grid gap-1 text-sm">Actual unit cost<Input type="number" step="0.0001" min="0" name="unitCost" defaultValue={previous?.unitCost ?? ""} /></label>
            </>}
            <label className="grid gap-1 text-sm">Actual total<Input type="number" step="0.01" min="0" name="total" required={Boolean(headerCharge)} defaultValue={previous?.total ?? ""} /></label>
          </div>
          {unplanned && <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="unplannedHeaderCharge" required /> This unplanned charge is separate from the line costs.
          </label>}
          {line?.materialId && <p className="text-sm text-muted-foreground">{line.quantityReceived} purchase units received. A confirmed actual quantity must match receiving.</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">Vendor invoice/reference<Input name="reference" maxLength={150} defaultValue={previous?.reference ?? ""} /></label>
            <label className="grid gap-1 text-sm">Adjustment date<Input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
          </div>
          <label className="grid gap-1 text-sm">Confirmation
            <select name="confirmation" aria-label="Confirmation" className="rounded-md border bg-background p-2"><option value="provisional">Provisional</option><option value="final">Final confirmed</option></select>
          </label>
          <label className="grid gap-1 text-sm">Adjustment reason<Textarea name="reason" required maxLength={1000} rows={2} /></label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!scope}>{saving ? "Recording…" : "Record cost"}</Button>
          </div>
        </fieldset>
      </form>
    </DialogContent>
  </Dialog>;
}
