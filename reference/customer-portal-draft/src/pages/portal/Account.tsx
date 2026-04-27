import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  User,
  Building2,
  Mail,
  Phone,
  LogOut,
  Lock,
  Bell,
  ShieldCheck,
  Info,
} from "lucide-react";

function ComingSoonBadge() {
  return (
    <Badge variant="outline" className="text-xs font-normal text-muted-foreground border-muted">
      Coming soon
    </Badge>
  );
}

function ReadOnlyNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Profile editing is not yet available. Contact your account manager to update this information.
      </span>
    </div>
  );
}

function FieldRow({ label, value, icon: Icon }: { label: string; value: string | undefined | null; icon?: React.ElementType }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground text-xs uppercase tracking-wide">{label}</Label>
      <div className="flex items-center gap-2 text-sm">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <span className="text-foreground">{value || "—"}</span>
      </div>
    </div>
  );
}

export default function Account() {
  const { user, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="space-y-6 p-6 max-w-3xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Unable to load account information.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Account</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View your profile and account settings.
        </p>
      </div>

      {/* ── 1. Profile Summary ────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Profile
          </CardTitle>
          <CardDescription>Your identity and company information.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadOnlyNotice />
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Full Name" value={`${user.firstName} ${user.lastName}`} icon={User} />
            <FieldRow label="Email" value={user.email} icon={Mail} />
            <FieldRow label="Company" value={user.customerName} icon={Building2} />
            <FieldRow label="Account ID" value={user.customerId} icon={ShieldCheck} />
          </div>
        </CardContent>
      </Card>

      {/* ── 2. Contact Information ────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4" />
            Contact Information
          </CardTitle>
          <CardDescription>Billing and shipping contact details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ReadOnlyNotice />

          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">Billing Contact</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Name" value={`${user.firstName} ${user.lastName}`} />
              <FieldRow label="Email" value={user.email} icon={Mail} />
              <FieldRow label="Phone" value={null} icon={Phone} />
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">Default Shipping Contact</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Name" value={null} />
              <FieldRow label="Email" value={null} icon={Mail} />
              <FieldRow label="Phone" value={null} icon={Phone} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Shipping contact information is not yet available from your account.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── 3. Notification Preferences ───────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Notification Preferences
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            Manage how you receive updates.
            <ComingSoonBadge />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { id: "proof-notifications", label: "Proof notifications", desc: "Get notified when new proofs are ready for review." },
            { id: "order-status", label: "Order status updates", desc: "Receive updates when your order status changes." },
            { id: "invoice-reminders", label: "Invoice reminders", desc: "Get reminders about upcoming or overdue invoices." },
          ].map((pref) => (
            <div key={pref.id} className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor={pref.id} className="text-sm font-medium text-foreground">
                  {pref.label}
                </Label>
                <p className="text-xs text-muted-foreground">{pref.desc}</p>
              </div>
              <Switch id={pref.id} disabled checked={false} aria-label={pref.label} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Notification preferences will be available once backend support is confirmed.
          </p>
        </CardContent>
      </Card>

      {/* ── 4. Security ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            Security
          </CardTitle>
          <CardDescription>Manage your account security.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Password change placeholder */}
          <div className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Change password</p>
              <p className="text-xs text-muted-foreground">
                Password management is not yet available through the portal.
              </p>
            </div>
            <Button variant="outline" size="sm" disabled>
              Change
            </Button>
          </div>

          <Separator />

          {/* Sign out */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Sign out</p>
              <p className="text-xs text-muted-foreground">
                End your current session.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 5. Status / Access ────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Status &amp; Access
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Portal Role</Label>
              <div>
                <Badge variant="secondary">Customer</Badge>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Account Status</Label>
              <div>
                <Badge variant="outline" className="border-green-500/40 text-green-700 dark:text-green-400">
                  Active
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
