import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PackageCheck,
  Power,
  RefreshCw,
  Rocket,
} from "lucide-react";
import type { ProductIntakeDraftReview } from "@shared/productIntakeWizardSchemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type PublishResponse = {
  success: boolean;
  requiresWarningsConfirm?: boolean;
  findings?: ProductIntakeDraftReview["publishReadiness"]["findings"];
  data?: unknown;
  productId?: string;
  pbv2ActiveTreeVersionId?: string;
  message?: string;
};

type DraftPricingResponse = {
  success: boolean;
  data: ProductIntakeDraftReview;
};

function statusBadgeVariant(value: string): "default" | "secondary" | "outline" | "destructive" {
  if (value === "ACTIVE" || value === "published" || value === "ready") return "secondary";
  if (value === "blocked") return "destructive";
  return "outline";
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function maybeDraftQuality(value: unknown): { label: string; score?: number; warnings: string[]; reasons: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = typeof raw.label === "string" ? raw.label : null;
  if (!label) return null;
  return {
    label,
    score: typeof raw.score === "number" ? raw.score : undefined,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(String) : [],
  };
}

function findingText(finding: ProductIntakeDraftReview["publishReadiness"]["findings"][number]) {
  return `${finding.code}: ${finding.message}`;
}

function centsToDollars(value: number | null | undefined): string {
  if (!value) return "";
  return (value / 100).toFixed(2);
}

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim().replace(/^\$/, "");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function titleFromMatrixType(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export default function ProductIntakeDraftReviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { toast } = useToast();
  const [serverWarnings, setServerWarnings] = useState<ProductIntakeDraftReview["publishReadiness"]["findings"] | null>(null);
  const [basePricingDraft, setBasePricingDraft] = useState({
    perSqft: "",
    perPiece: "",
    minimumCharge: "",
  });

  const reviewQuery = useQuery<ProductIntakeDraftReview>({
    queryKey: ["/api/admin/product-intake-wizard/sessions", sessionId, "draft-review"],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/admin/product-intake-wizard/sessions/${sessionId}/draft-review`);
      const json = await response.json();
      return json.data as ProductIntakeDraftReview;
    },
  });

  const review = reviewQuery.data;
  const draftQuality = maybeDraftQuality(review?.pbv2Tree.draftQuality);
  useEffect(() => {
    if (!review) return;
    setBasePricingDraft({
      perSqft: centsToDollars(review.pbv2Tree.basePricing.perSqftCents),
      perPiece: centsToDollars(review.pbv2Tree.basePricing.perPieceCents),
      minimumCharge: centsToDollars(review.pbv2Tree.basePricing.minimumChargeCents),
    });
  }, [review?.pbv2Tree.id, review?.pbv2Tree.basePricing.perSqftCents, review?.pbv2Tree.basePricing.perPieceCents, review?.pbv2Tree.basePricing.minimumChargeCents]);
  const canActivate = Boolean(
    review &&
    !review.product.isActive &&
    review.pbv2Tree.status === "ACTIVE" &&
    review.product.pbv2ActiveTreeVersionId === review.pbv2Tree.id,
  );

  const activateReason = useMemo(() => {
    if (!review) return "Load the draft review first.";
    if (review.product.isActive) return "Product is already active.";
    if (review.pbv2Tree.status !== "ACTIVE") return "Publish the PBV2 draft before activating this product.";
    if (review.product.pbv2ActiveTreeVersionId !== review.pbv2Tree.id) return "The product active PBV2 tree pointer does not match this intake draft.";
    return "Ready to activate.";
  }, [review]);

  const publishMutation = useMutation({
    mutationFn: async ({ confirmWarnings }: { confirmWarnings: boolean }) => {
      if (!review) throw new Error("Draft review has not loaded.");
      const query = confirmWarnings ? "?confirmWarnings=true" : "";
      const response = await apiRequest("POST", `/api/pbv2/tree-versions/${review.pbv2Tree.id}/publish${query}`);
      return (await response.json()) as PublishResponse;
    },
    onSuccess: async (result) => {
      if (result.requiresWarningsConfirm && Array.isArray(result.findings)) {
        setServerWarnings(result.findings.filter((finding) => finding.severity === "WARNING"));
        return;
      }
      setServerWarnings(null);
      toast({ title: "PBV2 draft published", description: "The product is still inactive until activation is confirmed." });
      await reviewQuery.refetch();
      if (review?.product.id) {
        await queryClient.invalidateQueries({ queryKey: ["/api/products", review.product.id] });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Publish failed", description: error.message, variant: "destructive" });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("Missing session id.");
      const response = await apiRequest("POST", `/api/admin/product-intake-wizard/sessions/${sessionId}/activate-product`);
      const json = await response.json();
      return json.data as { productId: string; isActive: true };
    },
    onSuccess: async () => {
      toast({ title: "Product activated", description: "The inactive Product Intake draft is now active." });
      await reviewQuery.refetch();
      if (review?.product.id) {
        await queryClient.invalidateQueries({ queryKey: ["/api/products", review.product.id] });
        await queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Activation blocked", description: error.message, variant: "destructive" });
    },
  });

  const pricingMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("Missing session id.");
      const response = await apiRequest("PATCH", `/api/admin/product-intake-wizard/sessions/${sessionId}/draft-pricing`, {
        base: {
          perSqftCents: dollarsToCents(basePricingDraft.perSqft),
          perPieceCents: dollarsToCents(basePricingDraft.perPiece),
          minimumChargeCents: dollarsToCents(basePricingDraft.minimumCharge),
        },
      });
      return (await response.json()) as DraftPricingResponse;
    },
    onSuccess: async () => {
      toast({ title: "Draft pricing saved", description: "PBV2 draft pricing metadata was updated. Publish validation still controls activation." });
      await reviewQuery.refetch();
      if (review?.product.id) {
        await queryClient.invalidateQueries({ queryKey: ["/api/products", review.product.id] });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Draft pricing blocked", description: error.message, variant: "destructive" });
    },
  });

  if (!sessionId) {
    return <div className="p-6 text-sm text-muted-foreground">Missing Product Intake session id.</div>;
  }

  if (reviewQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading Product Intake draft review...</div>;
  }

  if (reviewQuery.error || !review) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Draft review unavailable</AlertTitle>
          <AlertDescription>{reviewQuery.error instanceof Error ? reviewQuery.error.message : "The draft review could not be loaded."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const sourcePreview = review.intake.sourceText || (review.intake.sourceJson ? JSON.stringify(review.intake.sourceJson, null, 2) : "No source payload recorded.");
  const findings = review.publishReadiness.findings;
  const draftTreeQuery = review.pbv2Tree.id ? `?draftTreeVersionId=${encodeURIComponent(review.pbv2Tree.id)}` : "";
  const matrixReadiness = review.pbv2Tree.matrixReadiness;
  const likelyMatrixPricing = Boolean(matrixReadiness?.required);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">
              <Link className="hover:text-foreground" to="/admin/catalog-migration-lab">Catalog Migration Lab</Link>
              <span className="mx-2">/</span>
              Product Intake Draft Review
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">{review.product.name}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant={review.product.isActive ? "secondary" : "outline"}>{review.product.isActive ? "Product active" : "Product inactive"}</Badge>
              <Badge variant={statusBadgeVariant(review.pbv2Tree.status)}>PBV2 {review.pbv2Tree.status}</Badge>
              <Badge variant={statusBadgeVariant(review.publishReadiness.validationStatus)}>{review.publishReadiness.validationStatus}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="gap-2">
              <Link to={`/products/${review.product.id}/edit${draftTreeQuery}`}><ExternalLink className="h-4 w-4" /> Open Full Draft Editor</Link>
            </Button>
            <Button asChild variant="outline" className="gap-2">
              <Link to={`/products/${review.product.id}/builder-v2${draftTreeQuery}`}><ExternalLink className="h-4 w-4" /> PBV2-Only Builder</Link>
            </Button>
          </div>
        </div>

        <Alert>
          <PackageCheck className="h-4 w-4" />
          <AlertTitle>Review-first Product Intake draft</AlertTitle>
          <AlertDescription>
            Draft creation is inactive by default. Publish validates and assigns the PBV2 tree; activation is a separate explicit action.
          </AlertDescription>
        </Alert>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Intake Summary</CardTitle>
              <CardDescription>Source, brief confidence, material match, and decisions still needing attention.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-3 md:grid-cols-4">
                <div><div className="text-xs uppercase text-muted-foreground">Session</div><div className="font-mono text-xs">{review.intake.sessionId}</div></div>
                <div><div className="text-xs uppercase text-muted-foreground">Brief Source</div><div>{review.intake.briefSource ?? "-"}</div></div>
                <div><div className="text-xs uppercase text-muted-foreground">Confidence</div><div>{review.intake.confidence == null ? "-" : `${review.intake.confidence}%`}</div></div>
                <div><div className="text-xs uppercase text-muted-foreground">Material Match</div><div>{review.intake.materialMatch ?? "Review required"}</div></div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Source</div>
                <pre className="mt-2 max-h-56 overflow-auto rounded border bg-muted/30 p-3 text-xs whitespace-pre-wrap">{sourcePreview}</pre>
              </div>
              {review.intake.unansweredDecisions.length > 0 && (
                <div>
                  <div className="font-medium">Unanswered Decisions</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {review.intake.unansweredDecisions.map((decision) => <li key={decision}>{decision}</li>)}
                  </ul>
                </div>
              )}
              {review.intake.warnings.length > 0 && (
                <div>
                  <div className="font-medium">Warnings</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-700 dark:text-amber-300">
                    {review.intake.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}
              {draftQuality && (
                <div className="rounded border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Draft Quality</span>
                    <Badge variant={draftQuality.label === "Needs Review" ? "outline" : "secondary"}>{draftQuality.label}</Badge>
                    {draftQuality.score != null && <Badge variant="outline">{draftQuality.score}/100</Badge>}
                  </div>
                  {draftQuality.warnings.length > 0 && (
                    <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">{draftQuality.warnings.join("; ")}</div>
                  )}
                  {draftQuality.reasons.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">{draftQuality.reasons.join("; ")}</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Product Draft</CardTitle>
              <CardDescription>Inactive product shell created by Product Intake.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><div className="text-xs uppercase text-muted-foreground">Product ID</div><div className="font-mono text-xs">{review.product.id}</div></div>
              <div><div className="text-xs uppercase text-muted-foreground">Category / Type</div><div>{review.product.category ?? "-"} / {review.product.productTypeName ?? review.product.productTypeId ?? "-"}</div></div>
              <div><div className="text-xs uppercase text-muted-foreground">Description</div><div className="text-muted-foreground">{review.product.description || "-"}</div></div>
              <div><div className="text-xs uppercase text-muted-foreground">Active Status</div><Badge variant={review.product.isActive ? "secondary" : "outline"}>{review.product.isActive ? "Active" : "Inactive"}</Badge></div>
              <div><div className="text-xs uppercase text-muted-foreground">Active PBV2 Tree</div><div className="font-mono text-xs">{review.product.pbv2ActiveTreeVersionId ?? "Not assigned"}</div></div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">PBV2 Draft Tree</CardTitle>
              <CardDescription>Generated groups and options for the draft tree.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm md:grid-cols-4">
                <div><div className="text-xs uppercase text-muted-foreground">Tree ID</div><div className="font-mono text-xs">{review.pbv2Tree.id}</div></div>
                <div><div className="text-xs uppercase text-muted-foreground">Status</div><Badge variant={statusBadgeVariant(review.pbv2Tree.status)}>{review.pbv2Tree.status}</Badge></div>
                <div><div className="text-xs uppercase text-muted-foreground">Groups</div><div>{review.pbv2Tree.groupCount}</div></div>
                <div><div className="text-xs uppercase text-muted-foreground">Options</div><div>{review.pbv2Tree.optionCount}</div></div>
              </div>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      <TableHead>Options</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {review.pbv2Tree.optionGroups.length === 0 ? (
                      <TableRow><TableCell colSpan={2} className="text-sm text-muted-foreground">No option groups were generated.</TableCell></TableRow>
                    ) : review.pbv2Tree.optionGroups.map((group) => (
                      <TableRow key={group.id}>
                        <TableCell className="font-medium">{group.label}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{group.options.join(", ") || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Matrix Readiness</CardTitle>
              <CardDescription>Pricing matrix guidance from Product Intake. Matrix rows are never generated automatically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {matrixReadiness ? (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Detected Matrix Type</div>
                      <div className="font-medium">{titleFromMatrixType(matrixReadiness.matrixType)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Confidence</div>
                      <div>{matrixReadiness.matrixConfidence}%</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Rows Generated</div>
                      <Badge variant="outline">{matrixReadiness.noMatrixRowsGenerated ? "No" : "Review"}</Badge>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Dimensions</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {matrixReadiness.matrixDimensions.length > 0 ? matrixReadiness.matrixDimensions.map((dimension) => (
                        <Badge key={dimension} variant="secondary">{dimension}</Badge>
                      )) : <span className="text-muted-foreground">No matrix dimensions detected.</span>}
                    </div>
                  </div>
                  {matrixReadiness.reasoning.length > 0 && (
                    <div>
                      <div className="font-medium">Reason</div>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                        {matrixReadiness.reasoning.map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    </div>
                  )}
                  <div>
                    <div className="font-medium">Recommended Setup</div>
                    <div className="mt-1 text-muted-foreground">{matrixReadiness.recommendedSetup}</div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Detected Sizes</div>
                      <div className="mt-1 text-muted-foreground">{matrixReadiness.detectedSizes.join(", ") || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Quantity Breaks</div>
                      <div className="mt-1 text-muted-foreground">{matrixReadiness.detectedQuantityBreaks.join(", ") || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Materials / Stock</div>
                      <div className="mt-1 text-muted-foreground">{matrixReadiness.detectedMaterials.join(", ") || "-"}</div>
                    </div>
                  </div>
                  {matrixReadiness.detectedPricingSignals.length > 0 && (
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Pricing Signals</div>
                      <div className="mt-1 text-muted-foreground">{matrixReadiness.detectedPricingSignals.join("; ")}</div>
                    </div>
                  )}
                  {matrixReadiness.required && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Matrix pricing review required</AlertTitle>
                      <AlertDescription>
                        Product Intake preserved matrix setup guidance only. Configure PBV2 pricing matrix rows in the builder before publish.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : (
                <div className="text-muted-foreground">No matrix readiness metadata was recorded for this draft.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Validation / Publish Readiness</CardTitle>
              <CardDescription>Publish is still handled by the existing PBV2 validation route.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ["Product inactive", review.publishReadiness.productInactive],
                  ["Tree is draft", review.publishReadiness.pbv2TreeDraft],
                  ["Tree published", review.publishReadiness.pbv2TreePublished],
                  ["Active tree assigned", review.publishReadiness.activeTreeAssigned],
                  ["Required options present", review.publishReadiness.requiredOptionsPresent],
                  ["No duplicate size controls", review.publishReadiness.noDuplicateSizeControls],
                  ["Pricing configured", review.publishReadiness.pricingConfigured],
                  ["Material linked", review.publishReadiness.materialLinked],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between rounded border px-3 py-2">
                    <span>{label}</span>
                    <Badge variant={value ? "secondary" : "outline"}>{yesNo(Boolean(value))}</Badge>
                  </div>
                ))}
              </div>
              {findings.length > 0 ? (
                <div className="space-y-2">
                  <div className="font-medium">PBV2 Publish Findings</div>
                  {findings.map((finding) => (
                    <div key={`${finding.code}-${finding.path}-${finding.message}`} className="rounded border p-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={finding.severity === "ERROR" ? "destructive" : "outline"}>{finding.severity}</Badge>
                        <span className="font-medium">{finding.code}</span>
                      </div>
                      <div className="mt-1 text-muted-foreground">{finding.message}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{finding.path}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded border bg-muted/30 p-3 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                  No PBV2 publish errors are currently reported.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Base Pricing</CardTitle>
            <CardDescription>Draft-only PBV2 base pricing. Complex matrix pricing still belongs in the PBV2 builder.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs uppercase text-muted-foreground">Per square foot</span>
                <Input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={basePricingDraft.perSqft}
                  onChange={(event) => setBasePricingDraft((current) => ({ ...current, perSqft: event.target.value }))}
                  disabled={review.pbv2Tree.status !== "DRAFT" || pricingMutation.isPending}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs uppercase text-muted-foreground">Per piece</span>
                <Input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={basePricingDraft.perPiece}
                  onChange={(event) => setBasePricingDraft((current) => ({ ...current, perPiece: event.target.value }))}
                  disabled={review.pbv2Tree.status !== "DRAFT" || pricingMutation.isPending}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs uppercase text-muted-foreground">Minimum charge</span>
                <Input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={basePricingDraft.minimumCharge}
                  onChange={(event) => setBasePricingDraft((current) => ({ ...current, minimumCharge: event.target.value }))}
                  disabled={review.pbv2Tree.status !== "DRAFT" || pricingMutation.isPending}
                />
              </label>
            </div>
            {!review.publishReadiness.pricingConfigured && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Pricing required before publish</AlertTitle>
                <AlertDescription>Enter at least one real base price here or configure pricing in the PBV2 builder.</AlertDescription>
              </Alert>
            )}
            {likelyMatrixPricing && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Matrix pricing review required</AlertTitle>
                <AlertDescription>
                  Product Intake detected {matrixReadiness ? titleFromMatrixType(matrixReadiness.matrixType) : "matrix"} pricing. No matrix rows were generated; configure the pricing matrix in the PBV2 builder before publish.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-muted-foreground">
                Saving updates the inactive PBV2 draft tree only. It does not publish, activate, or assign an active tree.
              </div>
              <Button
                type="button"
                className="gap-2"
                onClick={() => pricingMutation.mutate()}
                disabled={review.pbv2Tree.status !== "DRAFT" || pricingMutation.isPending}
              >
                {pricingMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Save Draft Pricing
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next Actions</CardTitle>
            <CardDescription>Publish and activation remain separate review steps.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {serverWarnings && serverWarnings.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>PBV2 publish has warnings</AlertTitle>
                <AlertDescription>{serverWarnings.map(findingText).join(" ")}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="gap-2">
                <Link to={`/products/${review.product.id}/edit${draftTreeQuery}`}><ExternalLink className="h-4 w-4" /> Open Full Draft Editor</Link>
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <Link to={`/products/${review.product.id}/builder-v2${draftTreeQuery}`}><ExternalLink className="h-4 w-4" /> PBV2-Only Builder</Link>
              </Button>
              <Button type="button" variant="outline" className="gap-2" onClick={() => reviewQuery.refetch()} disabled={reviewQuery.isFetching}>
                {reviewQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Run Validation
              </Button>
              <Button
                type="button"
                className="gap-2"
                onClick={() => publishMutation.mutate({ confirmWarnings: false })}
                disabled={publishMutation.isPending || review.pbv2Tree.status !== "DRAFT"}
              >
                {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Publish PBV2 Draft
              </Button>
              {serverWarnings && serverWarnings.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-2"
                  onClick={() => publishMutation.mutate({ confirmWarnings: true })}
                  disabled={publishMutation.isPending || review.pbv2Tree.status !== "DRAFT"}
                >
                  <Rocket className="h-4 w-4" />
                  Confirm Warnings and Publish
                </Button>
              )}
              <Button
                type="button"
                variant={canActivate ? "default" : "outline"}
                className="gap-2"
                onClick={() => activateMutation.mutate()}
                disabled={!canActivate || activateMutation.isPending}
              >
                {activateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                Activate Product
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">{activateReason}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
