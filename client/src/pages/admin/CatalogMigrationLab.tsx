import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Brain,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { CatalogMigrationLabAnalyzerResult } from "@shared/catalogMigrationLabSchemas";
import { CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES } from "@shared/catalogMigrationLabSchemas";
import type {
  ProductIntakeAnswer,
  ProductIntakeAiDiagnostic,
  ProductIntakeBrief,
  ProductIntakeQuestion,
  ProductIntakeReadiness,
  ProductIntakeSession,
  ProductIntakeSessionDetail,
} from "@shared/productIntakeWizardSchemas";
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
import {
  SAMPLE_INFOFLO_JSON,
  resolveCatalogMigrationAnalyzerSource,
  type AnalyzerSourceKind,
} from "./catalogMigrationLabSource";

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

function ConfidenceBadge({ value }: { value: number }) {
  const variant = value >= 75 ? "default" : value >= 45 ? "outline" : "secondary";
  return <Badge variant={variant}>{value}%</Badge>;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function productNameForSession(session: ProductIntakeSession) {
  return session.brief.productIdentity.likelyProductName.value ?? "Untitled product";
}

function statusVariant(status: ProductIntakeSession["status"]): "default" | "secondary" | "outline" | "destructive" {
  if (status === "ready_for_draft") return "default";
  if (status === "needs_answers") return "outline";
  if (status === "abandoned") return "secondary";
  return "outline";
}

function answerDraftsFromDetail(detail: ProductIntakeSessionDetail | null): Record<string, unknown> {
  if (!detail) return {};
  const byKey = new Map(detail.answers.map((answer) => [answer.questionKey, answer.answer]));
  return Object.fromEntries(detail.questions.map((question) => [
    question.questionKey,
    byKey.has(question.questionKey) ? byKey.get(question.questionKey) : question.defaultValue,
  ]));
}

export function ProductIntakeSessionSummary({ session, readiness }: { session: ProductIntakeSession; readiness: ProductIntakeReadiness }) {
  const originalConfidence = typeof session.confidence?.originalConfidence === "number"
    ? session.confidence.originalConfidence
    : typeof session.confidence?.overallConfidence === "number"
      ? session.confidence.overallConfidence
      : session.brief.overallConfidence;
  const currentConfidence = typeof session.confidence?.currentConfidence === "number"
    ? session.confidence.currentConfidence
    : session.brief.overallConfidence;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Session Summary</CardTitle>
            <CardDescription>{session.id}</CardDescription>
          </div>
          <Badge variant={statusVariant(session.status)}>{session.status.replace(/_/g, " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-6">
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground">Source</div>
          <div className="mt-1 font-medium">{session.sourceType.replace(/_/g, " ")}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground">Created</div>
          <div className="mt-1 font-medium">{formatDateTime(session.createdAt)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground">Original Confidence</div>
          <div className="mt-1"><ConfidenceBadge value={Number(originalConfidence)} /></div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground">Current Confidence</div>
          <div className="mt-1"><ConfidenceBadge value={Number(currentConfidence)} /></div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground">Required Open</div>
          <div className="mt-1 font-medium">{readiness.unansweredRequiredCount}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground">Answered</div>
          <div className="mt-1 font-medium">{readiness.answeredCount}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function renderQuestionInput(args: {
  question: ProductIntakeQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { question, value, onChange } = args;
  if (question.questionType === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        Yes
      </label>
    );
  }
  if (question.questionType === "number") {
    return (
      <input
        type="number"
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={typeof value === "number" ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    );
  }
  if (question.questionType === "select") {
    return (
      <select
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select...</option>
        {(question.options ?? []).map((choice) => (
          <option key={String(choice.value)} value={String(choice.value)}>{choice.label}</option>
        ))}
      </select>
    );
  }
  if (question.questionType === "multiselect") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <select
        multiple
        className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
        value={selected}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}
      >
        {(question.options ?? []).map((choice) => (
          <option key={String(choice.value)} value={String(choice.value)}>{choice.label}</option>
        ))}
      </select>
    );
  }
  return (
    <Textarea
      rows={3}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ProductIntakeQuestionsWizard({
  questions,
  answers,
  readiness,
  answerDrafts,
  onAnswerChange,
  onSave,
  onAbandon,
  isSaving = false,
  isAbandoning = false,
}: {
  questions: ProductIntakeQuestion[];
  answers: ProductIntakeAnswer[];
  readiness: ProductIntakeReadiness;
  answerDrafts: Record<string, unknown>;
  onAnswerChange: (questionKey: string, value: unknown) => void;
  onSave: () => void;
  onAbandon: () => void;
  isSaving?: boolean;
  isAbandoning?: boolean;
}) {
  const answeredKeys = new Set(answers.filter((answer) => answer.answer != null).map((answer) => answer.questionKey));
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Missing Decisions Wizard</CardTitle>
            <CardDescription>{readiness.unansweredRequiredCount} required unanswered; {readiness.answeredCount} answered.</CardDescription>
          </div>
          <Badge variant={statusVariant(readiness.status)}>{readiness.status.replace(/_/g, " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {questions.length === 0 ? (
          <div className="text-sm text-muted-foreground">No follow-up questions were generated.</div>
        ) : questions.map((question) => (
          <div key={question.id} className="rounded border p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-medium">{question.label}</div>
              <div className="flex flex-wrap items-center gap-2">
                {question.required && <Badge variant="outline">Required</Badge>}
                {answeredKeys.has(question.questionKey) && <Badge variant="secondary">Saved</Badge>}
                {question.confidence != null && <ConfidenceBadge value={question.confidence} />}
              </div>
            </div>
            {question.helpText && <div className="mt-1 text-xs text-muted-foreground">{question.helpText}</div>}
            {question.sourcePath && <div className="mt-2 font-mono text-xs text-muted-foreground">{question.sourcePath}</div>}
            <div className="mt-3">{renderQuestionInput({
              question,
              value: answerDrafts[question.questionKey],
              onChange: (value) => onAnswerChange(question.questionKey, value),
            })}</div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-sm text-muted-foreground">
            {readiness.status === "ready_for_draft" ? "Ready for Phase 3 draft generation." : "Answer required questions to reach draft readiness."}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {readiness.status === "ready_for_draft" && (
              <Button type="button" variant="outline" disabled>Create TEMP Draft Coming in Phase 3</Button>
            )}
            <Button type="button" variant="outline" onClick={onAbandon} disabled={isAbandoning}>
              {isAbandoning ? "Marking..." : "Mark Abandoned"}
            </Button>
            <Button type="button" onClick={onSave} disabled={questions.length === 0 || isSaving}>
              {isSaving ? "Saving..." : "Save Answers"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProductIntakeSessionsList({
  sessions,
  onOpen,
  isLoading = false,
}: {
  sessions: ProductIntakeSession[];
  onOpen: (sessionId: string) => void;
  isLoading?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Intake Sessions</CardTitle>
        <CardDescription>Review saved Product Intake Brief sessions for this organization.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Created</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <EmptyRow colSpan={6} text="Loading intake sessions..." /> : sessions.length === 0 ? <EmptyRow colSpan={6} text="No intake sessions yet." /> : sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell className="font-medium">{productNameForSession(session)}</TableCell>
                <TableCell><Badge variant={statusVariant(session.status)}>{session.status.replace(/_/g, " ")}</Badge></TableCell>
                <TableCell>{session.sourceType.replace(/_/g, " ")}</TableCell>
                <TableCell><ConfidenceBadge value={session.brief.overallConfidence} /></TableCell>
                <TableCell>{formatDateTime(session.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="outline" size="sm" onClick={() => onOpen(session.id)}>Open</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function ProductIntakeAiDiagnosticsPanel({
  diagnostics,
  isLoading = false,
}: {
  diagnostics: ProductIntakeAiDiagnostic[];
  isLoading?: boolean;
}) {
  return (
    <Card className="border-amber-500/20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">AI Intake Diagnostics</CardTitle>
            <CardDescription>Admin-only schema validation failures from Product Intake AI.</CardDescription>
          </div>
          <Badge variant="outline">Admin only</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading AI diagnostics...</div>
        ) : diagnostics.length === 0 ? (
          <div className="text-sm text-muted-foreground">No Product Intake AI schema validation failures recorded.</div>
        ) : diagnostics.map((diagnostic) => (
          <div key={diagnostic.id} className="rounded border p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-medium">{diagnostic.provider ?? "Unknown provider"} / {diagnostic.model ?? "Unknown model"}</div>
              <div className="text-xs text-muted-foreground">{formatDateTime(diagnostic.createdAt)}</div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{diagnostic.sourceType.replace(/_/g, " ")}</Badge>
              {diagnostic.sessionId && <Badge variant="outline">Session {diagnostic.sessionId.slice(0, 8)}</Badge>}
              {diagnostic.promptVersion && <Badge variant="secondary">{diagnostic.promptVersion}</Badge>}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Failed Schema Paths</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {diagnostic.failedSchemaPaths.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No paths captured.</span>
                  ) : diagnostic.failedSchemaPaths.map((path) => (
                    <Badge key={path} variant="outline" className="font-mono">{path}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Validation Errors</div>
                <div className="mt-2 max-h-32 overflow-auto rounded bg-muted/30 p-2 text-xs">
                  {diagnostic.validationErrors.map((error, index) => (
                    <div key={`${error.path}-${index}`}>
                      <span className="font-mono">{error.path || "$"}</span>: {error.message}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {diagnostic.repairActions.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">Repair Actions</div>
                <div className="mt-2 rounded bg-muted/30 p-2 text-xs">
                  {diagnostic.repairActions.map((action, index) => (
                    <div key={`${action.path}-${index}`}>{repairActionText(action)}</div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3">
              <div className="text-xs font-medium uppercase text-muted-foreground">Raw AI Response</div>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 text-xs">{diagnostic.rawAiResponse}</pre>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EvidenceList({ evidence }: { evidence: ProductIntakeBrief["sourceEvidence"] }) {
  if (evidence.length === 0) return <div className="text-sm text-muted-foreground">No source-path evidence.</div>;
  return (
    <div className="space-y-2">
      {evidence.slice(0, 6).map((item, index) => (
        <div key={`${item.sourcePath}-${index}`} className="rounded border bg-muted/30 p-2 text-xs">
          <div className="font-medium">{item.label}</div>
          <div className="font-mono text-muted-foreground">{item.sourcePath}</div>
          {item.value && <div className="mt-1">{item.value}</div>}
          <div className="mt-1 text-muted-foreground">{item.reason}</div>
        </div>
      ))}
    </div>
  );
}

function repairActionText(action: ProductIntakeAiDiagnostic["repairActions"][number]) {
  return `${action.path}: ${action.reason}${action.confidenceImpact ? ` (${action.confidenceImpact})` : ""}`;
}

function IntakeBriefView({ brief }: { brief: ProductIntakeBrief }) {
  const sourceHint = brief.aiRepair?.accepted
    ? "Live AI repaired"
    : brief.source === "live_ai"
      ? "Live AI"
      : "Analyzer fallback";
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Confidence" value={`${brief.overallConfidence}%`} hint={sourceHint} />
        <SummaryCard label="Required Options" value={brief.requiredOptions.length} />
        <SummaryCard label="Missing Decisions" value={brief.missingDecisions.length} />
        <SummaryCard label="Redundant Fields" value={brief.redundantFields.length} />
      </div>

      {brief.aiRepair?.accepted && (
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardHeader>
            <CardTitle className="text-base">AI Repair Notes</CardTitle>
            <CardDescription>Live AI response repaired and accepted. {brief.aiRepair.actions.length} field(s) normalized.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {brief.aiRepair.actions.slice(0, 8).map((action, index) => (
              <div key={`${action.path}-${index}`} className="rounded border bg-background/60 p-2">
                <div className="font-mono">{action.path}</div>
                <div className="mt-1 text-muted-foreground">{action.reason}</div>
                {action.confidenceImpact && <div className="mt-1">{action.confidenceImpact}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {brief.fallbackReason && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
            <div>{brief.fallbackReason}</div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Product Summary</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Name</div>
                <div className="font-medium">{brief.productIdentity.likelyProductName.value ?? "-"}</div>
              </div>
              <ConfidenceBadge value={brief.productIdentity.likelyProductName.confidence} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Category</div>
                <div className="font-medium">{brief.productIdentity.category.value ?? "-"}</div>
              </div>
              <ConfidenceBadge value={brief.productIdentity.category.confidence} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Product Type</div>
                <div className="font-medium">{brief.productIdentity.productType.value ?? "-"}</div>
              </div>
              <ConfidenceBadge value={brief.productIdentity.productType.confidence} />
            </div>
            <EvidenceList evidence={brief.sourceEvidence} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Behavior</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {[
              ["Size", brief.sizeBehavior],
              ["Quantity", brief.quantityBehavior],
              ["Pricing", brief.pricingAnalysis],
            ].map(([label, behavior]) => (
              <div key={String(label)} className="rounded border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">{String(label)}</div>
                    <div className="font-medium">{(behavior as any).behavior.replace(/_/g, " ")}</div>
                  </div>
                  <ConfidenceBadge value={(behavior as any).confidence} />
                </div>
                {(behavior as any).notes && <div className="mt-2 text-xs text-muted-foreground">{(behavior as any).notes}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detected Material</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brief.materialAnalysis.likelyMaterialMatches.length === 0 ? <EmptyRow colSpan={4} text="No material match found." /> : brief.materialAnalysis.likelyMaterialMatches.map((material) => (
                <TableRow key={`${material.materialId ?? material.name}-${material.name}`}>
                  <TableCell>{material.name}</TableCell>
                  <TableCell>{material.materialId ?? "Review required"}</TableCell>
                  <TableCell>{material.sku ?? "-"}</TableCell>
                  <TableCell><ConfidenceBadge value={material.confidence} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {[
          ["Required Options", brief.requiredOptions],
          ["Optional Options", brief.optionalOptions],
        ].map(([title, options]) => (
          <Card key={String(title)}>
            <CardHeader><CardTitle className="text-base">{String(title)}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(options as ProductIntakeBrief["requiredOptions"]).length === 0 ? (
                <div className="text-sm text-muted-foreground">No options detected.</div>
              ) : (options as ProductIntakeBrief["requiredOptions"]).map((option) => (
                <div key={`${title}-${option.normalizedGroup}`} className="rounded border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{option.normalizedGroup}</div>
                    <ConfidenceBadge value={option.confidence} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{option.sampleValues.join(", ") || "No sample values"}</div>
                  {option.templateMatches.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {option.templateMatches.map((match) => (
                        <Badge key={match.templateId} variant={match.recommendation === "suggest_reuse" ? "default" : "outline"}>
                          {match.name} {Math.round(match.score * 100)}%
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Suggested Template Matches</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead>Signals</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brief.templateMatches.length === 0 ? <EmptyRow colSpan={5} text="No template matches above review threshold." /> : brief.templateMatches.map((match) => (
                <TableRow key={match.templateId}>
                  <TableCell className="font-medium">{match.name}</TableCell>
                  <TableCell>{match.category}</TableCell>
                  <TableCell>{Math.round(match.score * 100)}%</TableCell>
                  <TableCell><Badge variant={match.recommendation === "suggest_reuse" ? "default" : "outline"}>{match.recommendation.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="max-w-md truncate">{match.matchedSignals.join(", ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Missing Decisions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {brief.missingDecisions.length === 0 ? <div className="text-sm text-muted-foreground">No missing decisions detected.</div> : brief.missingDecisions.map((decision) => (
              <div key={decision.id} className="rounded border p-3 text-sm">
                <Badge variant={decision.severity === "blocker" ? "destructive" : "outline"}>{decision.severity}</Badge>
                <div className="mt-2 font-medium">{decision.question}</div>
                <div className="mt-1 text-xs text-muted-foreground">{decision.reason}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Redundant Fields</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {brief.redundantFields.length === 0 ? <div className="text-sm text-muted-foreground">No likely redundant fields detected.</div> : brief.redundantFields.slice(0, 12).map((field) => (
              <div key={`${field.sourcePath}-${field.fieldLabel}`} className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{field.fieldLabel}</div>
                  <ConfidenceBadge value={field.confidence} />
                </div>
                <Badge className="mt-2" variant="outline">{field.category.replace(/_/g, " ")}</Badge>
                <div className="mt-2 font-mono text-xs text-muted-foreground">{field.sourcePath}</div>
                <div className="mt-1 text-xs text-muted-foreground">{field.reason}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Warnings</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {brief.draftWarnings.length === 0 ? <div className="text-sm text-muted-foreground">No warnings detected.</div> : brief.draftWarnings.slice(0, 12).map((warning) => (
              <div key={`${warning.code}-${warning.message}`} className="rounded border p-3 text-sm">
                <Badge variant={warning.severity === "warning" ? "destructive" : "outline"}>{warning.code}</Badge>
                <div className="mt-2 text-xs text-muted-foreground">{warning.message}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function CatalogMigrationLab() {
  const { toast } = useToast();
  const { user, isLoading } = useAuth();
  const [uploadedJsonText, setUploadedJsonText] = useState("");
  const [pastedJsonText, setPastedJsonText] = useState("");
  const [sampleJsonText, setSampleJsonText] = useState("");
  const [activeSource, setActiveSource] = useState<AnalyzerSourceKind | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CatalogMigrationLabAnalyzerResult | null>(null);
  const [productDescription, setProductDescription] = useState("");
  const [intakeBrief, setIntakeBrief] = useState<ProductIntakeBrief | null>(null);
  const [intakeSessionDetail, setIntakeSessionDetail] = useState<ProductIntakeSessionDetail | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, unknown>>({});
  const [warningSeverityFilter, setWarningSeverityFilter] = useState<"all" | "blocker" | "warning" | "info">("all");
  const [warningProductFilter, setWarningProductFilter] = useState("all");
  const [warningCodeFilter, setWarningCodeFilter] = useState("all");
  const [migrationSort, setMigrationSort] = useState<"confidence" | "category" | "template" | "routing" | "complexity">("confidence");
  const [analysisTab, setAnalysisTab] = useState("overview");
  const canAccessPlatformTools = canUsePlatformTools(user);

  const analyzerSource = useMemo(
    () => resolveCatalogMigrationAnalyzerSource({ activeSource, uploadedJsonText, pastedJsonText, sampleJsonText }),
    [activeSource, pastedJsonText, sampleJsonText, uploadedJsonText],
  );
  const availableSourceCount = [uploadedJsonText, pastedJsonText, sampleJsonText].filter((text) => text.trim().length > 0).length;
  const sourceBytes = useMemo(() => new Blob([analyzerSource.text]).size, [analyzerSource.text]);
  const oversized = sourceBytes > CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES;
  const parsedFieldCount = useMemo(
    () => analysis?.products.reduce((count, product) => count + product.sourceFields.length, 0) ?? 0,
    [analysis],
  );
  const filteredWarnings = useMemo(() => {
    if (!analysis) return [];
    return analysis.warnings.filter((warning) => {
      if (warningSeverityFilter !== "all" && warning.severity !== warningSeverityFilter) return false;
      if (warningProductFilter !== "all" && (warning.productName ?? "-") !== warningProductFilter) return false;
      if (warningCodeFilter !== "all" && warning.code !== warningCodeFilter) return false;
      return true;
    });
  }, [analysis, warningCodeFilter, warningProductFilter, warningSeverityFilter]);
  const warningProducts = useMemo(
    () => Array.from(new Set((analysis?.warnings ?? []).map((warning) => warning.productName ?? "-"))).sort((a, b) => a.localeCompare(b)),
    [analysis],
  );
  const warningCodes = useMemo(
    () => Array.from(new Set((analysis?.warnings ?? []).map((warning) => warning.code))).sort((a, b) => a.localeCompare(b)),
    [analysis],
  );
  const sortedMigrationReadiness = useMemo(() => {
    const rows = [...(analysis?.migrationReadiness ?? [])];
    return rows.sort((a, b) => {
      if (migrationSort === "confidence") return b.migrationConfidence - a.migrationConfidence || a.sourceProductName.localeCompare(b.sourceProductName);
      if (migrationSort === "complexity") return b.complexityScore - a.complexityScore || a.sourceProductName.localeCompare(b.sourceProductName);
      if (migrationSort === "category") return String(a.suggestedCategory ?? "").localeCompare(String(b.suggestedCategory ?? "")) || a.sourceProductName.localeCompare(b.sourceProductName);
      if (migrationSort === "template") return String(a.suggestedProductTemplate ?? "").localeCompare(String(b.suggestedProductTemplate ?? "")) || a.sourceProductName.localeCompare(b.sourceProductName);
      return String(a.suggestedRoutingTemplate ?? "").localeCompare(String(b.suggestedRoutingTemplate ?? "")) || a.sourceProductName.localeCompare(b.sourceProductName);
    });
  }, [analysis, migrationSort]);
  const readinessCounts = useMemo(() => {
    const counts = { Ready: 0, "Needs Review": 0, Complex: 0, "Manual Build Recommended": 0 };
    for (const row of analysis?.migrationReadiness ?? []) counts[row.readyForImport] += 1;
    return counts;
  }, [analysis]);
  const sessionsQuery = useQuery({
    queryKey: ["/api/admin/product-intake-wizard/sessions"],
    enabled: canAccessPlatformTools && !isLoading,
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/product-intake-wizard/sessions");
      const json = await response.json();
      if (!json?.success) throw new Error(json?.message ?? "Failed to load intake sessions");
      return json.data.sessions as ProductIntakeSession[];
    },
  });
  const diagnosticsQuery = useQuery({
    queryKey: ["/api/admin/product-intake-wizard/ai-diagnostics", intakeSessionDetail?.session.id ?? null],
    enabled: canAccessPlatformTools && !isLoading,
    queryFn: async () => {
      const query = intakeSessionDetail?.session.id ? `?sessionId=${encodeURIComponent(intakeSessionDetail.session.id)}` : "";
      const response = await apiRequest("GET", `/api/admin/product-intake-wizard/ai-diagnostics${query}`);
      const json = await response.json();
      if (!json?.success) throw new Error(json?.message ?? "Failed to load intake diagnostics");
      return json.data.diagnostics as ProductIntakeAiDiagnostic[];
    },
  });

  useEffect(() => {
    setAnswerDrafts(answerDraftsFromDetail(intakeSessionDetail));
  }, [intakeSessionDetail]);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/catalog-migration-lab/analyze", {
        adapter: "infoflo-json",
        fileName: analyzerSource.kind === "upload" ? fileName ?? undefined : analyzerSource.kind === "sample" ? "sample-infoflo.json" : undefined,
        jsonText: analyzerSource.text,
      });
      const json = await response.json();
      if (!json?.success) throw new Error(json?.message ?? "Analysis failed");
      return json.data as CatalogMigrationLabAnalyzerResult;
    },
    onSuccess: (result) => {
      setAnalysis(result);
      setWarningSeverityFilter("all");
      setWarningProductFilter("all");
      setWarningCodeFilter("all");
      setMigrationSort("confidence");
      setAnalysisTab("overview");
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

  const intakeMutation = useMutation({
    mutationFn: async () => {
      const hasJsonSource = analyzerSource.text.trim().length > 0;
      const response = await apiRequest("POST", "/api/admin/product-intake-wizard/analyze", hasJsonSource ? {
        sourceType: analyzerSource.kind === "upload" ? "uploaded_json" : "pasted_json",
        fileName: analyzerSource.kind === "upload" ? fileName ?? undefined : analyzerSource.kind === "sample" ? "sample-infoflo.json" : undefined,
        jsonText: analyzerSource.text,
        description: productDescription.trim() || undefined,
      } : {
        sourceType: "text_description",
        description: productDescription,
      });
      const json = await response.json();
      if (!json?.success) throw new Error(json?.message ?? "Product Intake Brief failed");
      return json.data as {
        analyzer: CatalogMigrationLabAnalyzerResult | null;
        brief: ProductIntakeBrief;
        session?: ProductIntakeSession;
        questions?: ProductIntakeQuestion[];
        answers?: ProductIntakeAnswer[];
        readiness?: ProductIntakeReadiness;
      };
    },
    onSuccess: (result) => {
      setIntakeBrief(result.brief);
      if (result.session && result.questions && result.answers && result.readiness) {
        setIntakeSessionDetail({
          session: result.session,
          brief: result.brief,
          questions: result.questions,
          answers: result.answers,
          readiness: result.readiness,
        });
        setAnalysisTab("intake-brief");
        void sessionsQuery.refetch();
      }
      if (result.analyzer) {
        setAnalysis(result.analyzer);
        setWarningSeverityFilter("all");
        setWarningProductFilter("all");
        setWarningCodeFilter("all");
        setMigrationSort("confidence");
      }
      toast({
        title: "Product Intake Brief ready",
        description: "No products, PBV2 trees, or catalog records were created.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Product Intake Brief failed",
        description: error?.message ?? "The intake brief could not be generated.",
        variant: "destructive",
      });
    },
  });

  const openSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await apiRequest("GET", `/api/admin/product-intake-wizard/sessions/${sessionId}`);
      const json = await response.json();
      if (!json?.success) throw new Error(json?.message ?? "Failed to open intake session");
      return json.data as ProductIntakeSessionDetail;
    },
    onSuccess: (detail) => {
      setIntakeSessionDetail(detail);
      setIntakeBrief(detail.brief);
      setAnalysisTab("intake-brief");
      toast({
        title: "Product Intake session opened",
        description: `${detail.questions.length} follow-up question(s) loaded.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Session open failed",
        description: error?.message ?? "The intake session could not be opened.",
        variant: "destructive",
      });
    },
  });

  const saveAnswersMutation = useMutation({
    mutationFn: async () => {
      if (!intakeSessionDetail) throw new Error("No intake session is selected.");
      const response = await apiRequest("PATCH", `/api/admin/product-intake-wizard/sessions/${intakeSessionDetail.session.id}/answers`, {
        answers: intakeSessionDetail.questions.map((question) => ({
          questionId: question.id,
          questionKey: question.questionKey,
          answer: answerDrafts[question.questionKey] ?? null,
        })),
      });
      const json = await response.json();
      if (!json?.success) throw new Error(json?.message ?? "Failed to save answers");
      return json.data as ProductIntakeSessionDetail;
    },
    onSuccess: (detail) => {
      setIntakeSessionDetail(detail);
      setIntakeBrief(detail.brief);
      void sessionsQuery.refetch();
      toast({
        title: "Answers saved",
        description: detail.readiness.status === "ready_for_draft" ? "Session is ready for Phase 3 draft generation." : "Required follow-up answers are still open.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Answer save failed",
        description: error?.message ?? "Product Intake answers could not be saved.",
        variant: "destructive",
      });
    },
  });

  const abandonSessionMutation = useMutation({
    mutationFn: async () => {
      if (!intakeSessionDetail) throw new Error("No intake session is selected.");
      const response = await apiRequest("POST", `/api/admin/product-intake-wizard/sessions/${intakeSessionDetail.session.id}/abandon`);
      const json = await response.json();
      if (!json?.success) throw new Error(json?.message ?? "Failed to abandon session");
      return json.data as ProductIntakeSessionDetail;
    },
    onSuccess: (detail) => {
      setIntakeSessionDetail(detail);
      setIntakeBrief(detail.brief);
      void sessionsQuery.refetch();
      toast({
        title: "Session abandoned",
        description: "No products, PBV2 trees, or catalog records were changed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Abandon failed",
        description: error?.message ?? "The intake session could not be abandoned.",
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
    setUploadedJsonText(await file.text());
    setActiveSource("upload");
    setAnalysis(null);
    setIntakeSessionDetail(null);
    setIntakeBrief(null);
  };

  const canAnalyze = analyzerSource.text.trim().length > 0 && !oversized && !analyzeMutation.isPending;
  const canGenerateIntake = (analyzerSource.text.trim().length > 0 || productDescription.trim().length > 0) && !oversized && !intakeMutation.isPending;

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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSampleJsonText(SAMPLE_INFOFLO_JSON);
                setActiveSource("sample");
                setAnalysis(null);
              }}
            >
              Load sample JSON
            </Button>
          </div>

          <div className="rounded border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Analyzer Source</div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={analyzerSource.kind === "upload" ? "default" : "outline"}
                disabled={uploadedJsonText.trim().length === 0}
                onClick={() => setActiveSource("upload")}
              >
                Uploaded file
              </Button>
              <Button
                type="button"
                size="sm"
                variant={analyzerSource.kind === "paste" ? "default" : "outline"}
                disabled={pastedJsonText.trim().length === 0}
                onClick={() => setActiveSource("paste")}
              >
                Pasted JSON
              </Button>
              <Button
                type="button"
                size="sm"
                variant={analyzerSource.kind === "sample" ? "default" : "outline"}
                disabled={sampleJsonText.trim().length === 0}
                onClick={() => setActiveSource("sample")}
              >
                Sample JSON
              </Button>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {analyzerSource.kind
                ? `Run Analyzer will use ${analyzerSource.label}${analyzerSource.kind === "upload" && fileName ? ` from ${fileName}` : ""}.`
                : "Upload a file, paste JSON, or load the sample JSON to choose an analyzer source."}
              {availableSourceCount > 1 && " Multiple sources are available; select the one to analyze above."}
            </div>
          </div>

          <Textarea
            value={pastedJsonText}
            onChange={(event) => {
              setPastedJsonText(event.target.value);
              if (event.target.value.trim().length > 0) setActiveSource("paste");
              setAnalysis(null);
            }}
            rows={10}
            placeholder="Paste InfoFlo JSON here, or upload a file above."
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4" />
            Product Intake Brief
          </CardTitle>
          <CardDescription>
            Converts the active JSON source or a short product description into a saved review session with follow-up questions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={productDescription}
            onChange={(event) => setProductDescription(event.target.value)}
            rows={4}
            placeholder="Foam board signs with optional grommets"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button className="gap-2" disabled={!canGenerateIntake} onClick={() => intakeMutation.mutate()}>
              {intakeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              {intakeMutation.isPending ? "Generating..." : "Generate Intake Brief"}
            </Button>
            <Badge variant="outline">Read-only</Badge>
            <Badge variant="secondary">Questions only</Badge>
          </div>
        </CardContent>
      </Card>

      <ProductIntakeSessionsList
        sessions={sessionsQuery.data ?? []}
        isLoading={sessionsQuery.isLoading || openSessionMutation.isPending}
        onOpen={(sessionId) => openSessionMutation.mutate(sessionId)}
      />

      {canAccessPlatformTools && (
        <ProductIntakeAiDiagnosticsPanel
          diagnostics={diagnosticsQuery.data ?? []}
          isLoading={diagnosticsQuery.isLoading}
        />
      )}

      {intakeBrief && !analysis && (
        <div className="space-y-6">
          {intakeSessionDetail && (
            <>
              <ProductIntakeSessionSummary session={intakeSessionDetail.session} readiness={intakeSessionDetail.readiness} />
              <ProductIntakeQuestionsWizard
                questions={intakeSessionDetail.questions}
                answers={intakeSessionDetail.answers}
                readiness={intakeSessionDetail.readiness}
                answerDrafts={answerDrafts}
                onAnswerChange={(questionKey, value) => setAnswerDrafts((current) => ({ ...current, [questionKey]: value }))}
                onSave={() => saveAnswersMutation.mutate()}
                onAbandon={() => abandonSessionMutation.mutate()}
                isSaving={saveAnswersMutation.isPending}
                isAbandoning={abandonSessionMutation.isPending}
              />
            </>
          )}
          <IntakeBriefView brief={intakeBrief} />
        </div>
      )}

      {analysis && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Products" value={analysis.counts.totalProducts} hint="Detected source records" />
            <SummaryCard label="Parsed Fields" value={parsedFieldCount} hint="InfoFlo structure rows" />
            <SummaryCard label="Warning Count" value={analysis.warningCounts.actionable} hint="Blockers + warnings only" />
            <SummaryCard label="Blockers" value={analysis.warningCounts.blockers} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Info Notices" value={analysis.warningCounts.info} hint="Visible below, not counted as problems" />
            <SummaryCard label="Active" value={analysis.counts.activeProducts} />
            <SummaryCard label="Inactive" value={analysis.counts.inactiveProducts} />
            <SummaryCard label="Fingerprint" value={analysis.source.fingerprint.slice(0, 12)} />
          </div>

          <Tabs value={analysisTab} onValueChange={setAnalysisTab} className="space-y-4">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="migration-planning">Migration Planning</TabsTrigger>
              <TabsTrigger value="structures">Product Structures</TabsTrigger>
              {intakeBrief && <TabsTrigger value="intake-brief">Product Intake Brief</TabsTrigger>}
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
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Product Definition Metadata</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">product_index: {analysis.source.productDefinitionMetadata.productIndexFieldCount}</Badge>
                  <Badge variant="outline">dropdowns: {analysis.source.productDefinitionMetadata.dropdownCount}</Badge>
                  <Badge variant="outline">conditional dropdowns: {analysis.source.productDefinitionMetadata.conditionalDropdownCount}</Badge>
                  <Badge variant="outline">total fields: {analysis.source.productDefinitionMetadata.totalFields}</Badge>
                  <Badge variant="outline">conditional fields: {analysis.source.productDefinitionMetadata.totalConditionalFields}</Badge>
                  <Badge variant="outline">has conditionals: {analysis.source.productDefinitionMetadata.hasConditionalFields ? "yes" : "no"}</Badge>
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
            <CardHeader>
              <CardTitle className="text-base">Warnings And Info Notices</CardTitle>
              <CardDescription>
                Blockers and warnings count as actionable problems. Info notices are retained separately for migration review.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-auto">
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <select
                  value={warningSeverityFilter}
                  onChange={(event) => setWarningSeverityFilter(event.target.value as any)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  aria-label="Filter warnings by severity"
                >
                  <option value="all">All severities</option>
                  <option value="blocker">Blockers</option>
                  <option value="warning">Warnings</option>
                  <option value="info">Info</option>
                </select>
                <select
                  value={warningProductFilter}
                  onChange={(event) => setWarningProductFilter(event.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  aria-label="Filter warnings by product"
                >
                  <option value="all">All products</option>
                  {warningProducts.map((product) => <option key={product} value={product}>{product}</option>)}
                </select>
                <select
                  value={warningCodeFilter}
                  onChange={(event) => setWarningCodeFilter(event.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  aria-label="Filter warnings by code"
                >
                  <option value="all">All codes</option>
                  {warningCodes.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Occurrences</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWarnings.length === 0 ? <EmptyRow colSpan={5} text="No warnings match the current filters." /> : filteredWarnings.map((warning, index) => (
                    <TableRow key={`${warning.code}-${index}`}>
                      <TableCell><Badge variant={warning.severity === "blocker" ? "destructive" : "outline"}>{warning.severity}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{warning.code}</TableCell>
                      <TableCell>{warning.productName ?? "-"}</TableCell>
                      <TableCell>{warning.occurrences ?? warning.count ?? 1}</TableCell>
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

            {intakeBrief && (
              <TabsContent value="intake-brief" className="space-y-6">
                {intakeSessionDetail && (
                  <>
                    <ProductIntakeSessionSummary session={intakeSessionDetail.session} readiness={intakeSessionDetail.readiness} />
                    <ProductIntakeQuestionsWizard
                      questions={intakeSessionDetail.questions}
                      answers={intakeSessionDetail.answers}
                      readiness={intakeSessionDetail.readiness}
                      answerDrafts={answerDrafts}
                      onAnswerChange={(questionKey, value) => setAnswerDrafts((current) => ({ ...current, [questionKey]: value }))}
                      onSave={() => saveAnswersMutation.mutate()}
                      onAbandon={() => abandonSessionMutation.mutate()}
                      isSaving={saveAnswersMutation.isPending}
                      isAbandoning={abandonSessionMutation.isPending}
                    />
                  </>
                )}
                <IntakeBriefView brief={intakeBrief} />
              </TabsContent>
            )}

            <TabsContent value="migration-planning" className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryCard label="Products" value={analysis.migrationReadiness.length} />
                <SummaryCard label="Ready" value={readinessCounts.Ready} />
                <SummaryCard label="Needs Review" value={readinessCounts["Needs Review"]} />
                <SummaryCard label="Complex" value={readinessCounts.Complex} />
                <SummaryCard label="Manual Build" value={readinessCounts["Manual Build Recommended"]} />
              </div>

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Migration Planning</CardTitle>
                      <CardDescription>
                        Product-level worksheet suggestions for human review. Read-only; no mappings or products are created.
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={migrationSort}
                        onChange={(event) => setMigrationSort(event.target.value as any)}
                        className="h-9 rounded-md border bg-background px-3 text-sm"
                        aria-label="Sort migration planning rows"
                      >
                        <option value="confidence">Migration Confidence</option>
                        <option value="category">Category</option>
                        <option value="template">Template</option>
                        <option value="routing">Routing</option>
                        <option value="complexity">Complexity</option>
                      </select>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => downloadText(analysis.migrationWorksheets.catalogMigrationWorksheet, "Catalog Migration Worksheet.csv")}
                      >
                        <Download className="h-4 w-4" />
                        Export Worksheet
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Template</TableHead>
                        <TableHead>Routing</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Options</TableHead>
                        <TableHead>Complexity</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedMigrationReadiness.length === 0 ? <EmptyRow colSpan={10} text="No migration planning rows found." /> : sortedMigrationReadiness.map((row) => (
                        <TableRow key={`${row.sourceProductName}-${row.suggestedProductTemplate ?? "template"}`}>
                          <TableCell className="font-medium">{row.sourceProductName}</TableCell>
                          <TableCell>
                            <div>{row.suggestedCategory ?? "-"}</div>
                            <div className="text-xs text-muted-foreground">{row.categoryConfidence}</div>
                          </TableCell>
                          <TableCell>
                            <div>{row.suggestedProductTemplate ?? "-"}</div>
                            <div className="text-xs text-muted-foreground">{row.templateConfidence}</div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-xs truncate">{row.suggestedRoutingTemplate ?? "-"}</div>
                            <div className="text-xs text-muted-foreground">{row.routingConfidence}</div>
                          </TableCell>
                          <TableCell>
                            <div>{row.suggestedMaterial ?? "-"}</div>
                            <div className="text-xs text-muted-foreground">{row.materialMatchConfidence}</div>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">{row.detectedOptionGroups.join(", ") || "-"}</TableCell>
                          <TableCell>{row.complexityScore}</TableCell>
                          <TableCell>{row.migrationConfidence}</TableCell>
                          <TableCell><Badge variant={row.readyForImport === "Ready" ? "default" : "outline"}>{row.readyForImport}</Badge></TableCell>
                          <TableCell className="max-w-md truncate">{row.migrationNotes || "-"}</TableCell>
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
                        <TableHead>Suggested Category</TableHead>
                        <TableHead>Confidence</TableHead>
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
                      {analysis.productStructures.length === 0 ? <EmptyRow colSpan={12} text="No product structures found." /> : analysis.productStructures.map((product) => (
                        <TableRow key={product.productName}>
                          <TableCell className="font-medium">{product.productName}</TableCell>
                          <TableCell>{product.productType ?? "-"}</TableCell>
                          <TableCell>{product.suggestedCategory ?? "-"}</TableCell>
                          <TableCell>{product.categoryConfidence}</TableCell>
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
                        <TableHead>Normalized</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead>Option</TableHead>
                        <TableHead>Parent</TableHead>
                        <TableHead>Level</TableHead>
                        <TableHead>Group</TableHead>
                        <TableHead>Signals</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.products.flatMap((product) => product.sourceFields).length === 0 ? <EmptyRow colSpan={10} text="No InfoFlo form fields found." /> : analysis.products.flatMap((product) => product.sourceFields).map((field) => (
                        <TableRow key={field.analyzerId}>
                          <TableCell className="font-medium">{field.productName}</TableCell>
                          <TableCell>{field.fieldLabel}</TableCell>
                          <TableCell>{field.normalizedFieldLabel}</TableCell>
                          <TableCell>{field.fieldType}</TableCell>
                          <TableCell>{field.required ? "Yes" : "No"}</TableCell>
                          <TableCell>{field.optionText ?? "-"}</TableCell>
                          <TableCell>{field.parentField ? `${field.parentField}${field.parentOption ? `: ${field.parentOption}` : ""}` : "-"}</TableCell>
                          <TableCell>{field.level}</TableCell>
                          <TableCell>{field.normalizedGroup}</TableCell>
                          <TableCell className="space-x-1">
                            {field.isQuantityCandidate && <Badge variant="outline">Quantity</Badge>}
                            {field.isCustomerMetadata && <Badge variant="outline">Customer</Badge>}
                            {field.isPricingSignal && <Badge variant="outline">Pricing</Badge>}
                            {!field.isQuantityCandidate && !field.isCustomerMetadata && !field.isPricingSignal ? "-" : null}
                          </TableCell>
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
                <CardContent className="grid gap-4 md:grid-cols-4">
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() => downloadText(analysis.migrationWorksheets.catalogMigrationWorksheet, "Catalog Migration Worksheet.csv")}
                  >
                    <Download className="h-4 w-4" />
                    Catalog Migration Worksheet
                  </Button>
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
