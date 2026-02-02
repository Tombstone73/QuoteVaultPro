import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PRICING_PROFILES, type FlatGoodsConfig, getProfile, getDefaultFormula } from "@shared/pricingProfiles";
import React from "react";
import ProductOptionsEditor from "@/features/products/editor/ProductOptionsEditor";
import { Plus } from "lucide-react";
import { CreateMaterialDialog } from "@/features/materials/CreateMaterialDialog";
import { optionTreeV2Schema, validateOptionTreeV2 } from "@shared/optionTreeV2";
import { buildOptionTreeV2FromLegacyOptions } from "@shared/optionTreeV2Initializer";
import ProductOptionsPanelV2_Mvp from "@/components/ProductOptionsPanelV2_Mvp";
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
}: {
  form: any;
  materials: any;
  pricingFormulas: any;
  productTypes: any;
  onSave: any;
  formId?: string;
}) => {
  const { toast } = useToast();
  const addPricingProfileKey = form.watch("pricingProfileKey");
  const [addGroupSignal, setAddGroupSignal] = React.useState<number | null>(null);
  
  const optionTreeJson = form.watch("optionTreeJson");
  const productId = form.watch("id");
  
  // Determine optionsMode based on actual data presence, then fall back to localStorage
  // Decision order:
  // 1. If optionTreeJson has schemaVersion=2 => Tree v2 mode
  // 2. Else if legacy data (array/graph without schemaVersion) => check localStorage preference
  // 3. For new products (no id, no data) => Tree v2 mode by default
  const determineInitialMode = React.useCallback((): "legacy" | "treeV2" => {
    // If we have PBV2 data, always use Tree v2
    if (optionTreeJson && (optionTreeJson as any)?.schemaVersion === 2) {
      return "treeV2";
    }
    
    // For new products, default to Tree v2
    if (!productId) {
      return "treeV2";
    }
    
    // For existing products with legacy data, check localStorage preference
    const storageKey = productId ? `productEditor:optionsMode:${productId}` : 'productEditor:optionsMode';
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === 'treeV2' ? 'treeV2' : 'legacy';
    } catch {
      return 'legacy';
    }
  }, [optionTreeJson, productId]);
  
  const [optionsMode, setOptionsMode] = React.useState<"legacy" | "treeV2">(determineInitialMode);

  const [optionTreeText, setOptionTreeText] = React.useState<string>("");
  const [optionTreeErrors, setOptionTreeErrors] = React.useState<string[]>([]);

  // Wrapper to persist optionsMode changes to localStorage (per-product)
  const setAndPersistOptionsMode = React.useCallback((mode: "legacy" | "treeV2") => {
    setOptionsMode(mode);
    const storageKey = productId ? `productEditor:optionsMode:${productId}` : 'productEditor:optionsMode';
    try {
      localStorage.setItem(storageKey, mode);
    } catch (e) {
      console.warn('Failed to persist optionsMode:', e);
    }
  }, []);

  // Re-evaluate mode when optionTreeJson or productId changes
  React.useEffect(() => {
    const correctMode = determineInitialMode();
    if (correctMode !== optionsMode) {
      setOptionsMode(correctMode);
      // Also persist the auto-determined mode
      const storageKey = productId ? `productEditor:optionsMode:${productId}` : 'productEditor:optionsMode';
      try {
        localStorage.setItem(storageKey, correctMode);
      } catch (e) {
        console.warn('Failed to persist optionsMode:', e);
      }
    }
  }, [determineInitialMode, optionsMode, productId]);

  React.useEffect(() => {
    // Auto-initialize PBV2 for new products (no optionTreeJson)
    if (!productId && !optionTreeJson) {
      // New product with no tree - initialize with PBV2 empty state
      // Matches optionTreeV2Schema: schemaVersion=2, rootNodeIds=[], nodes={}
      const emptyPBV2 = {
        schemaVersion: 2,
        rootNodeIds: [],
        nodes: {},
        meta: {
          title: 'New Options Tree',
          updatedAt: new Date().toISOString(),
        },
      };
      form.setValue("optionTreeJson", emptyPBV2, { shouldDirty: false });
      setOptionTreeText(JSON.stringify(emptyPBV2, null, 2));
    }
  }, [productId, optionTreeJson, form]);

  React.useEffect(() => {
    if (optionsMode !== "treeV2") return;
    if (optionTreeJson == null) {
      setOptionTreeText("");
      setOptionTreeErrors([]);
      return;
    }
    try {
      setOptionTreeText(JSON.stringify(optionTreeJson, null, 2));
      setOptionTreeErrors([]);
    } catch {
      setOptionTreeText("");
      setOptionTreeErrors(["optionTreeJson is not serializable"]);
    }
  }, [optionsMode]);

  const setTreeTextAndValidate = (nextText: string) => {
    setOptionTreeText(nextText);

    const trimmed = nextText.trim();
    if (trimmed.length === 0) {
      form.setValue("optionTreeJson", null, { shouldDirty: true });
      form.clearErrors("optionTreeJson");
      setOptionTreeErrors([]);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(nextText);
    } catch (e) {
      form.setError("optionTreeJson", {
        type: "manual",
        message: e instanceof Error ? e.message : "Invalid JSON",
      });
      setOptionTreeErrors(["Invalid JSON"]);
      return;
    }

    // Detect if this is legacy format - skip validation if so
    const isLegacy = Array.isArray(parsed) || 
                     (parsed && typeof parsed === 'object' && !('schemaVersion' in parsed));
    
    if (isLegacy) {
      // Legacy format detected - don't validate, just store as-is
      form.clearErrors("optionTreeJson");
      setOptionTreeErrors([]);
      form.setValue("optionTreeJson", parsed, { shouldDirty: true });
      return;
    }

    // PBV2 mode: Only validate structure, NOT legacy graph rules
    // Skip validateOptionTreeV2 (legacy graph validator with rootNodeIds requirement)
    // PBV2 uses groups/options model and doesn't require rootNodeIds
    const zodRes = optionTreeV2Schema.safeParse(parsed);
    if (!zodRes.success) {
      form.setError("optionTreeJson", {
        type: "manual",
        message: "Invalid optionTreeJson (v2)",
      });
      setOptionTreeErrors(zodRes.error.issues.map((i) => i.message));
      return;
    }

    // DO NOT call validateOptionTreeV2 here - it's a legacy graph validator
    // PBV2 empty state (nodes: [], edges: []) is valid
    // Legacy validator requires rootNodeIds.length > 0 which breaks PBV2

    form.clearErrors("optionTreeJson");
    setOptionTreeErrors([]);
    form.setValue("optionTreeJson", zodRes.data, { shouldDirty: true });
  };

  const initTreeV2 = () => {
    const legacyOptionsJson = form.getValues("optionsJson");
    const tree = buildOptionTreeV2FromLegacyOptions(legacyOptionsJson);

    // DO NOT call validateOptionTreeV2 - it's a legacy graph validator
    // that requires rootNodeIds.length > 0, breaking PBV2 empty state
    // PBV2 uses groups/options model and is valid with empty nodes/edges arrays

    form.setValue("optionTreeJson", tree as any, { shouldDirty: true });
    form.clearErrors("optionTreeJson");
    setOptionTreeErrors([]);
    setOptionTreeText(JSON.stringify(tree, null, 2));
    
    toast({
      title: "Tree v2 Initialized",
      description: "PBV2 options tree created. You can now add groups and options.",
    });
  };

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
            <CardDescription>Configure selectable add-ons and finishing.</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-xs text-muted-foreground">Options Mode</span>
              <span className="text-xs font-medium">{optionsMode === "legacy" ? "Legacy" : "Tree v2"}</span>
              <Switch
                checked={optionsMode === "treeV2"}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setAndPersistOptionsMode("treeV2");
                    setOptionTreeErrors([]);
                    form.clearErrors("optionTreeJson");
                    try {
                      setOptionTreeText(optionTreeJson ? JSON.stringify(optionTreeJson, null, 2) : "");
                    } catch {
                      setOptionTreeText("");
                    }
                    return;
                  }

                  // Switching back to legacy disables v2 by clearing optionTreeJson.
                  setAndPersistOptionsMode("legacy");
                  form.setValue("optionTreeJson", null, { shouldDirty: true });
                  form.clearErrors("optionTreeJson");
                  setOptionTreeErrors([]);
                }}
              />
            </div>

            {optionsMode === "legacy" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddGroupSignal(Date.now())}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Option Group
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={initTreeV2}>
                Initialize Tree v2
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {optionsMode === "legacy" ? (
            <div className="p-6">
              <ProductOptionsEditor form={form} fieldName="optionsJson" addGroupSignal={addGroupSignal} />
            </div>
          ) : (
            <div className="h-[600px]">
              <ProductOptionsPanelV2_Mvp
                productId={String(form.getValues("id") ?? "new")}
                optionTreeJson={optionTreeText}
                onChangeOptionTreeJson={setTreeTextAndValidate}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {optionsMode === "treeV2" && (() => {
        // Only show red error box if we have PBV2 data with validation errors
        // Do NOT show for legacy format (that's handled by yellow banner in PBV2 panel)
        const trimmed = optionTreeText.trim();
        if (!trimmed) return null;
        
        try {
          const parsed = JSON.parse(trimmed);
          const isLegacy = Array.isArray(parsed) || 
                           (parsed && typeof parsed === 'object' && !('schemaVersion' in parsed));
          
          // Only render error box if NOT legacy and we have errors
          if (isLegacy || optionTreeErrors.length === 0) return null;
          
          return (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <div className="font-medium">Option Tree v2 errors</div>
              <ul className="mt-1 list-disc pl-4">
                {optionTreeErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          );
        } catch {
          // JSON parse error - show errors if any
          if (optionTreeErrors.length === 0) return null;
          return (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <div className="font-medium">Option Tree v2 errors</div>
              <ul className="mt-1 list-disc pl-4">
                {optionTreeErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          );
        }
      })()}

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
