import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/portal/ui";

export const Route = createFileRoute("/portal-login")({
  head: () => ({
    meta: [
      { title: "Customer Sign In — Hensley Print Co." },
      { name: "description", content: "Sign in to review proofs, track orders, pay invoices and reorder print work." },
      { property: "og:title", content: "Customer Sign In — Hensley Print Co." },
      { property: "og:description", content: "Your print account: orders, proofs, invoices and reordering in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-card p-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">HP</span>
          <span className="text-sm font-semibold">Hensley Print Co.</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight">Your print account, always open.</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Approve proofs, track shipments, reorder your regular work at your contracted pricing, and settle several
            invoices in a single payment.
          </p>
        </div>
        <p className="text-[12px] text-muted-foreground">Need access? Contact your account representative.</p>
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <form
          className="w-full max-w-sm space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setBusy(true);
            setTimeout(() => {
              setBusy(false);
              navigate({ to: "/portal" });
            }, 700);
          }}
        >
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Use the email your shop has on file.</p>
          </div>

          {error && <Notice tone="danger" title="Sign in failed">{error}</Notice>}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" defaultValue="marta@blueridgeoutfitters.com" autoComplete="username" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <a href="#" onClick={(e) => e.preventDefault()} className="text-[12px] text-primary hover:underline">
                Forgot password?
              </a>
            </div>
            <Input id="password" type="password" defaultValue="••••••••••" autoComplete="current-password" />
          </div>

          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {busy ? "Signing in" : "Sign in"}
          </Button>

          <button
            type="button"
            className="w-full text-[12px] text-muted-foreground hover:underline"
            onClick={() => setError("We couldn't sign you in with those details. Check the email address and try again.")}
          >
            Preview the error state
          </button>
        </form>
      </div>
    </div>
  );
}
