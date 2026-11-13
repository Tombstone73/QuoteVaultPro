import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MaterialForm, type MaterialFormValues } from "@/components/MaterialForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MaterialFamily } from "@/hooks/useMaterials";
import { materialDimensionKey } from "@/lib/materialFamilyControls";

function sharedMaterialDefaults(values: MaterialFormValues): Partial<MaterialFormValues> {
  return {
    materialForm: values.materialForm,
    inventoryUnit: values.inventoryUnit,
    consumptionUnit: values.consumptionUnit,
    vendorCostUnit: values.vendorCostUnit,
    inventoryUnitsPerPurchaseUnit: values.inventoryUnitsPerPurchaseUnit,
    minimumPurchaseQuantity: values.minimumPurchaseQuantity,
    vendorCostPerUnit: values.vendorCostPerUnit,
    costPerUnit: values.costPerUnit,
    preferredVendorId: values.preferredVendorId,
    preferredVendorName: values.preferredVendorName,
    category: values.category,
    minStockAlert: values.minStockAlert,
    width: values.width,
    height: values.height,
    thickness: values.thickness,
    thicknessUnit: values.thicknessUnit,
    rollLengthFt: values.rollLengthFt,
    costPerRoll: values.costPerRoll,
    edgeWasteInPerSide: values.edgeWasteInPerSide,
    leadWasteFt: values.leadWasteFt,
    tailWasteFt: values.tailWasteFt,
    weightValue: values.weightValue,
    weightUnit: values.weightUnit,
    weightBasis: values.weightBasis,
  };
}

export function MaterialFamilyWizard({ initialFamily, onFinish }: { initialFamily?: MaterialFamily; onFinish: () => void }) {
  const queryClient = useQueryClient();
  const [family, setFamily] = useState(initialFamily);
  const [familyName, setFamilyName] = useState("");
  const [dimensions, setDimensions] = useState("Color");
  const [values, setValues] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<Partial<MaterialFormValues>>();
  const [editingVariant, setEditingVariant] = useState(false);
  const [creatingFamily, setCreatingFamily] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createFamily(event: FormEvent) {
    event.preventDefault();
    const configured = dimensions.split(",").map((name) => name.trim()).filter(Boolean)
      .map((displayName) => ({ key: materialDimensionKey(displayName), displayName }));
    if (!configured.length || new Set(configured.map(({ key }) => key)).size !== configured.length || configured.some(({ key }) => !/^[a-z][a-z0-9_]{0,63}$/.test(key))) {
      setError("Enter distinct dimension names that begin with a letter, such as Color or Pack Size.");
      return;
    }
    setError(null);
    setCreatingFamily(true);
    try {
      const response = await fetch("/api/material-families", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: familyName.trim(), dimensions: configured }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create the family. Try again.");
      setFamily(result.data);
      void queryClient.invalidateQueries({ queryKey: ["/api/material-families"] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the family. Try again.");
    } finally {
      setCreatingFamily(false);
    }
  }

  const variantValues = family?.dimensions.map((dimension) => ({
    dimensionId: dimension.id,
    label: dimension.displayName,
    value: (values[dimension.id] ?? "").trim(),
  })) ?? [];

  if (family && editingVariant) {
    const name = [family.name, ...variantValues.map(({ value }) => value)].join(" - ");
    return <MaterialForm open onOpenChange={setEditingVariant}
      familyAssignment={{ familyId: family.id, familyName: family.name, values: variantValues }}
      initialValues={{ ...defaults, name: name.slice(0, 255), sku: name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase().slice(0, 100) }}
      onVariantSaved={(savedValues, material) => {
        if (!defaults) setDefaults(sharedMaterialDefaults(savedValues));
        setFamily({ ...family, variants: [...family.variants, material] });
        setValues({});
        setEditingVariant(false);
      }} />;
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !family && !creatingFamily) onFinish(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{family?.name ?? "New Material Family"}</DialogTitle>
        <DialogDescription>{family ? "Choose values for the next variant or finish. The first saved variant supplies defaults for the rest of this session." : "Set the family name and the dimensions that distinguish its variants."}</DialogDescription>
      </DialogHeader>
      {family ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setEditingVariant(true); }}>
        {family.variants.length > 0 && <ul aria-label="Saved variants" className="max-h-32 overflow-auto text-sm">
          {family.variants.map((variant) => <li key={variant.id}>{variant.name} · {variant.sku}</li>)}
        </ul>}
        {variantValues.map(({ dimensionId, label }) => <label key={dimensionId} className="block space-y-1 text-sm">
          <span>{label}</span>
          <Input required maxLength={255} value={values[dimensionId] ?? ""} onChange={(event) => setValues({ ...values, [dimensionId]: event.target.value })} />
        </label>)}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFinish}>Finish</Button>
          <Button disabled={variantValues.some(({ value }) => !value)}>{family.variants.length ? "Add Next Variant" : "Add First Variant"}</Button>
        </DialogFooter>
      </form> : <form className="space-y-4" onSubmit={createFamily}>
        <label className="block space-y-1 text-sm"><span>Family name</span><Input required maxLength={255} value={familyName} onChange={(event) => setFamilyName(event.target.value)} /></label>
        <label className="block space-y-1 text-sm"><span>Variant dimensions (comma separated)</span><Input required value={dimensions} onChange={(event) => setDimensions(event.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={creatingFamily} onClick={onFinish}>Cancel</Button>
          <Button disabled={creatingFamily || !familyName.trim() || !dimensions.trim()}>Create Family</Button>
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
