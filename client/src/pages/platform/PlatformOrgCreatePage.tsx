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
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
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
import {
  platformReauth,
  createPlatformOrg,
  listPlatformSeedOrganizations,
  previewConfigurationCopy,
  type ConfigurationCopyJobResult,
  type ConfigurationCopyPreview,
  type PlatformSeedOrganization,
} from "@/lib/api/platform";

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
    seedConfigurationEnabled: z.boolean().default(false),
    sourceOrganizationId: z.string().optional(),
  })
  .refine(
    (data) => !data.createOwnerInvite || (data.ownerEmail && data.ownerEmail.length > 0),
    { message: "Owner email is required when creating an invite", path: ["ownerEmail"] }
  )
  .refine(
    (data) => !data.seedConfigurationEnabled || Boolean(data.sourceOrganizationId),
    { message: "Choose a source organization to seed configuration", path: ["sourceOrganizationId"] }
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
  configurationCopy?: ConfigurationCopyJobResult | null;
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
        {result.configurationCopy && (
          <div className="rounded-md border bg-white p-3">
            <span className="font-medium text-muted-foreground">Configuration Copy</span>
            <p className="mt-0.5 font-medium capitalize">{result.configurationCopy.status}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              {Object.entries(result.configurationCopy.entityCounts ?? {}).map(([key, count]) => (
                <div key={key} className="rounded border px-2 py-1">
                  <span className="text-muted-foreground">{key}</span>
                  <span className="float-right font-semibold">{count}</span>
                </div>
              ))}
            </div>
            {result.configurationCopy.warnings?.length ? (
              <ul className="mt-2 list-disc pl-4 text-xs text-amber-700">
                {result.configurationCopy.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : null}
          </div>
        )}
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
  const [createState, setCreateState] = useState<"idle" | "creating" | "copying" | "validating">("idle");
  const [success, setSuccess] = useState<SuccessResult | null>(null);
  const [seedOrganizations, setSeedOrganizations] = useState<PlatformSeedOrganization[]>([]);
  const [seedOrgsLoading, setSeedOrgsLoading] = useState(false);
  const [preview, setPreview] = useState<ConfigurationCopyPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copyFailure, setCopyFailure] = useState<{ summary: string; orgId?: string; job?: ConfigurationCopyJobResult | null } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      seedConfigurationEnabled: false,
    },
  });

  const seedEnabled = watch("seedConfigurationEnabled");
  const sourceOrganizationId = watch("sourceOrganizationId");

  useEffect(() => {
    if (!user?.isPlatformAdmin) return;
    let cancelled = false;
    setSeedOrgsLoading(true);
    listPlatformSeedOrganizations()
      .then(({ body }) => {
        if (!cancelled && body.success) {
          setSeedOrganizations(body.data ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast({ title: "Could not load source organizations", variant: "destructive" });
        }
      })
      .finally(() => {
        if (!cancelled) setSeedOrgsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.isPlatformAdmin, toast]);

  useEffect(() => {
    setPreview(null);
  }, [sourceOrganizationId, seedEnabled]);

  const loadPreview = async () => {
    if (!sourceOrganizationId) return;
    setPreviewLoading(true);
    try {
      const { body } = await previewConfigurationCopy(sourceOrganizationId);
      if (body.success && body.data) {
        setPreview(body.data);
      } else {
        toast({
          title: "Preview failed",
          description: body.message ?? "Could not preview source configuration.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Network error", description: "Could not load configuration preview.", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

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
    setCreateState(values.seedConfigurationEnabled ? "copying" : "creating");
    setCopyFailure(null);
    try {
      const { httpStatus, body } = await createPlatformOrg({
        name: values.name,
        slug: values.slug || undefined,
        ownerEmail: values.ownerEmail as string,
        seedConfiguration: {
          enabled: values.seedConfigurationEnabled,
          sourceOrganizationId: values.seedConfigurationEnabled ? values.sourceOrganizationId : undefined,
        },
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
        setCreateState("validating");
        setSuccess(body.data);
        setPreview(null);
        reset();
      } else {
        if (body.code === "CONFIGURATION_COPY_FAILED" && body.data) {
          setCopyFailure({
            summary: body.message ?? "Configuration copy failed.",
            orgId: body.data.orgId,
            job: body.data.configurationCopy ?? null,
          });
        }
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
      setCreateState("idle");
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

            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="seedConfigurationEnabled"
                  checked={Boolean(seedEnabled)}
                  onCheckedChange={(checked) => setValue("seedConfigurationEnabled", checked === true, { shouldDirty: true, shouldValidate: true })}
                />
                <div className="space-y-1">
                  <Label htmlFor="seedConfigurationEnabled" className="font-medium">
                    Seed configuration from an existing organization
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Copies product catalog, PBV2 option/pricing configuration, materials, formula library, tax setup,
                    and production defaults. Customers, orders, invoices, emails, users, credentials, and production
                    history are never copied.
                  </p>
                </div>
              </div>

              {seedEnabled && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="sourceOrganizationId">Source organization</Label>
                    <select
                      id="sourceOrganizationId"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={seedOrgsLoading || submitting}
                      {...register("sourceOrganizationId")}
                    >
                      <option value="">{seedOrgsLoading ? "Loading organizations..." : "Choose source organization"}</option>
                      {seedOrganizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name} ({org.slug})
                        </option>
                      ))}
                    </select>
                    {errors.sourceOrganizationId && (
                      <p className="text-destructive text-sm">{errors.sourceOrganizationId.message}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Preview shows counts only. Create copies the complete product configuration graph with dependencies.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={loadPreview} disabled={!sourceOrganizationId || previewLoading}>
                      {previewLoading ? "Previewing..." : "Preview"}
                    </Button>
                  </div>

                  {preview && (
                    <div className="rounded-md border bg-background p-3 text-sm">
                      <div className="font-medium">
                        {preview.sourceOrganizationName} <span className="text-muted-foreground">({preview.sourceOrganizationSlug})</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        {Object.entries(preview.entityCounts).map(([key, count]) => (
                          <div key={key} className="rounded border px-2 py-1">
                            <span className="text-muted-foreground">{key}</span>
                            <span className="float-right font-semibold">{count}</span>
                          </div>
                        ))}
                      </div>
                      {preview.warnings.length > 0 && (
                        <ul className="mt-2 list-disc pl-4 text-xs text-amber-700">
                          {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {copyFailure && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
                <div className="font-medium text-destructive">Configuration copy failed</div>
                <p className="mt-1 text-muted-foreground">{copyFailure.summary}</p>
                {copyFailure.orgId && <p className="mt-2 font-mono text-xs">Organization created: {copyFailure.orgId}</p>}
                {copyFailure.job?.copyJobId && <p className="font-mono text-xs">Copy job: {copyFailure.job.copyJobId}</p>}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting
                ? createState === "copying"
                  ? "Creating and copying configuration..."
                  : createState === "validating"
                    ? "Validating copied configuration..."
                    : "Creating..."
                : "Create Organization"}
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
