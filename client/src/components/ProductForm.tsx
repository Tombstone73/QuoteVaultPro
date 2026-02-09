import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { PRICING_PROFILES, type FlatGoodsConfig, getProfile, getDefaultFormula } from "@shared/pricingProfiles";
import React, { useState, useEffect } from "react";
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
      {/* Section 1: Basic Information — 2-column grid */}
      <div className="space-y-3">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Basic Information</h3>

        <div className="grid grid-cols-2 gap-6">
          {/* LEFT: Description */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-slate-400">Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Product description"
                    {...field}
                    value={field.value || ""}
                    className="min-h-[104px]"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* RIGHT: Category + Type row, then Service/Fee */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-400">Category</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Signs, Banners"
                        {...field}
                        value={field.value || ""}
                      />
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
                    <FormLabel className="text-xs text-slate-400">Product Type</FormLabel>
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
                <FormItem>
                  <div className="flex items-center gap-2 h-9">
                    <FormControl>
                      <Switch checked={field.value || false} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="text-sm text-slate-300 !mt-0">Service / Fee</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </div>

      <Separator className="bg-slate-700/50" />

      {/* 2-column layout for Pricing Engine and Material & Weight */}
      <div className="grid grid-cols-2 gap-6">
        {/* LEFT: Pricing Engine */}
        <PricingEngineRadioSection
          form={form}
          pricingFormulas={pricingFormulas}
          pricingProfileKey={addPricingProfileKey}
        />

        {/* RIGHT: Material & Weight Configuration */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Material & Weight Configuration</h3>

          <FormField
            control={form.control}
            name="primaryMaterialId"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3">
                  <FormLabel className="text-xs text-slate-400">Primary Material</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      <Separator className="bg-slate-700/50" />

      {/* Section 3: Advanced Settings — right column of 2-col grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* LEFT: placeholder for future Base Pricing Model */}
        <div />

        {/* RIGHT: Advanced Settings — toggles stacked vertically */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Advanced Settings</h3>

          <div className="space-y-3">
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="text-sm text-slate-300 !mt-0">Active</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="requiresProductionJob"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="text-sm text-slate-300 !mt-0">Requires Production Job</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isTaxable"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="text-sm text-slate-300 !mt-0">Taxable Item</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </div>

      <Separator className="bg-slate-700/50" />

      {/* Section 4: Product Images — full width */}
      <div className="space-y-3">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Product Images</h3>
        <p className="text-xs text-slate-500">Customer-facing images displayed in portals and storefronts</p>
        <div className="text-sm text-slate-400">
          Image upload functionality coming soon...
        </div>
      </div>
    </form>
  );
};

/**
 * Pricing Engine section with radio-per-field layout.
 * Each radio is inline with its field label. Selection determines the active engine.
 */
function PricingEngineRadioSection({
  form,
  pricingFormulas,
  pricingProfileKey,
}: {
  form: any;
  pricingFormulas: any;
  pricingProfileKey: string;
}) {
  type PricingMode = "formulaLibrary" | "pricingProfile" | "pricingFormula";

  // Derive initial mode from form state
  const formulaId = form.watch("pricingFormulaId");
  const [pricingMode, setPricingMode] = useState<PricingMode>(() => {
    if (formulaId) return "formulaLibrary";
    return "pricingProfile";
  });

  // Sync mode if formula is selected externally
  useEffect(() => {
    if (formulaId && pricingMode !== "formulaLibrary") {
      setPricingMode("formulaLibrary");
    }
  }, [formulaId]);

  const handleModeChange = (mode: PricingMode) => {
    setPricingMode(mode);
    // Clear other fields when switching modes
    if (mode !== "formulaLibrary") {
      form.setValue("pricingFormulaId", null);
    }
    if (mode === "pricingFormula") {
      // Ensure formula field has a value
      const currentFormula = form.getValues("pricingFormula");
      if (!currentFormula) {
        form.setValue("pricingFormula", getDefaultFormula(pricingProfileKey));
      }
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Pricing Engine</h3>

      <RadioGroup
        value={pricingMode}
        onValueChange={(v) => handleModeChange(v as PricingMode)}
        className="space-y-0 gap-0"
      >
        {/* — Field 1: Formula Library — */}
        <div className={`rounded-md px-3 py-2.5 transition-colors ${pricingMode === "formulaLibrary" ? "bg-slate-800/60" : "bg-transparent"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <RadioGroupItem value="formulaLibrary" id="pe-formula-lib" className="h-3.5 w-3.5" />
            <label htmlFor="pe-formula-lib" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
              Formula Library
            </label>
          </div>
          <div className={pricingMode !== "formulaLibrary" ? "opacity-40 pointer-events-none" : ""}>
            <FormField
              control={form.control}
              name="pricingFormulaId"
              render={({ field }) => (
                <FormItem className="space-y-0">
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
                      <SelectTrigger className="bg-slate-950/60 border-slate-700/50 h-8 text-sm">
                        <SelectValue placeholder="Select a saved formula" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {pricingFormulas?.map((formula: any) => (
                        <SelectItem key={formula.id} value={formula.id}>
                          {formula.name} ({formula.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* — Field 2: Pricing Profile — */}
        <div className={`rounded-md px-3 py-2.5 transition-colors ${pricingMode === "pricingProfile" ? "bg-slate-800/60" : "bg-transparent"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <RadioGroupItem value="pricingProfile" id="pe-profile" className="h-3.5 w-3.5" />
            <label htmlFor="pe-profile" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
              Pricing Profile
            </label>
          </div>
          <div className={pricingMode !== "pricingProfile" ? "opacity-40 pointer-events-none" : ""}>
            <FormField
              control={form.control}
              name="pricingProfileKey"
              render={({ field }) => (
                <FormItem className="space-y-0">
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
                      <SelectTrigger className="bg-slate-950/60 border-slate-700/50 h-8 text-sm">
                        <SelectValue placeholder="Select pricing profile" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.values(PRICING_PROFILES).map((profile) => (
                        <SelectItem key={profile.key} value={profile.key}>{profile.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* — Field 3: Pricing Formula — */}
        {getProfile(pricingProfileKey).usesFormula && (
          <div className={`rounded-md px-3 py-2.5 transition-colors ${pricingMode === "pricingFormula" ? "bg-slate-800/60" : "bg-transparent"}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <RadioGroupItem value="pricingFormula" id="pe-formula" className="h-3.5 w-3.5" />
              <label htmlFor="pe-formula" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
                Pricing Formula
              </label>
            </div>
            <div className={pricingMode !== "pricingFormula" ? "opacity-40 pointer-events-none" : ""}>
              <FormField
                control={form.control}
                name="pricingFormula"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <FormControl>
                      <Input
                        placeholder={getDefaultFormula(pricingProfileKey)}
                        {...field}
                        value={field.value || ""}
                        className="bg-slate-950/60 border-slate-700/50 h-8 text-sm font-mono"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        )}
      </RadioGroup>
    </div>
  );
}
