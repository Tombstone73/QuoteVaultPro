import { Link } from "react-router-dom";
import { Download, FileText, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { portalFileDownloadUrl, usePortalDashboard } from "@/hooks/usePortal";

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function detailPath(entityType: "invoice" | "order" | "quote", entityId: string) {
  if (entityType === "invoice") return `/portal/invoices/${entityId}`;
  if (entityType === "order") return `/portal/orders/${entityId}`;
  return `/portal/quotes/${entityId}`;
}

export default function PortalDocumentsPage() {
  const { data, isLoading, error } = usePortalDashboard();
  const files = data?.recentFiles ?? [];

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Business Documents</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Upload tax forms, resale certificates, or account documents. Artwork should be uploaded with the related quote/order/proof.
        </p>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium text-destructive">Could not load documents</p>
            <p className="mt-1 text-sm text-muted-foreground">{(error as Error).message}</p>
          </CardContent>
        </Card>
      ) : files.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <FileText className="mb-3 h-9 w-9 text-muted-foreground" />
            <p className="font-medium">No business documents are available</p>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              Account documents shared by your print partner will appear here. Artwork belongs with the related quote, order, or proof.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {files.map((file) => (
            <div key={`${file.entityType}-${file.entityId}-${file.id}`} className="flex flex-col gap-3 rounded-md border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{file.displayName}</p>
                  <Badge variant="outline">{file.categoryLabel}</Badge>
                  <Badge variant="secondary">{file.fileTypeLabel}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {file.sourceLabel} / {formatDate(file.uploadedAt)}
                </p>
                {file.description ? <p className="mt-1 text-sm text-muted-foreground">{file.description}</p> : null}
              </div>
              <div className="flex gap-2 sm:justify-end">
                <Button asChild variant="outline" size="sm">
                  <Link to={detailPath(file.entityType, file.entityId)}>Open</Link>
                </Button>
                {file.downloadAvailable ? (
                  <Button asChild size="sm">
                    <a href={portalFileDownloadUrl(`${file.entityType}s` as "invoices" | "orders" | "quotes", file.entityId, file.id)}>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
