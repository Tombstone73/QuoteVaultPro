import { Download, FileText, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { portalFileDownloadUrl, type PortalFileDto } from "@/hooks/usePortal";

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatBytes(value: number | null) {
  if (!value || value <= 0) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / (1024 * 102.4)) / 10} MB`;
}

export default function PortalFilesCard({
  title = "Documents",
  files,
  isLoading,
  error,
  entity,
  entityId,
}: {
  title?: string;
  files: PortalFileDto[];
  isLoading: boolean;
  error: unknown;
  entity: "invoices" | "orders" | "quotes";
  entityId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading documents
          </div>
        ) : error ? (
          <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive" role="alert">
            Documents are unavailable right now. Please try again shortly.
          </p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customer documents are available.</p>
        ) : (
          <div className="divide-y">
            {files.map((file) => {
              const size = formatBytes(file.fileSize);
              return (
                <div key={file.id} className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{file.displayName}</p>
                      <Badge variant="outline">{file.categoryLabel}</Badge>
                      <Badge variant="secondary">{file.fileTypeLabel}</Badge>
                      {file.customerUploadReviewStatusLabel ? <Badge variant={file.customerUploadReviewStatus === "rejected" ? "destructive" : "outline"}>{file.customerUploadReviewStatusLabel}</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatDate(file.uploadedAt)}
                      {size ? ` / ${size}` : ""}
                    </p>
                    {file.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{file.description}</p>
                    ) : null}
                    {file.customerUploadReviewNote ? (
                      <p className="mt-1 text-sm text-muted-foreground">Staff review note: {file.customerUploadReviewNote}</p>
                    ) : null}
                  </div>
                  {file.downloadAvailable ? (
                    <Button asChild variant="outline" className="w-full md:w-auto">
                      <a href={portalFileDownloadUrl(entity, entityId, file.id)} aria-label={`Download ${file.displayName}`}>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </a>
                    </Button>
                  ) : (
                    <Button variant="outline" className="w-full md:w-auto" disabled>
                      <Download className="mr-2 h-4 w-4" />
                      Unavailable
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
