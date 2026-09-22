import { useCallback, useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { downloadAuthenticatedFile } from "@/lib/authenticatedFileDownload";

/** Customer-portal file downloads stay in the portal and surface failures as UI feedback. */
export function usePortalDownload() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = useCallback(async (path: string, filename: string) => {
    setDownloading(true);
    try {
      await downloadAuthenticatedFile(path, filename);
      return true;
    } catch (error: any) {
      toast({
        title: "Download unavailable",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setDownloading(false);
    }
  }, [toast]);

  return { download, downloading };
}
