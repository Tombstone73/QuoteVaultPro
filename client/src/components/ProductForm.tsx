import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { PRICING_PROFILES, type FlatGoodsConfig, getProfile, getDefaultFormula } from "@shared/pricingProfiles";
import type { ShippingPolicy, WeightUnit, WeightBasis, ShippingConfig } from "@shared/optionTreeV2";
import React, { useState, useEffect, useCallback } from "react";
import { CreateMaterialDialog } from "@/features/materials/CreateMaterialDialog";
import { useToast } from "@/hooks/use-toast";
import { BasePricingEditor } from "@/components/pbv2/builder-v2/BasePricingEditor";

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
  treeMeta,
  onUpdateTreeMeta,
  pricingV2,
  onUpdatePricingV2Base,
  onUpdatePricingV2UnitSystem,
  onAddPricingV2Tier,
  onUpdatePricingV2Tier,
  onDeletePricingV2Tier,
  pricingEngine,
  onPricingEngineChange,
}: {
  form: any;
  materials: any;
  pricingFormulas: any;
  productTypes: any;
  onSave: any;
  formId?: string;
  onPbv2StateChange?: (state: { treeJson: unknown; hasChanges: boolean; draftId: string | null }) => void;
  treeMeta?: { shippingConfig?: ShippingConfig; productImages?: any[] };
  onUpdateTreeMeta?: (updates: Record<string, unknown>) => void;
  pricingV2?: any;
  onUpdatePricingV2Base?: (base: { perSqftCents?: number; perPieceCents?: number; minimumChargeCents?: number }) => void;
  onUpdatePricingV2UnitSystem?: (unitSystem: 'imperial' | 'metric') => void;
  onAddPricingV2Tier?: (kind: 'qty' | 'sqft') => void;
  onUpdatePricingV2Tier?: (kind: 'qty' | 'sqft', index: number, tier: any) => void;
  onDeletePricingV2Tier?: (kind: 'qty' | 'sqft', index: number) => void;
  pricingEngine: "formulaLibrary" | "pricingProfile" | "pricingFormula";
  onPricingEngineChange: (engine: "formulaLibrary" | "pricingProfile" | "pricingFormula") => void;
}) => {
  const { toast } = useToast();
  const addPricingProfileKey = form.watch("pricingProfileKey");

  // Shipping config local state — synced from treeMeta
  // CRITICAL: Also use setValue to mark form dirty when shipping fields change
  const [shippingPolicy, setShippingPolicy] = useState<ShippingPolicy>(treeMeta?.shippingConfig?.shippingPolicy ?? "pickup_only");
  const [baseWeight, setBaseWeight] = useState<string>(treeMeta?.shippingConfig?.baseWeight != null ? String(treeMeta.shippingConfig.baseWeight) : "");
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(treeMeta?.shippingConfig?.weightUnit ?? "oz");
  const [weightBasis, setWeightBasis] = useState<WeightBasis>(treeMeta?.shippingConfig?.weightBasis ?? "per_item");
  
  // Hidden tracking field to mark form dirty when shipping config changes
  const shippingConfigTracker = form.watch("__shippingConfigTracker");

  // Sync local state from treeMeta when it loads from server
  useEffect(() => {
    if (treeMeta?.shippingConfig) {
      setShippingPolicy(treeMeta.shippingConfig.shippingPolicy ?? "pickup_only");
      setBaseWeight(treeMeta.shippingConfig.baseWeight != null ? String(treeMeta.shippingConfig.baseWeight) : "");
      setWeightUnit(treeMeta.shippingConfig.weightUnit ?? "oz");
      setWeightBasis(treeMeta.shippingConfig.weightBasis ?? "per_item");
    }
  }, [treeMeta?.shippingConfig]);

  const updateShippingConfig = useCallback((updates: Partial<ShippingConfig>) => {
    const current: ShippingConfig = {
      shippingPolicy,
      baseWeight: baseWeight === "" ? null : parseFloat(baseWeight),
      weightUnit,
      weightBasis,
      ...updates,
    };
    // Sanitize baseWeight: ensure no NaN
    if (typeof current.baseWeight === 'number' && isNaN(current.baseWeight)) {
      current.baseWeight = null;
    }
    onUpdateTreeMeta?.({ shippingConfig: current });
    
    // CRITICAL: Mark form dirty when shipping config changes
    // Use hidden tracking field to trigger RHF dirty state
    form.setValue("__shippingConfigTracker", Date.now(), { shouldDirty: true });
  }, [shippingPolicy, baseWeight, weightUnit, weightBasis, onUpdateTreeMeta, form]);

  const isWeightDisabled = shippingPolicy === "pickup_only";

  // Options are now managed by PBV2ProductBuilderSectionV2, not ProductForm

  const handleSave = React.useCallback((data: any) => {
    return onSave(data);
  }, [onSave]);

  return (
    <form
      onSubmit={form.handleSubmit(handleSave)}
      id={formId}
      className="space-y-0"
    >
      {/* Section 1: Basic Information — 2-column grid */}
      <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4 space-y-3">
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

      <Separator className="bg-slate-700/60 my-0" />

      {/* 2-column layout for Pricing Engine and Material & Weight */}
      <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
        <div className="grid grid-cols-2 gap-6">
        {/* LEFT: Pricing Engine */}
        <div>
          <PricingEngineRadioSection
            form={form}
            pricingFormulas={pricingFormulas}
            pricingProfileKey={addPricingProfileKey}
            pricingEngine={pricingEngine}
            onPricingEngineChange={onPricingEngineChange}
          />
        </div>

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

          {/* Shipping Policy */}
          <div>
            <Label className="text-xs text-slate-400 mb-1.5 block">Shipping Policy</Label>
            <Select
              value={shippingPolicy}
              onValueChange={(val) => {
                const policy = val as ShippingPolicy;
                setShippingPolicy(policy);
                updateShippingConfig({ shippingPolicy: policy });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select shipping policy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pickup_only">Pickup only</SelectItem>
                <SelectItem value="shippable_estimate">Shippable (estimate)</SelectItem>
                <SelectItem value="shippable_custom_quote">Shippable (custom quote)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Weight row: Base Weight, Unit, Weight Basis */}
          <div className={`grid grid-cols-3 gap-3 ${isWeightDisabled ? "opacity-40 pointer-events-none" : ""}`}>
            <div>
              <Label className="text-xs text-slate-400 mb-1.5 block">Base weight</Label>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={baseWeight}
                onChange={(e) => setBaseWeight(e.target.value)}
                onBlur={() => {
                  updateShippingConfig({
                    baseWeight: baseWeight === "" ? null : Math.max(0, parseFloat(baseWeight) || 0),
                  });
                }}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400 mb-1.5 block">Unit</Label>
              <Select
                value={weightUnit}
                onValueChange={(val) => {
                  const unit = val as WeightUnit;
                  setWeightUnit(unit);
                  updateShippingConfig({ weightUnit: unit });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oz">oz</SelectItem>
                  <SelectItem value="lb">lb</SelectItem>
                  <SelectItem value="g">g</SelectItem>
                  <SelectItem value="kg">kg</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400 mb-1.5 block">Weight basis</Label>
              <Select
                value={weightBasis}
                onValueChange={(val) => {
                  const basis = val as WeightBasis;
                  setWeightBasis(basis);
                  updateShippingConfig({ weightBasis: basis });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_item">Per item</SelectItem>
                  <SelectItem value="per_sqft">Per sq ft</SelectItem>
                  <SelectItem value="per_order">Per order</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        </div>
      </div>

      <Separator className="bg-slate-700/60 my-0" />

      {/* Section 3: Base Pricing Model (left) + Advanced Settings (right) */}
      <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4" data-section="base-pricing">
        <div className="grid grid-cols-2 gap-6">
        {/* LEFT: Base Pricing Model */}
        <div>
          <BasePricingEditor
            pricingV2={pricingV2 || null}
            onUpdateBase={onUpdatePricingV2Base!}
            onUpdateUnitSystem={onUpdatePricingV2UnitSystem!}
            onAddTier={onAddPricingV2Tier!}
            onUpdateTier={onUpdatePricingV2Tier!}
            onDeleteTier={onDeletePricingV2Tier!}
          />
        </div>

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
  pricingEngine,
  onPricingEngineChange,
}: {
  form: any;
  pricingFormulas: any;
  pricingProfileKey: string;
  pricingEngine: "formulaLibrary" | "pricingProfile" | "pricingFormula";
  onPricingEngineChange: (engine: "formulaLibrary" | "pricingProfile" | "pricingFormula") => void;
}) {
  type PricingMode = "formulaLibrary" | "pricingProfile" | "pricingFormula";

  // Use controlled state from parent
  const handleModeChange = (mode: PricingMode) => {
    onPricingEngineChange(mode);
    
    // Clear other fields when switching modes
    if (mode !== "formulaLibrary") {
      form.setValue("pricingFormulaId", null, { shouldDirty: true });
    }
    if (mode === "pricingFormula") {
      // Ensure formula field has a value
      const currentFormula = form.getValues("pricingFormula");
      if (!currentFormula) {
        form.setValue("pricingFormula", getDefaultFormula(pricingProfileKey), { shouldDirty: true });
      }
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Pricing Engine</h3>

      <RadioGroup
        value={pricingEngine}
        onValueChange={(v) => handleModeChange(v as PricingMode)}
        className="space-y-0 gap-0"
      >
        {/* — Field 1: Formula Library — */}
        <div className={`rounded-md px-3 py-2.5 transition-colors ${pricingEngine === "formulaLibrary" ? "bg-slate-800/60" : "bg-transparent"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <RadioGroupItem value="formulaLibrary" id="pe-formula-lib" className="h-3.5 w-3.5" />
            <label htmlFor="pe-formula-lib" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
              Formula Library
            </label>
          </div>
          <div className={pricingEngine !== "formulaLibrary" ? "opacity-40 pointer-events-none" : "">
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
        <div className={`rounded-md px-3 py-2.5 transition-colors ${pricingEngine === "pricingProfile" ? "bg-slate-800/60" : "bg-transparent"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <RadioGroupItem value="pricingProfile" id="pe-profile" className="h-3.5 w-3.5" />
            <label htmlFor="pe-profile" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
              Pricing Profile
            </label>
          </div>
          <div className={pricingEngine !== "pricingProfile" ? "opacity-40 pointer-events-none" : "">
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
          <div className={`rounded-md px-3 py-2.5 transition-colors ${pricingEngine === "pricingFormula" ? "bg-slate-800/60" : "bg-transparent"}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <RadioGroupItem value="pricingFormula" id="pe-formula" className="h-3.5 w-3.5" />
              <label htmlFor="pe-formula" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
                Pricing Formula
              </label>
            </div>
            <div className={pricingEngine !== "pricingFormula" ? "opacity-40 pointer-events-none" : ""}>
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
