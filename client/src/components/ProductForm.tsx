import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PRICING_PROFILES, type FlatGoodsConfig, getProfile, getDefaultFormula } from "@shared/pricingProfiles";
import type { Pbv2TierBasis, ShippingPolicy, WeightUnit, WeightBasis, ShippingConfig } from "@shared/optionTreeV2";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { CreateMaterialDialog } from "@/features/materials/CreateMaterialDialog";
import { useToast } from "@/hooks/use-toast";
import { BasePricingEditor } from "@/components/pbv2/builder-v2/BasePricingEditor";
import { PricingVariableHelper } from "@/components/pbv2/builder-v2/PricingVariableHelper";
import { FormulaReferenceModal } from "@/components/pbv2/builder-v2/FormulaReferenceModal";
import { CircleHelp } from "lucide-react";
import { formatMaterialWeightStatus } from "@/lib/materialWeightDisplay";
import { getPricingFormulaSelectionValues } from "@/lib/pricingFormulaSelection";
import {
  buildPricingConfigWithAllowRotation,
  getAllowRotationFromPricingConfig,
  mergeFormulaLibraryConfigWithProductConfig,
  normalizeProductPricingRotationConfig,
  pricingConfigHasRotationState,
  shouldShowPricingEngineRotationControl,
} from "@/lib/productPricingRotation";

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

function hasKnownLookupValue(items: any, value: unknown): boolean {
  return Array.isArray(items) && typeof value === "string" && items.some((item: any) => item.id === value);
}

function shouldShowUnknownLookupValue(items: any, value: unknown): value is string {
  return Array.isArray(items) && typeof value === "string" && value.length > 0 && !hasKnownLookupValue(items, value);
}

function UnknownLookupWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
      {children}
    </div>
  );
}

const MATERIAL_SELECT_CONTENT_CLASS = "max-h-80 overflow-y-auto";

export const ProductForm = ({
  form,
  materials,
  materialsLoading = false,
  materialsError = false,
  onRetryMaterials,
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
  onUpdatePricingV2TierBasis,
  onAddPricingV2Tier,
  onUpdatePricingV2Tier,
  onDeletePricingV2Tier,
  pricingEngine,
  onPricingEngineChange,
  pbv2PricingMode,
  onPbv2PricingModeChange,
  onGenerateAiParsingDescription,
  isGeneratingAiParsingDescription = false,
}: {
  form: any;
  materials: any;
  materialsLoading?: boolean;
  materialsError?: boolean;
  onRetryMaterials?: () => void;
  pricingFormulas: any;
  productTypes: any;
  onSave: any;
  formId?: string;
  onPbv2StateChange?: (state: { treeJson: unknown; hasChanges: boolean; draftId: string | null }) => void;
  treeMeta?: {
    shippingConfig?: ShippingConfig;
    productImages?: any[];
    geometry?: { trimAllowance?: number; trimAllowanceX?: number; trimAllowanceY?: number };
    formulaVariables?: Record<string, number>;
    pricingFormulaVariables?: Record<string, number>;
    pricingProfileKey?: string;
    pricingFormula?: string;
  };
  onUpdateTreeMeta?: (updates: Record<string, unknown>) => void;
  pricingV2?: any;
  onUpdatePricingV2Base?: (base: { perSqftCents?: number; perPieceCents?: number; minimumChargeCents?: number }) => void;
  onUpdatePricingV2UnitSystem?: (unitSystem: 'imperial' | 'metric') => void;
  onUpdatePricingV2TierBasis?: (tierBasis: Pbv2TierBasis) => void;
  onAddPricingV2Tier?: (kind: 'qty' | 'sqft') => void;
  onUpdatePricingV2Tier?: (kind: 'qty' | 'sqft', index: number, tier: any) => void;
  onDeletePricingV2Tier?: (kind: 'qty' | 'sqft', index: number) => void;
  pricingEngine?: "formulaLibrary" | "pricingProfile" | "pricingFormula";
  onPricingEngineChange?: (engine: "formulaLibrary" | "pricingProfile" | "pricingFormula") => void;
  pbv2PricingMode?: "basic" | "advanced";
  onPbv2PricingModeChange?: (mode: "basic" | "advanced") => void;
  onGenerateAiParsingDescription?: () => void;
  isGeneratingAiParsingDescription?: boolean;
}) => {
  const { toast } = useToast();
  const addPricingProfileKey = form.watch("pricingProfileKey");
  const measurementMode = form.watch("measurementMode") ?? "dimensions_required";
  const workflowIntent = form.watch("workflowIntent") ?? "standard_production";
  const aiParsingLinkedToDescription = Boolean(form.watch("aiParsingDescriptionLinkedToDescription"));

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

  const updateProductAllowRotation = useCallback((allowRotation: boolean) => {
    form.setValue("pricingProfileConfig", buildPricingConfigWithAllowRotation(form.getValues("pricingProfileConfig"), allowRotation), { shouldDirty: true });
  }, [form]);

  const isWeightDisabled = shippingPolicy === "pickup_only";
  const selectedPrimaryMaterialId = form.watch("primaryMaterialId");
  const selectedPrimaryMaterial = Array.isArray(materials)
    ? materials.find((mat: any) => mat.id === selectedPrimaryMaterialId)
    : null;
  const productTypesLoaded = Array.isArray(productTypes);
  const selectedProductType = productTypesLoaded
    ? productTypes.find((productType: any) => productType.id === form.watch("productTypeId"))
    : null;
  const productionDestination = String(selectedProductType?.defaultStationKey ?? "").trim();
  const prepressRouting = selectedProductType?.requiresPrepressOverride === true
    ? "Prepress required"
    : selectedProductType?.requiresPrepressOverride === false
      ? "Prepress skipped"
      : "Prepress inherits org default";
  const productionRouteSummary = selectedProductType
    ? `${prepressRouting}; destination: ${productionDestination || "No station configured"}`
    : null;
  const materialsLoaded = Array.isArray(materials);
  const legacyTrimAllowance = Number(treeMeta?.geometry?.trimAllowance ?? 0);
  const normalizedLegacyTrimAllowance = Number.isFinite(legacyTrimAllowance) && legacyTrimAllowance >= 0 ? legacyTrimAllowance : 0;
  const trimAllowanceX = Number(treeMeta?.geometry?.trimAllowanceX);
  const trimAllowanceY = Number(treeMeta?.geometry?.trimAllowanceY);
  const safeTrimAllowanceX = Number.isFinite(trimAllowanceX) && trimAllowanceX >= 0 ? trimAllowanceX : normalizedLegacyTrimAllowance;
  const safeTrimAllowanceY = Number.isFinite(trimAllowanceY) && trimAllowanceY >= 0 ? trimAllowanceY : normalizedLegacyTrimAllowance;

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

        <FormField
          control={form.control}
          name="shopName"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-slate-400">Shop name</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., ACM"
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormDescription className="text-[11px] text-slate-500">
                Short internal name shown on production screens.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

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
                    <Select
                      key={productTypesLoaded ? "product-type-loaded" : "product-type-loading"}
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {shouldShowUnknownLookupValue(productTypes, field.value) ? (
                          <SelectItem value={field.value}>Unknown value ({field.value})</SelectItem>
                        ) : null}
                        {productTypes?.map((pt: any) => (
                          <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {shouldShowUnknownLookupValue(productTypes, field.value) ? (
                      <UnknownLookupWarning>
                        Product type "{field.value}" is not in the current product type list. Select a valid type before saving.
                      </UnknownLookupWarning>
                    ) : null}
                    {productionRouteSummary ? (
                      <FormDescription className="text-[11px] text-slate-500">
                        Production workflow: {productionRouteSummary}. Proof requirement is configured below.
                      </FormDescription>
                    ) : null}
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
            <FormField
              control={form.control}
              name="measurementMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-slate-400">Order measurements</FormLabel>
                  <Select value={field.value ?? "dimensions_required"} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="dimensions_required">Dimensions required</SelectItem>
                      <SelectItem value="quantity_only">Quantity only</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-[11px] text-slate-500">
                    Quantity-only products do not collect width or height during quote and order entry.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="workflowIntent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-slate-400">Workflow intent</FormLabel>
                  <Select
                    value={field.value ?? "standard_production"}
                    onValueChange={(value) => {
                      field.onChange(value);
                      if (value === "service_fee") {
                        form.setValue("measurementMode", "quantity_only", { shouldDirty: true });
                        form.setValue("requiresProductionJob", false, { shouldDirty: true });
                        form.setValue("requiresProofApproval", false, { shouldDirty: true });
                      }
                    }}
                  >
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="standard_production">Standard production</SelectItem>
                      <SelectItem value="fulfillment_only">Fulfillment only</SelectItem>
                      <SelectItem value="service_fee">Service / fee</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-[11px] text-slate-500">
                    Fulfillment-only items skip artwork, proof, and prepress by default. Service / fee items are billing-only and never create production work by default.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </div>

      <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4 space-y-4 mt-4">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">AI Parsing Description</h3>
              <p className="mt-1 text-xs text-slate-500">
                Internal matching guidance for inbound parsing. This does not change customer-facing product copy.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onGenerateAiParsingDescription}
              disabled={!onGenerateAiParsingDescription || aiParsingLinkedToDescription || isGeneratingAiParsingDescription}
              aria-label="Generate AI parsing description with AI"
              aria-busy={isGeneratingAiParsingDescription ? "true" : "false"}
            >
              {isGeneratingAiParsingDescription ? "Generating..." : "Generate with AI"}
            </Button>
          </div>
          {isGeneratingAiParsingDescription ? (
            <p className="mt-2 text-xs text-slate-400" role="status" aria-live="polite">Generating AI parsing description...</p>
          ) : null}
        </div>
        <FormField
          control={form.control}
          name="aiParsingDescriptionLinkedToDescription"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 rounded-md border border-slate-700/70 bg-slate-950/30 p-3">
              <FormControl>
                <Checkbox
                  checked={Boolean(field.value)}
                  onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel className="text-sm text-slate-200">Use product description for AI parsing</FormLabel>
                <FormDescription className="text-xs text-slate-500">
                  Keep AI matching tied to the normal product description when a separate internal hint is not needed.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="aiParsingDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-slate-400">AI Parsing Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Internal phrases, aliases, and ordering language staff expect AI parsing to match."
                  {...field}
                  value={field.value || ""}
                  disabled={aiParsingLinkedToDescription}
                  className={`min-h-[96px] ${aiParsingLinkedToDescription ? "opacity-60" : ""}`}
                />
              </FormControl>
              <FormDescription className="text-xs text-slate-500">
                {aiParsingLinkedToDescription
                  ? "The product description will be used as the AI parsing description."
                  : "Use this for alternate terms or staff-only matching guidance. Product name remains the strongest match signal."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <Separator className="bg-slate-700/60 my-0" />

      {/* 2-column layout for Pricing Engine and Material & Weight */}
      <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
        <div className="grid grid-cols-2 gap-6">
        {/* LEFT: Pricing Engine */}
        <PricingEngineRadioSection
          form={form}
          pricingFormulas={pricingFormulas}
          pricingProfileKey={addPricingProfileKey}
          treeMeta={treeMeta}
          onUpdateTreeMeta={onUpdateTreeMeta}
          pricingEngine={pricingEngine}
          onPricingEngineChange={onPricingEngineChange}
          pricingMode={pbv2PricingMode ?? "basic"}
          onPricingModeChange={onPbv2PricingModeChange}
          trimAllowanceX={safeTrimAllowanceX}
          trimAllowanceY={safeTrimAllowanceY}
          onUpdateAllowRotation={updateProductAllowRotation}
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
                  key={materialsError ? "primary-material-error" : materialsLoaded ? "primary-material-loaded" : "primary-material-loading"}
                  onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                  value={field.value || "__none__"}
                  disabled={materialsLoading || materialsError}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={materialsLoading ? "Loading materials…" : materialsError ? "Materials unavailable" : "Select primary material"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className={MATERIAL_SELECT_CONTENT_CLASS}>
                    <SelectItem value="__none__">None</SelectItem>
                    {shouldShowUnknownLookupValue(materials, field.value) ? (
                      <SelectItem value={field.value}>Unknown material ({field.value})</SelectItem>
                    ) : null}
                    {materials?.map((mat: any) => (
                      <SelectItem key={mat.id} value={mat.id}>
                        {mat.name} {mat.sku ? `(${mat.sku})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="text-[11px] text-slate-500">
                  Used as the weight source unless a PBV2 option choice resolves a more specific material.
                </FormDescription>
                {materialsLoading ? (
                  <div className="text-[11px] text-slate-400" role="status">Loading active materials…</div>
                ) : null}
                {materialsError ? (
                  <div className="flex items-center gap-2 text-[11px] text-amber-300" role="alert">
                    <span>Materials could not be loaded. The selector is disabled until the list is available.</span>
                    {onRetryMaterials ? (
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={onRetryMaterials}>
                        Retry
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {materialsLoaded && materials.length === 0 ? (
                  <div className="text-[11px] text-slate-400">No active materials are available in this organization.</div>
                ) : null}
                {selectedPrimaryMaterial ? (
                  <div className={`text-[11px] ${formatMaterialWeightStatus(selectedPrimaryMaterial) === "Weight not configured" ? "text-amber-300" : "text-emerald-300"}`}>
                    {formatMaterialWeightStatus(selectedPrimaryMaterial)}
                  </div>
                ) : null}
                {shouldShowUnknownLookupValue(materials, field.value) ? (
                  <UnknownLookupWarning>
                    Primary material "{field.value}" is not in the current material list. Choose a valid material or clear it.
                  </UnknownLookupWarning>
                ) : null}
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
              <Label className="text-xs text-slate-400 mb-1.5 block">Fallback weight</Label>
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
          <div className="text-[11px] text-slate-500">
            Used only when no selected material weight is available.
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
              pricingProfileKey={addPricingProfileKey}
              onUpdateBase={onUpdatePricingV2Base!}
              onUpdateUnitSystem={onUpdatePricingV2UnitSystem!}
              onUpdateTierBasis={onUpdatePricingV2TierBasis!}
              allowRotation={getAllowRotationFromPricingConfig(form.watch("pricingProfileConfig"))}
              onUpdateAllowRotation={updateProductAllowRotation}
              onAddTier={onAddPricingV2Tier!}
              onUpdateTier={onUpdatePricingV2Tier!}
              onDeleteTier={onDeletePricingV2Tier!}
            />
            <div className="mt-2 text-[11px] text-slate-500">
              Product Editor pricing changes are saved to the PBV2 draft tree when you click Save.
            </div>
          </div>

          {/* RIGHT: Advanced Settings + Finished Size Rules */}
          <div className="flex flex-col gap-4 pt-0.5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <FormField
                control={form.control}
                name="requiresProofApproval"
                render={({ field }) => (
                  <FormItem className="min-h-9">
                    <div className="flex items-center gap-2">
                      <FormControl>
                        <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="text-sm text-slate-300 !mt-0">Requires Proof Approval</FormLabel>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {workflowIntent === "service_fee" ? (
                <div className="min-h-9 text-sm text-slate-400">
                  Service / fee workflow: no production job
                </div>
              ) : (
                <FormField
                  control={form.control}
                  name="requiresProductionJob"
                  render={({ field }) => (
                    <FormItem className="min-h-9">
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
              )}
              <FormField
                control={form.control}
                name="allowZeroPrice"
                render={({ field }) => (
                  <FormItem className="min-h-9">
                    <div className="flex items-center gap-2">
                      <FormControl><Switch checked={field.value ?? false} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="text-sm text-slate-300 !mt-0">Allow $0.00 price</FormLabel>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isTaxable"
                render={({ field }) => (
                  <FormItem className="min-h-9">
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

            {workflowIntent === "fulfillment_only" ? (
              <div className="rounded-md border border-sky-700/60 bg-sky-950/20 p-3 text-xs text-sky-200">
                Fulfillment-only defaults do not require artwork, design, proof approval, or prepress. Individual order lines can be overridden by staff.
              </div>
            ) : null}
            {measurementMode === "dimensions_required" ? <div className="rounded-md border border-slate-700 bg-slate-900/30 p-3 space-y-2">
              <h4 className="text-xs font-medium text-slate-300 uppercase tracking-wider">Finished Size Rules</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400">Trim Allowance W (in)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={safeTrimAllowanceX}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      const nextTrimAllowanceX = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
                      onUpdateTreeMeta?.({
                        geometry: {
                          ...(treeMeta?.geometry || {}),
                          trimAllowanceX: nextTrimAllowanceX,
                          trimAllowanceY: safeTrimAllowanceY,
                        },
                      });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400">Trim Allowance H (in)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={safeTrimAllowanceY}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      const nextTrimAllowanceY = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
                      onUpdateTreeMeta?.({
                        geometry: {
                          ...(treeMeta?.geometry || {}),
                          trimAllowanceX: safeTrimAllowanceX,
                          trimAllowanceY: nextTrimAllowanceY,
                        },
                      });
                    }}
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-400">Adds to finished width/height to represent trimmed delivered size.</p>
            </div> : null}
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
  treeMeta,
  onUpdateTreeMeta,
  pricingEngine,
  onPricingEngineChange,
  pricingMode,
  onPricingModeChange,
  trimAllowanceX,
  trimAllowanceY,
  onUpdateAllowRotation,
}: {
  form: any;
  pricingFormulas: any;
  pricingProfileKey: string;
  treeMeta?: {
    formulaVariables?: Record<string, number>;
    pricingFormulaVariables?: Record<string, number>;
    pricingProfileKey?: string;
    pricingFormula?: string;
  };
  onUpdateTreeMeta?: (updates: Record<string, unknown>) => void;
  pricingEngine?: "formulaLibrary" | "pricingProfile" | "pricingFormula";
  onPricingEngineChange?: (engine: "formulaLibrary" | "pricingProfile" | "pricingFormula") => void;
  pricingMode: "basic" | "advanced";
  onPricingModeChange?: (mode: "basic" | "advanced") => void;
  trimAllowanceX?: number;
  trimAllowanceY?: number;
  onUpdateAllowRotation?: (allowRotation: boolean) => void;
}) {
  type PricingEngineMode = "formulaLibrary" | "pricingProfile" | "pricingFormula";
  const LEGACY_SQFT_BASIC_FORMULA = "ceil(total_sqft) * base_price";
  const DEFAULT_FLAT_GOODS_CONFIG: FlatGoodsConfig = {
    sheetWidth: 48,
    sheetHeight: 96,
    allowRotation: false,
    materialType: "sheet",
    minPricePerItem: null,
  };

  // Use controlled pricingEngine prop, with fallback to derive from form state
  const formulaId = form.watch("pricingFormulaId");
  const currentFormula = form.watch("pricingFormula");
  const currentProfile = form.watch("pricingProfileKey");
  const currentProfileConfig = form.watch("pricingProfileConfig") as FlatGoodsConfig | null;
  const selectedFormulaLibraryValues = formulaId
    ? getPricingFormulaSelectionValues(pricingFormulas, formulaId)
    : { pricingFormula: null };
  const isAdvancedMode = pricingMode === "advanced";
  const hasTrimAllowance = (Number(trimAllowanceX) || 0) > 0 || (Number(trimAllowanceY) || 0) > 0;
  const formulaUsesOrderedDimsPattern = /\bw\s*\*\s*h\b|\bh\s*\*\s*w\b|\/\s*144\b|\bwidth\s*\*\s*height\b|\bordered_/i.test(String(currentFormula || ""));
  const shouldShowFinishedSizeWarning = isAdvancedMode && hasTrimAllowance && formulaUsesOrderedDimsPattern;
  const recommendedFormula = getDefaultFormula(currentProfile || pricingProfileKey || "default");
  const formulaForValidation = String(currentFormula || selectedFormulaLibraryValues.pricingFormula || recommendedFormula || "");
  const formulaReferencesFlatFee = /\bflatFee\b/.test(formulaForValidation);
  const formulaReferencesHourlyRate = /\bhourly_rate\b/.test(formulaForValidation);
  const shouldShowRotationControl = shouldShowPricingEngineRotationControl({
    pricingProfileKey: currentProfile || pricingProfileKey,
    pricingFormula: formulaForValidation,
    pricingProfileConfig: currentProfileConfig,
  });
  const feeFormulaUsesSqftPricing = currentProfile === "fee" && /\b(?:total_sqft|sqft|w|h|width|height|base_price|p)\b/i.test(formulaForValidation);
  const currentConfigRecord = currentProfileConfig && typeof currentProfileConfig === "object" && !Array.isArray(currentProfileConfig)
    ? (currentProfileConfig as Record<string, any>)
    : {};
  const currentFormulaVariables = currentConfigRecord.formulaVariables && typeof currentConfigRecord.formulaVariables === "object" && !Array.isArray(currentConfigRecord.formulaVariables)
    ? currentConfigRecord.formulaVariables as Record<string, any>
    : {};
  const flatFeeValueRaw = currentFormulaVariables.flatFee ?? treeMeta?.formulaVariables?.flatFee ?? treeMeta?.pricingFormulaVariables?.flatFee;
  const flatFeeInputValue = flatFeeValueRaw === undefined || flatFeeValueRaw === null ? "" : String(flatFeeValueRaw);
  const hasFlatFeeValue = flatFeeInputValue !== "" && Number.isFinite(Number(flatFeeInputValue));
  const hourlyRateValueRaw = currentFormulaVariables.hourly_rate ?? treeMeta?.formulaVariables?.hourly_rate ?? treeMeta?.pricingFormulaVariables?.hourly_rate;
  const hourlyRateInputValue = hourlyRateValueRaw === undefined || hourlyRateValueRaw === null ? "" : String(hourlyRateValueRaw);
  const hasHourlyRateValue = hourlyRateInputValue !== "" && Number.isFinite(Number(hourlyRateInputValue));
  const isLegacyFeeSqftFormula = currentProfile === "fee" && String(currentFormula || "").trim() === LEGACY_SQFT_BASIC_FORMULA;
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceInsertEnabled, setReferenceInsertEnabled] = useState(false);
  const formulaInputRef = useRef<HTMLInputElement | null>(null);
  const [sheetWidthInput, setSheetWidthInput] = useState(String(DEFAULT_FLAT_GOODS_CONFIG.sheetWidth));
  const [sheetHeightInput, setSheetHeightInput] = useState(String(DEFAULT_FLAT_GOODS_CONFIG.sheetHeight));
  const [sheetWidthError, setSheetWidthError] = useState<string | null>(null);
  const [sheetHeightError, setSheetHeightError] = useState<string | null>(null);

  const parsePositiveFinite = (value: unknown): number | null => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  };

  const getSafeFlatGoodsConfig = useCallback((config: FlatGoodsConfig | null | undefined): FlatGoodsConfig => {
    const safeSheetWidth = parsePositiveFinite(config?.sheetWidth) ?? DEFAULT_FLAT_GOODS_CONFIG.sheetWidth;
    const safeSheetHeight = parsePositiveFinite(config?.sheetHeight) ?? DEFAULT_FLAT_GOODS_CONFIG.sheetHeight;
    const allowRotation = pricingConfigHasRotationState(config)
      ? getAllowRotationFromPricingConfig(config)
      : false;
    const configRecord = config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, any>)
      : {};
    const formulaVariables = configRecord.formulaVariables && typeof configRecord.formulaVariables === "object" && !Array.isArray(configRecord.formulaVariables)
      ? configRecord.formulaVariables
      : {};
    return normalizeProductPricingRotationConfig({
      ...DEFAULT_FLAT_GOODS_CONFIG,
      ...(config || {}),
      sheetWidth: safeSheetWidth,
      sheetHeight: safeSheetHeight,
      allowRotation,
      formulaVariables,
      materialType: config?.materialType === "roll" ? "roll" : "sheet",
      minPricePerItem: config?.minPricePerItem ?? null,
    }, false) as FlatGoodsConfig;
  }, []);

  const updateFlatGoodsConfig = useCallback((updates: Partial<FlatGoodsConfig>, shouldDirty = true) => {
    const current = getSafeFlatGoodsConfig(form.getValues("pricingProfileConfig") as FlatGoodsConfig | null);
    form.setValue(
      "pricingProfileConfig",
      {
        ...current,
        ...updates,
      },
      { shouldDirty }
    );
  }, [form, getSafeFlatGoodsConfig]);

  const updatePricingFormulaVariable = useCallback((key: string, value: number | null, shouldDirty = true) => {
    const current = form.getValues("pricingProfileConfig");
    const currentRecord = current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, any>) }
      : {};
    const variables = currentRecord.formulaVariables && typeof currentRecord.formulaVariables === "object" && !Array.isArray(currentRecord.formulaVariables)
      ? { ...(currentRecord.formulaVariables as Record<string, number>) }
      : {};

    if (value === null) {
      delete variables[key];
    } else {
      variables[key] = value;
    }

    const nextConfig = {
      ...currentRecord,
      formulaVariables: variables,
    };
    form.setValue("pricingProfileConfig", nextConfig, { shouldDirty });
    onUpdateTreeMeta?.({
      formulaVariables: variables,
      pricingFormulaVariables: variables,
      pricingProfileKey: form.getValues("pricingProfileKey") || currentProfile || pricingProfileKey || "default",
      pricingFormula: form.getValues("pricingFormula") || getDefaultFormula(form.getValues("pricingProfileKey") || currentProfile || pricingProfileKey || "default"),
      ...((form.getValues("pricingProfileKey") || currentProfile || pricingProfileKey) === "hourly" ? {
        billingUnit: { kind: "hour", selectionKey: "hours", step: 0.25 },
      } : {}),
    });
  }, [currentProfile, form, onUpdateTreeMeta, pricingProfileKey]);

  const isAutoManagedFormula = useCallback((formula: string, profileKey: string | null | undefined) => {
    const trimmed = String(formula || "").trim();
    if (!trimmed) return true;
    const profileDefault = getDefaultFormula(profileKey || "default");
    return trimmed === profileDefault || trimmed === LEGACY_SQFT_BASIC_FORMULA;
  }, []);

  const applyPricingProfileFormula = useCallback((nextProfileKey: string, previousProfileKey: string) => {
    const existingFormula = String(form.getValues("pricingFormula") || "").trim();
    const nextFormula = getDefaultFormula(nextProfileKey);
    const shouldRegenerate = isAutoManagedFormula(existingFormula, previousProfileKey);
    const formulaToSave = shouldRegenerate ? nextFormula : existingFormula;

    if (shouldRegenerate) {
      form.setValue("pricingFormula", nextFormula, { shouldDirty: true });
    }

    onUpdateTreeMeta?.({
      pricingProfileKey: nextProfileKey,
      pricingFormula: formulaToSave || nextFormula,
      ...(nextProfileKey === "hourly" ? {
        billingUnit: { kind: "hour", selectionKey: "hours", step: 0.25 },
      } : {}),
    });
  }, [form, isAutoManagedFormula, onUpdateTreeMeta]);

  useEffect(() => {
    if (!formulaId) return;
    const values = getPricingFormulaSelectionValues(pricingFormulas, formulaId);
    if (!values.pricingFormulaId || !values.pricingFormula) return;

    if (String(form.getValues("pricingFormula") || "") !== values.pricingFormula) {
      form.setValue("pricingFormula", values.pricingFormula, { shouldDirty: false });
    }
    if (values.pricingProfileKey && form.getValues("pricingProfileKey") !== values.pricingProfileKey) {
      form.setValue("pricingProfileKey", values.pricingProfileKey, { shouldDirty: false });
    }
    if (values.pricingProfileConfig !== undefined) {
      const currentConfig = form.getValues("pricingProfileConfig");
      const mergedConfig = mergeFormulaLibraryConfigWithProductConfig(values.pricingProfileConfig, currentConfig);
      if (JSON.stringify(currentConfig ?? null) !== JSON.stringify(mergedConfig)) {
        form.setValue("pricingProfileConfig", mergedConfig as FlatGoodsConfig, { shouldDirty: false });
      }
    }
  }, [formulaId, pricingFormulas, form]);
  
  // Determine effective mode (controlled or derived)
  const derivedMode: PricingEngineMode = (() => {
    if (formulaId) return "formulaLibrary";
    
    const profile = getProfile(currentProfile || "default");
    const defaultFormula = profile.defaultFormula || getDefaultFormula(currentProfile || "default");
    
    if (currentFormula && currentFormula !== defaultFormula) {
      return "pricingFormula";
    }
    
    return "pricingProfile";
  })();
  const effectiveMode: PricingEngineMode = isAdvancedMode ? (pricingEngine || derivedMode) : "pricingProfile";

  useEffect(() => {
    if (pricingMode !== "basic") return;
    const existing = String(form.getValues("pricingFormula") || "").trim();
    if (!existing || (currentProfile === "fee" && existing === LEGACY_SQFT_BASIC_FORMULA)) {
      form.setValue("pricingFormula", recommendedFormula, { shouldDirty: false });
      onUpdateTreeMeta?.({
        pricingProfileKey: currentProfile || pricingProfileKey || "default",
        pricingFormula: recommendedFormula,
      });
    }
  }, [pricingMode, form, currentProfile, recommendedFormula, onUpdateTreeMeta, pricingProfileKey]);

  useEffect(() => {
    if (currentProfile !== "flat_goods") return;
    const current = form.getValues("pricingProfileConfig") as FlatGoodsConfig | null;
    const safe = getSafeFlatGoodsConfig(current);
    const shouldSeed =
      !current ||
      parsePositiveFinite(current.sheetWidth) === null ||
      parsePositiveFinite(current.sheetHeight) === null ||
      typeof current.allowRotation !== "boolean";

    if (shouldSeed) {
      form.setValue("pricingProfileConfig", safe, { shouldDirty: false });
    }
  }, [currentProfile, form, getSafeFlatGoodsConfig]);

  useEffect(() => {
    if (currentProfile !== "flat_goods") return;
    const safe = getSafeFlatGoodsConfig(currentProfileConfig);
    setSheetWidthInput(String(safe.sheetWidth));
    setSheetHeightInput(String(safe.sheetHeight));
    setSheetWidthError(null);
    setSheetHeightError(null);
  }, [currentProfile, currentProfileConfig, getSafeFlatGoodsConfig]);

  const handleModeChange = (mode: PricingEngineMode) => {
    if (!isAdvancedMode) return;
    // Call parent handler if provided (for controlled mode)
    onPricingEngineChange?.(mode);
    // Clear other fields when switching modes
    if (mode !== "formulaLibrary") {
      form.setValue("pricingFormulaId", null, { shouldDirty: true });
    }
    // Log mode change for verification
    if (import.meta.env.DEV) {
      console.log('[PRICING_ENGINE] Mode changed to:', mode);
    }
  };

  const openReference = (allowInsert: boolean) => {
    setReferenceInsertEnabled(isAdvancedMode && allowInsert);
    setReferenceOpen(true);
  };

  const insertFormulaTextAtCursor = (text: string) => {
    const input = formulaInputRef.current;
    const current = String(form.getValues("pricingFormula") || "");
    if (!input) {
      form.setValue("pricingFormula", `${current}${text}`, { shouldDirty: true });
      return;
    }

    const start = input.selectionStart ?? current.length;
    const end = input.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
    form.setValue("pricingFormula", next, { shouldDirty: true });

    window.setTimeout(() => {
      const cursor = start + text.length;
      input.focus();
      input.setSelectionRange(cursor, cursor);
    }, 0);
  };

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Pricing Engine</h3>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={pricingMode}
            onValueChange={(value) => {
              if (value === "basic" || value === "advanced") {
                onPricingModeChange?.(value);
              }
            }}
            variant="outline"
            size="sm"
            className="gap-0 rounded-md border border-slate-700 bg-slate-900/30 p-0.5"
          >
            <ToggleGroupItem value="basic" className="h-7 rounded-sm border-0 px-2.5 text-[11px] text-slate-300 data-[state=on]:bg-slate-200 data-[state=on]:text-slate-950">
              Basic
            </ToggleGroupItem>
            <ToggleGroupItem value="advanced" className="h-7 rounded-sm border-0 px-2.5 text-[11px] text-slate-300 data-[state=on]:bg-slate-200 data-[state=on]:text-slate-950">
              Advanced
            </ToggleGroupItem>
          </ToggleGroup>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-700 bg-slate-900/30 text-slate-400 transition-colors hover:text-slate-200"
                  aria-label="Pricing mode help"
                >
                  <CircleHelp className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-relaxed">
                <div>Basic: Uses the structured builder and generated canonical formula.</div>
                <div>Advanced: Enables direct formula editing and advanced pricing control.</div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {shouldShowRotationControl ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-900/30 px-3 py-2">
          <div className="min-w-0">
            <Label className="text-xs font-medium text-slate-300">Allow Rotation / Mixed Sheet Layout</Label>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">Used by sheet-yield formulas and flat goods nesting.</p>
          </div>
          <Switch
            checked={getAllowRotationFromPricingConfig(getSafeFlatGoodsConfig(currentProfileConfig))}
            onCheckedChange={(checked) => {
              onUpdateAllowRotation?.(Boolean(checked));
            }}
            disabled={!onUpdateAllowRotation}
          />
        </div>
      ) : null}

      <RadioGroup
        value={effectiveMode}
        onValueChange={(v) => handleModeChange(v as PricingEngineMode)}
        className="space-y-0 gap-0"
      >
        {/* — Field 1: Formula Library — */}
        <div className={`rounded-md px-3 py-2.5 transition-colors ${effectiveMode === "formulaLibrary" ? "bg-slate-800/60" : "bg-transparent"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <RadioGroupItem value="formulaLibrary" id="pe-formula-lib" className="h-3.5 w-3.5" />
            <label htmlFor="pe-formula-lib" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
              Formula Library
            </label>
            <button
              type="button"
              className="text-[10px] text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline"
              onClick={() => openReference(false)}
            >
              Reference
            </button>
          </div>
          <div className={!isAdvancedMode || effectiveMode !== "formulaLibrary" ? "opacity-40 pointer-events-none" : ""}>
            <FormField
              control={form.control}
              name="pricingFormulaId"
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <Select
                    onValueChange={(val) => {
                      const values = getPricingFormulaSelectionValues(pricingFormulas, val);
                      field.onChange(values.pricingFormulaId);
                      if (values.pricingFormula) {
                        form.setValue("pricingFormula", values.pricingFormula, { shouldDirty: true });
                      }
                      if (values.pricingProfileKey) {
                        form.setValue("pricingProfileKey", values.pricingProfileKey, { shouldDirty: true });
                      }
                      if (values.pricingProfileConfig !== undefined) {
                        form.setValue(
                          "pricingProfileConfig",
                          normalizeProductPricingRotationConfig(values.pricingProfileConfig, false) as FlatGoodsConfig,
                          { shouldDirty: true },
                        );
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
        <div className={`rounded-md px-3 py-2.5 transition-colors ${effectiveMode === "pricingProfile" ? "bg-slate-800/60" : "bg-transparent"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <RadioGroupItem value="pricingProfile" id="pe-profile" className="h-3.5 w-3.5" />
            <label htmlFor="pe-profile" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
              Pricing Profile
            </label>
          </div>
          <div className={effectiveMode !== "pricingProfile" ? "opacity-40 pointer-events-none" : ""}>
            <FormField
              control={form.control}
              name="pricingProfileKey"
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <Select
                    onValueChange={(val) => {
                      const previousProfileKey = form.getValues("pricingProfileKey") || currentProfile || pricingProfileKey || "default";
                      field.onChange(val);
                      const profile = getProfile(val);
                      if (profile.usesFormula && profile.defaultFormula) {
                        applyPricingProfileFormula(val, previousProfileKey);
                      }
                      if (val === "flat_goods") {
                        const current = form.getValues("pricingProfileConfig") as FlatGoodsConfig | null;
                        form.setValue("pricingProfileConfig", getSafeFlatGoodsConfig(current), { shouldDirty: true });
                      } else if (val === "fee") {
                        onUpdateTreeMeta?.({
                          pricingProfileKey: val,
                          pricingFormula: form.getValues("pricingFormula") || profile.defaultFormula || getDefaultFormula(val),
                          formulaVariables: currentFormulaVariables,
                          pricingFormulaVariables: currentFormulaVariables,
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

            {currentProfile === "flat_goods" ? (
              <div className="mt-2 rounded-md border border-slate-700 bg-slate-900/30 p-3 space-y-2">
                <div className="text-xs font-medium text-slate-300">Sheet Settings</div>
                <p className="text-[11px] text-slate-400">Used only for Flat Goods nesting (sheet yield and waste). Does not change Finished Size or total_sqft geometry.</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">Sheet Width (in)</Label>
                    <Input
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={sheetWidthInput}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setSheetWidthInput(nextValue);
                        const parsed = parsePositiveFinite(nextValue);
                        if (parsed === null) {
                          setSheetWidthError("Must be a number greater than 0");
                          return;
                        }
                        setSheetWidthError(null);
                        updateFlatGoodsConfig({ sheetWidth: parsed }, true);
                      }}
                      onBlur={() => {
                        const parsed = parsePositiveFinite(sheetWidthInput);
                        const fallback = getSafeFlatGoodsConfig(form.getValues("pricingProfileConfig") as FlatGoodsConfig | null).sheetWidth;
                        if (parsed === null) {
                          setSheetWidthInput(String(fallback));
                          setSheetWidthError(null);
                          return;
                        }
                        setSheetWidthInput(String(parsed));
                      }}
                      className="h-8"
                    />
                    {sheetWidthError ? <p className="text-[11px] text-destructive">{sheetWidthError}</p> : null}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">Sheet Height (in)</Label>
                    <Input
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={sheetHeightInput}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setSheetHeightInput(nextValue);
                        const parsed = parsePositiveFinite(nextValue);
                        if (parsed === null) {
                          setSheetHeightError("Must be a number greater than 0");
                          return;
                        }
                        setSheetHeightError(null);
                        updateFlatGoodsConfig({ sheetHeight: parsed }, true);
                      }}
                      onBlur={() => {
                        const parsed = parsePositiveFinite(sheetHeightInput);
                        const fallback = getSafeFlatGoodsConfig(form.getValues("pricingProfileConfig") as FlatGoodsConfig | null).sheetHeight;
                        if (parsed === null) {
                          setSheetHeightInput(String(fallback));
                          setSheetHeightError(null);
                          return;
                        }
                        setSheetHeightInput(String(parsed));
                      }}
                      className="h-8"
                    />
                    {sheetHeightError ? <p className="text-[11px] text-destructive">{sheetHeightError}</p> : null}
                  </div>
                </div>

              </div>
            ) : null}

            {currentProfile === "fee" ? (
              <div className="mt-2 rounded-md border border-slate-700 bg-slate-900/30 p-3 space-y-2">
                <div className="text-xs font-medium text-slate-300">Fee / Service Amount</div>
                <p className="text-[11px] text-slate-400">Use this for fixed charges like rush fees, design fees, and service add-ons. The flatFee variable is priced in dollars.</p>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400">Flat Fee Amount ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={flatFeeInputValue}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        updatePricingFormulaVariable("flatFee", null, true);
                        return;
                      }
                      const parsed = Number(raw);
                      if (Number.isFinite(parsed) && parsed >= 0) {
                        updatePricingFormulaVariable("flatFee", parsed, true);
                      }
                    }}
                    className="h-8"
                    placeholder="25.00"
                  />
                </div>
                {formulaReferencesFlatFee && !hasFlatFeeValue ? (
                  <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                    This formula references flatFee. Enter a flat fee amount before using this product in order entry.
                  </div>
                ) : null}
                {isLegacyFeeSqftFormula ? (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200 space-y-1">
                    <div>This Fee / Service product is using a legacy sqft-based pricing formula.</div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => {
                        form.setValue("pricingFormula", "flatFee", { shouldDirty: true });
                        onUpdateTreeMeta?.({
                          pricingProfileKey: "fee",
                          pricingFormula: "flatFee",
                        });
                      }}
                    >
                      Reset to flat-fee pricing
                    </Button>
                  </div>
                ) : null}
                {feeFormulaUsesSqftPricing ? (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
                    This Fee / Service formula uses sqft or base-rate variables. Confirm that square-foot pricing is intentional for this fee.
                  </div>
                ) : null}
              </div>
            ) : null}

            {currentProfile === "hourly" ? (
              <div className="mt-2 rounded-md border border-slate-700 bg-slate-900/30 p-3 space-y-2">
                <div className="text-xs font-medium text-slate-300">Hourly Rate</div>
                <p className="text-[11px] text-slate-400">Customers enter billable hours in quarter-hour increments. This rate is stored with the product pricing configuration.</p>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400">Hourly Rate ($/hr)</Label>
                  <Input type="number" min={0} step="0.01" value={hourlyRateInputValue}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") { updatePricingFormulaVariable("hourly_rate", null, true); return; }
                      const parsed = Number(raw);
                      if (Number.isFinite(parsed) && parsed >= 0) updatePricingFormulaVariable("hourly_rate", parsed, true);
                    }}
                    className="h-8" placeholder="60.00" />
                </div>
                {formulaReferencesHourlyRate && !hasHourlyRateValue ? <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">This formula requires an hourly rate. Enter the product hourly rate before using it in order entry.</div> : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* — Field 3: Pricing Formula — */}
        {getProfile(pricingProfileKey).usesFormula && isAdvancedMode && (
          <div className={`rounded-md px-3 py-2.5 transition-colors min-w-0 ${effectiveMode === "pricingFormula" ? "bg-slate-800/60" : "bg-transparent"}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <RadioGroupItem value="pricingFormula" id="pe-formula" className="h-3.5 w-3.5" />
              <label htmlFor="pe-formula" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
                Pricing Formula
              </label>
              <button
                type="button"
                className="text-[10px] text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline"
                onClick={() => openReference(true)}
              >
                Reference
              </button>
            </div>
            <div className={`min-w-0 ${effectiveMode !== "pricingFormula" ? "opacity-40 pointer-events-none" : ""}`}>
              <FormField
                control={form.control}
                name="pricingFormula"
                render={({ field }) => (
                  <FormItem className="space-y-2 min-w-0">
                    <FormControl>
                      <Input
                        placeholder={getDefaultFormula(pricingProfileKey)}
                        {...field}
                        value={field.value || ""}
                        onChange={(event) => {
                          field.onChange(event);
                          onUpdateTreeMeta?.({
                            pricingProfileKey: currentProfile || pricingProfileKey || "default",
                            pricingFormula: event.target.value,
                          });
                        }}
                        ref={(node) => {
                          field.ref(node);
                          formulaInputRef.current = node;
                        }}
                        className="bg-slate-950/60 border-slate-700/50 h-8 text-sm font-mono"
                      />
                    </FormControl>
                    {!String(field.value || "").trim() ? (
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                        <span>No formula set. Preview will use recommended formula: {recommendedFormula}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => {
                            form.setValue("pricingFormula", recommendedFormula, { shouldDirty: true });
                            onUpdateTreeMeta?.({
                              pricingProfileKey: currentProfile || pricingProfileKey || "default",
                              pricingFormula: recommendedFormula,
                            });
                          }}
                        >
                          Insert default formula
                        </Button>
                      </div>
                    ) : null}
                    {shouldShowFinishedSizeWarning ? (
                      <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200 space-y-1">
                        <div>This formula recomputes sqft from ordered width/height and ignores Finished Size Rules. Use total_sqft (finished) or finished_width/finished_height to include trim.</div>
                        <div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => {
                              form.setValue("pricingFormula", recommendedFormula, { shouldDirty: true });
                              onUpdateTreeMeta?.({
                                pricingProfileKey: currentProfile || pricingProfileKey || "default",
                                pricingFormula: recommendedFormula,
                              });
                            }}
                          >
                            Fix formula
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <div className="text-[11px] text-slate-400">
                      Use lowercase variable names such as w, h, q, sqft, total_sqft, and base_price. Use formula functions such as ceil(...), round(...), and max(...), not Math.ceil(...).
                    </div>
                    <PricingVariableHelper />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        )}

        {getProfile(pricingProfileKey).usesFormula && !isAdvancedMode ? (
          <div className="rounded-md px-3 py-2.5 bg-slate-900/30 border border-slate-700">
            <div className="text-xs font-medium text-slate-300 mb-1">Generated Canonical Formula</div>
            <Input
              value={recommendedFormula}
              readOnly
              className="bg-slate-950/60 border-slate-700/50 h-8 text-sm font-mono"
            />
          </div>
        ) : null}
      </RadioGroup>

      <FormulaReferenceModal
        open={referenceOpen}
        onOpenChange={setReferenceOpen}
        onInsertText={referenceInsertEnabled ? insertFormulaTextAtCursor : undefined}
      />
    </div>
  );
}
