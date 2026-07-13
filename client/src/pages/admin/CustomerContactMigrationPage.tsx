import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, DatabaseZap, Download, PlayCircle, RefreshCw, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import { canUsePlatformTools } from "@/lib/platformAccess";
import {
  createCustomerContactMigrationBatch,
  customerContactMigrationReportUrl,
  finalizeCustomerContactMigrationBatch,
  getCustomerContactMigrationBatch,
  getCustomerContactMigrationQuickBooksSourceStatus,
  listCustomerContactMigrationBatches,
  listPlatformSeedOrganizations,
  retrieveCustomerContactMigrationQuickBooksSource,
  saveCustomerContactMigrationReviewDecision,
  uploadCustomerContactMigrationQuickBooksSource,
  type CustomerContactMigrationBatch,
  type CustomerContactMigrationBatchDetail,
  type CustomerContactQuickBooksSourceSnapshot,
  type CustomerContactQuickBooksSourceStatus,
  type PlatformSeedOrganization,
} from "@/lib/api/platform";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const reportKinds = [
  "completed-mappings",
  "exceptions",
  "rejected-records",
  "conflicts",
  "failed-records",
];

async function readFileText(file: File | null): Promise<string> {
  if (!file) return "";
  return file.text();
}

function countRows(rows: Array<Record<string, any>>, statuses: string[]) {
  return rows.filter((row) => statuses.includes(String(row.status))).length;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString();
}

export default function CustomerContactMigrationPage() {
  const { user, isLoading } = useAuth();
  const canAccess = canUsePlatformTools(user);
  const [organizations, setOrganizations] = useState<PlatformSeedOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Titan Graphics dry run");
  const [qbJson, setQbJson] = useState("");
  const [qbStatus, setQbStatus] = useState<CustomerContactQuickBooksSourceStatus | null>(null);
  const [qbSnapshot, setQbSnapshot] = useState<CustomerContactQuickBooksSourceSnapshot | null>(null);
  const [qbProgress, setQbProgress] = useState<string | null>(null);
  const [qbApiError, setQbApiError] = useState<string | null>(null);
  const [showQbFallback, setShowQbFallback] = useState(false);
  const [companyFile, setCompanyFile] = useState<File | null>(null);
  const [contactsFile, setContactsFile] = useState<File | null>(null);
  const [batches, setBatches] = useState<CustomerContactMigrationBatch[]>([]);
  const [detail, setDetail] = useState<CustomerContactMigrationBatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [finalizeText, setFinalizeText] = useState("");
  const [allowUnresolvedSkips, setAllowUnresolvedSkips] = useState(false);
  const [manualEntityIds, setManualEntityIds] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!canAccess) return;
    let cancelled = false;
    listPlatformSeedOrganizations().then(({ body }) => {
      if (cancelled || !body.success) return;
      setOrganizations(body.data ?? []);
      if (!organizationId && body.data?.[0]?.id) setOrganizationId(body.data[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, [canAccess]);

  const selectedOrg = useMemo(
    () => organizations.find((org) => org.id === organizationId) ?? null,
    [organizations, organizationId],
  );

  const refreshBatches = async () => {
    if (!organizationId) return;
    const { body } = await listCustomerContactMigrationBatches(organizationId, 25);
    if (body.success) setBatches(body.data ?? []);
  };

  const refreshQuickBooksStatus = async () => {
    if (!organizationId) return;
    const { body } = await getCustomerContactMigrationQuickBooksSourceStatus(organizationId);
    if (body.success) setQbStatus(body.data ?? null);
  };

  useEffect(() => {
    if (!canAccess || !organizationId) return;
    setQbSnapshot(null);
    setQbProgress(null);
    setQbApiError(null);
    setShowQbFallback(false);
    void refreshBatches();
    void refreshQuickBooksStatus();
  }, [canAccess, organizationId]);

  const retrieveQuickBooksCustomers = async () => {
    if (!organizationId) {
      setMessage("Choose a target organization.");
      return;
    }
    setLoading(true);
    setMessage(null);
    setQbApiError(null);
    setQbProgress("Connecting to QuickBooks...");
    try {
      const { body } = await retrieveCustomerContactMigrationQuickBooksSource(organizationId);
      if (!body.success || !body.data) {
        setQbProgress(null);
        setQbApiError(body.message ?? "Failed to retrieve QuickBooks customers.");
        return;
      }
      setQbStatus(body.data.status);
      setQbSnapshot(body.data.snapshot);
      setQbProgress(`Retrieved ${body.data.customerCount} QuickBooks customers.`);
    } finally {
      setLoading(false);
    }
  };

  const uploadQuickBooksFallback = async () => {
    if (!organizationId) {
      setMessage("Choose a target organization.");
      return;
    }
    setLoading(true);
    setMessage(null);
    setQbApiError(null);
    setQbProgress("Validating uploaded QuickBooks JSON...");
    try {
      let quickBooksCustomers: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(qbJson || "[]");
        quickBooksCustomers = Array.isArray(parsed) ? parsed : [];
      } catch {
        setQbProgress(null);
        setQbApiError("QuickBooks source JSON must be an array.");
        return;
      }

      const { body } = await uploadCustomerContactMigrationQuickBooksSource({ organizationId, quickBooksCustomers });
      if (!body.success || !body.data) {
        setQbProgress(null);
        setQbApiError(body.message ?? "Failed to stage uploaded QuickBooks customers.");
        return;
      }
      if (body.data.status) setQbStatus(body.data.status);
      setQbSnapshot(body.data.snapshot);
      setQbProgress(`Staged ${body.data.customerCount} uploaded QuickBooks customers.`);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (batchId: string) => {
    if (!organizationId) return;
    setLoading(true);
    setMessage(null);
    try {
      const { body } = await getCustomerContactMigrationBatch(organizationId, batchId);
      if (!body.success || !body.data) {
        setMessage(body.message ?? "Failed to load batch.");
        return;
      }
      setDetail(body.data);
    } finally {
      setLoading(false);
    }
  };

  const createBatch = async () => {
    if (!organizationId) {
      setMessage("Choose a target organization.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      if (!qbSnapshot) {
        setMessage("Retrieve QuickBooks customers or stage the developer JSON fallback first.");
        return;
      }

      const [infoFloCompanyCsv, infoFloContactsCsv] = await Promise.all([
        readFileText(companyFile),
        readFileText(contactsFile),
      ]);

      const { body } = await createCustomerContactMigrationBatch({
        organizationId,
        sourceLabel,
        quickBooksSourceSnapshotId: qbSnapshot.id,
        qbSourceLabel: qbSnapshot.sourceMode === "live"
          ? `Connected QuickBooks: ${qbSnapshot.connectedCompanyName ?? qbSnapshot.quickBooksCompanyId ?? "unknown company"}`
          : "Uploaded QuickBooks customer JSON fallback",
        infoFloCompanyCsv,
        infoFloCompanyFilename: companyFile?.name,
        infoFloContactsCsv,
        infoFloContactsFilename: contactsFile?.name,
      });

      if (!body.success || !body.data) {
        setMessage(body.message ?? "Failed to create batch.");
        return;
      }
      setMessage(`Batch ${body.data.batch.id} staged with status ${body.data.batch.status}.`);
      await refreshBatches();
      await loadDetail(body.data.batch.id);
    } finally {
      setLoading(false);
    }
  };

  const finalizeBatch = async () => {
    if (!detail || finalizeText !== "FINALIZE") return;
    setLoading(true);
    setMessage(null);
    try {
      const { body, httpStatus } = await finalizeCustomerContactMigrationBatch(organizationId, detail.batch.id, allowUnresolvedSkips);
      if (!body.success) {
        setMessage(httpStatus === 401 ? "Step-up authentication is required before finalizing." : body.message ?? "Finalize failed.");
        return;
      }
      setMessage(`Finalized ${detail.batch.id}.`);
      await refreshBatches();
      await loadDetail(detail.batch.id);
      setFinalizeText("");
      setAllowUnresolvedSkips(false);
    } finally {
      setLoading(false);
    }
  };

  const saveReviewDecision = async (
    recordType: "company" | "contact",
    recordId: string,
    action: "accept_proposed" | "choose_existing" | "create_new" | "ignore",
    selectedEntityId?: string,
  ) => {
    if (!detail) return;
    setLoading(true);
    setMessage(null);
    try {
      const { body } = await saveCustomerContactMigrationReviewDecision({
        organizationId,
        batchId: detail.batch.id,
        recordType,
        recordId,
        action,
        selectedEntityId,
      });
      if (!body.success || !body.data) {
        setMessage(body.message ?? "Failed to save review decision.");
        return;
      }
      setDetail(body.data);
      await refreshBatches();
      setMessage("Review decision saved.");
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!canAccess) return <NotFound />;

  const summary = detail?.batch.summaryJson ?? {};
  const unresolved = detail
    ? countRows(detail.companyRows, ["ambiguous", "failed"]) +
      countRows(detail.contactRows, ["ambiguous_person", "company_ambiguous", "company_missing", "failed"]) +
      countRows(detail.relationshipRows, ["ambiguous", "failed"])
    : 0;
  const canFinalize = detail?.batch.status === "ready_to_finalize" ||
    detail?.batch.status === "completed_with_exceptions" ||
    (allowUnresolvedSkips && detail?.batch.status === "needs_review");
  const finalizePreview = detail?.finalizePreview ?? {
    companiesToCreate: 0,
    companiesToUpdate: 0,
    contactsToCreate: 0,
    contactsToUpdate: 0,
    relationshipsToCreate: 0,
    relationshipsToUpdate: 0,
    remainingUnresolved: unresolved,
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Customer & Contact Migration</h1>
            <Badge variant="outline">Platform developer</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Stage QuickBooks, InfoFlo company, and InfoFlo contact sources before any permanent customer data changes.
          </p>
        </div>
        <Button type="button" variant="outline" className="gap-2" onClick={refreshBatches} disabled={!organizationId || loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {message && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
            <span>{message}</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage Batch</CardTitle>
          <CardDescription>Select the tenant, retrieve QuickBooks customers, upload InfoFlo files, then stage a dry-run batch.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <div className="text-sm font-medium">1. Select organization</div>
            <div className="grid gap-3 lg:grid-cols-2">
              <Label className="block space-y-1">
                <span>Target organization</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={organizationId}
                  onChange={(event) => setOrganizationId(event.target.value)}
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>{org.name} ({org.slug})</option>
                  ))}
                </select>
              </Label>
              <Label className="block space-y-1">
                <span>Source label</span>
                <Input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} />
              </Label>
            </div>
            {selectedOrg && <div className="font-mono text-xs text-muted-foreground">{selectedOrg.id}</div>}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium">2. Retrieve QuickBooks customers</div>
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={refreshQuickBooksStatus} disabled={!organizationId || loading}>
                <RefreshCw className="h-4 w-4" />
                Refresh status
              </Button>
            </div>
            <div className="rounded-md border p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Connected QuickBooks company</div>
                  <div className="mt-1 text-sm font-medium">{qbStatus?.connectedCompanyName ?? "Not connected"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Last successful sync</div>
                  <div className="mt-1 text-sm font-medium">{formatDateTime(qbStatus?.lastSuccessfulSyncAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Customers retrieved</div>
                  <div className="mt-1 text-sm font-medium">{qbSnapshot?.retrievedCount ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Retrieve progress</div>
                  <div className="mt-1 text-sm font-medium">{qbProgress ?? (qbStatus?.connected ? "Ready" : "Waiting for connection")}</div>
                </div>
              </div>

              {qbStatus?.healthState === "transient_error" || qbStatus?.healthMessage ? (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-900">
                  {qbStatus.healthMessage ?? "QuickBooks reported a transient API error."}
                </div>
              ) : null}

              <div className="mt-3">
                <div className="text-xs text-muted-foreground">API errors</div>
                <div className="mt-1 text-sm font-medium">{qbApiError ?? "None"}</div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="gap-2"
                  onClick={retrieveQuickBooksCustomers}
                  disabled={loading || !organizationId || !qbStatus?.connected}
                >
                  <DatabaseZap className="h-4 w-4" />
                  Fetch from connected QuickBooks
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowQbFallback((value) => !value)}
                  disabled={loading || !organizationId}
                >
                  Upload QuickBooks customer JSON
                </Button>
              </div>

              {!qbStatus?.connected && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Connect QuickBooks for this organization to fetch automatically, or use the developer fallback for offline staging.
                </p>
              )}

              {showQbFallback && (
                <div className="mt-4 space-y-3 rounded-md border bg-muted/30 p-3">
                  <Label className="block space-y-1">
                    <span>Advanced / offline fallback JSON</span>
                    <Textarea rows={7} value={qbJson} onChange={(event) => setQbJson(event.target.value)} className="font-mono text-xs" />
                  </Label>
                  <Button type="button" variant="secondary" className="gap-2" onClick={uploadQuickBooksFallback} disabled={loading || !organizationId}>
                    <Upload className="h-4 w-4" />
                    Stage uploaded QuickBooks source
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Label className="block space-y-1">
              <span>3. Upload InfoFlo company CSV</span>
              <Input type="file" accept=".csv,text/csv" onChange={(event) => setCompanyFile(event.target.files?.[0] ?? null)} />
            </Label>
            <Label className="block space-y-1">
              <span>4. Upload InfoFlo contacts CSV</span>
              <Input type="file" accept=".csv,text/csv" onChange={(event) => setContactsFile(event.target.files?.[0] ?? null)} />
            </Label>
          </div>

          <div className="flex justify-end">
            <Button type="button" className="gap-2" onClick={createBatch} disabled={loading || !organizationId || !qbSnapshot}>
              <Upload className="h-4 w-4" />
              5. Parse, Validate, and Match
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Batches</CardTitle>
            <CardDescription>Recent staged imports for the selected tenant.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {batches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No batches yet.</p>
            ) : batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted"
                onClick={() => loadDetail(batch.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{batch.id}</span>
                  <Badge variant={batch.status === "completed" ? "default" : batch.status === "failed" ? "destructive" : "secondary"}>
                    {batch.status}
                  </Badge>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{batch.sourceLabel || batch.createdAt}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Preview & Reports</CardTitle>
                <CardDescription>Inspect staged rows and exact permanent-change counts before finalization.</CardDescription>
              </div>
              {detail && <Badge variant={unresolved > 0 ? "destructive" : "default"}>{unresolved} unresolved</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!detail ? (
              <p className="text-sm text-muted-foreground">Select or create a batch to inspect it.</p>
            ) : (
              <>
                <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                  {[
                    ["QB companies", summary.quickBooksCompaniesRead],
                    ["InfoFlo companies", summary.infoFloCompaniesRead],
                    ["InfoFlo contacts", summary.infoFloContactsRead],
                    ["Companies", detail.companyRows.length],
                    ["Contacts", detail.contactRows.length],
                    ["Relationships", detail.relationshipRows.length],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{String(label)}</div>
                      <div className="mt-1 text-xl font-semibold">{String(value ?? 0)}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  {reportKinds.map((kind) => (
                    <a
                      key={kind}
                      href={customerContactMigrationReportUrl(organizationId, detail.batch.id, kind)}
                      className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"
                    >
                      <Download className="h-4 w-4" />
                      {kind}
                    </a>
                  ))}
                </div>

                <ExceptionReviewPanel
                  detail={detail}
                  manualEntityIds={manualEntityIds}
                  setManualEntityIds={setManualEntityIds}
                  onDecision={saveReviewDecision}
                  loading={loading}
                />

                <div className="grid gap-4 lg:grid-cols-3">
                  <RecordPreview title="Company Records" rows={detail.companyRows} />
                  <RecordPreview title="Contact Records" rows={detail.contactRows} />
                  <RecordPreview title="Relationships" rows={detail.relationshipRows} />
                </div>

                <div className="rounded-md border p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <div className="font-medium">Finalize</div>
                  </div>
                  <div className="mb-4 grid gap-2 md:grid-cols-3 xl:grid-cols-7">
                    {[
                      ["Companies to create", finalizePreview.companiesToCreate],
                      ["Companies to update", finalizePreview.companiesToUpdate],
                      ["Contacts to create", finalizePreview.contactsToCreate],
                      ["Contacts to update", finalizePreview.contactsToUpdate],
                      ["Relationships to create", finalizePreview.relationshipsToCreate],
                      ["Relationships to update", finalizePreview.relationshipsToUpdate],
                      ["Remaining unresolved", finalizePreview.remainingUnresolved],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{String(label)}</div>
                        <div className="mt-1 text-lg font-semibold">{String(value ?? 0)}</div>
                      </div>
                    ))}
                  </div>
                  {finalizePreview.remainingUnresolved > 0 && (
                    <Label className="mb-3 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={allowUnresolvedSkips}
                        onChange={(event) => setAllowUnresolvedSkips(event.target.checked)}
                        disabled={loading}
                      />
                      <span>Approve unresolved skips</span>
                    </Label>
                  )}
                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <Input
                      placeholder="Type FINALIZE"
                      value={finalizeText}
                      onChange={(event) => setFinalizeText(event.target.value)}
                      disabled={!canFinalize || loading}
                    />
                    <Button type="button" className="gap-2" onClick={finalizeBatch} disabled={!canFinalize || finalizeText !== "FINALIZE" || loading}>
                      <PlayCircle className="h-4 w-4" />
                      Finalize Import
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Finalization is blocked unless the batch is ready and platform step-up authentication has succeeded.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RecordPreview({ title, rows }: { title: string; rows: Array<Record<string, any>> }) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <DatabaseZap className="h-4 w-4 text-muted-foreground" />
          {title}
        </div>
        <Badge variant="secondary">{rows.length}</Badge>
      </div>
      <div className="max-h-80 divide-y overflow-auto">
        {rows.slice(0, 30).map((row) => (
          <div key={row.id} className="p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono">{row.sourceRecordId || row.rowNumber || row.id}</span>
              <Badge variant={String(row.status).includes("failed") || String(row.status).includes("ambiguous") ? "destructive" : "outline"}>
                {row.status}
              </Badge>
            </div>
            <pre className="mt-2 max-h-24 overflow-auto rounded bg-muted p-2 text-[11px]">
              {JSON.stringify(row.normalizedJson ?? row.proposedChangesJson ?? {}, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function unresolvedCompanyRows(detail: CustomerContactMigrationBatchDetail) {
  return detail.companyRows.filter((row) => ["ambiguous", "failed"].includes(String(row.status)));
}

function unresolvedContactRows(detail: CustomerContactMigrationBatchDetail) {
  return detail.contactRows.filter((row) => ["ambiguous_person", "company_ambiguous", "company_missing", "failed"].includes(String(row.status)));
}

function sortedCandidates(row: Record<string, any>) {
  return Array.isArray(row.matchCandidatesJson)
    ? [...row.matchCandidatesJson].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    : [];
}

function sourceLabel(row: Record<string, any>) {
  const normalized = row.normalizedJson ?? {};
  return normalized.name || normalized.fullName || [normalized.firstName, normalized.lastName].filter(Boolean).join(" ") || row.sourceRecordId || row.id;
}

function ExceptionReviewPanel({
  detail,
  manualEntityIds,
  setManualEntityIds,
  onDecision,
  loading,
}: {
  detail: CustomerContactMigrationBatchDetail;
  manualEntityIds: Record<string, string>;
  setManualEntityIds: (value: Record<string, string>) => void;
  onDecision: (
    recordType: "company" | "contact",
    recordId: string,
    action: "accept_proposed" | "choose_existing" | "create_new" | "ignore",
    selectedEntityId?: string,
  ) => Promise<void>;
  loading: boolean;
}) {
  const companies = unresolvedCompanyRows(detail);
  const contacts = unresolvedContactRows(detail);
  const rows = [
    ...companies.map((row) => ({ recordType: "company" as const, row })),
    ...contacts.map((row) => ({ recordType: "contact" as const, row })),
  ];

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div>
          <div className="text-sm font-medium">Exception Review</div>
          <div className="text-xs text-muted-foreground">Ambiguous companies and contacts</div>
        </div>
        <Badge variant={rows.length > 0 ? "destructive" : "default"}>{rows.length}</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No company or contact exceptions need review.</div>
      ) : (
        <div className="divide-y">
          {rows.map(({ recordType, row }) => {
            const candidates = sortedCandidates(row);
            const proposed = candidates[0] ?? null;
            const manualKey = `${recordType}:${row.id}`;
            const warnings = Array.isArray(row.warningsJson) ? row.warningsJson : [];
            return (
              <div key={manualKey} className="space-y-3 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{recordType === "company" ? "Company" : "Contact"}: {sourceLabel(row)}</div>
                    <div className="font-mono text-xs text-muted-foreground">{row.sourceRecordId || row.id}</div>
                  </div>
                  <Badge variant="destructive">{row.status}</Badge>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium text-muted-foreground">Source record</div>
                    <pre className="mt-2 max-h-44 overflow-auto rounded bg-muted p-2 text-[11px]">
                      {JSON.stringify(row.normalizedJson ?? row.rawJson ?? {}, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium text-muted-foreground">Proposed match</div>
                    {proposed ? (
                      <div className="mt-2 space-y-1">
                        <div className="font-mono text-xs">{proposed.id}</div>
                        <div>Score {String(proposed.score ?? "")}</div>
                        <div>{String(proposed.reason ?? "")}</div>
                      </div>
                    ) : (
                      <div className="mt-2 text-muted-foreground">No proposed match</div>
                    )}
                    <div className="mt-3 text-xs font-medium text-muted-foreground">Conflicting fields</div>
                    <div className="mt-1 text-xs">{warnings.length > 0 ? warnings.join("; ") : "None recorded"}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium text-muted-foreground">All candidates</div>
                    <div className="mt-2 max-h-44 space-y-2 overflow-auto">
                      {candidates.length === 0 ? (
                        <div className="text-muted-foreground">No candidates</div>
                      ) : candidates.map((candidate: any) => (
                        <div key={`${candidate.id}:${candidate.reason}`} className="rounded border p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs">{candidate.id}</span>
                            <Badge variant="outline">{String(candidate.score ?? "")}</Badge>
                          </div>
                          <div className="mt-1 text-xs">{String(candidate.reason ?? "")}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={loading || !proposed}
                    onClick={() => onDecision(recordType, row.id, "accept_proposed")}
                  >
                    Accept proposed match
                  </Button>
                  <Input
                    className="h-9 w-72"
                    placeholder={recordType === "company" ? "Existing company ID" : "Existing contact ID"}
                    value={manualEntityIds[manualKey] ?? ""}
                    onChange={(event) => setManualEntityIds({ ...manualEntityIds, [manualKey]: event.target.value })}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loading || !manualEntityIds[manualKey]?.trim()}
                    onClick={() => onDecision(recordType, row.id, "choose_existing", manualEntityIds[manualKey]?.trim())}
                  >
                    Choose existing
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => onDecision(recordType, row.id, "create_new")}
                  >
                    Create new {recordType}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => onDecision(recordType, row.id, "ignore")}
                  >
                    Ignore source record
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
