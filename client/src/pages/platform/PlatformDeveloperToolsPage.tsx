import { Link } from "react-router-dom";
import { Code2, DatabaseZap, FlaskConical, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import { ROUTES } from "@/config/routes";
import { canUsePlatformTools } from "@/lib/platformAccess";
import {
  listConfigurationCopyJobs,
  listPlatformSeedOrganizations,
  updatePlatformOrganization,
  type ConfigurationCopyJobResult,
  type PlatformSeedOrganization,
} from "@/lib/api/platform";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PlatformDeveloperToolsPage() {
  const { user, isLoading } = useAuth();
  const canAccessPlatformTools = canUsePlatformTools(user);
  const [copyJobs, setCopyJobs] = useState<ConfigurationCopyJobResult[]>([]);
  const [copyJobsLoading, setCopyJobsLoading] = useState(false);
  const [organizations, setOrganizations] = useState<PlatformSeedOrganization[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [editingOrg, setEditingOrg] = useState<PlatformSeedOrganization | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editArchived, setEditArchived] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingOrg, setSavingOrg] = useState(false);

  useEffect(() => {
    if (!canAccessPlatformTools) return;
    let cancelled = false;
    setCopyJobsLoading(true);
    listConfigurationCopyJobs(8)
      .then(({ body }) => {
        if (!cancelled && body.success) {
          setCopyJobs(body.data ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setCopyJobs([]);
      })
      .finally(() => {
        if (!cancelled) setCopyJobsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessPlatformTools]);

  const loadOrganizations = async () => {
    setOrganizationsLoading(true);
    try {
      const { body } = await listPlatformSeedOrganizations();
      if (body.success) {
        setOrganizations(body.data ?? []);
      }
    } finally {
      setOrganizationsLoading(false);
    }
  };

  useEffect(() => {
    if (!canAccessPlatformTools) return;
    void loadOrganizations();
  }, [canAccessPlatformTools]);

  const startEdit = (org: PlatformSeedOrganization) => {
    setEditingOrg(org);
    setEditName(org.name);
    setEditSlug(org.slug);
    setEditArchived(Boolean(org.isArchived));
    setEditError(null);
  };

  const saveOrganization = async () => {
    if (!editingOrg || savingOrg) return;
    setEditError(null);
    if (!editName.trim()) {
      setEditError("Organization name is required.");
      return;
    }
    if (!editSlug.trim()) {
      setEditError("Organization slug is required.");
      return;
    }
    if (editArchived !== Boolean(editingOrg.isArchived)) {
      const ok = window.confirm(
        editArchived
          ? "Archive this organization? It will be hidden from normal organization selectors and blocked from normal tenant activity."
          : "Restore this organization? It will become selectable again for authorized users."
      );
      if (!ok) return;
    }
    setSavingOrg(true);
    try {
      const payload: { name?: string; slug?: string; isArchived?: boolean } = {};
      if (editName.trim() !== editingOrg.name) payload.name = editName.trim();
      if (editSlug.trim() !== editingOrg.slug) payload.slug = editSlug.trim();
      if (editArchived !== Boolean(editingOrg.isArchived)) payload.isArchived = editArchived;
      const { body } = await updatePlatformOrganization(editingOrg.id, payload);
      if (!body.success || !body.data) {
        setEditError(body.message ?? "Failed to save organization.");
        return;
      }
      setEditingOrg(body.data);
      setEditName(body.data.name);
      setEditSlug(body.data.slug);
      setEditArchived(Boolean(body.data.isArchived));
      await loadOrganizations();
    } finally {
      setSavingOrg(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }

  if (!canAccessPlatformTools) {
    return <NotFound />;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Platform Developer Tools</h1>
            <Badge variant="outline">Platform only</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Internal platform utilities for diagnostics, migrations research, and guarded experimental workflows.
          </p>
        </div>
      </div>

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-blue-500" />
          <div className="space-y-1 text-sm">
            <div className="font-medium text-blue-700 dark:text-blue-300">Platform access boundary</div>
            <div className="text-muted-foreground">
              This area is visible only to platform developers and platform admins. Tenant admins should use standard
              Settings and Admin Tools unless a utility is promoted out of Platform.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-titan-bg-card-elevated">
        <CardHeader className="pb-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Organizations</CardTitle>
            <Badge variant="secondary">Developer / Platform Admin</Badge>
          </div>
          <CardDescription>
            Edit organization display names, slugs, and archive state. Tenant data remains linked by organization ID.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-md border">
            {organizationsLoading ? (
              <div className="p-3"><Skeleton className="h-24 w-full" /></div>
            ) : organizations.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No organizations found.</p>
            ) : (
              <div className="divide-y">
                {organizations.map((org) => (
                  <div key={org.id} className="grid gap-2 p-3 text-sm md:grid-cols-[minmax(0,1fr)_160px_120px_80px] md:items-center">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{org.name}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{org.slug}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {org.createdAt ? new Date(org.createdAt).toLocaleDateString() : "Created date unavailable"}
                    </div>
                    <Badge variant={org.isArchived ? "secondary" : "default"} className="w-fit">
                      {org.isArchived ? "Archived" : "Active"}
                    </Badge>
                    <Button type="button" size="sm" variant="outline" onClick={() => startEdit(org)}>
                      Edit
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border p-3">
            {editingOrg ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium">Edit organization</div>
                  <div className="font-mono text-xs text-muted-foreground">{editingOrg.id}</div>
                </div>

                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Display name</span>
                  <input
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    disabled={savingOrg}
                  />
                </label>

                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Slug</span>
                  <input
                    className="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm"
                    value={editSlug}
                    onChange={(event) => setEditSlug(event.target.value)}
                    disabled={savingOrg}
                  />
                  <span className="block text-xs text-muted-foreground">
                    Changing the slug may change organization URLs. Organization data remains linked by organization ID.
                  </span>
                </label>

                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={editArchived}
                      onChange={(event) => setEditArchived(event.target.checked)}
                      disabled={savingOrg}
                    />
                    <span>
                      <span className="block font-medium">{editArchived ? "Archived" : "Active"}</span>
                      <span className="text-xs text-muted-foreground">
                        Archive/restore is separate from rename. Archived organizations remain in the database and developer tools.
                      </span>
                    </span>
                  </label>
                </div>

                {editError && <p className="text-sm text-destructive">{editError}</p>}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditingOrg(null)} disabled={savingOrg}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={saveOrganization} disabled={savingOrg}>
                    {savingOrg ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select an organization to edit.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-titan-bg-card-elevated">
        <CardHeader className="pb-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Organization Configuration Copy Jobs</CardTitle>
            <Badge variant="secondary">Read-only</Badge>
          </div>
          <CardDescription>
            Recent seed-copy diagnostics for new tenant setup. Counts and safe error summaries only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {copyJobsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : copyJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent configuration copy jobs.</p>
          ) : (
            <div className="space-y-2">
              {copyJobs.map((job) => (
                <div key={job.id ?? job.copyJobId} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-xs">{job.id ?? job.copyJobId}</div>
                    <Badge variant={job.status === "completed" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>
                      {job.status}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>Source: <span className="font-mono">{job.sourceOrganizationId}</span></div>
                    <div>Destination: <span className="font-mono">{job.destinationOrganizationId}</span></div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {Object.entries(job.entityCounts ?? {}).slice(0, 8).map(([key, count]) => (
                      <span key={key} className="rounded border px-2 py-0.5">{key}: {count}</span>
                    ))}
                  </div>
                  {job.errorSummary && <p className="mt-2 text-xs text-destructive">{job.errorSummary}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className="border-amber-500/25 bg-titan-bg-card-elevated">
          <CardHeader className="pb-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <FlaskConical className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-base">Catalog Migration Lab</CardTitle>
              <Badge variant="outline" className="border-amber-500/40 text-amber-600">Experimental</Badge>
              <Badge variant="secondary">Read-only</Badge>
            </div>
            <CardDescription>
              Analyze an uploaded InfoFlo JSON catalog export and review product, category, option, material, pricing,
              and warning summaries. No catalog records are created or changed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to={ROUTES.admin.catalogMigrationLab}>
              <Button className="w-full gap-2" variant="outline">
                <DatabaseZap className="h-4 w-4" />
                Open Lab
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-amber-500/25 bg-titan-bg-card-elevated">
          <CardHeader className="pb-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Code2 className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-base">QB Invoice Inspector</CardTitle>
              <Badge variant="outline" className="border-amber-500/40 text-amber-600">Developer</Badge>
              <Badge variant="secondary">Read-only</Badge>
            </div>
            <CardDescription>
              Fetch and inspect a single QuickBooks invoice payload, transformed mapping, and raw QB fields before
              changing import behavior.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to={ROUTES.developer.qbInvoiceInspector}>
              <Button className="w-full gap-2" variant="outline">
                <Code2 className="h-4 w-4" />
                Open Inspector
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-amber-500/25 bg-titan-bg-card-elevated">
          <CardHeader className="pb-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Code2 className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-base">QB Customer Inspector</CardTitle>
              <Badge variant="outline" className="border-amber-500/40 text-amber-600">Developer</Badge>
              <Badge variant="secondary">Read-only</Badge>
            </div>
            <CardDescription>
              Inspect a single QuickBooks customer payload, mapped TitanOS fields, unmapped QB fields, and contact
              creation analysis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to={ROUTES.developer.qbCustomerInspector}>
              <Button className="w-full gap-2" variant="outline">
                <Code2 className="h-4 w-4" />
                Open Inspector
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-dashed bg-muted/20">
          <CardHeader className="pb-3">
            <div className="mb-2 flex items-center gap-2">
              <Code2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Future Platform Tools</CardTitle>
            </div>
            <CardDescription>
              This page is the host for future platform-only diagnostics and experimental utilities.
            </CardDescription>
          </CardHeader>
        </Card>

        {user?.isPlatformAdmin && (
          <Card className="bg-titan-bg-card-elevated">
            <CardHeader className="pb-3">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">New Organization</CardTitle>
              </div>
              <CardDescription>
                Create a tenant organization and owner invite. Platform admin access is required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to={ROUTES.platform.orgsNew}>
                <Button className="w-full" variant="outline">Open Organization Creator</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
