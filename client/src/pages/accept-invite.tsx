/**
 * AcceptInvitePage — /accept-invite?token=...
 *
 * Public page (accessible without authentication).
 *
 * States:
 *  1. loading      — previewing token validity
 *  2. invalid      — token not found, expired, or already used
 *  3. new-user     — valid invite, email not yet registered → show password form
 *  4. existing-user — valid invite, email already has an account → show accept button
 *  5. success      — invite accepted → redirects to /dashboard
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { useToast } from "@/hooks/use-toast";
import {
  acceptInvite,
  acceptPortalInvite,
  previewInvite,
  previewPortalInvite,
  type InvitePreviewResult,
} from "@/lib/api/platform";
import { sanitizePortalReturnTarget } from "@shared/portalReturnTarget";

// ─── Password form schema ─────────────────────────────────────────────────────

const passwordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type PasswordFormValues = z.infer<typeof passwordSchema>;

// ─── State types ──────────────────────────────────────────────────────────────

type PageState =
  | { phase: "loading" }
  | { phase: "invalid"; message: string }
  | { phase: "new-user"; preview: InvitePreviewResult }
  | { phase: "existing-user"; preview: InvitePreviewResult }
  | { phase: "submitting" }
  | { phase: "success"; email: string; redirectTo: string };

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const requestedKind = searchParams.get("kind");
  const returnTo = sanitizePortalReturnTarget(searchParams.get("returnTo"));
  const { toast } = useToast();

  const [state, setState] = useState<PageState>({ phase: "loading" });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PasswordFormValues>({ resolver: zodResolver(passwordSchema) });

  // Preview invite on mount
  useEffect(() => {
    if (!token) {
      setState({ phase: "invalid", message: "No invite token provided." });
      return;
    }

    const preview = async () => {
      if (requestedKind === "portal") {
        return previewPortalInvite(token);
      }

      const orgPreview = await previewInvite(token);
      if (orgPreview.body.success && orgPreview.body.status === "valid") {
        return orgPreview;
      }

      const portalPreview = await previewPortalInvite(token);
      if (portalPreview.body.success && portalPreview.body.status === "valid") {
        return portalPreview;
      }
      return orgPreview;
    };

    preview()
      .then(({ body }) => {
        if (!body.success || body.status !== "valid") {
          setState({
            phase: "invalid",
            message: body.message ?? "This invite is invalid or has expired.",
          });
          return;
        }

        if (body.kind !== "portal" && body.emailAlreadyRegistered) {
          setState({ phase: "existing-user", preview: body });
        } else {
          setState({ phase: "new-user", preview: body });
        }
      })
      .catch(() => {
        setState({ phase: "invalid", message: "Could not validate invite. Please try again." });
      });
  }, [token, requestedKind]);

  // Accept handler — used for both existing users (no password) and new users (with password)
  const doAccept = async (password?: string) => {
    const currentPreview =
      state.phase === "new-user" || state.phase === "existing-user" ? state.preview : null;

    setState({ phase: "submitting" });
    try {
      const isPortalInvite = currentPreview?.kind === "portal";
      const { httpStatus, body } = isPortalInvite
        ? await acceptPortalInvite(token, password || "", returnTo)
        : await acceptInvite(token, password);

      if (body.success) {
        const redirectTo = body.redirectTo || (isPortalInvite ? "/portal" : "/dashboard");
        setState({ phase: "success", email: body.data?.email || currentPreview?.email || "", redirectTo });
        // Give the browser a moment to set the session cookie before redirecting
        setTimeout(() => {
          window.location.href = redirectTo;
        }, 1500);
        return;
      }

      // Handle specific known codes
      if (httpStatus === 409) {
        setState({ phase: "invalid", message: "This invite has already been accepted." });
        return;
      }
      if (httpStatus === 410) {
        setState({ phase: "invalid", message: "This invite has expired." });
        return;
      }

      // Fallback error
      toast({
        title: "Failed to accept invite",
        description: body.message ?? "An unexpected error occurred.",
        variant: "destructive",
      });
      // Restore previous state so user can try again
      setState((prev) =>
        prev.phase === "submitting" ? { phase: "loading" } : prev
      );
      // Re-preview to restore correct state
      (requestedKind === "portal" ? previewPortalInvite(token) : previewInvite(token)).then(({ body: previewBody }) => {
        if (previewBody.success && previewBody.status === "valid") {
          setState(
            previewBody.kind !== "portal" && previewBody.emailAlreadyRegistered
              ? { phase: "existing-user", preview: previewBody }
              : { phase: "new-user", preview: previewBody }
          );
        }
      });
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
      setState({ phase: "loading" });
    }
  };

  const onPasswordSubmit = (values: PasswordFormValues) => doAccept(values.password);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (state.phase === "loading" || state.phase === "submitting") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground animate-pulse">
          {state.phase === "loading" ? "Validating invite…" : "Accepting invite…"}
        </p>
      </div>
    );
  }

  if (state.phase === "invalid") {
    return (
      <StatusCard
        title="Invite unavailable"
        description={state.message}
      >
        <Button asChild variant="outline" className="w-full">
          <a href="/login">Go to login</a>
        </Button>
      </StatusCard>
    );
  }

  if (state.phase === "success") {
    return (
      <StatusCard
        title="Welcome!"
        description={`Your account (${state.email}) is ready. Redirecting...`}
      />
    );
  }

  const preview = state.preview;
  const inviteName = preview.kind === "portal" ? preview.customerName || "your customer portal" : preview.orgName;

  if (state.phase === "existing-user") {
    return (
      <StatusCard
        title={`Join ${inviteName}`}
        description={`You have been invited to join ${inviteName} as ${preview.email}. Since you already have an account, click below to accept.`}
      >
        <Button className="w-full" onClick={() => doAccept()}>
          Accept &amp; Join {inviteName}
        </Button>
        <p className="text-xs text-muted-foreground text-center mt-3">
          Not you?{" "}
          <a href="/login" className="underline underline-offset-2 hover:text-foreground">
            Log in with a different account
          </a>
        </p>
      </StatusCard>
    );
  }

  // phase: new-user
  return (
    <StatusCard
      title={preview.kind === "portal" ? "Create Customer Portal Access" : `Join ${inviteName}`}
      description={
        preview.kind === "portal"
          ? `Create a password to access portal data for ${inviteName} as ${preview.email}.`
          : `You've been invited to join ${inviteName}. Create a password to set up your account for ${preview.email}.`
      }
    >
      <form onSubmit={handleSubmit(onPasswordSubmit)} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={preview.email ?? ""}
            readOnly
            className="bg-muted text-muted-foreground cursor-not-allowed"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="invite-password">
            Password <span className="text-destructive">*</span>
          </Label>
          <Input
            id="invite-password"
            type="password"
            autoFocus
            placeholder="At least 8 characters"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-destructive text-sm">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="invite-confirm">
            Confirm Password <span className="text-destructive">*</span>
          </Label>
          <Input
            id="invite-confirm"
            type="password"
            placeholder="Re-enter password"
            {...register("confirm")}
          />
          {errors.confirm && (
            <p className="text-destructive text-sm">{errors.confirm.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full">
          Create Account &amp; Join {preview.orgName}
        </Button>
      </form>
    </StatusCard>
  );
}
