/**
 * PlatformOrgCreatePage — /platform/orgs/new
 *
 * Platform-admin-only organization creation form.
 *
 * Flow:
 * 1. Fetch current user via useAuth(). If not platform admin → render NotFound.
 * 2. Render form: Org Name, Slug, "Create owner invite" checkbox, Owner Email.
 * 3. On submit, call POST /api/platform/orgs.
 *    - If 404 → show NotFound (shouldn't happen but defensive).
 *    - If 401 { code: STEP_UP_REQUIRED } → show step-up modal.
 * 4. Step-up modal: password entry → POST /api/platform/reauth → retry create.
 * 5. On success: show result card with orgId, inviteLink, and "Switch to org" link.
 */
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { platformReauth, createPlatformOrg } from "@/lib/api/platform";

// ─── Form schema ──────────────────────────────────────────────────────────────

const formSchema = z
  .object({
    name: z.string().min(1, "Org name is required").max(255).transform((v) => v.trim()),
    slug: z
      .string()
      .max(100)
      .regex(/^[a-z0-9-]*$/, "Lowercase letters, numbers, hyphens only")
      .optional()
      .transform((v) => (v ? v.trim() : undefined)),
    createOwnerInvite: z.boolean().default(false),
    ownerEmail: z.string().email("Valid email required").optional().or(z.literal("")),
  })
  .refine(
    (data) => !data.createOwnerInvite || (data.ownerEmail && data.ownerEmail.length > 0),
    { message: "Owner email is required when creating an invite", path: ["ownerEmail"] }
  );

type FormValues = z.infer<typeof formSchema>;

// ─── Step-up modal ────────────────────────────────────────────────────────────

interface StepUpModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function StepUpModal({ open, onClose, onSuccess }: StepUpModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await platformReauth(password);
      if (result.success) {
        setPassword("");
        onSuccess();
      } else {
        setError("Incorrect password. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm your identity</DialogTitle>
          <DialogDescription>
            This action requires recent authentication. Enter your password to continue.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="stepup-password">Password</Label>
            <Input
              id="stepup-password"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="Enter your password"
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !password}>
              {loading ? "Verifying…" : "Confirm"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Success card ─────────────────────────────────────────────────────────────

interface SuccessResult {
  orgId: string;
  slug: string;
  inviteLink: string;
  ownerEmail: string;
}

function SuccessCard({ result, onReset }: { result: SuccessResult; onReset: () => void }) {
  const { toast } = useToast();

  const handleCopy = () => {
    navigator.clipboard.writeText(result.inviteLink).then(() => {
      toast({ title: "Invite link copied" });
    });
  };

  return (
    <Card className="border-green-200 bg-green-50">
      <CardHeader>
        <CardTitle className="text-green-800">Organization created</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <span className="font-medium text-muted-foreground">Org ID</span>
          <p className="font-mono text-xs mt-0.5 break-all">{result.orgId}</p>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Owner Invite Email</span>
          <p className="mt-0.5">{result.ownerEmail}</p>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Invite Link</span>
          <p className="font-mono text-xs mt-0.5 break-all bg-white border rounded px-2 py-1.5 select-all">
            {result.inviteLink}
          </p>
        </div>
        <div className="flex gap-2 pt-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            Copy invite link
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/settings">Switch to Org settings</a>
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset}>
            Create another org
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlatformOrgCreatePage() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessResult | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  // Still loading auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // Mask from non-platform-admins
  if (!user?.isPlatformAdmin) {
    return <NotFound />;
  }

  const doCreate = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const { httpStatus, body } = await createPlatformOrg({
        name: values.name,
        slug: values.slug || undefined,
        ownerEmail: values.ownerEmail as string,
      });

      if (httpStatus === 404) {
        toast({ title: "Access denied", variant: "destructive" });
        return;
      }

      if (httpStatus === 401 && body.code === "STEP_UP_REQUIRED") {
        setStepUpOpen(true);
        return;
      }

      if (body.success && body.data) {
        setSuccess(body.data);
        reset();
      } else {
        toast({
          title: "Failed to create organization",
          description: body.message ?? "An unknown error occurred.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const onStepUpSuccess = async () => {
    setStepUpOpen(false);
    await handleSubmit(doCreate)();
  };

  if (success) {
    return (
      <div className="max-w-xl mx-auto py-8 px-4">
        <SuccessCard result={success} onReset={() => setSuccess(null)} />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create Organization</h1>
        <p className="text-muted-foreground text-sm mt-1">Platform admin · New tenant onboarding</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization details</CardTitle>
          <CardDescription>
            Creates a new tenant organization with an owner invite. Slug must be unique and URL-safe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(doCreate)} className="space-y-5">
            {/* Org Name */}
            <div className="space-y-1">
              <Label htmlFor="name">Org Name <span className="text-destructive">*</span></Label>
              <Input id="name" {...register("name")} placeholder="Acme Print Co." />
              {errors.name && <p className="text-destructive text-sm">{errors.name.message}</p>}
            </div>

            {/* Slug */}
            <div className="space-y-1">
              <Label htmlFor="slug">
                Slug{" "}
                <span className="text-muted-foreground font-normal">(optional — auto-derived from name)</span>
              </Label>
              <Input id="slug" {...register("slug")} placeholder="acme-print-co" className="font-mono" />
              {errors.slug && <p className="text-destructive text-sm">{errors.slug.message}</p>}
            </div>

            {/* Owner Email — always required */}
            <div className="space-y-1">
              <Label htmlFor="ownerEmail">Owner Email <span className="text-destructive">*</span></Label>
              <Input id="ownerEmail" type="email" {...register("ownerEmail")} placeholder="owner@example.com" />
              <p className="text-muted-foreground text-xs">
                A 7-day invite link will be generated for this address.
              </p>
              {errors.ownerEmail && <p className="text-destructive text-sm">{errors.ownerEmail.message}</p>}
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating…" : "Create Organization"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <StepUpModal
        open={stepUpOpen}
        onClose={() => setStepUpOpen(false)}
        onSuccess={onStepUpSuccess}
      />
    </div>
  );
}
