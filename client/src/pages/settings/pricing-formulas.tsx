import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  usePricingFormulas,
  useCreatePricingFormula,
  useUpdatePricingFormula,
  useDeletePricingFormula,
  usePricingFormulaWithProducts,
  type PricingFormula,
  type PricingFormulaInput,
} from "@/hooks/usePricingFormulas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Trash2, Eye, Package, Play, AlertTriangle, Info, ChevronDown, Copy } from "lucide-react";
import { TitanCard } from "@/components/ui/TitanCard";
import { evaluate } from "mathjs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormulaLanguageHelp } from "@/components/pbv2/FormulaLanguageHelp";
import { formulaHelperScope, extractFormulaVariables } from "@shared/pbv2/formulaHelpers";
import { buildDuplicateFormulaInput } from "@shared/pbv2/formulaUtils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  hydrateFormulaOutputMeaning,
  setFormulaOutputMeaningInConfig,
  type FormulaOutputMeaning,
} from "@/lib/pricingFormulaOutputMeaning";

// Variable library for pricing formulas
type VariableLibraryItem = {
  key: string;
  label: string;
  description: string;
};

type VariableSection = {
  section: string;
  variables: VariableLibraryItem[];
};

const VARIABLE_LIBRARY: VariableSection[] = [
  {
    section: "Global Variables",
    variables: [
      { key: "MACHINE_RATE", label: "Machine Hourly Rate", description: "Default hourly rate for machine time" },
      { key: "SETUP_MIN", label: "Setup Minimum", description: "Minimum setup charge" },
      { key: "WASTE_FACTOR", label: "Waste Factor", description: "Material waste multiplier" },
    ],
  },
  {
    section: "Line Item Variables",
    variables: [
      { key: "w", label: "Width", description: "Ordered item width in inches" },
      { key: "ordered_width", label: "Ordered Width", description: "Explicit ordered width before finished-size adjustments" },
      { key: "h", label: "Height", description: "Ordered item height in inches" },
      { key: "ordered_height", label: "Ordered Height", description: "Explicit ordered height before finished-size adjustments" },
      { key: "q", label: "Quantity", description: "Number of items" },
      { key: "sides", label: "Sides", description: "Number of printed sides" },
      { key: "copies", label: "Copies", description: "Number of copies per original" },
    ],
  },
  {
    section: "System Calculated",
    variables: [
      { key: "sqft", label: "Square Feet", description: "Calculated from width × height / 144" },
      { key: "total_sqft", label: "Total Square Feet", description: "sqft × quantity" },
      { key: "base_price", label: "Base Price Rate", description: "Effective base rate used by the evaluator" },
      { key: "p", label: "Price Alias", description: "Alias for base_price" },
    ],
  },
];

// Available pricing profiles from the system
const PRICING_PROFILES = [
  { key: "default", label: "Default (Formula)", description: "Uses pricing formula with sqft, width, height, quantity" },
  { key: "flat_goods", label: "Flat Goods / Sheets", description: "Sheet-based products with nesting calculator" },
  { key: "qty_only", label: "Quantity Only", description: "Simple quantity-based pricing, no dimensions" },
  { key: "fee", label: "Fee / Service", description: "Flat fees with no dimensions" },
];

type FormulaTestBreakdown = {
  rawValue: number;
  expression: string;
  w: number;
  h: number;
  q: number;
  sqft: number;
  total_sqft: number;
  base_price: number;
  MACHINE_RATE: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const emptyFormData: PricingFormulaInput = {
  name: "",
  code: "",
  description: "",
  pricingProfileKey: "default",
  expression: "",
  config: null,
  isActive: true,
};

type GlobalVariable = {
  id: string;
  name: string;
  value: string;
  description?: string | null;
  category?: string | null;
};

const DOCUMENT_NUMBER_VARIABLES = new Set(["next_quote_number", "next_order_number", "next_invoice_number", "next_job_number"]);

function GlobalPricingVariablesSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<GlobalVariable | null>(null);
  const [draft, setDraft] = useState({ name: "", value: "", description: "", category: "" });

  const { data: variables = [], isLoading } = useQuery<GlobalVariable[]>({
    queryKey: ["/api/global-variables"],
    queryFn: async () => {
      const res = await fetch("/api/global-variables", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load pricing variables");
      return res.json();
    },
  });

  const pricingVariables = variables.filter((variable) => !DOCUMENT_NUMBER_VARIABLES.has(variable.name));

  const resetDraft = () => {
    setEditing(null);
    setDraft({ name: "", value: "", description: "", category: "" });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: draft.name.trim(),
        value: draft.value.trim(),
        description: draft.description.trim() || null,
        category: draft.category.trim() || null,
      };
      if (editing) {
        return apiRequest("PATCH", `/api/global-variables/${editing.id}`, payload);
      }
      return apiRequest("POST", "/api/global-variables", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      toast({ title: "Pricing variable saved" });
      setIsOpen(false);
      resetDraft();
    },
    onError: (error: Error) => {
      toast({ title: "Unable to save variable", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/global-variables/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      toast({ title: "Pricing variable removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to remove variable", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    resetDraft();
    setIsOpen(true);
  };

  const openEdit = (variable: GlobalVariable) => {
    setEditing(variable);
    setDraft({
      name: variable.name,
      value: variable.value,
      description: variable.description ?? "",
      category: variable.category ?? "",
    });
    setIsOpen(true);
  };

  return (
    <TitanCard className="p-0 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-lg font-semibold">Pricing Variables</h2>
          <p className="text-sm text-muted-foreground">
            Canonical editor for formula variables. Document numbering stays in System Setup.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Variable
        </Button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading variables
        </div>
      ) : pricingVariables.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No pricing variables configured.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pricingVariables.map((variable) => (
              <TableRow key={variable.id}>
                <TableCell className="font-mono text-xs">{variable.name}</TableCell>
                <TableCell>{variable.value}</TableCell>
                <TableCell>{variable.category || "-"}</TableCell>
                <TableCell className="text-muted-foreground">{variable.description || "-"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(variable)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete pricing variable ${variable.name}?`)) deleteMutation.mutate(variable.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetDraft(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Pricing Variable" : "Add Pricing Variable"}</DialogTitle>
            <DialogDescription>
              Variables here are available to pricing formulas. Number sequencing variables are managed in System Setup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="variable-name">Name</Label>
              <Input
                id="variable-name"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="MACHINE_RATE"
                disabled={!!editing}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variable-value">Value</Label>
              <Input
                id="variable-value"
                value={draft.value}
                onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
                placeholder="75"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variable-category">Category</Label>
              <Input
                id="variable-category"
                value={draft.category}
                onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                placeholder="machine"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variable-description">Description</Label>
              <Textarea
                id="variable-description"
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Default hourly rate for machine time"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button disabled={!draft.name.trim() || !draft.value.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Saving..." : "Save Variable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TitanCard>
  );
}

export default function PricingFormulasSettings() {
  const { data: formulas, isLoading } = usePricingFormulas();
  const createMutation = useCreatePricingFormula();
  const updateMutation = useUpdatePricingFormula();
  const deleteMutation = useDeletePricingFormula();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [editingFormula, setEditingFormula] = useState<PricingFormula | null>(null);
  const [viewingFormula, setViewingFormula] = useState<string | null>(null);
  const [formData, setFormData] = useState<PricingFormulaInput>(emptyFormData);

  // Fetch products linked to formula being viewed
  const { data: formulaWithProducts } = usePricingFormulaWithProducts(viewingFormula ?? undefined);

  const resetForm = () => {
    setFormData(emptyFormData);
  };

  const buildFormulaSavePayload = (data: PricingFormulaInput): PricingFormulaInput => {
    const outputMeaning = hydrateFormulaOutputMeaning(data.config).outputMeaning;
    return {
      ...data,
      config: setFormulaOutputMeaningInConfig(data.config, outputMeaning),
    };
  };

  const handleCreate = async () => {
    try {
      await createMutation.mutateAsync(buildFormulaSavePayload(formData));
      setIsCreateOpen(false);
      resetForm();
    } catch {
      // error handled by toast
    }
  };

  const handleUpdate = async () => {
    if (!editingFormula) return;
    try {
      await updateMutation.mutateAsync({ id: editingFormula.id, data: buildFormulaSavePayload(formData) });
      setEditingFormula(null);
      resetForm();
    } catch {
      // error handled by toast
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this pricing formula? Products using it will fall back to their own settings.")) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const openEdit = (formula: PricingFormula) => {
    setEditingFormula(formula);
    setFormData({
      name: formula.name,
      code: formula.code,
      description: formula.description ?? "",
      pricingProfileKey: formula.pricingProfileKey,
      expression: formula.expression ?? "",
      config: formula.config,
      isActive: formula.isActive,
    });
  };

  const openCreate = () => {
    resetForm();
    setIsDuplicating(false);
    setIsCreateOpen(true);
  };

  const openDuplicate = (formula: PricingFormula) => {
    setFormData(buildDuplicateFormulaInput(formula));
    setIsDuplicating(true);
    setIsCreateOpen(true);
  };

  const selectedProfile = PRICING_PROFILES.find((p) => p.key === formData.pricingProfileKey);
  const showFlatGoodsConfig = formData.pricingProfileKey === "flat_goods";

  type TestValues = {
    width: number;
    height: number;
    quantity: number;
    MACHINE_RATE: number;
    basePrice: number;
  };

  // Formula tester state
  const [testValues, setTestValues] = useState<TestValues>({
    width: 12,
    height: 18,
    quantity: 100,
    MACHINE_RATE: 75,
    basePrice: 1.0,
  });
  const [testResult, setTestResult] = useState<FormulaTestBreakdown | null>(null);
  const [testError, setTestError] = useState<string>("");
  const expressionInputRef = useRef<HTMLInputElement>(null);

  const handleRunTest = () => {
    try {
      const expression = formData.expression || "";
      if (!expression.trim()) {
        setTestError("No formula to test");
        setTestResult(null);
        return;
      }

      const w = testValues.width;
      const h = testValues.height;
      const q = testValues.quantity;
      const sqft = (w * h) / 144;
      const total_sqft = sqft * q;
      const MACHINE_RATE = testValues.MACHINE_RATE;

      const base_price = testValues.basePrice > 0 ? testValues.basePrice : 1.0;

      const formulaVars = extractFormulaVariables(formData.config as Record<string, unknown>);
      const scope = {
        ...formulaVars,
        ...testValues,
        w,
        h,
        q,
        sqft,
        total_sqft,
        base_price,
        basePricePerSqft: base_price,
        p: base_price,
        MACHINE_RATE,
        ...formulaHelperScope(formulaVars.allow_rotation),
      };

      const result = evaluate(expression, scope);

      if (typeof result !== 'number' || !isFinite(result)) {
        setTestError(
          `Formula returned ${typeof result === 'number' ? 'a non-finite number' : typeof result} — expected a finite number.`
        );
        setTestResult(null);
        return;
      }

      setTestResult({ rawValue: result, expression, w, h, q, sqft, total_sqft, base_price, MACHINE_RATE });
      setTestError("");
    } catch (error: any) {
      setTestError(error.message || "Invalid formula");
      setTestResult(null);
    }
  };

  // `FormulaEditorFields` expects a setter-like function accepting Record<string, number>.
  // Adapt it to our strongly-typed `TestValues` without changing behavior.
  const setTestValuesFromRecord = (values: Record<string, number>) => {
    setTestValues(prev => ({
      width: values.width ?? prev.width,
      height: values.height ?? prev.height,
      quantity: values.quantity ?? prev.quantity,
      MACHINE_RATE: values.MACHINE_RATE ?? prev.MACHINE_RATE,
      basePrice: values.basePrice ?? prev.basePrice,
    }));
  };

  const insertVariable = (variableKey: string) => {
    const input = expressionInputRef.current;
    if (!input) return;

    const start = input.selectionStart ?? formData.expression?.length ?? 0;
    const end = input.selectionEnd ?? formData.expression?.length ?? 0;
    const currentExpression = formData.expression || "";
    
    const newExpression = 
      currentExpression.substring(0, start) + 
      variableKey + 
      currentExpression.substring(end);
    
    setFormData({ ...formData, expression: newExpression });
    
    // Restore focus and cursor position after the inserted variable
    setTimeout(() => {
      input.focus();
      const newPosition = start + variableKey.length;
      input.setSelectionRange(newPosition, newPosition);
    }, 0);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pricing Formulas</h1>
          <p className="text-muted-foreground text-sm">
            Define reusable pricing configurations that can be attached to multiple products
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) setIsDuplicating(false); }}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Formula
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>{isDuplicating ? "Duplicate Pricing Formula" : "Create Pricing Formula"}</DialogTitle>
              <DialogDescription>
                {isDuplicating
                  ? "Review the copied formula, adjust the name and code, then save as a new formula."
                  : "Define a reusable pricing configuration that can be attached to multiple products."}
              </DialogDescription>
            </DialogHeader>
            <FormulaEditorFields
              formData={formData}
              setFormData={setFormData}
              selectedProfile={selectedProfile}
              showFlatGoodsConfig={showFlatGoodsConfig}
              expressionInputRef={expressionInputRef}
              insertVariable={insertVariable}
              testValues={testValues}
              setTestValues={setTestValuesFromRecord}
              testResult={testResult}
              testError={testError}
              handleRunTest={handleRunTest}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!formData.name || !formData.code || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Formula
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <TitanCard className="p-0 overflow-hidden">
        {formulas && formulas.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {formulas.map((formula) => {
                const profile = PRICING_PROFILES.find((p) => p.key === formula.pricingProfileKey);
                return (
                  <TableRow key={formula.id}>
                    <TableCell className="font-medium">{formula.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {formula.code}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{profile?.label ?? formula.pricingProfileKey}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {formula.description || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewingFormula(formula.id)}
                          title="View products using this formula"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(formula)} title="Edit formula">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDuplicate(formula)}
                          title="Duplicate formula"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(formula.id)}
                          disabled={deleteMutation.isPending}
                          title="Delete formula"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No pricing formulas yet</p>
            <p className="text-sm">
              Create a pricing formula to define reusable pricing configurations for your products.
            </p>
          </div>
        )}
      </TitanCard>

      <GlobalPricingVariablesSettings />

      {/* Edit Dialog */}
      <Dialog open={!!editingFormula} onOpenChange={(open) => !open && setEditingFormula(null)}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Pricing Formula</DialogTitle>
            <DialogDescription>
              Update the pricing configuration. Changes will apply to all products using this formula.
            </DialogDescription>
          </DialogHeader>
          <FormulaEditorFields
            formData={formData}
            setFormData={setFormData}
            selectedProfile={selectedProfile}
            showFlatGoodsConfig={showFlatGoodsConfig}
            expressionInputRef={expressionInputRef}
            insertVariable={insertVariable}
            testValues={testValues}
            setTestValues={setTestValuesFromRecord}
            testResult={testResult}
            testError={testError}
            handleRunTest={handleRunTest}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingFormula(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={!formData.name || !formData.code || updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Products Dialog */}
      <Dialog open={!!viewingFormula} onOpenChange={(open) => !open && setViewingFormula(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Products Using This Formula</DialogTitle>
          </DialogHeader>
          {formulaWithProducts ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  <strong>{formulaWithProducts.formula.name}</strong> ({formulaWithProducts.formula.code})
                </p>
              </div>
              {formulaWithProducts.products.length > 0 ? (
                <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                  {formulaWithProducts.products.map((product: any) => (
                    <div key={product.id} className="px-3 py-2 flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{product.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No products are currently using this formula.
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingFormula(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SheetFitResult = {
  normalFit: number;
  rotatedFit: number;
  mixedA: number;
  mixedB: number;
  best: number;
  sheetsRequired: number;
  fullSheetSqft: number;
  billableSqft: number;
};

function computeSheetFit(
  w: number,
  h: number,
  q: number,
  sheetW = 48,
  sheetH = 96
): SheetFitResult | null {
  if (w <= 0 || h <= 0 || q <= 0) return null;
  const normalFit = Math.floor(sheetW / w) * Math.floor(sheetH / h);
  const rotatedFit = Math.floor(sheetW / h) * Math.floor(sheetH / w);
  // Mixed A: fill normal rows, then use remainder height with rotated orientation
  const normRows = Math.floor(sheetH / h);
  const remainA = sheetH - normRows * h;
  const mixedA =
    Math.floor(sheetW / w) * normRows + Math.floor(sheetW / h) * Math.floor(remainA / w);
  // Mixed B: fill rotated rows, then use remainder height with normal orientation
  const rotRows = Math.floor(sheetH / w);
  const remainB = sheetH - rotRows * w;
  const mixedB =
    Math.floor(sheetW / h) * rotRows + Math.floor(sheetW / w) * Math.floor(remainB / h);
  const best = Math.max(normalFit, rotatedFit, mixedA, mixedB, 1);
  const sheetsRequired = Math.ceil(q / best);
  const fullSheetSqft = (sheetW * sheetH) / 144;
  const billableSqft = sheetsRequired * fullSheetSqft;
  return { normalFit, rotatedFit, mixedA, mixedB, best, sheetsRequired, fullSheetSqft, billableSqft };
}

function BreakdownRow({
  label,
  value,
  note,
  mono = false,
}: {
  label: string;
  value: string;
  note?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start px-3 py-1.5 gap-2 text-xs">
      <span className="text-muted-foreground shrink-0 w-36">{label}</span>
      <span className={`font-medium flex-1 break-all ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
      {note && <span className="text-muted-foreground text-[10px] shrink-0 text-right">{note}</span>}
    </div>
  );
}

const SHEET_4X8_PRESET: Record<string, number> = {
  sheet_width: 48,
  sheet_length: 96,
  usable_drop_min: 0,
  billable_length_increment: 1,
  minimum_billable_sqft: 32,
};

function FormulaVariablesEditor({
  config,
  onConfigChange,
  onInsertVariable,
}: {
  config: Record<string, unknown> | null | undefined;
  onConfigChange: (config: Record<string, unknown>) => void;
  onInsertVariable?: (key: string) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const variables = (
    config?.variables && typeof config.variables === "object" && !Array.isArray(config.variables)
      ? config.variables
      : {}
  ) as Record<string, number>;

  const entries = Object.entries(variables);

  const setVariable = (key: string, value: number) => {
    onConfigChange({
      ...(config ?? {}),
      variables: { ...variables, [key]: value },
    });
  };

  const deleteVariable = (key: string) => {
    const { [key]: _removed, ...rest } = variables;
    onConfigChange({ ...(config ?? {}), variables: rest });
  };

  const addVariable = () => {
    const k = newKey.trim();
    const v = parseFloat(newValue);
    if (!k || !Number.isFinite(v)) return;
    setVariable(k, v);
    setNewKey("");
    setNewValue("");
  };

  const applyPreset = () => {
    onConfigChange({
      ...(config ?? {}),
      variables: { ...variables, ...SHEET_4X8_PRESET },
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Formula Variables
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          onClick={applyPreset}
          title="Add sheet_width=48, sheet_length=96, usable_drop_min=0, billable_length_increment=1, minimum_billable_sqft=32"
        >
          + 4×8 Sheet Vars
        </Button>
      </div>

      {entries.length > 0 && (
        <div className="border rounded overflow-hidden divide-y text-xs">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center px-2 py-1 gap-2">
              <code className="font-mono text-[11px] flex-1 min-w-0 truncate">{key}</code>
              <Input
                type="number"
                value={value}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) setVariable(key, v);
                }}
                className="h-6 w-20 text-xs font-mono px-1"
              />
              {onInsertVariable && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px] shrink-0"
                  onClick={() => onInsertVariable(key)}
                >
                  Insert
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 shrink-0"
                onClick={() => {
                  if (confirm(`Delete variable "${key}"?`)) deleteVariable(key);
                }}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          placeholder="variable_name"
          value={newKey}
          onChange={(e) =>
            setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
          }
          className="h-7 text-xs font-mono flex-1"
          onKeyDown={(e) => e.key === "Enter" && addVariable()}
        />
        <Input
          type="number"
          placeholder="0"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="h-7 text-xs w-20"
          onKeyDown={(e) => e.key === "Enter" && addVariable()}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs shrink-0"
          onClick={addVariable}
          disabled={!newKey.trim() || !newValue.trim()}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>

      {entries.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No variables defined. Variables are injected into the formula scope by name. Use "Add
          4×8 Sheet Vars" for the sheet_consumption_sqft helper.
        </p>
      )}
    </div>
  );
}

// Separate component to prevent re-mounting on state changes
type FormulaEditorFieldsProps = {
  formData: PricingFormulaInput;
  setFormData: (data: PricingFormulaInput) => void;
  selectedProfile: typeof PRICING_PROFILES[0] | undefined;
  showFlatGoodsConfig: boolean;
  expressionInputRef: React.RefObject<HTMLInputElement>;
  insertVariable: (variableKey: string) => void;
  testValues: Record<string, number>;
  setTestValues: (values: Record<string, number>) => void;
  testResult: FormulaTestBreakdown | null;
  testError: string;
  handleRunTest: () => void;
};

function FormulaEditorFields({
  formData,
  setFormData,
  selectedProfile,
  showFlatGoodsConfig,
  expressionInputRef,
  insertVariable,
  testValues,
  setTestValues,
  testResult,
  testError,
  handleRunTest,
}: FormulaEditorFieldsProps) {
  const outputMeaningHydration = hydrateFormulaOutputMeaning(formData.config);
  const outputMeaning = outputMeaningHydration.outputMeaning;
  const outputMeaningMissing = !outputMeaningHydration.hasSavedOutputMeaning;
  const [showSheetDebug, setShowSheetDebug] = useState(false);
  const updateOutputMeaning = (value: FormulaOutputMeaning) => {
    setFormData({
      ...formData,
      config: setFormulaOutputMeaningInConfig(formData.config, value),
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main form fields - Left/Center column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Standard Coroplast"
              />
            </div>
            <div>
              <Label htmlFor="code">Code *</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase().replace(/\s/g, "_") })}
                placeholder="e.g., STD_CORO"
              />
              <p className="text-xs text-muted-foreground mt-1">Unique identifier for this formula</p>
            </div>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description ?? ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of this pricing formula..."
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="pricingProfile">Pricing Profile *</Label>
            <Select
              value={formData.pricingProfileKey ?? "default"}
              onValueChange={(value) => setFormData({ ...formData, pricingProfileKey: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a pricing profile" />
              </SelectTrigger>
              <SelectContent>
                {PRICING_PROFILES.map((profile) => (
                  <SelectItem key={profile.key} value={profile.key}>
                    {profile.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProfile && (
              <p className="text-xs text-muted-foreground mt-1">{selectedProfile.description}</p>
            )}
          </div>

          {/* Show flat goods config fields when flat_goods profile is selected */}
          {showFlatGoodsConfig && (
            <div className="border rounded-md p-4 space-y-4 bg-muted/30">
              <h4 className="font-medium text-sm">Flat Goods Configuration</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="sheetWidth">Sheet Width (inches)</Label>
                  <Input
                    id="sheetWidth"
                    type="number"
                    value={
                      (formData.config as Record<string, unknown>)?.sheetWidth?.toString() ?? "48"
                    }
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...(formData.config as Record<string, unknown>),
                          sheetWidth: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="sheetHeight">Sheet Height (inches)</Label>
                  <Input
                    id="sheetHeight"
                    type="number"
                    value={
                      (formData.config as Record<string, unknown>)?.sheetHeight?.toString() ?? "96"
                    }
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...(formData.config as Record<string, unknown>),
                          sheetHeight: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="materialType">Material Type</Label>
                  <Select
                    value={
                      ((formData.config as Record<string, unknown>)?.materialType as string) ?? "sheet"
                    }
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...(formData.config as Record<string, unknown>),
                          materialType: value,
                        },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sheet">Sheet</SelectItem>
                      <SelectItem value="roll">Roll</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="minPricePerItem">Min Price Per Item ($)</Label>
                  <Input
                    id="minPricePerItem"
                    type="number"
                    step="0.01"
                    value={
                      (formData.config as Record<string, unknown>)?.minPricePerItem?.toString() ?? ""
                    }
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...(formData.config as Record<string, unknown>),
                          minPricePerItem: e.target.value ? parseFloat(e.target.value) : null,
                        },
                      })
                    }
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Show expression field for formula-based profiles */}
          {!showFlatGoodsConfig && (
            <>
              <div>
                <Label htmlFor="expression">Pricing Expression</Label>
                <Input
                  ref={expressionInputRef}
                  id="expression"
                  value={formData.expression ?? ""}
                  onChange={(e) => setFormData({ ...formData, expression: e.target.value })}
                  placeholder="e.g., sqft * base_price * q"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Click variables from the library to insert them →
                </p>
                {(() => {
                  const expr = (formData.expression ?? "").trim();
                  let warning: string | null = null;
                  if (expr) {
                    if (/Math\s*\./.test(expr))
                      warning = "Use ceil(), floor(), max() etc. directly — Math.ceil() and similar are not supported.";
                    else if (/\|\|/.test(expr))
                      warning = "|| is not supported. Use a ternary: condition ? a : b";
                    else if (/&&/.test(expr))
                      warning = "&& is not supported. Use a ternary: condition ? a : b";
                    else if (/\b(var|let|const|function|return)\b/.test(expr))
                      warning = "JavaScript keywords are not supported. Formulas must be a single expression.";
                    else if (/\bif\s*\(/.test(expr))
                      warning = "if/else blocks are not supported. Use a ternary: condition ? a : b";
                  }
                  return warning ? (
                    <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 text-amber-700 dark:text-amber-300 mt-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{warning}</span>
                    </div>
                  ) : null;
                })()}
              </div>

              {/* Formula Tester Panel */}
              <div className="border rounded-md p-4 space-y-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">Test Formula</h4>
                  <Button size="sm" onClick={handleRunTest} variant="secondary">
                    <Play className="h-3 w-3 mr-1" />
                    Run Test
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="test-width" className="text-xs">Width (in)</Label>
                    <Input
                      id="test-width"
                      type="number"
                      value={testValues.width}
                      onChange={(e) => setTestValues({ ...testValues, width: parseFloat(e.target.value) || 0 })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="test-height" className="text-xs">Height (in)</Label>
                    <Input
                      id="test-height"
                      type="number"
                      value={testValues.height}
                      onChange={(e) => setTestValues({ ...testValues, height: parseFloat(e.target.value) || 0 })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="test-quantity" className="text-xs">Quantity</Label>
                    <Input
                      id="test-quantity"
                      type="number"
                      value={testValues.quantity}
                      onChange={(e) => setTestValues({ ...testValues, quantity: parseFloat(e.target.value) || 0 })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="test-machine-rate" className="text-xs">Machine Rate ($)</Label>
                    <Input
                      id="test-machine-rate"
                      type="number"
                      value={testValues.MACHINE_RATE}
                      onChange={(e) => setTestValues({ ...testValues, MACHINE_RATE: parseFloat(e.target.value) || 0 })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="test-base-price" className="text-xs">
                      Base Price ($/unit)
                    </Label>
                    <Input
                      id="test-base-price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={testValues.basePrice ?? 1}
                      onChange={(e) =>
                        setTestValues({ ...testValues, basePrice: parseFloat(e.target.value) || 1 })
                      }
                      className="h-8 text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Sets base_price / p in formula
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs">Output Meaning</Label>
                    <Select
                      value={outputMeaning}
                      onValueChange={(v) =>
                        updateOutputMeaning(v as FormulaOutputMeaning)
                      }
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="billable">Billable qty / sqft</SelectItem>
                        <SelectItem value="final_price">Final dollars</SelectItem>
                        <SelectItem value="generic">Generic number</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      How to interpret the result
                    </p>
                    {outputMeaningMissing && (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          This formula has no saved output meaning. It will be treated as final dollars until explicitly changed.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {testResult && (() => {
                  const resultLabel =
                    outputMeaning === "final_price"
                      ? "Formula Result (dollar amount)"
                      : outputMeaning === "billable"
                      ? "Formula Result (billable qty / sqft)"
                      : "Formula Result";
                  const resultNote =
                    outputMeaning === "final_price"
                      ? "Treated as a final dollar amount"
                      : outputMeaning === "billable"
                      ? "Billable quantity or sqft — multiply by base price for estimated price"
                      : "Raw expression output";
                  const displayValue =
                    outputMeaning === "final_price"
                      ? `$${testResult.rawValue.toFixed(2)}`
                      : testResult.rawValue.toLocaleString(undefined, { maximumFractionDigits: 8 });
                  const estimatedPrice: number | null =
                    outputMeaning === "final_price"
                      ? testResult.rawValue
                      : outputMeaning === "billable"
                      ? testResult.rawValue * testResult.base_price
                      : null;

                  const fit = computeSheetFit(testResult.w, testResult.h, testResult.q);
                  const pieceSqft = testResult.sqft;
                  const rounded3 = Math.ceil(pieceSqft / 3) * 3;
                  const fullSheetSqft48x96 = (48 * 96) / 144; // 32
                  const fullSheetTrigger = pieceSqft >= fullSheetSqft48x96;
                  const chosenBillable = fullSheetTrigger ? fullSheetSqft48x96 : rounded3;

                  return (
                    <div className="space-y-2">
                      {/* Result headline */}
                      <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded p-3">
                        <p className="text-xs font-medium text-green-800 dark:text-green-300 mb-0.5">
                          {resultLabel}
                        </p>
                        <p className="text-xl font-bold text-green-700 dark:text-green-400">
                          {displayValue}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">{resultNote}</p>
                        {estimatedPrice !== null && (
                          <div className="mt-2 pt-2 border-t border-green-200 dark:border-green-800">
                            <p className="text-[11px] text-green-700 dark:text-green-300">
                              Estimated price:{" "}
                              <strong className="text-base">${estimatedPrice.toFixed(2)}</strong>
                              {outputMeaning === "billable" && (
                                <span className="text-muted-foreground ml-1.5">
                                  ({testResult.rawValue} × ${testResult.base_price.toFixed(2)})
                                </span>
                              )}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Breakdown table */}
                      <div className="border rounded divide-y text-xs overflow-hidden">
                        <div className="px-3 py-1.5 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Test Inputs
                        </div>
                        <BreakdownRow label="Width" value={`${testResult.w}"`} />
                        <BreakdownRow label="Height" value={`${testResult.h}"`} />
                        <BreakdownRow label="Quantity" value={String(testResult.q)} />
                        <BreakdownRow
                          label="Machine Rate"
                          value={`$${testResult.MACHINE_RATE.toFixed(2)}`}
                        />

                        <div className="px-3 py-1.5 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Computed Geometry
                        </div>
                        <BreakdownRow
                          label="Sqft per piece"
                          value={`${testResult.sqft.toFixed(6).replace(/\.?0+$/, "")} sqft`}
                          note={`(${testResult.w} × ${testResult.h}) / 144`}
                        />
                        <BreakdownRow
                          label="Total sqft"
                          value={`${testResult.total_sqft.toFixed(6).replace(/\.?0+$/, "")} sqft`}
                          note={`${testResult.sqft.toFixed(4).replace(/\.?0+$/, "")} × ${testResult.q}`}
                        />

                        <div className="px-3 py-1.5 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Test Context
                        </div>
                        <BreakdownRow
                          label="base_price (p)"
                          value={`$${testResult.base_price.toFixed(2)}`}
                          note="test input value"
                        />
                        {(() => {
                          const fv = extractFormulaVariables(formData.config as Record<string, unknown>);
                          const fvEntries = Object.entries(fv);
                          if (fvEntries.length === 0) return null;
                          return (
                            <>
                              <div className="px-3 py-1.5 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                                Formula Variables
                              </div>
                              {fvEntries.map(([k, v]) => (
                                <BreakdownRow key={k} label={k} value={String(v)} mono />
                              ))}
                            </>
                          );
                        })()}

                        <div className="px-3 py-1.5 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Evaluated
                        </div>
                        <BreakdownRow label="Expression" value={testResult.expression} mono />
                        <BreakdownRow label="Raw result" value={String(testResult.rawValue)} />
                        {testResult.rawValue !== Math.round(testResult.rawValue) && (
                          <BreakdownRow
                            label="Rounded"
                            value={Math.round(testResult.rawValue).toString()}
                            note="nearest integer"
                          />
                        )}
                      </div>

                      {/* Sheet Fit Debug toggle */}
                      <button
                        type="button"
                        onClick={() => setShowSheetDebug((v) => !v)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-4 w-full"
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${showSheetDebug ? "rotate-180" : ""}`}
                        />
                        {showSheetDebug ? "Hide" : "Show"} Sheet Fit Debug (48×96)
                      </button>

                      {/* Sheet Fit Debug panel */}
                      {showSheetDebug && fit && (
                        <div className="border border-blue-200 dark:border-blue-800 rounded divide-y text-xs overflow-hidden">
                          <div className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/20 text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">
                            Sheet Fit Debug — 48×96 sheet
                          </div>
                          <BreakdownRow label="Sheet size" value="48 × 96 in" />
                          <BreakdownRow
                            label="Piece size"
                            value={`${testResult.w} × ${testResult.h} in`}
                          />

                          <div className="px-3 py-1.5 bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            Nesting
                          </div>
                          <BreakdownRow
                            label="Normal orientation"
                            value={String(fit.normalFit)}
                            note={`floor(48/${testResult.w}) × floor(96/${testResult.h})`}
                          />
                          <BreakdownRow
                            label="Rotated 90°"
                            value={String(fit.rotatedFit)}
                            note={`floor(48/${testResult.h}) × floor(96/${testResult.w})`}
                          />
                          <BreakdownRow
                            label="Mixed layout A"
                            value={String(fit.mixedA)}
                            note="normal rows + rotated remainder"
                          />
                          <BreakdownRow
                            label="Mixed layout B"
                            value={String(fit.mixedB)}
                            note="rotated rows + normal remainder"
                          />
                          <BreakdownRow
                            label="Best fit"
                            value={String(fit.best)}
                            note={`max(${fit.normalFit}, ${fit.rotatedFit}, ${fit.mixedA}, ${fit.mixedB}, 1)`}
                          />

                          <div className="px-3 py-1.5 bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            Sheet Requirements
                          </div>
                          <BreakdownRow
                            label="Sheets required"
                            value={String(fit.sheetsRequired)}
                            note={`ceil(${testResult.q} / ${fit.best})`}
                          />
                          <BreakdownRow
                            label="Full sheet sqft"
                            value={`${fit.fullSheetSqft} sqft`}
                            note="(48 × 96) / 144"
                          />
                          <BreakdownRow
                            label="Billable sqft"
                            value={`${fit.billableSqft} sqft`}
                            note={`${fit.sheetsRequired} sheets × ${fit.fullSheetSqft}`}
                          />

                          <div className="px-3 py-1.5 bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            4×8 Single-Piece Debug
                          </div>
                          <BreakdownRow
                            label="Piece sqft"
                            value={`${pieceSqft.toFixed(4).replace(/\.?0+$/, "")} sqft`}
                          />
                          <BreakdownRow
                            label="Rounded (3-sqft)"
                            value={`${rounded3} sqft`}
                            note={`ceil(${pieceSqft.toFixed(4).replace(/\.?0+$/, "")} / 3) × 3`}
                          />
                          <BreakdownRow
                            label="Full-sheet trigger"
                            value={fullSheetTrigger ? "Yes" : "No"}
                            note={`sqft ${fullSheetTrigger ? "≥" : "<"} 32`}
                          />
                          <BreakdownRow
                            label="Chosen billable sqft"
                            value={`${chosenBillable} sqft`}
                            note={fullSheetTrigger ? "full sheet" : "3-sqft increment"}
                          />

                          <div className="px-3 py-2">
                            <p className="text-[10px] text-muted-foreground">
                              4×8 helper debug based on current test inputs. This debug panel is for
                              validating common flat-sheet formulas. The actual formula result above
                              is the source of truth.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Helper note */}
                      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" />
                        <span>
                          The formula tester evaluates the expression only. Product pricing preview
                          may apply base rates, minimums, option pricing, and modifiers separately.
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {testError && (
                  <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded p-3">
                    <p className="text-xs text-red-600 dark:text-red-400">Error: {testError}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Formula Variables editor (non-flat-goods profiles only) */}
          {!showFlatGoodsConfig && (
            <div className="border rounded-md p-4 space-y-3 bg-muted/20">
              <FormulaVariablesEditor
                config={formData.config as Record<string, unknown>}
                onConfigChange={(cfg) => setFormData({ ...formData, config: cfg })}
                onInsertVariable={insertVariable}
              />
            </div>
          )}
        </div>

        {/* Variable Library + Formula Help - Right sidebar */}
        {!showFlatGoodsConfig && (
          <div className="lg:col-span-1">
            <div className="sticky top-0">
              <Tabs defaultValue="variables" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="variables" className="text-xs">Variables</TabsTrigger>
                  <TabsTrigger value="help" className="text-xs">Formula Help</TabsTrigger>
                </TabsList>
                <TabsContent value="variables">
                  <div className="border rounded-md overflow-hidden bg-card">
                    <div className="max-h-[500px] overflow-y-auto divide-y">
                      {VARIABLE_LIBRARY.map((section) => (
                        <div key={section.section} className="p-3">
                          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            {section.section}
                          </h5>
                          <div className="space-y-1">
                            {section.variables.map((variable) => (
                              <button
                                key={variable.key}
                                onClick={() => insertVariable(variable.key)}
                                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted transition-colors group"
                                type="button"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{variable.label}</p>
                                    <p className="text-xs text-muted-foreground truncate">{variable.description}</p>
                                  </div>
                                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                                    {variable.key}
                                  </code>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="help">
                  <FormulaLanguageHelp onInsert={insertVariable} />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
