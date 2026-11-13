import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Material } from "@/hooks/useMaterials";

export function purchaseMaterialLabel(material: Material) {
  const variant = material.variantValues?.map(({ value }) => value).join(" / ");
  return [material.familyName && variant ? `${material.familyName} / ${variant}` : material.displayLabel || material.name, material.sku].filter(Boolean).join(" / ");
}

export function PurchaseOrderMaterialPicker({ materials, value, savedDescription, onChange }: {
  materials: Material[];
  value?: string;
  savedDescription?: string;
  onChange: (materialId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = materials.find(({ id }) => id === value);
  const choose = (id: string) => { onChange(id); setOpen(false); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" className="w-full justify-start font-normal" aria-label="Select material" aria-expanded={open}>
        <span className="truncate">{selected ? purchaseMaterialLabel(selected) : value ? savedDescription || "Saved material" : "Manual / misc line"}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
      <Command label="Search materials">
        <CommandInput placeholder="Search material, variant, or SKU" />
        <CommandList>
          <CommandEmpty>No matching materials.</CommandEmpty>
          <CommandGroup>
            <CommandItem value="manual" keywords={["misc line"]} onSelect={() => choose("none")}>Manual / misc line</CommandItem>
            {materials.map((material) => <CommandItem key={material.id} value={material.id}
              keywords={[purchaseMaterialLabel(material), material.name, material.vendorSku ?? "", material.color ?? ""]}
              onSelect={() => choose(material.id)}>
              <span className="min-w-0 break-words">{purchaseMaterialLabel(material)}{material.vendorSku && <span className="block text-xs text-muted-foreground">Vendor SKU {material.vendorSku}</span>}</span>
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
