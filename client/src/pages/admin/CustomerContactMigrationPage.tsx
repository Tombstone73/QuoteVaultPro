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
  listCustomerContactMigrationBatches,
  listPlatformSeedOrganizations,
  type CustomerContactMigrationBatch,
  type CustomerContactMigrationBatchDetail,
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

export default function CustomerContactMigrationPage() {
  const { user, isLoading } = useAuth();
  const canAccess = canUsePlatformTools(user);
  const [organizations, setOrganizations] = useState<PlatformSeedOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Titan Graphics dry run");
  const [qbJson, setQbJson] = useState("[]");
  const [companyFile, setCompanyFile] = useState<File | null>(null);
  const [contactsFile, setContactsFile] = useState<File | null>(null);
  const [batches, setBatches] = useState<CustomerContactMigrationBatch[]>([]);
  const [detail, setDetail] = useState<CustomerContactMigrationBatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [finalizeText, setFinalizeText] = useState("");

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

  useEffect(() => {
    if (canAccess && organizationId) void refreshBatches();
  }, [canAccess, organizationId]);

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
      let quickBooksCustomers: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(qbJson || "[]");
        quickBooksCustomers = Array.isArray(parsed) ? parsed : [];
      } catch {
        setMessage("QuickBooks source JSON must be an array.");
        return;
      }

      const [infoFloCompanyCsv, infoFloContactsCsv] = await Promise.all([
        readFileText(companyFile),
        readFileText(contactsFile),
      ]);

      const { body } = await createCustomerContactMigrationBatch({
        organizationId,
        sourceLabel,
        qbSourceLabel: quickBooksCustomers.length > 0 ? "Uploaded QuickBooks customer JSON" : "No QuickBooks JSON supplied",
        quickBooksCustomers,
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
      const { body, httpStatus } = await finalizeCustomerContactMigrationBatch(organizationId, detail.batch.id);
      if (!body.success) {
        setMessage(httpStatus === 401 ? "Step-up authentication is required before finalizing." : body.message ?? "Finalize failed.");
        return;
      }
      setMessage(`Finalized ${detail.batch.id}.`);
      await refreshBatches();
      await loadDetail(detail.batch.id);
      setFinalizeText("");
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
  const canFinalize = detail?.batch.status === "ready_to_finalize" || detail?.batch.status === "completed_with_exceptions";

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
          <CardDescription>Select the tenant and upload source files. The result is a dry-run staging batch.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
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
            {selectedOrg && <div className="font-mono text-xs text-muted-foreground">{selectedOrg.id}</div>}
            <Label className="block space-y-1">
              <span>Source label</span>
              <Input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} />
            </Label>
            <Label className="block space-y-1">
              <span>QuickBooks customer JSON array</span>
              <Textarea rows={7} value={qbJson} onChange={(event) => setQbJson(event.target.value)} className="font-mono text-xs" />
            </Label>
          </div>

          <div className="space-y-3">
            <Label className="block space-y-1">
              <span>InfoFlo company CSV</span>
              <Input type="file" accept=".csv,text/csv" onChange={(event) => setCompanyFile(event.target.files?.[0] ?? null)} />
            </Label>
            <Label className="block space-y-1">
              <span>InfoFlo contacts CSV</span>
              <Input type="file" accept=".csv,text/csv" onChange={(event) => setContactsFile(event.target.files?.[0] ?? null)} />
            </Label>
            <Button type="button" className="w-full gap-2" onClick={createBatch} disabled={loading || !organizationId}>
              <Upload className="h-4 w-4" />
              Parse, Validate, and Match
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
