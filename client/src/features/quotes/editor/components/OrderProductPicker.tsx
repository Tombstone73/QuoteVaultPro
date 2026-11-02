import type { Ref } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export type OrderProductPickerOption = { id: string; name: string; sku?: string | null; category?: string | null };

/** The catalog picker used for adding or changing an Order line product. */
export function OrderProductPicker({
  products, open, onOpenChange, search, onSearchChange, onSelect,
  disabled = false, loading = false, inHeader = false, label = "Add Product", selectedProductName, triggerRef,
}: {
  products: OrderProductPickerOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onSelect: (product: OrderProductPickerOption) => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  inHeader?: boolean;
  label?: string;
  selectedProductName?: string;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <Button ref={triggerRef} variant="outline" type="button" disabled={disabled} role="combobox"
        aria-label={label} aria-expanded={open}
        className={inHeader ? "h-9 gap-2 border-primary/40 bg-primary/[0.03] font-medium hover:bg-primary/[0.07]" : "w-full justify-between h-9 font-normal"}>
        <span className={inHeader ? "text-foreground" : "text-muted-foreground"}>{selectedProductName ?? label}</span>
        {inHeader ? <Plus className="h-4 w-4 shrink-0" /> : <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-0" align={inHeader ? "end" : "start"}>
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search by name, SKU, or category…" value={search} onValueChange={onSearchChange} />
        <CommandList>
          <CommandEmpty>{loading ? "Searching products..." : "No products found."}</CommandEmpty>
          <CommandGroup>
            {products.map((product) => <CommandItem key={product.id}
              value={`${product.name} ${product.sku ?? ""} ${product.category ?? ""}`}
              disabled={disabled}
              onSelect={() => { void onSelect(product); }}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{product.name}</div>
                {product.sku && <div className="truncate text-xs text-muted-foreground">SKU: {product.sku}</div>}
              </div>
              <Badge variant="outline" className="ml-2 shrink-0 text-[10px]">{product.category || "Product"}</Badge>
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
