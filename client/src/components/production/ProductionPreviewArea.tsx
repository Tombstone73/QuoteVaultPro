import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Loader2 } from "lucide-react";
import { downloadAuthenticatedFile } from "@/lib/authenticatedFileDownload";
import { useToast } from "@/hooks/use-toast";

export type ProductionPreviewSize = "compact" | "normal" | "large";
type PreviewTab = "artwork" | "production";

function availableTab(artworkCount: number, productionFileCount: number): PreviewTab {
  return artworkCount > 0 || productionFileCount === 0 ? "artwork" : "production";
}

export function ProductionPreviewArea({
  jobId,
  size,
  artworkCount,
  productionFileCount,
  productionFileName,
  productionFileStatus,
  onSizeChange,
  artworkPreview,
  productionFilePreview,
}: {
  jobId: string;
  size: ProductionPreviewSize;
  artworkCount: number;
  productionFileCount: number;
  productionFileName?: string | null;
  productionFileStatus?: string | null;
  onSizeChange: (size: ProductionPreviewSize) => void;
  artworkPreview: ReactNode;
  productionFilePreview: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<PreviewTab>(() => availableTab(artworkCount, productionFileCount));
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();

  const downloadAll = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadAuthenticatedFile(
        `/api/production/jobs/${encodeURIComponent(jobId)}/files/download-all?scope=${activeTab}`,
        `production-job-${jobId}-${activeTab}.zip`,
      );
    } catch (error) {
      toast({ title: "Download All failed", description: error instanceof Error ? error.message : "Unable to download files", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    setActiveTab((current) => {
      if (current === "artwork" && artworkCount === 0 && productionFileCount > 0) return "production";
      if (current === "production" && productionFileCount === 0 && artworkCount > 0) return "artwork";
      if (artworkCount === 0 && productionFileCount === 0) return "artwork";
      return current;
    });
  }, [jobId, artworkCount, productionFileCount]);

  return (
    <section className="rounded-lg border border-titan-border-subtle bg-titan-bg-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-titan-text-primary">Artwork & production files</div>
          <div className="truncate text-[11px] text-titan-text-muted">
            {artworkCount} artwork {artworkCount === 1 ? "file" : "files"}
            {productionFileName ? ` · ${productionFileName}` : " · No final production file"}
            {productionFileStatus === "pending" ? " · Preview processing" : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" disabled={downloading || (activeTab === "artwork" ? artworkCount === 0 : productionFileCount === 0)} onClick={() => void downloadAll()}>
            {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
            {downloading ? "Preparing ZIP..." : "Download All"}
          </Button>
          <div className="flex rounded-md border border-titan-border-subtle p-0.5" aria-label="Preview area size">
            {(["compact", "normal", "large"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={size === option ? "secondary" : "ghost"}
                className="h-7 px-2 text-[11px] capitalize"
                onClick={() => onSizeChange(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PreviewTab)} className="mt-3 min-w-0">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1">
          <TabsTrigger value="artwork" className="min-h-11 min-w-0 whitespace-normal px-2 text-xs sm:text-sm">Original Artwork</TabsTrigger>
          <TabsTrigger value="production" className="min-h-11 min-w-0 whitespace-normal px-2 text-xs sm:text-sm">Production File / Layout</TabsTrigger>
        </TabsList>
        {artworkCount === 0 && productionFileCount === 0 ? (
          <p className="mt-3 rounded-md border border-titan-border-subtle p-4 text-sm text-titan-text-muted">No artwork or production file available for this job.</p>
        ) : (
          <>
            <TabsContent value="artwork"><div data-testid="production-artwork-previews">{artworkPreview}</div></TabsContent>
            <TabsContent value="production"><div data-testid="production-file-previews">{productionFilePreview}</div></TabsContent>
          </>
        )}
      </Tabs>
    </section>
  );
}
