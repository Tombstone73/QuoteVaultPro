import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Bug, Upload, X } from "lucide-react";
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

// ─── Zod schema (mirrors backend validation) ─────────────────────────────────

const bugReportSchema = z.object({
  type:        z.enum(["bug", "feature"]).default("bug"),
  title:       z.string().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().min(3, "Description must be at least 3 characters").max(5000),
  severity:    z.enum(["low", "medium", "high", "critical"]),
  screenshots: z.array(z.instanceof(File)).max(5, "Maximum 5 screenshots allowed").optional(),
});

type BugReportFormValues = z.infer<typeof bugReportSchema>;

// ─── API helpers ──────────────────────────────────────────────────────────────

async function uploadScreenshots(files: File[]): Promise<string[]> {
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

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Screenshot upload failed");
  }

  const body = await res.json();
  return body.screenshotUrls ?? [];
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

// ─── Severity display helpers ─────────────────────────────────────────────────

const SEVERITY_LABELS: Record<string, string> = {
  low:      "Low — cosmetic issue, minor inconvenience",
  medium:   "Medium — degraded experience, workaround exists",
  high:     "High — feature broken, no workaround",
  critical: "Critical — data loss, security issue, or crash",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface BugReportModalProps {
  open: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BugReportModal({ open, onClose }: BugReportModalProps) {
  const { toast } = useToast();
  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const currentUrl = typeof window !== "undefined" ? window.location.href : "";
  const screenSize =
    typeof window !== "undefined"
      ? `${window.screen.width} × ${window.screen.height}`
      : "";

  const form = useForm<BugReportFormValues>({
    resolver: zodResolver(bugReportSchema),
    defaultValues: {
      type:        "bug",
      title:       "",
      description: "",
      severity:    "medium",
      screenshots: [],
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: BugReportFormValues) => {
      let screenshotUrls: string[] = [];
      let screenshotUploadWarning: string | null = null;

      if (values.screenshots && values.screenshots.length > 0) {
        try {
          screenshotUrls = await uploadScreenshots(values.screenshots);
        } catch (err) {
          screenshotUploadWarning = err instanceof Error
            ? err.message
            : "Screenshot upload failed";
        }
      }

      const created = await createBugReport({
        type:         values.type,
        title:        values.title,
        description:  values.description,
        severity:     values.severity,
        url:          currentUrl,
        screenWidth:  typeof window !== "undefined" ? window.screen.width : undefined,
        screenHeight: typeof window !== "undefined" ? window.screen.height : undefined,
        screenshotUrls,
      });

      return {
        ...created,
        screenshotUploadWarning,
      };
    },
    onSuccess: (result) => {
      toast({ title: "Feedback submitted", description: "Thank you! We'll look into it." });
      if (result.screenshotUploadWarning) {
        toast({
          title: "Submitted without screenshots",
          description: result.screenshotUploadWarning,
          variant: "destructive",
        });
      }
      form.reset();
      setSelectedFiles([]);
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    
    // Validate file count
    if (files.length + selectedFiles.length > 5) {
      toast({
        title: "Too many files",
        description: "Maximum 5 screenshots allowed",
        variant: "destructive",
      });
      return;
    }

    // Validate file sizes
    const invalidFiles = files.filter(f => f.size > 5 * 1024 * 1024);
    if (invalidFiles.length > 0) {
      toast({
        title: "File too large",
        description: "Each screenshot must be under 5 MB",
        variant: "destructive",
      });
      return;
    }

    const newFiles = [...selectedFiles, ...files];
    setSelectedFiles(newFiles);
    form.setValue("screenshots", newFiles);
  };

  const handleRemoveFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
    form.setValue("screenshots", newFiles);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (!mutation.isPending) {
      form.reset();
      setSelectedFiles([]);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
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
            {/* Feedback type */}
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

            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Brief summary of your feedback…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Severity */}
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

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the issue or request in detail…"
                      className="min-h-[120px] resize-y"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Screenshots (optional, up to 5) */}
            <FormItem>
              <FormLabel>Screenshots <span className="text-muted-foreground font-normal">(optional, max 5 files, 5 MB each)</span></FormLabel>
              
              {selectedFiles.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {selectedFiles.map((file, index) => {
                    const previewUrl = URL.createObjectURL(file);
                    return (
                      <div key={index} className="relative group rounded-md border border-border overflow-hidden bg-muted/30">
                        <img
                          src={previewUrl}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-24 object-cover"
                          onLoad={() => URL.revokeObjectURL(previewUrl)}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(index)}
                          className="absolute top-1 right-1 bg-background/90 hover:bg-background rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remove screenshot"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 bg-background/80 px-2 py-0.5 text-xs truncate">
                          {file.name}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedFiles.length < 5 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  {selectedFiles.length > 0 ? "Add more screenshots" : "Attach screenshots"}
                </Button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </FormItem>

            {/* Auto-captured read-only context */}
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
              <p><span className="font-medium">URL:</span> {currentUrl}</p>
              {screenSize && <p><span className="font-medium">Screen:</span> {screenSize}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={handleClose} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Submitting…" : "Submit feedback"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
