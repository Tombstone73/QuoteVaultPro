import { useState, useRef } from "react";
import { X, GripVertical, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface ObjectUploaderProps {
  value: string[];
  onChange: (urls: string[]) => void;
  onUploaded?: (files: Array<{ url: string; filename: string; fileSize: number; mimeType: string }>) => Promise<void> | void;
  maxFiles?: number;
  allowedFileTypes?: string[];
}

export function ObjectUploader({
  value = [],
  onChange,
  onUploaded,
  maxFiles = 5,
  allowedFileTypes = ["image/*"],
}: ObjectUploaderProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Prevent event bubbling to parent collapsible/accordion triggers
  const stopBubbling = (e: React.MouseEvent | React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const remainingSlots = maxFiles - value.length;
    if (files.length > remainingSlots) {
      toast({
        title: "Too many files",
        description: `You can only upload ${remainingSlots} more file(s)`,
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    const uploadedFiles: Array<{ url: string; filename: string; fileSize: number; mimeType: string }> = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
          throw new Error('Choose a JPEG, PNG, WebP, or GIF image.');
        }

        const presignedResponse = await fetch("/api/objects/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            fileName: file.name,
            fileSizeBytes: file.size,
            uploadPurpose: "product-image",
          }),
        });

        if (!presignedResponse.ok) {
          throw new Error("Failed to get upload URL");
        }

        const { storageTarget, method, url, path } = await presignedResponse.json();
        // /objects serves Supabase images to authenticated portal customers.
        // Other direct-upload providers do not yet have a customer image proxy.
        if (storageTarget !== 'supabase' || method !== 'PUT' || typeof url !== 'string' || typeof path !== 'string' || !/^[a-zA-Z0-9/_.-]+$/.test(path) || path.includes('..') || path.startsWith('/')) {
          throw new Error('Customer image upload is not available for this storage provider.');
        }

        // Match Supabase Storage's uploadToSignedUrl request shape. A Blob is
        // sent as multipart form data; the browser supplies the boundary.
        const body = new FormData();
        body.append("cacheControl", "3600");
        body.append("", file);
        let uploadResponse: Response;
        try {
          uploadResponse = await fetch(url, {
            method,
            // Signed Storage URLs use their token, not the app's session cookie.
            // This also overrides the app-wide fetch wrapper's include default.
            credentials: "omit",
            headers: { "x-upsert": "false" },
            body,
          });
        } catch {
          throw new Error("Could not reach image storage. Please retry the upload.");
        }

        if (!uploadResponse.ok) {
          throw new Error(`Image storage rejected the upload (HTTP ${uploadResponse.status}).`);
        }

        uploadedFiles.push({ url: `/objects/${path}`, filename: file.name, fileSize: file.size, mimeType: file.type });
      }

      await onUploaded?.(uploadedFiles);
      onChange([...value, ...uploadedFiles.map((file) => file.url)]);
      toast({
        title: "Upload successful",
        description: `${uploadedFiles.length} file(s) uploaded`,
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload one or more files",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemove = (index: number) => {
    const newUrls = value.filter((_, i) => i !== index);
    onChange(newUrls);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newUrls = [...value];
    const draggedItem = newUrls[draggedIndex];
    newUrls.splice(draggedIndex, 1);
    newUrls.splice(index, 0, draggedItem);

    onChange(newUrls);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="space-y-4">
      {value.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {value.map((url, index) => (
            <div
              key={`${url}-${index}`}
              draggable
              onDragStart={(e) => {
                stopBubbling(e);
                handleDragStart(index);
              }}
              onDragOver={(e) => {
                stopBubbling(e);
                handleDragOver(e, index);
              }}
              onDragEnd={(e) => {
                stopBubbling(e);
                handleDragEnd();
              }}
              className="group relative rounded-md border border-border bg-card overflow-hidden cursor-move hover-elevate"
              data-testid={`thumbnail-preview-${index}`}
            >
              <div className="aspect-square relative">
                <img
                  src={url}
                  alt={`Thumbnail ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVertical className="w-4 h-4 text-white drop-shadow-md" />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6"
                  onMouseDown={stopBubbling}
                  onClick={(e) => {
                    stopBubbling(e);
                    handleRemove(index);
                  }}
                  data-testid={`button-remove-thumbnail-${index}`}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {value.length < maxFiles && (
        <div className="border-2 border-dashed border-border rounded-md p-6">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={allowedFileTypes.join(",")}
            onChange={(e) => handleFileSelect(e.target.files)}
            onClick={(event) => event.stopPropagation()}
            className="hidden"
            data-testid="file-input"
          />
          <div className="flex flex-col items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onMouseDown={stopBubbling}
              onClick={(e) => {
                stopBubbling(e);
                fileInputRef.current?.click();
              }}
              disabled={uploading}
              data-testid="button-upload"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload {allowedFileTypes.includes("image/*") ? "Images" : "Files"}
                </>
              )}
            </Button>
            <p className="text-sm text-muted-foreground">
              {maxFiles - value.length} of {maxFiles} remaining
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
