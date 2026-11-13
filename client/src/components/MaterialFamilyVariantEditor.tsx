import { useState } from "react";
import { MaterialForm, type MaterialFormValues } from "@/components/MaterialForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Material, MaterialFamily } from "@/hooks/useMaterials";
import { copyMaterialVariantSettings, mostRecentMaterialVariant } from "@/lib/materialVariantDefaults";

export function MaterialFamilyVariantEditor({ family, onFinish }: { family: MaterialFamily; onFinish: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [latest, setLatest] = useState<Material>();
  const [sourceId, setSourceId] = useState(() => mostRecentMaterialVariant(family.variants)?.id ?? "");
  const [draft, setDraft] = useState<{ initialValues: Partial<MaterialFormValues>; dimensions: Array<{ dimensionId: string; label: string; value: string }> }>();
  const siblings = latest && !family.variants.some((variant) => variant.id === latest.id) ? [...family.variants, latest] : family.variants;
  const dimensions = family.dimensions.map((dimension) => ({
    dimensionId: dimension.id,
    label: dimension.displayName,
    value: (values[dimension.id] ?? "").trim(),
  }));
  const source = siblings.find((variant) => variant.id === sourceId);

  if (draft) {
    return <MaterialForm open onOpenChange={(open) => { if (!open) onFinish(); }}
      familyAssignment={{ familyId: family.id, familyName: family.name, values: draft.dimensions }}
      initialValues={draft.initialValues}
      onVariantSaved={(material, addAnother) => {
        if (!addAnother) return onFinish();
        setLatest(material);
        setSourceId(material.id);
        setValues({});
        setDraft(undefined);
      }} />;
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onFinish(); }}>
    <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add Variant</DialogTitle>
        <DialogDescription>{family.name}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (dimensions.some(({ value }) => !value)) return;
        const identity = dimensions.map(({ value }) => value).join(" - ");
        setDraft({ dimensions, initialValues: {
          ...(source ? copyMaterialVariantSettings(source) : {}),
          name: [family.name, identity].filter(Boolean).join(" - ").slice(0, 255),
          sku: "", vendorSku: "", stockQuantity: 0, linkedProductIds: [],
        } });
      }}>
        {siblings.length > 0 && <label className="block space-y-1 text-sm font-medium">
          <span>Copy settings from</span>
          <select className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            <option value="">Start with an empty form</option>
            {siblings.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {variant.sku}</option>)}
          </select>
          <span className="block text-xs font-normal text-muted-foreground">Settings are copied when you continue.</span>
        </label>}
        {dimensions.map(({ dimensionId, label }) => <label key={dimensionId} className="block space-y-1 text-sm font-medium">
          <span>{label}</span>
          <Input required maxLength={255} value={values[dimensionId] ?? ""} onChange={(event) => {
            const value = event.target.value;
            setValues((current) => ({ ...current, [dimensionId]: value }));
          }} />
        </label>)}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFinish}>Cancel</Button>
          <Button type="submit" disabled={dimensions.some(({ value }) => !value)}>Continue to Material details</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
