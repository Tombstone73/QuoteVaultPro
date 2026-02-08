import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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
  onPbv2StateChange,
}: {
  form: any;
  materials: any;
  pricingFormulas: any;
  productTypes: any;
  onSave: any;
  formId?: string;
  onPbv2StateChange?: (state: { treeJson: unknown; hasChanges: boolean; draftId: string | null }) => void;
}) => {
  const { toast } = useToast();
  const addPricingProfileKey = form.watch("pricingProfileKey");

  // Options are now managed by PBV2ProductBuilderSectionV2, not ProductForm

  const handleSave = React.useCallback((data: any) => {
    return onSave(data);
  }, [onSave]);

  return (
    <form
      onSubmit={form.handleSubmit(handleSave)}
      id={formId}
      className="space-y-6"
    >
      {/* #basics - Full width section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Basic Information</h3>
          <p className="text-xs text-slate-400 mt-1">Description</p>
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Textarea
                  placeholder="Product description"
                  {...field}
                  value={field.value || ""}
                  className="min-h-[80px]"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-3 gap-4">
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
          <FormField
            control={form.control}
            name="isService"
            render={({ field }) => (
              <FormItem className="flex flex-col justify-end">
                <div className="flex items-center gap-2 h-10">
                  <FormControl>
                    <Switch checked={field.value || false} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="text-slate-200 !mt-0">Service / Fee</FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* 2-column layout for Pricing Engine and Material & Weight */}
      <div className="grid grid-cols-2 gap-6">
        {/* LEFT: Pricing Engine */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Pricing Engine</h3>
            <p className="text-xs text-slate-400 mt-1">Formula Library</p>
          </div>

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
                        <SelectValue placeholder="— No formula (configure manually) —" />
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
                  <FormDescription className="text-xs text-slate-400">
                    {selectedFormula
                      ? `Optional: choose a saved pricing formula as a starting point.`
                      : "Optional: choose a saved pricing formula as a starting point."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          <div>
            <p className="text-xs text-slate-400 mt-4 mb-2">Pricing Profile</p>
          </div>

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
                <FormDescription className="text-xs text-slate-400">
                  {getProfile(field.value).description}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Formula field - shown for profiles that use formulas */}
          {getProfile(addPricingProfileKey).usesFormula && (
            <>
              <div>
                <p className="text-xs text-slate-400 mt-4 mb-2">Pricing Formula</p>
              </div>
              <FormField
                control={form.control}
                name="pricingFormula"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        placeholder={getDefaultFormula(addPricingProfileKey)}
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormDescription className="text-xs text-slate-400">
                      {addPricingProfileKey === "default" && "Variables: width, height, sqft (width×height÷144), p (price per sqft), q (quantity)"}
                      {addPricingProfileKey === "qty_only" && "Variables: q (quantity), unitPrice"}
                      {addPricingProfileKey === "fee" && "Variables: flatFee (this price is used as-is)"}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
        </div>

        {/* RIGHT: Material & Weight Configuration */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Material & Weight Configuration</h3>
            <p className="text-xs text-slate-400 mt-1">Primary Material</p>
          </div>

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
                <FormDescription className="text-xs text-slate-400">
                  Primary material is used for cost calculations and inventory; optional for service/fee products.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* Advanced Settings - Full width section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Advanced Settings</h3>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="text-slate-200 !mt-0">Active</FormLabel>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="requiresProductionJob"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="text-slate-200 !mt-0">Requires Production Job</FormLabel>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isTaxable"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="text-slate-200 !mt-0">Taxable Item</FormLabel>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* Product Images - Full width section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Product Images</h3>
          <p className="text-xs text-slate-400 mt-1">Customer-facing images displayed in quotes and proposals</p>
        </div>
        <div className="text-sm text-slate-400">
          Image upload functionality coming soon...
        </div>
      </div>
    </form>
  );
};
