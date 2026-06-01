import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, Upload, FileJson, AlertCircle, CheckCircle2, XCircle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { summarizeProductExportItem, type ProductExportV2Item } from "@shared/importExportSchemas";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportPlan {
  counts: {
    total: number;
    create: number;
    update: number;
    skip: number;
  };
  warnings: Array<{
    productIndex: number;
    productName: string;
    code: string;
    message: string;
    field?: string;
  }>;
  errors: Array<{
    productIndex: number;
    productName: string;
    code: string;
    message: string;
    field?: string;
  }>;
  preview: Array<{
    productIndex: number;
    productName: string;
    category?: string;
    status?: string;
    hasPbv2?: boolean;
    hasActiveTree?: boolean;
    optionGroupCount?: number;
    optionCount?: number;
    choiceCount?: number;
    ruleCount?: number;
    pricingConfigPresent?: boolean;
    matrixCount?: number;
    tierCount?: number;
    action: "create" | "update" | "skip";
    existingId?: string;
    reason?: string;
    warnings?: string[];
  }>;
}

interface ImportResult {
  success: boolean;
  counts: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  created: Array<{
    productIndex: number;
    productName: string;
    productId: string;
    optionGroupCount?: number;
    optionCount?: number;
    choiceCount?: number;
    ruleCount?: number;
    pricingConfigPresent?: boolean;
    matrixCount?: number;
    tierCount?: number;
  }>;
  updated: Array<{
    productIndex: number;
    productName: string;
    productId: string;
    optionGroupCount?: number;
    optionCount?: number;
    choiceCount?: number;
    ruleCount?: number;
    pricingConfigPresent?: boolean;
    matrixCount?: number;
    tierCount?: number;
  }>;
  failed: Array<{
    productIndex: number;
    productName: string;
    error: string;
    code?: string;
  }>;
}

interface CatalogProductOption {
  id: string;
  name: string;
  category?: string | null;
  isActive?: boolean;
  pricingMode?: string;
  pbv2ActiveTreeVersionId?: string | null;
  optionTreeJson?: unknown;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function exportProducts(productIds: string[]) {
  const query = productIds.length > 0
    ? `?productIds=${encodeURIComponent(productIds.join(","))}`
    : "";
  const res = await fetch(`/api/admin/products/export${query}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to export products");
  return await res.json();
}

async function runDryRun(payload: any, mode: string) {
  const res = await fetch(`/api/admin/products/import?dryRun=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, mode }),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Dry run failed");
  }
  return (await res.json()) as ImportPlan;
}

async function applyImport(payload: any, mode: string) {
  const res = await fetch(`/api/admin/products/import?dryRun=0`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, mode }),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Import failed");
  }
  return (await res.json()) as ImportResult;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductImportExport() {
  const { toast } = useToast();
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPayload, setImportPayload] = useState<any | null>(null);
  const [dryRunResult, setDryRunResult] = useState<ImportPlan | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importMode, setImportMode] = useState<"upsertBySlug" | "requireExplicitConflictResolution">("upsertBySlug");
  const [selectedExportProductIds, setSelectedExportProductIds] = useState<Set<string>>(new Set());
  const [selectedImportProductIndexes, setSelectedImportProductIndexes] = useState<Set<number>>(new Set());

  const productsQuery = useQuery<CatalogProductOption[]>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const res = await fetch("/api/products", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load products");
      return await res.json();
    },
  });

  const importedProducts = Array.isArray(importPayload?.products)
    ? (importPayload.products as ProductExportV2Item[])
    : [];

  const selectedImportCount = selectedImportProductIndexes.size;

  const getSelectedImportPayload = () => {
    if (!importPayload) return null;
    return {
      ...importPayload,
      products: importedProducts.filter((_, index) => selectedImportProductIndexes.has(index)),
    };
  };

  // Export mutation
  const exportMutation = useMutation({
    mutationFn: exportProducts,
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `products-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Export successful",
        description: `Exported ${data.products.length} products`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Export failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Dry-run mutation
  const dryRunMutation = useMutation({
    mutationFn: () => runDryRun(getSelectedImportPayload()!, importMode),
    onSuccess: (plan) => {
      setDryRunResult(plan);
      if (plan.errors.length === 0) {
        toast({
          title: "Validation passed",
          description: `Ready to import ${plan.counts.create} new and update ${plan.counts.update} existing products`,
        });
      } else {
        toast({
          title: "Validation failed",
          description: `${plan.errors.length} errors found`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Dry run failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Apply import mutation
  const applyMutation = useMutation({
    mutationFn: () => applyImport(getSelectedImportPayload()!, importMode),
    onSuccess: (result) => {
      setImportResult(result);
      setDryRunResult(null);
      setImportFile(null);
      setImportPayload(null);
      setSelectedImportProductIndexes(new Set());

      if (result.success) {
        toast({
          title: "Import successful",
          description: `Created ${result.counts.created}, updated ${result.counts.updated}`,
        });
      } else {
        toast({
          title: "Import completed with errors",
          description: `${result.counts.failed} products failed`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const productCount = Array.isArray(json?.products) ? json.products.length : 0;
      setImportFile(file);
      setImportPayload(json);
      setSelectedImportProductIndexes(new Set(Array.from({ length: productCount }, (_, index) => index)));
      setDryRunResult(null);
      setImportResult(null);
    } catch (error: any) {
      toast({
        title: "Invalid file",
        description: "File must be valid JSON",
        variant: "destructive",
      });
    }
  };

  const canApply = dryRunResult && dryRunResult.errors.length === 0 && selectedImportCount > 0;
  const exportProductsList = productsQuery.data ?? [];
  const allExportSelected = exportProductsList.length > 0 && selectedExportProductIds.size === exportProductsList.length;
  const allImportSelected = importedProducts.length > 0 && selectedImportProductIndexes.size === importedProducts.length;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Product Import/Export</h1>
        <p className="text-muted-foreground mt-2">
          Export products with PBV2 option trees or import products from JSON
        </p>
      </div>

      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Products
          </CardTitle>
          <CardDescription>
            Download all products with complete PBV2 option tree definitions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                {selectedExportProductIds.size} selected
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedExportProductIds(new Set(exportProductsList.map((product) => product.id)))}
                  disabled={productsQuery.isLoading || exportProductsList.length === 0}
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedExportProductIds(new Set())}
                  disabled={selectedExportProductIds.size === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            {productsQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allExportSelected}
                          onCheckedChange={(checked) => {
                            setSelectedExportProductIds(
                              checked ? new Set(exportProductsList.map((product) => product.id)) : new Set(),
                            );
                          }}
                          aria-label="Select all export products"
                        />
                      </TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>PBV2</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exportProductsList.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedExportProductIds.has(product.id)}
                            onCheckedChange={(checked) => {
                              const next = new Set(selectedExportProductIds);
                              if (checked) next.add(product.id);
                              else next.delete(product.id);
                              setSelectedExportProductIds(next);
                            }}
                            aria-label={`Select ${product.name} for export`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell>{product.category || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={product.isActive === false ? "outline" : "secondary"}>
                            {product.isActive === false ? "Inactive" : "Active"}
                          </Badge>
                        </TableCell>
                        <TableCell>{product.pbv2ActiveTreeVersionId || product.optionTreeJson ? "Yes" : "No"}</TableCell>
                      </TableRow>
                    ))}
                    {exportProductsList.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          No products found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => exportMutation.mutate(Array.from(selectedExportProductIds))}
                disabled={exportMutation.isPending || selectedExportProductIds.size === 0}
              >
                <FileJson className="h-4 w-4 mr-2" />
                {exportMutation.isPending ? "Exporting..." : "Export Selected"}
              </Button>
              <Button
                onClick={() => exportMutation.mutate([])}
                disabled={exportMutation.isPending}
                variant="outline"
              >
                Export All
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Products
          </CardTitle>
          <CardDescription>
            Upload a JSON file to import products with PBV2 trees
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File upload */}
          <div className="flex items-center gap-4">
            <input
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="block w-full text-sm text-muted-foreground
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-primary file:text-primary-foreground
                hover:file:bg-primary/90"
            />
          </div>

          {/* Import mode selector */}
          {importFile && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Import Mode</label>
              <Select
                value={importMode}
                onValueChange={(v) => {
                  setImportMode(v as any);
                  setDryRunResult(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upsertBySlug">
                    Upsert by Slug (update if exists, create if new)
                  </SelectItem>
                  <SelectItem value="requireExplicitConflictResolution">
                    Require Explicit Conflict Resolution (error on duplicate)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {importFile && importedProducts.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Products in Import File</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedImportCount} of {importedProducts.length} selected
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedImportProductIndexes(new Set(importedProducts.map((_, index) => index)));
                      setDryRunResult(null);
                    }}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedImportProductIndexes(new Set());
                      setDryRunResult(null);
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allImportSelected}
                          onCheckedChange={(checked) => {
                            setSelectedImportProductIndexes(
                              checked ? new Set(importedProducts.map((_, index) => index)) : new Set(),
                            );
                            setDryRunResult(null);
                          }}
                          aria-label="Select all import products"
                        />
                      </TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>PBV2</TableHead>
                      <TableHead>Groups</TableHead>
                      <TableHead>Options</TableHead>
                      <TableHead>Rules</TableHead>
                      <TableHead>Matrices</TableHead>
                      <TableHead>Tiers</TableHead>
                      <TableHead>Pricing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importedProducts.map((product, index) => {
                      const summary = summarizeProductExportItem(product);
                      return (
                        <TableRow key={`${product.name}-${index}`}>
                          <TableCell>
                            <Checkbox
                              checked={selectedImportProductIndexes.has(index)}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedImportProductIndexes);
                                if (checked) next.add(index);
                                else next.delete(index);
                                setSelectedImportProductIndexes(next);
                                setDryRunResult(null);
                              }}
                              aria-label={`Select ${product.name} for import`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell>{product.category || "-"}</TableCell>
                          <TableCell>{product.isActive === false ? "Inactive" : "Active"}</TableCell>
                          <TableCell>{summary.hasPbv2 ? "Yes" : "No"}</TableCell>
                          <TableCell>{summary.optionGroupCount}</TableCell>
                          <TableCell>{summary.optionCount}</TableCell>
                          <TableCell>{summary.ruleCount}</TableCell>
                          <TableCell>{summary.matrixCount}</TableCell>
                          <TableCell>{summary.tierCount}</TableCell>
                          <TableCell>{summary.pricingConfigPresent ? "Yes" : "No"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Actions */}
          {importFile && importPayload && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => dryRunMutation.mutate()}
                disabled={dryRunMutation.isPending || selectedImportCount === 0}
                variant="outline"
              >
                {dryRunMutation.isPending ? "Validating..." : "Preview Selected"}
              </Button>
              <Button
                onClick={() => applyMutation.mutate()}
                disabled={!canApply || applyMutation.isPending}
              >
                {applyMutation.isPending ? "Importing..." : "Import Selected"}
              </Button>
            </div>
          )}

          {/* Dry-run results */}
          {dryRunResult && (
            <div className="space-y-4 mt-6">
              <Alert variant={dryRunResult.errors.length > 0 ? "destructive" : "default"}>
                <Info className="h-4 w-4" />
                <AlertTitle>Validation Results</AlertTitle>
                <AlertDescription>
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Total</div>
                      <div className="text-lg font-semibold">{dryRunResult.counts.total}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Create</div>
                      <div className="text-lg font-semibold text-green-600">{dryRunResult.counts.create}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Update</div>
                      <div className="text-lg font-semibold text-blue-600">{dryRunResult.counts.update}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Skip</div>
                      <div className="text-lg font-semibold text-muted-foreground">{dryRunResult.counts.skip}</div>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              {/* Errors */}
              {dryRunResult.errors.length > 0 && (
                <div className="border border-destructive rounded-md p-4 space-y-2">
                  <h3 className="font-semibold text-destructive flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Errors ({dryRunResult.errors.length})
                  </h3>
                  <div className="space-y-1 text-sm">
                    {dryRunResult.errors.map((err, idx) => (
                      <div key={idx} className="text-destructive">
                        [{err.productName}] {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {dryRunResult.warnings.length > 0 && (
                <div className="border border-yellow-500 rounded-md p-4 space-y-2">
                  <h3 className="font-semibold text-yellow-700 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Warnings ({dryRunResult.warnings.length})
                  </h3>
                  <div className="space-y-1 text-sm">
                    {dryRunResult.warnings.map((warn, idx) => (
                      <div key={idx} className="text-yellow-700">
                        [{warn.productName}] {warn.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview */}
              {dryRunResult.preview.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Import Preview</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>PBV2</TableHead>
                        <TableHead>Groups</TableHead>
                        <TableHead>Options</TableHead>
                        <TableHead>Rules</TableHead>
                        <TableHead>Matrices</TableHead>
                        <TableHead>Tiers</TableHead>
                        <TableHead>Pricing</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dryRunResult.preview.slice(0, 50).map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{item.productName}</TableCell>
                          <TableCell>{item.category || "-"}</TableCell>
                          <TableCell>
                            <Badge variant={
                              item.action === "create" ? "default" :
                              item.action === "update" ? "secondary" :
                              "outline"
                            }>
                              {item.action}
                            </Badge>
                          </TableCell>
                          <TableCell>{item.hasPbv2 ? "Yes" : "No"}</TableCell>
                          <TableCell>{item.optionGroupCount ?? 0}</TableCell>
                          <TableCell>{item.optionCount ?? 0}</TableCell>
                          <TableCell>{item.ruleCount ?? 0}</TableCell>
                          <TableCell>{item.matrixCount ?? 0}</TableCell>
                          <TableCell>{item.tierCount ?? 0}</TableCell>
                          <TableCell>{item.pricingConfigPresent ? "Yes" : "No"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {[item.reason, ...(item.warnings ?? [])].filter(Boolean).join(" ") || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                      {dryRunResult.preview.length > 50 && (
                        <TableRow>
                          <TableCell colSpan={11} className="text-center text-sm text-muted-foreground">
                            ... and {dryRunResult.preview.length - 50} more
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {/* Import results */}
          {importResult && (
            <div className="space-y-4 mt-6">
              <Alert variant={importResult.success ? "default" : "destructive"}>
                {importResult.success ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <AlertTitle>
                  {importResult.success ? "Import Successful" : "Import Completed with Errors"}
                </AlertTitle>
                <AlertDescription>
                  <div className="grid grid-cols-5 gap-2 mt-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Total</div>
                      <div className="text-lg font-semibold">{importResult.counts.total}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Created</div>
                      <div className="text-lg font-semibold text-green-600">{importResult.counts.created}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Updated</div>
                      <div className="text-lg font-semibold text-blue-600">{importResult.counts.updated}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Skipped</div>
                      <div className="text-lg font-semibold text-muted-foreground">{importResult.counts.skipped}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Failed</div>
                      <div className="text-lg font-semibold text-destructive">{importResult.counts.failed}</div>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              {importResult.created.length + importResult.updated.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Imported PBV2 Counts</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Groups</TableHead>
                        <TableHead>Options</TableHead>
                        <TableHead>Rules</TableHead>
                        <TableHead>Matrices</TableHead>
                        <TableHead>Tiers</TableHead>
                        <TableHead>Pricing</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        ...importResult.created.map((item) => ({ ...item, result: "Created" })),
                        ...importResult.updated.map((item) => ({ ...item, result: "Updated" })),
                      ].map((item) => (
                        <TableRow key={`${item.result}-${item.productId}`}>
                          <TableCell className="font-medium">{item.productName}</TableCell>
                          <TableCell>{item.result}</TableCell>
                          <TableCell>{item.optionGroupCount ?? 0}</TableCell>
                          <TableCell>{item.optionCount ?? 0}</TableCell>
                          <TableCell>{item.ruleCount ?? 0}</TableCell>
                          <TableCell>{item.matrixCount ?? 0}</TableCell>
                          <TableCell>{item.tierCount ?? 0}</TableCell>
                          <TableCell>{item.pricingConfigPresent ? "Yes" : "No"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Failed items */}
              {importResult.failed.length > 0 && (
                <div className="border border-destructive rounded-md p-4 space-y-2">
                  <h3 className="font-semibold text-destructive flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Failed Imports ({importResult.failed.length})
                  </h3>
                  <div className="space-y-1 text-sm">
                    {importResult.failed.map((item, idx) => (
                      <div key={idx} className="text-destructive">
                        [{item.productName}] {item.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
