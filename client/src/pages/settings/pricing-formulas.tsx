import { useState, useEffect, useRef } from "react";
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
import { Loader2, Plus, Pencil, Trash2, Eye, Package, Play } from "lucide-react";
import { TitanCard } from "@/components/ui/TitanCard";
import { evaluate } from "mathjs";

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
      { key: "width", label: "Width", description: "Item width in inches" },
      { key: "w", label: "Width (short)", description: "Alias for width" },
      { key: "height", label: "Height", description: "Item height in inches" },
      { key: "h", label: "Height (short)", description: "Alias for height" },
      { key: "quantity", label: "Quantity", description: "Number of items" },
      { key: "q", label: "Quantity (short)", description: "Alias for quantity" },
      { key: "sides", label: "Sides", description: "Number of printed sides" },
      { key: "copies", label: "Copies", description: "Number of copies per original" },
    ],
  },
  {
    section: "System Calculated",
    variables: [
      { key: "sqft", label: "Square Feet", description: "Calculated from width × height / 144" },
      { key: "total_sqft", label: "Total Square Feet", description: "sqft × quantity" },
      { key: "basePricePerSqft", label: "Base Price/SqFt", description: "From volume pricing tier" },
      { key: "p", label: "Price (short)", description: "Alias for basePricePerSqft" },
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

const emptyFormData: PricingFormulaInput = {
  name: "",
  code: "",
  description: "",
  pricingProfileKey: "default",
  expression: "",
  config: null,
  isActive: true,
};

export default function PricingFormulasSettings() {
  const { data: formulas, isLoading } = usePricingFormulas();
  const createMutation = useCreatePricingFormula();
  const updateMutation = useUpdatePricingFormula();
  const deleteMutation = useDeletePricingFormula();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingFormula, setEditingFormula] = useState<PricingFormula | null>(null);
  const [viewingFormula, setViewingFormula] = useState<string | null>(null);
  const [formData, setFormData] = useState<PricingFormulaInput>(emptyFormData);
  const [configJson, setConfigJson] = useState<string>("");

  // Fetch products linked to formula being viewed
  const { data: formulaWithProducts } = usePricingFormulaWithProducts(viewingFormula ?? undefined);

  const resetForm = () => {
    setFormData(emptyFormData);
    setConfigJson("");
  };

  const handleCreate = async () => {
    try {
      const config = configJson.trim() ? JSON.parse(configJson) : null;
      await createMutation.mutateAsync({ ...formData, config });
      setIsCreateOpen(false);
      resetForm();
    } catch (e) {
      // Config parse error handled by toast
    }
  };

  const handleUpdate = async () => {
    if (!editingFormula) return;
    try {
      const config = configJson.trim() ? JSON.parse(configJson) : null;
      await updateMutation.mutateAsync({ id: editingFormula.id, data: { ...formData, config } });
      setEditingFormula(null);
      resetForm();
    } catch (e) {
      // Config parse error handled by toast
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
    setConfigJson(formula.config ? JSON.stringify(formula.config, null, 2) : "");
  };

  const openCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const selectedProfile = PRICING_PROFILES.find((p) => p.key === formData.pricingProfileKey);
  const showFlatGoodsConfig = formData.pricingProfileKey === "flat_goods";

  type TestValues = {
    width: number;
    height: number;
    quantity: number;
    MACHINE_RATE: number;
  };

  // Formula tester state
  const [testValues, setTestValues] = useState<TestValues>({
    width: 12,
    height: 18,
    quantity: 100,
    MACHINE_RATE: 75,
  });
  const [testResult, setTestResult] = useState<string>("");
  const [testError, setTestError] = useState<string>("");
  const expressionInputRef = useRef<HTMLInputElement>(null);

  const handleRunTest = () => {
    try {
      const expression = formData.expression || "";
      if (!expression.trim()) {
        setTestError("No formula to test");
        setTestResult("");
        return;
      }

      // Build scope with common aliases
      const scope = {
        ...testValues,
        w: testValues.width,
        h: testValues.height,
        q: testValues.quantity,
        sqft: (testValues.width * testValues.height) / 144,
        basePricePerSqft: 1.0, // Default for testing
        p: 1.0,
      };

      const result = evaluate(expression, scope);
      setTestResult(typeof result === 'number' ? `$${result.toFixed(2)}` : String(result));
      setTestError("");
    } catch (error: any) {
      setTestError(error.message || "Invalid formula");
      setTestResult("");
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
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Formula
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Create Pricing Formula</DialogTitle>
              <DialogDescription>
                Define a reusable pricing configuration that can be attached to multiple products.
              </DialogDescription>
            </DialogHeader>
            <FormulaEditorFields
              formData={formData}
              setFormData={setFormData}
              configJson={configJson}
              setConfigJson={setConfigJson}
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
                        <Button variant="ghost" size="sm" onClick={() => openEdit(formula)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(formula.id)}
                          disabled={deleteMutation.isPending}
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
            configJson={configJson}
            setConfigJson={setConfigJson}
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

// Separate component to prevent re-mounting on state changes
type FormulaEditorFieldsProps = {
  formData: PricingFormulaInput;
  setFormData: (data: PricingFormulaInput) => void;
  configJson: string;
  setConfigJson: (json: string) => void;
  selectedProfile: typeof PRICING_PROFILES[0] | undefined;
  showFlatGoodsConfig: boolean;
  expressionInputRef: React.RefObject<HTMLInputElement>;
  insertVariable: (variableKey: string) => void;
  testValues: Record<string, number>;
  setTestValues: (values: Record<string, number>) => void;
  testResult: string;
  testError: string;
  handleRunTest: () => void;
};

function FormulaEditorFields({
  formData,
  setFormData,
  configJson,
  setConfigJson,
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
                  placeholder="e.g., sqft * p * q"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Click variables from the library to insert them →
                </p>
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
                </div>

                {testResult && (
                  <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded p-3">
                    <p className="text-xs text-muted-foreground mb-1">Result:</p>
                    <p className="text-lg font-semibold text-green-700 dark:text-green-400">{testResult}</p>
                  </div>
                )}

                {testError && (
                  <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded p-3">
                    <p className="text-xs text-red-600 dark:text-red-400">Error: {testError}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Advanced config JSON (hidden for flat_goods which uses structured fields) */}
          {!showFlatGoodsConfig && (
            <div>
              <Label htmlFor="config">Advanced Config (JSON)</Label>
              <Textarea
                id="config"
                value={configJson}
                onChange={(e) => setConfigJson(e.target.value)}
                placeholder='{"key": "value"}'
                rows={3}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional JSON configuration for advanced pricing logic
              </p>
            </div>
          )}
        </div>

        {/* Variable Library - Right sidebar */}
        {!showFlatGoodsConfig && (
          <div className="lg:col-span-1">
            <div className="sticky top-0">
              <h4 className="font-medium text-sm mb-3">Variable Library</h4>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
