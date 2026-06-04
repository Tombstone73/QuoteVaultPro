import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bug, ImagePlus, Upload, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

export const MAX_SCREENSHOTS = 5;
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_SCREENSHOT_BYTES = 25 * 1024 * 1024;

const bugReportSchema = z.object({
  type: z.enum(["bug", "feature"]).default("bug"),
  title: z.string().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().min(3, "Description must be at least 3 characters").max(5000),
  severity: z.enum(["low", "medium", "high", "critical"]),
  screenshots: z.array(z.instanceof(File)).max(MAX_SCREENSHOTS, "Maximum 5 screenshots allowed").optional(),
});

type BugReportFormValues = z.infer<typeof bugReportSchema>;

type ScreenshotUploadMetadata = {
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  displayOrder: number;
};

type ScreenshotPreview = {
  id: string;
  file: File;
  previewUrl: string;
};

type CurrentOrganization = {
  id?: string;
  name?: string | null;
  slug?: string | null;
};

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function validateScreenshotSelection(existingFiles: File[], incomingFiles: File[]): string | null {
  if (incomingFiles.length === 0) return null;

  if (existingFiles.length + incomingFiles.length > MAX_SCREENSHOTS) {
    return `You can attach up to ${MAX_SCREENSHOTS} screenshots per bug report.`;
  }

  const nonImage = incomingFiles.find((file) => !isImageFile(file));
  if (nonImage) {
    return `${nonImage.name || "Selected file"} is not an image. Only image files are allowed.`;
  }

  const tooLarge = incomingFiles.find((file) => file.size > MAX_SCREENSHOT_BYTES);
  if (tooLarge) {
    return `${tooLarge.name || "Selected image"} is ${formatBytes(tooLarge.size)}. Each screenshot must be 10 MB or smaller.`;
  }

  const totalBytes = [...existingFiles, ...incomingFiles].reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_SCREENSHOT_BYTES) {
    return `Screenshot attachments total ${formatBytes(totalBytes)}. The total limit is 25 MB.`;
  }

  return null;
}

export function getClipboardImageFiles(event: Pick<ClipboardEvent, "clipboardData">): File[] {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return [];

  const files = Array.from(clipboardData.files ?? []).filter(isImageFile);
  if (files.length > 0) return files;

  return Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      if (file.name) return file;
      const extension = item.type.split("/")[1] || "png";
      return new File([file], `pasted-screenshot-${index + 1}.${extension}`, { type: item.type });
    })
    .filter((file): file is File => !!file);
}

function getRouteName(): string {
  if (typeof document !== "undefined" && document.title) return document.title;
  if (typeof window === "undefined") return "";
  const route = window.location.pathname.replace(/^\/+|\/+$/g, "");
  return route ? route.split("/").filter(Boolean).join(" / ") : "Home";
}

async function uploadScreenshots(files: File[]): Promise<ScreenshotUploadMetadata[]> {
  if (files.length === 0) return [];

  const formData = new FormData();
  files.forEach((file) => {
    formData.append("screenshots", file);
  });

  const res = await fetch("/api/bug-reports/screenshot", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorList = Array.isArray(body.errors) ? ` ${body.errors.join(" ")}` : "";
    throw new Error(`${body.message ?? "Screenshot upload failed"}${errorList}`);
  }

  return body.screenshotAttachments ?? [];
}

async function createBugReport(payload: object): Promise<{ id: string }> {
  const res = await fetch("/api/bug-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to submit bug report");
  }

  const body = await res.json();
  return (body.data ?? {}) as { id: string };
}

const SEVERITY_LABELS: Record<string, string> = {
  low: "Low - cosmetic issue, minor inconvenience",
  medium: "Medium - degraded experience, workaround exists",
  high: "High - feature broken, no workaround",
  critical: "Critical - data loss, security issue, or crash",
};

interface BugReportModalProps {
  open: boolean;
  onClose: () => void;
}

export function BugReportModal({ open, onClose }: BugReportModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedFiles, setSelectedFiles] = React.useState<ScreenshotPreview[]>([]);
  const [attachmentMessage, setAttachmentMessage] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [openedAt, setOpenedAt] = React.useState<string>(() => new Date().toISOString());
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const selectedFilesRef = React.useRef<ScreenshotPreview[]>([]);

  const { data: organization } = useQuery<CurrentOrganization>({
    queryKey: ["/api/organization/current"],
    queryFn: async () => {
      const response = await fetch("/api/organization/current", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch organization");
      return response.json();
    },
    enabled: open,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const currentUrl = typeof window !== "undefined" ? window.location.href : "";
  const screenSize =
    typeof window !== "undefined"
      ? `${window.screen.width} x ${window.screen.height}`
      : "";

  const form = useForm<BugReportFormValues>({
    resolver: zodResolver(bugReportSchema),
    defaultValues: {
      type: "bug",
      title: "",
      description: "",
      severity: "medium",
      screenshots: [],
    },
  });

  React.useEffect(() => {
    if (open) {
      setOpenedAt(new Date().toISOString());
      setAttachmentMessage(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;

    const handlePaste = (event: ClipboardEvent) => {
      const files = getClipboardImageFiles(event);
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files, "paste");
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [open, selectedFiles]);

  React.useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  React.useEffect(() => {
    return () => {
      selectedFilesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  const mutation = useMutation({
    mutationFn: async (values: BugReportFormValues) => {
      const screenshotAttachments = await uploadScreenshots(values.screenshots ?? []);
      const screenshotUrls = screenshotAttachments.map((item) => item.storagePath);
      const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();

      const created = await createBugReport({
        type: values.type,
        title: values.title,
        description: values.description,
        severity: values.severity,
        url: currentUrl,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        screenWidth: typeof window !== "undefined" ? window.screen.width : undefined,
        screenHeight: typeof window !== "undefined" ? window.screen.height : undefined,
        screenshotUrls,
        screenshotAttachments,
        metadata: {
          autoContext: {
            capturedAt: openedAt,
            currentPageUrl: currentUrl,
            routePath: typeof window !== "undefined" ? window.location.pathname : "",
            routeName: getRouteName(),
            pageTitle: typeof document !== "undefined" ? document.title : "",
            browserUserAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
            user: user ? {
              id: user.id,
              name: displayName || user.email || null,
              email: user.email ?? null,
            } : null,
            organization: organization ? {
              id: organization.id ?? null,
              name: organization.name ?? null,
              slug: organization.slug ?? null,
            } : null,
          },
        },
      });

      return created;
    },
    onSuccess: () => {
      toast({ title: "Feedback submitted", description: "Thank you! We'll look into it." });
      resetAndClose();
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  function syncFiles(next: ScreenshotPreview[]) {
    setSelectedFiles(next);
    form.setValue("screenshots", next.map((item) => item.file), { shouldValidate: true });
  }

  function addFiles(files: File[], source: "browse" | "drop" | "paste") {
    const existing = selectedFiles.map((item) => item.file);
    const message = validateScreenshotSelection(existing, files);
    if (message) {
      setAttachmentMessage(message);
      toast({ title: "Attachment limit exceeded", description: message, variant: "destructive" });
      return;
    }

    const previews = files.map((file) => ({
      id: `${source}-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    syncFiles([...selectedFiles, ...previews]);
    setAttachmentMessage(null);
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []), "browse");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files ?? []), "drop");
  };

  const handleRemoveFile = (id: string) => {
    const removed = selectedFiles.find((item) => item.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    syncFiles(selectedFiles.filter((item) => item.id !== id));
    setAttachmentMessage(null);
  };

  const resetAndClose = () => {
    form.reset();
    selectedFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setSelectedFiles([]);
    setAttachmentMessage(null);
    setIsDragging(false);
    onClose();
  };

  const handleClose = () => {
    if (!mutation.isPending) {
      resetAndClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-destructive" />
            Send Feedback
          </DialogTitle>
          <DialogDescription>
            Send a bug report or feature request. Your session context will be captured automatically.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Feedback type</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="flex items-center gap-6"
                    >
                      <label htmlFor="feedback-type-bug" className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="bug" id="feedback-type-bug" />
                        Bug Report
                      </label>
                      <label htmlFor="feedback-type-feature" className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="feature" id="feedback-type-feature" />
                        Feature Request
                      </label>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Brief summary of your feedback..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="severity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Severity</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select severity" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the issue or request in detail..."
                      className="min-h-[110px] resize-y"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormItem>
              <div className="space-y-1">
                <FormLabel>Attachments ({selectedFiles.length}/{MAX_SCREENSHOTS})</FormLabel>
                <p className="text-xs text-muted-foreground">
                  Upload, drag in, or paste screenshots with Ctrl+V after using the Snipping Tool.
                </p>
              </div>

              <div
                className={[
                  "rounded-md border border-dashed px-3 py-3 transition-colors",
                  isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/20",
                ].join(" ")}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                {selectedFiles.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {selectedFiles.map((item, index) => (
                      <div key={item.id} className="group relative overflow-hidden rounded-md border border-border bg-background">
                        <img
                          src={item.previewUrl}
                          alt={`Screenshot ${index + 1}`}
                          className="h-20 w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(item.id)}
                          className="absolute right-1 top-1 rounded-full bg-background/95 p-1 text-foreground shadow-sm opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
                          aria-label={`Remove screenshot ${index + 1}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div className="absolute inset-x-0 bottom-0 bg-background/90 px-1.5 py-0.5 text-[11px] truncate">
                          {item.file.name || `Screenshot ${index + 1}`}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <ImagePlus className="h-5 w-5" />
                    <span>Drop screenshots here, paste with Ctrl+V, or browse.</span>
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={selectedFiles.length >= MAX_SCREENSHOTS}
                  >
                    <Upload className="h-4 w-4" />
                    Browse
                  </Button>
                  <span className="text-xs text-muted-foreground">10 MB each, 25 MB total</span>
                </div>
              </div>

              {attachmentMessage ? (
                <p role="alert" className="text-xs text-destructive">{attachmentMessage}</p>
              ) : null}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </FormItem>

            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
              <p><span className="font-medium">URL:</span> {currentUrl}</p>
              <p><span className="font-medium">Page:</span> {getRouteName()}</p>
              {screenSize && <p><span className="font-medium">Screen:</span> {screenSize}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={handleClose} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Submitting..." : "Submit feedback"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
