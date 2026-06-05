import { Link } from "react-router-dom";
import { Code2, DatabaseZap, FlaskConical, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import { ROUTES } from "@/config/routes";
import { canUsePlatformTools } from "@/lib/platformAccess";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PlatformDeveloperToolsPage() {
  const { user, isLoading } = useAuth();
  const canAccessPlatformTools = canUsePlatformTools(user);

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
