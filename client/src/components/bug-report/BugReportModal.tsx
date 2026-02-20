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
import { useToast } from "@/hooks/use-toast";

// ─── Zod schema (mirrors backend validation) ─────────────────────────────────

const bugReportSchema = z.object({
  title:       z.string().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().min(3, "Description must be at least 3 characters").max(5000),
  severity:    z.enum(["low", "medium", "high", "critical"]),
  screenshot:  z.instanceof(File).optional().nullable(),
});

type BugReportFormValues = z.infer<typeof bugReportSchema>;

// ─── API helpers ──────────────────────────────────────────────────────────────

async function uploadScreenshot(file: File): Promise<string | null> {
  const formData = new FormData();
  formData.append("screenshot", file);

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
  return body.screenshotUrl ?? null;
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

  return res.json();
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
  const [screenshotName, setScreenshotName] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const currentUrl = typeof window !== "undefined" ? window.location.href : "";
  const screenSize =
    typeof window !== "undefined"
      ? `${window.screen.width} × ${window.screen.height}`
      : "";

  const form = useForm<BugReportFormValues>({
    resolver: zodResolver(bugReportSchema),
    defaultValues: {
      title:       "",
      description: "",
      severity:    "medium",
      screenshot:  null,
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: BugReportFormValues) => {
      let screenshotUrl: string | null = null;

      if (values.screenshot) {
        screenshotUrl = await uploadScreenshot(values.screenshot);
      }

      return createBugReport({
        title:        values.title,
        description:  values.description,
        severity:     values.severity,
        url:          currentUrl,
        screenWidth:  typeof window !== "undefined" ? window.screen.width : undefined,
        screenHeight: typeof window !== "undefined" ? window.screen.height : undefined,
        screenshotUrl,
      });
    },
    onSuccess: () => {
      toast({ title: "Bug report submitted", description: "Thank you! We'll look into it." });
      form.reset();
      setScreenshotName(null);
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    form.setValue("screenshot", file);
    setScreenshotName(file?.name ?? null);
  };

  const handleRemoveScreenshot = () => {
    form.setValue("screenshot", null);
    setScreenshotName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (!mutation.isPending) {
      form.reset();
      setScreenshotName(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-destructive" />
            Report a Bug
          </DialogTitle>
          <DialogDescription>
            Describe the issue you encountered. Your session context will be captured automatically.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Brief summary of the bug…" {...field} />
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
                      placeholder="Steps to reproduce, expected vs actual behaviour…"
                      className="min-h-[120px] resize-y"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Screenshot (optional) */}
            <FormItem>
              <FormLabel>Screenshot <span className="text-muted-foreground font-normal">(optional, max 5 MB)</span></FormLabel>
              {screenshotName ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <span className="flex-1 truncate text-foreground">{screenshotName}</span>
                  <button
                    type="button"
                    onClick={handleRemoveScreenshot}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remove screenshot"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  Attach screenshot
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
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
                {mutation.isPending ? "Submitting…" : "Submit report"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
