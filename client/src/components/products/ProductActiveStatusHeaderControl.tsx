import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";

export function ProductActiveStatusHeaderControl({
  control,
  disabled = false,
}: {
  control: any;
  disabled?: boolean;
}) {
  return (
    <FormField
      control={control}
      name="isActive"
      render={({ field }) => {
        const active = field.value ?? true;
        return (
          <FormItem className="min-w-[150px]">
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 shadow-sm">
              <FormControl>
                <Switch
                  checked={active}
                  onCheckedChange={field.onChange}
                  disabled={disabled}
                  aria-label={active ? "Product status Active" : "Product status Inactive"}
                />
              </FormControl>
              <div className="leading-tight">
                <FormLabel className="text-sm font-medium !mt-0">
                  {active ? "Active" : "Inactive"}
                </FormLabel>
                <div className="text-[11px] text-muted-foreground">Product status</div>
              </div>
            </div>
          </FormItem>
        );
      }}
    />
  );
}
