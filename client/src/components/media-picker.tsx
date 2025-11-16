import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X } from "lucide-react";
import { useState, useEffect } from "react";
import type { MediaAsset } from "@shared/schema";

interface MediaPickerProps {
  value: string[];
  onChange: (urls: string[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MediaPicker({ value, onChange, open, onOpenChange }: MediaPickerProps) {
  const [selectedUrls, setSelectedUrls] = useState<string[]>(value);

  const { data: mediaAssets = [], isLoading } = useQuery<MediaAsset[]>({
    queryKey: ["/api/media"],
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setSelectedUrls(value);
    }
  }, [open, value]);

  const toggleSelection = (url: string) => {
    setSelectedUrls(prev =>
      prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]
    );
  };

  const handleConfirm = () => {
    onChange(selectedUrls);
    onOpenChange(false);
  };

  const handleRemoveSelected = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedUrls(prev => prev.filter(u => u !== url));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]" data-testid="dialog-media-picker">
        <DialogHeader>
          <DialogTitle>Select Images from Library</DialogTitle>
          <DialogDescription>
            Choose one or more images to use with this product. {selectedUrls.length} selected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {selectedUrls.length > 0 && (
            <div className="border rounded-lg p-4 bg-muted/30">
              <div className="text-sm font-medium mb-3">Selected Images ({selectedUrls.length})</div>
              <div className="flex flex-wrap gap-2">
                {selectedUrls.map((url) => (
                  <div
                    key={url}
                    className="relative group"
                    data-testid={`selected-image-${url}`}
                  >
                    <img
                      src={url}
                      alt="Selected"
                      className="w-20 h-20 object-cover rounded border-2 border-primary"
                    />
                    <button
                      onClick={(e) => handleRemoveSelected(url, e)}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      data-testid={`button-remove-selected-${url}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ScrollArea className="h-[400px] border rounded-lg p-4">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                Loading media library...
              </div>
            ) : mediaAssets.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No images in library. Upload images in the Media Library tab first.
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-4">
                {mediaAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="relative group cursor-pointer"
                    onClick={() => toggleSelection(asset.url)}
                    data-testid={`media-asset-${asset.id}`}
                  >
                    <div className={`border-2 rounded-lg overflow-hidden transition-all ${
                      selectedUrls.includes(asset.url)
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-transparent hover:border-primary/50"
                    }`}>
                      <img
                        src={asset.url}
                        alt={asset.filename}
                        className="w-full aspect-square object-cover"
                      />
                      <div className="absolute top-2 left-2">
                        <Checkbox
                          checked={selectedUrls.includes(asset.url)}
                          onCheckedChange={() => toggleSelection(asset.url)}
                          className="bg-background"
                          data-testid={`checkbox-asset-${asset.id}`}
                        />
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground truncate">
                      {asset.filename}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-picker"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              data-testid="button-confirm-picker"
            >
              Confirm Selection ({selectedUrls.length})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
