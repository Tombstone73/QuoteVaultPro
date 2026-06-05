import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { CatalogMigrationLabAnalyzerResult } from "@shared/catalogMigrationLabSchemas";
import { CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES } from "@shared/catalogMigrationLabSchemas";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { canUsePlatformTools } from "@/lib/platformAccess";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, fileName);
}

function downloadText(text: string, fileName: string, type = "text/csv;charset=utf-8") {
  downloadBlob(new Blob([text], { type }), fileName);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-sm text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function CatalogMigrationLab() {
  const { toast } = useToast();
  const { user, isLoading } = useAuth();
  const [jsonText, setJsonText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CatalogMigrationLabAnalyzerResult | null>(null);
  const canAccessPlatformTools = canUsePlatformTools(user);

  const sourceBytes = useMemo(() => new Blob([jsonText]).size, [jsonText]);
  const oversized = sourceBytes > CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES;

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/catalog-migration-lab/analyze", {
        adapter: "infoflo-json",
        fileName,
        jsonText,
      });
      const json = await response.json();
      if (!json?.success) throw new Error(json?.message ?? "Analysis failed");
      return json.data as CatalogMigrationLabAnalyzerResult;
    },
    onSuccess: (result) => {
      setAnalysis(result);
      toast({
        title: "Analysis complete",
        description: `${result.counts.totalProducts} product(s) discovered. No catalog changes were made.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis failed",
        description: error?.message ?? "Catalog source could not be analyzed.",
        variant: "destructive",
      });
    },
  });

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES) {
      toast({
        title: "File too large",
        description: `Phase 1 analyzer accepts JSON files up to ${formatBytes(CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES)}.`,
        variant: "destructive",
      });
      return;
    }
    setFileName(file.name);
    setJsonText(await file.text());
    setAnalysis(null);
  };

  const canAnalyze = jsonText.trim().length > 0 && !oversized && !analyzeMutation.isPending;

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  if (!canAccessPlatformTools) {
    return <NotFound />;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Catalog Migration Lab</h1>
            <Badge variant="outline">Experimental</Badge>
            <Badge variant="secondary">Read-only</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Analyze an InfoFlo JSON product catalog export before any mapping, draft generation, or import workflow exists.
          </p>
        </div>
        {analysis && (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => downloadJson(analysis, `catalog-migration-analysis-${new Date().toISOString().slice(0, 10)}.json`)}
          >
            <Download className="h-4 w-4" />
            Download Analysis
          </Button>
        )}
      </div>

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-blue-500" />
          <div className="space-y-1 text-sm">
            <div className="font-medium text-blue-700 dark:text-blue-300">Phase 1 safety boundary</div>
            <div className="text-muted-foreground">
              This page only parses uploaded JSON and returns catalog intelligence. It does not create products, drafts,
              PBV2 trees, materials, pricing formulas, Product Planning records, or catalog table changes.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            InfoFlo JSON Analyzer
          </CardTitle>
          <CardDescription>
            Upload a JSON export or paste JSON text. Maximum size: {formatBytes(CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES)}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" accept=".json,application/json" onChange={handleFileChange} />
            {fileName && <Badge variant="secondary">{fileName}</Badge>}
            <Badge variant={oversized ? "destructive" : "outline"}>{formatBytes(sourceBytes)}</Badge>
          </div>
          <Textarea
            value={jsonText}
            onChange={(event) => {
              setJsonText(event.target.value);
              setAnalysis(null);
            }}
            rows={10}
            placeholder='{"products":[{"name":"Banner","category":"Signs","basePrice":25}]}'
            className="font-mono text-xs"
          />
          {oversized && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Source is too large for the Phase 1 analyzer.
            </div>
          )}
          <Button className="gap-2" disabled={!canAnalyze} onClick={() => analyzeMutation.mutate()}>
            {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {analyzeMutation.isPending ? "Analyzing..." : "Run Analyzer"}
          </Button>
        </CardContent>
      </Card>

      {analysis && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Products" value={analysis.counts.totalProducts} hint="Detected source records" />
            <SummaryCard label="Active" value={analysis.counts.activeProducts} />
            <SummaryCard label="Inactive" value={analysis.counts.inactiveProducts} />
            <SummaryCard label="Warnings" value={analysis.warnings.length} hint={analysis.source.fingerprint.slice(0, 12)} />
          </div>

          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="structures">Product Structures</TabsTrigger>
              <TabsTrigger value="conditional">Conditional Logic</TabsTrigger>
              <TabsTrigger value="worksheets">Migration Worksheets</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source Structure</CardTitle>
              <CardDescription>
                Adapter: {analysis.source.adapter}; product path: {analysis.source.detectedProductPath ?? "not found"};
                shape: {analysis.source.sourceShape}; analyzed size: {formatBytes(analysis.source.byteSize)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Root Keys</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {analysis.source.detectedRootKeys.length === 0 ? (
                    <span className="text-muted-foreground">No object root keys.</span>
                  ) : analysis.source.detectedRootKeys.map((key) => (
                    <Badge key={key} variant="outline">{key}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Category Breakdown</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Count</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Inactive</TableHead>
                    <TableHead>Unknown</TableHead>
                    <TableHead>Samples</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.categories.length === 0 ? <EmptyRow colSpan={6} text="No categories found." /> : analysis.categories.map((category) => (
                    <TableRow key={category.category}>
                      <TableCell className="font-medium">{category.category}</TableCell>
                      <TableCell>{category.count}</TableCell>
                      <TableCell>{category.activeCount}</TableCell>
                      <TableCell>{category.inactiveCount}</TableCell>
                      <TableCell>{category.unknownCount}</TableCell>
                      <TableCell className="max-w-md truncate">{category.sampleProducts.join(", ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Option Patterns</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Option</TableHead>
                    <TableHead>Products</TableHead>
                    <TableHead>Reusable</TableHead>
                    <TableHead>Samples</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.optionPatterns.length === 0 ? <EmptyRow colSpan={4} text="No option patterns found." /> : analysis.optionPatterns.map((option) => (
                    <TableRow key={option.optionName}>
                      <TableCell className="font-medium">{option.optionName}</TableCell>
                      <TableCell>{option.productCount}</TableCell>
                      <TableCell>{option.likelyReusableGroup ? <Badge>Likely</Badge> : <Badge variant="outline">Maybe</Badge>}</TableCell>
                      <TableCell className="max-w-md truncate">{option.sampleProducts.join(", ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Material Candidates</CardTitle></CardHeader>
              <CardContent className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Count</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead>Samples</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.materialCandidates.length === 0 ? <EmptyRow colSpan={4} text="No material references found." /> : analysis.materialCandidates.map((material) => (
                      <TableRow key={material.reference}>
                        <TableCell className="font-medium">{material.reference}</TableCell>
                        <TableCell>{material.frequency}</TableCell>
                        <TableCell>{material.matchedMaterial ? material.matchedMaterial.name : <span className="text-muted-foreground">No match</span>}</TableCell>
                        <TableCell className="max-w-xs truncate">{material.sampleProducts.join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Pricing Patterns</CardTitle></CardHeader>
              <CardContent className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bucket</TableHead>
                      <TableHead>Count</TableHead>
                      <TableHead>Fields</TableHead>
                      <TableHead>Samples</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.pricingPatterns.length === 0 ? <EmptyRow colSpan={4} text="No pricing patterns found." /> : analysis.pricingPatterns.map((pattern) => (
                      <TableRow key={pattern.bucket}>
                        <TableCell className="font-medium">{pattern.bucket.replace(/_/g, " ")}</TableCell>
                        <TableCell>{pattern.count}</TableCell>
                        <TableCell className="max-w-xs truncate">{pattern.fields.join(", ") || "-"}</TableCell>
                        <TableCell className="max-w-xs truncate">{pattern.sampleProducts.join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Warnings</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.warnings.length === 0 ? <EmptyRow colSpan={4} text="No warnings." /> : analysis.warnings.map((warning, index) => (
                    <TableRow key={`${warning.code}-${index}`}>
                      <TableCell><Badge variant={warning.severity === "error" ? "destructive" : "outline"}>{warning.severity}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{warning.code}</TableCell>
                      <TableCell>{warning.productName ?? "-"}</TableCell>
                      <TableCell>{warning.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Unsupported Fields</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>Samples</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.unsupportedFields.length === 0 ? <EmptyRow colSpan={4} text="No unsupported fields found." /> : analysis.unsupportedFields.map((field) => (
                    <TableRow key={field.fieldName}>
                      <TableCell className="font-medium">{field.fieldName}</TableCell>
                      <TableCell>{field.frequency}</TableCell>
                      <TableCell className="font-mono text-xs">{field.path}</TableCell>
                      <TableCell className="max-w-md truncate">{field.sampleValues.join(", ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="structures" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Product Structures</CardTitle>
                  <CardDescription>
                    Deterministic InfoFlo form-field analysis. Read-only worksheet intelligence only.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Fields</TableHead>
                        <TableHead>Groups</TableHead>
                        <TableHead>Conditional</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Materials</TableHead>
                        <TableHead>Complexity</TableHead>
                        <TableHead>Warnings</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.productStructures.length === 0 ? <EmptyRow colSpan={10} text="No product structures found." /> : analysis.productStructures.map((product) => (
                        <TableRow key={product.productName}>
                          <TableCell className="font-medium">{product.productName}</TableCell>
                          <TableCell>{product.productType ?? "-"}</TableCell>
                          <TableCell>{product.fieldCount}</TableCell>
                          <TableCell className="max-w-xs truncate">{product.detectedOptionGroups.join(", ") || "-"}</TableCell>
                          <TableCell>{product.conditionalFieldCount}</TableCell>
                          <TableCell className="max-w-xs truncate">{product.sizeFieldsDetected.join(", ") || "-"}</TableCell>
                          <TableCell>{product.quantityFieldDetected ? <Badge>Detected</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                          <TableCell className="max-w-xs truncate">{product.materialsDetected.join(", ") || "-"}</TableCell>
                          <TableCell>{product.complexityScore}</TableCell>
                          <TableCell className="max-w-xs truncate">{product.warnings.join(", ") || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Parsed Product Fields</CardTitle></CardHeader>
                <CardContent className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead>Option</TableHead>
                        <TableHead>Parent</TableHead>
                        <TableHead>Level</TableHead>
                        <TableHead>Suggested Group</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.products.flatMap((product) => product.sourceFields).length === 0 ? <EmptyRow colSpan={8} text="No InfoFlo form fields found." /> : analysis.products.flatMap((product) => product.sourceFields).map((field) => (
                        <TableRow key={field.analyzerId}>
                          <TableCell className="font-medium">{field.productName}</TableCell>
                          <TableCell>{field.fieldLabel}</TableCell>
                          <TableCell>{field.fieldType}</TableCell>
                          <TableCell>{field.required ? "Yes" : "No"}</TableCell>
                          <TableCell>{field.optionText ?? "-"}</TableCell>
                          <TableCell>{field.parentField ? `${field.parentField}${field.parentOption ? `: ${field.parentOption}` : ""}` : "-"}</TableCell>
                          <TableCell>{field.level}</TableCell>
                          <TableCell>{field.suggestedOptionGroup ?? "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="conditional" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Conditional Logic</CardTitle>
                  <CardDescription>
                    Reveal chains and conditional field relationships found in InfoFlo form structures.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Parent Field</TableHead>
                        <TableHead>Parent Option</TableHead>
                        <TableHead>Child Field</TableHead>
                        <TableHead>Child Type</TableHead>
                        <TableHead>Level</TableHead>
                        <TableHead>Relationship</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.conditionalLogic.length === 0 ? <EmptyRow colSpan={8} text="No conditional logic found." /> : analysis.conditionalLogic.map((logic, index) => (
                        <TableRow key={`${logic.productName}-${logic.childField}-${index}`}>
                          <TableCell className="font-medium">{logic.productName}</TableCell>
                          <TableCell>{logic.parentField ?? "-"}</TableCell>
                          <TableCell>{logic.parentOption ?? "-"}</TableCell>
                          <TableCell>{logic.childField}</TableCell>
                          <TableCell>{logic.childFieldType}</TableCell>
                          <TableCell>{logic.level}</TableCell>
                          <TableCell>{logic.relationshipType}</TableCell>
                          <TableCell className="font-mono text-xs">{logic.sourcePath}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="worksheets" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileSpreadsheet className="h-4 w-4" />
                    Migration Worksheets
                  </CardTitle>
                  <CardDescription>
                    Editable CSV outputs for future migration planning. These downloads do not import or create catalog records.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() => downloadText(analysis.migrationWorksheets.productSummary, "catalog-migration-product-summary.csv")}
                  >
                    <Download className="h-4 w-4" />
                    Product Summary CSV
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() => downloadText(analysis.migrationWorksheets.productFields, "catalog-migration-product-fields.csv")}
                  >
                    <Download className="h-4 w-4" />
                    Product Fields CSV
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() => downloadText(analysis.migrationWorksheets.optionGroupDiscovery, "catalog-migration-option-groups.csv")}
                  >
                    <Download className="h-4 w-4" />
                    Option Groups CSV
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Worksheet Preview</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Product Fields CSV</div>
                    <pre className="max-h-80 overflow-auto rounded border bg-muted p-3 text-xs">
                      {analysis.migrationWorksheets.productFields.split("\n").slice(0, 20).join("\n")}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
