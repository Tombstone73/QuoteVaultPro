import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PRICING_PROFILES, type FlatGoodsConfig, getProfile, getDefaultFormula } from "@shared/pricingProfiles";
import React from "react";
import { CreateMaterialDialog } from "@/features/materials/CreateMaterialDialog";
import { useToast } from "@/hooks/use-toast";

// Required field indicator component
function RequiredIndicator() {
  return <span className="text-destructive ml-0.5">*</span>;
}

// Helper to create a label with required indicator
function RequiredLabel({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return (
    <>
      {children}
      {required && <RequiredIndicator />}
    </>
  );
}

export const ProductForm = ({
  form,
  materials,
  pricingFormulas,
  productTypes,
  onSave,
  formId,
  treeWasMigrated = false,
}: {
  form: any;
  materials: any;
  pricingFormulas: any;
  productTypes: any;
  onSave: any;
  formId?: string;
  treeWasMigrated?: boolean;
}) => {
  const { toast } = useToast();
  const addPricingProfileKey = form.watch("pricingProfileKey");

  return (
    <form
      onSubmit={form.handleSubmit(onSave)}
      id={formId}
      className="space-y-6"
    >
      {/* #basics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basic Information</CardTitle>
          <CardDescription>Customer-facing metadata and categorization.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea placeholder="Product description" {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Signs, Banners" {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="productTypeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {productTypes?.map((pt: any) => (
                        <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="isService"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                <div className="space-y-0.5">
                  <FormLabel>Service / Fee</FormLabel>
                  <FormDescription>This is a service or fee (design, rush, shipping) rather than a physical product</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value || false} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </CardContent>
      </Card>

      {/* #pricing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pricing Engine</CardTitle>
          <CardDescription>Choose how this product is priced and computed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

        {/* Pricing Formula Selector (Optional) */}
        <FormField
          control={form.control}
          name="pricingFormulaId"
          render={({ field }) => {
            const selectedFormula = pricingFormulas?.find((f: any) => f.id === field.value);
            return (
              <FormItem>
                <FormLabel>Formula Library</FormLabel>
                <Select
                  onValueChange={(val) => {
                    field.onChange(val === "__none__" ? null : val);
                    if (val !== "__none__") {
                      const formula = pricingFormulas?.find((f: any) => f.id === val);
                      if (formula) {
                        form.setValue("pricingProfileKey", formula.pricingProfileKey || "default");
                        if (formula.config) {
                          form.setValue("pricingProfileConfig", formula.config as unknown as FlatGoodsConfig);
                        }
                      }
                    }
                  }}
                  value={field.value || "__none__"}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a reusable formula (optional)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">— No formula (configure manually) —</SelectItem>
                    {pricingFormulas?.map((formula: any) => (
                      <SelectItem key={formula.id} value={formula.id}>
                        {formula.name} ({formula.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs italic">
                  {selectedFormula
                    ? `Using "${selectedFormula.name}" formula. Profile and config inherited from formula.`
                    : "Optional: choose a saved pricing formula as a starting point."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        <FormField
          control={form.control}
          name="pricingProfileKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pricing Profile</FormLabel>
              <Select
                onValueChange={(val) => {
                  field.onChange(val);
                  const profile = getProfile(val);
                  if (profile.usesFormula && profile.defaultFormula) {
                    form.setValue("pricingFormula", profile.defaultFormula);
                  }
                  if (val === "flat_goods" && !form.getValues("pricingProfileConfig")) {
                    form.setValue("pricingProfileConfig", {
                      sheetWidth: 48,
                      sheetHeight: 96,
                      allowRotation: true,
                      materialType: "sheet",
                      minPricePerItem: null,
                    });
                  }
                }}
                value={field.value || "default"}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select pricing profile" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.values(PRICING_PROFILES).map((profile) => (
                    <SelectItem key={profile.key} value={profile.key}>{profile.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription className="text-xs italic">
                {getProfile(field.value).description}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Profile-specific notes */}
        {getProfile(addPricingProfileKey).requiresDimensions === false && (
          <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-700 dark:text-green-300">
            <strong>Note:</strong> This profile does NOT require width/height. Dimensions will be hidden in the quote editor.
          </div>
        )}

        {/* Formula field - shown for profiles that use formulas */}
        {getProfile(addPricingProfileKey).usesFormula && (
          <FormField
            control={form.control}
            name="pricingFormula"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pricing Formula</FormLabel>
                <FormControl>
                  <Input
                    placeholder={getDefaultFormula(addPricingProfileKey)}
                    {...field}
                    value={field.value || ""}
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  {addPricingProfileKey === "default" && "Variables: width, height, sqft (width×height÷144), p (price per sqft), q (quantity)"}
                  {addPricingProfileKey === "qty_only" && "Variables: q (quantity), unitPrice"}
                  {addPricingProfileKey === "fee" && "Variables: flatFee (this price is used as-is)"}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        </CardContent>
      </Card>

      {/* #materials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Materials Config</CardTitle>
          <CardDescription>Primary material for cost and inventory.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            control={form.control}
            name="primaryMaterialId"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3">
                  <FormLabel>Primary Material</FormLabel>
                  <CreateMaterialDialog
                    onCreated={(material) => {
                      form.setValue("primaryMaterialId", material.id, { shouldDirty: true });
                    }}
                    triggerClassName="h-auto px-0"
                  />
                </div>
                <Select
                  onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                  value={field.value || "__none__"}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select primary material" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {materials?.map((mat: any) => (
                      <SelectItem key={mat.id} value={mat.id}>
                        {mat.name} {mat.sku ? `(${mat.sku})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">
                  Primary material is used for cost calculations and inventory; optional for service/fee products.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
      </Card>

      {/* #options */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base">Options & Add-ons</CardTitle>
            <CardDescription>Configure selectable add-ons and finishing using PBV2 builder below.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {treeWasMigrated ? (
              <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-1.5">
                <span className="text-xs font-medium text-amber-600">PBV2: migrated, save to persist</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5">
                <span className="text-xs font-medium text-emerald-600">PBV2: persisted</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6 text-center text-slate-400">
          <p className="text-sm">Options are managed in the PBV2 Builder section below.</p>
          <p className="text-xs mt-1">Scroll down to add groups and options.</p>
        </CardContent>
      </Card>

      {/* #advanced */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advanced</CardTitle>
          <CardDescription>Status and workflow flags.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Active</FormLabel>
                  <FormDescription>Product is available for use in quotes</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="requiresProductionJob"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Requires Production Job</FormLabel>
                  <FormDescription>Create a production job when this product is ordered</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isTaxable"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Taxable Item</FormLabel>
                  <FormDescription>Apply sales tax to this product when sold</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <Button type="submit">Save Changes</Button>
        </CardContent>
      </Card>
    </form>
  );
};
