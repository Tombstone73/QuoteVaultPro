import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Database, Users, Package, Building2, Bug, AlertTriangle, Trash2, Ban, Loader2 } from "lucide-react";
import { TitanCard } from "@/components/titan";
import { DestructiveActionModal } from "@/components/DestructiveActionModal";
import { useToast } from "@/hooks/use-toast";

type Organization = {
  id: string;
  slug: string;
  name: string;
};

function formatDeletedCounts(counts: Record<string, number>): string {
  const significant = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  return significant || "nothing";
}

export default function AdminTools() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Transactional reset
  const [resetModalOpen, setResetModalOpen] = useState(false);

  // QB import reset
  const [qbResetModalOpen, setQBResetModalOpen] = useState(false);
  const [qbDisconnectOAuth, setQBDisconnectOAuth] = useState(false);
  const [qbDeleteCustomers, setQBDeleteCustomers] = useState(true);
  const [qbSlugInput, setQBSlugInput] = useState("");
  const [qbConfirmChecked, setQBConfirmChecked] = useState(false);
  const [qbIsSubmitting, setQBIsSubmitting] = useState(false);

  // Other danger zone
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Fetch current organization details
  const { data: organization, isLoading: orgLoading } = useQuery<Organization>({
    queryKey: ["/api/organization/current"],
    queryFn: async () => {
      const response = await fetch("/api/organization/current", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch organization");
      return response.json();
    },
  });

  // Reset organization transactional data
  const resetMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/org/reset", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to reset organization");
      }
      return response.json();
    },
    onSuccess: (data) => {
      const summary = data?.data?.deletedCounts
        ? `Deleted: ${formatDeletedCounts(data.data.deletedCounts)}.`
        : "Transactional data cleared.";
      toast({
        title: "Organization data reset",
        description: summary,
      });
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Reset failed",
        description: error.message,
      });
    },
  });

  // Reset QuickBooks import data
  const qbResetMutation = useMutation({
    mutationFn: async (opts: { disconnectOAuth: boolean; deleteQBCustomers: boolean }) => {
      const response = await fetch("/api/admin/org/reset-quickbooks-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to reset QuickBooks import data");
      }
      return response.json();
    },
    onSuccess: (data) => {
      const summary = data?.data?.deletedCounts
        ? `Deleted: ${formatDeletedCounts(data.data.deletedCounts)}.`
        : "QuickBooks import data cleared.";
      const warnings: string[] = data?.data?.warnings ?? [];
      toast({
        title: "QuickBooks import data reset",
        description: warnings.length > 0 ? `${summary} ${warnings[0]}` : summary,
      });
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "QB reset failed",
        description: error.message,
      });
    },
  });

  // Disable organization mutation
  const disableMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/org/disable", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to disable organization");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Organization disabled",
        description: "Non-admin users can no longer access this organization.",
      });
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Disable failed",
        description: error.message,
      });
    },
  });

  // Delete organization mutation (requests deletion)
  const deleteMutation = useMutation({
    mutationFn: async (reason?: string) => {
      const response = await fetch("/api/admin/org", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to request organization deletion");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Deletion requested",
        description: "A platform administrator must finalize this action. You will be notified when it's complete.",
      });
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Request failed",
        description: error.message,
      });
    },
  });

  const orgSlug = organization?.slug || "";
  const isActionsDisabled = orgLoading || !organization;

  const handleQBResetClose = () => {
    setQBSlugInput("");
    setQBConfirmChecked(false);
    setQBResetModalOpen(false);
  };

  const handleQBResetConfirm = async () => {
    if (qbSlugInput !== orgSlug || !qbConfirmChecked) return;
    setQBIsSubmitting(true);
    try {
      await qbResetMutation.mutateAsync({
        disconnectOAuth: qbDisconnectOAuth,
        deleteQBCustomers: qbDeleteCustomers,
      });
      handleQBResetClose();
    } catch {
      // Error shown via onError toast
    } finally {
      setQBIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <TitanCard className="p-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Admin Tools</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Infrequent administrative actions for data portability and organization lifecycle management
          </p>
        </div>
      </TitanCard>

      {/* Data Portability Section */}
      <TitanCard className="p-6">
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Database className="h-5 w-5 text-titan-accent" />
              <h3 className="text-titan-base font-semibold text-titan-text-primary">Data Portability</h3>
            </div>
            <p className="text-titan-sm text-titan-text-secondary">
              Import and export core system data in JSON format. Useful for backups, migrations, and bulk operations.
            </p>
          </div>

          <div className="h-px bg-titan-border-subtle" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Products Import/Export */}
            <Card className="border-titan-border bg-titan-bg-card-elevated">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="h-4 w-4 text-titan-accent" />
                  <CardTitle className="text-titan-sm">Products</CardTitle>
                </div>
                <CardDescription className="text-titan-xs">
                  Export products with PBV2 option trees, or import from JSON files
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link to="/admin/products/import-export">
                  <Button variant="outline" size="sm" className="w-full">
                    Manage Products Data
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Customers Import/Export (Placeholder) */}
            <Card className="border-titan-border bg-titan-bg-card-elevated opacity-60">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-titan-text-muted" />
                  <CardTitle className="text-titan-sm">Customers</CardTitle>
                </div>
                <CardDescription className="text-titan-xs">
                  Export customers and contacts, or import from JSON files
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" className="w-full" disabled>
                  Coming Soon
                </Button>
              </CardContent>
            </Card>

            {/* Materials Import/Export */}
            <Card className="border-titan-border bg-titan-bg-card-elevated">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Database className="h-4 w-4 text-titan-accent" />
                  <CardTitle className="text-titan-sm">Materials</CardTitle>
                </div>
                <CardDescription className="text-titan-xs">
                  Export materials as CSV, or bulk-import from a CSV with staged review
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link to="/admin/materials/import-export">
                  <Button variant="outline" size="sm" className="w-full">
                    Manage Materials Data
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </TitanCard>

      {/* Organization Lifecycle Section */}
      <TitanCard className="p-6">
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="h-5 w-5 text-titan-accent" />
              <h3 className="text-titan-base font-semibold text-titan-text-primary">Organization Lifecycle</h3>
            </div>
            <p className="text-titan-sm text-titan-text-secondary">
              Manage organizations, report bugs, and perform other system-level administrative tasks.
            </p>
          </div>

          <div className="h-px bg-titan-border-subtle" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Create Organization */}
            <Card className="border-titan-border bg-titan-bg-card-elevated">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-4 w-4 text-titan-accent" />
                  <CardTitle className="text-titan-sm">Create Organization</CardTitle>
                </div>
                <CardDescription className="text-titan-xs">
                  Create a new multi-tenant organization for development or testing
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link to="/platform/orgs/new">
                  <Button variant="outline" size="sm" className="w-full">
                    Create Organization
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Bug Reports */}
            <Card className="border-titan-border bg-titan-bg-card-elevated">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Bug className="h-4 w-4 text-titan-accent" />
                  <CardTitle className="text-titan-sm">Bug Reports</CardTitle>
                </div>
                <CardDescription className="text-titan-xs">
                  View and manage system bug reports and feedback
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link to="/admin/bug-reports">
                  <Button variant="outline" size="sm" className="w-full">
                    View Bug Reports
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </TitanCard>

      {/* Danger Zone Section */}
      <TitanCard className="p-6 border-destructive/50">
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h3 className="text-titan-base font-semibold text-destructive">Danger Zone</h3>
            </div>
            <p className="text-titan-sm text-titan-text-secondary">
              Irreversible administrative actions. Proceed with caution.
            </p>
          </div>

          <div className="h-px bg-destructive/20" />

          <div className="space-y-3">
            {/* Reset Organization Transactional Data */}
            <div className="flex items-start justify-between p-4 border border-border rounded-lg">
              <div className="space-y-1 flex-1">
                <h4 className="text-sm font-semibold text-titan-text-primary">Reset Organization Transactional Data</h4>
                <p className="text-xs text-titan-text-secondary">
                  Permanently deletes all orders, invoices, quotes, customers, production records, jobs, and audit history.
                  Preserved: organization record, users &amp; memberships, products, product options, PBV2 trees, materials, pricing formulas, company settings, email settings, and QuickBooks OAuth.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setResetModalOpen(true)}
                disabled={isActionsDisabled}
                className="ml-4 shrink-0"
              >
                Reset Data
              </Button>
            </div>

            {/* Reset QuickBooks Import Data */}
            <div className="flex items-start justify-between p-4 border border-border rounded-lg">
              <div className="space-y-1 flex-1">
                <h4 className="text-sm font-semibold text-titan-text-primary">Reset QuickBooks Import Data</h4>
                <p className="text-xs text-titan-text-secondary">
                  Removes QB-imported invoices, sync jobs, and optionally QB-sourced customers. Manually-created customers and orders are never deleted.
                  Preserved by default: organization, users, products, materials, pricing, and QuickBooks OAuth connection.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setQBResetModalOpen(true)}
                disabled={isActionsDisabled}
                className="ml-4 shrink-0"
              >
                Reset QB Data
              </Button>
            </div>

            {/* Disable Organization */}
            <div className="flex items-start justify-between p-4 border border-border rounded-lg">
              <div className="space-y-1 flex-1">
                <h4 className="text-sm font-semibold text-titan-text-primary">Disable Organization</h4>
                <p className="text-xs text-titan-text-secondary">
                  Prevents all non-admin access. Organization remains in system.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDisableModalOpen(true)}
                disabled={isActionsDisabled}
                className="ml-4 shrink-0"
              >
                <Ban className="h-4 w-4 mr-1" />
                Disable
              </Button>
            </div>

            {/* Delete Organization */}
            <div className="flex items-start justify-between p-4 border border-destructive/50 rounded-lg bg-destructive/5">
              <div className="space-y-1 flex-1">
                <h4 className="text-sm font-semibold text-destructive">Request Organization Deletion</h4>
                <p className="text-xs text-titan-text-secondary">
                  Submits a deletion request. A platform administrator must finalize this action.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteModalOpen(true)}
                disabled={isActionsDisabled}
                className="ml-4 shrink-0"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Request Deletion
              </Button>
            </div>
          </div>
        </div>
      </TitanCard>

      {/* Transactional Reset Modal */}
      <DestructiveActionModal
        open={resetModalOpen}
        onOpenChange={setResetModalOpen}
        title="Reset Organization Transactional Data"
        description="Permanently deletes all orders, invoices, quotes, customers, production records, and audit history for this organization. Products, users, company settings, and QuickBooks OAuth are preserved."
        confirmationSlug={orgSlug}
        confirmButtonText="Reset Transactional Data"
        onConfirm={async () => {
          await resetMutation.mutateAsync();
        }}
      />

      {/* QuickBooks Import Reset Modal */}
      <Dialog open={qbResetModalOpen} onOpenChange={handleQBResetClose}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <DialogTitle className="text-xl">Reset QuickBooks Import Data</DialogTitle>
            </div>
            <DialogDescription className="text-base pt-2">
              Removes QB-imported invoices, QB sync jobs, and optionally QB-sourced customers. Manually-created customers and orders are never removed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* QB-specific options */}
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-titan-text-secondary uppercase tracking-wide">Options</p>

              <div className="flex items-start space-x-2">
                <Checkbox
                  id="qb-delete-customers"
                  checked={qbDeleteCustomers}
                  onCheckedChange={(v) => setQBDeleteCustomers(v === true)}
                  disabled={qbIsSubmitting}
                />
                <div className="grid gap-0.5">
                  <label htmlFor="qb-delete-customers" className="text-sm font-medium leading-none">
                    Remove QB-imported customers
                  </label>
                  <p className="text-xs text-titan-text-muted">
                    Only customers with no linked orders or invoices will be deleted.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-2">
                <Checkbox
                  id="qb-disconnect-oauth"
                  checked={qbDisconnectOAuth}
                  onCheckedChange={(v) => setQBDisconnectOAuth(v === true)}
                  disabled={qbIsSubmitting}
                />
                <div className="grid gap-0.5">
                  <label htmlFor="qb-disconnect-oauth" className="text-sm font-medium leading-none">
                    Also disconnect QuickBooks OAuth connection
                  </label>
                  <p className="text-xs text-titan-text-muted">
                    Removes stored tokens. You'll need to reconnect QB to sync again.
                  </p>
                </div>
              </div>
            </div>

            {/* Slug verification */}
            <div className="space-y-2">
              <Label htmlFor="qb-slug-confirm" className="text-sm font-medium">
                Type <span className="font-mono font-semibold text-destructive">{orgSlug}</span> to confirm
              </Label>
              <Input
                id="qb-slug-confirm"
                value={qbSlugInput}
                onChange={(e) => setQBSlugInput(e.target.value)}
                placeholder="Enter organization slug"
                className="font-mono"
                disabled={qbIsSubmitting}
              />
            </div>

            {/* Irreversible checkbox */}
            <div className="flex items-start space-x-2">
              <Checkbox
                id="qb-understand-irreversible"
                checked={qbConfirmChecked}
                onCheckedChange={(v) => setQBConfirmChecked(v === true)}
                disabled={qbIsSubmitting}
              />
              <label
                htmlFor="qb-understand-irreversible"
                className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                I understand this action cannot be undone
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleQBResetClose} disabled={qbIsSubmitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleQBResetConfirm}
              disabled={qbSlugInput !== orgSlug || !qbConfirmChecked || qbIsSubmitting}
            >
              {qbIsSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset QuickBooks Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DestructiveActionModal
        open={disableModalOpen}
        onOpenChange={setDisableModalOpen}
        title="Disable Organization"
        description="This will prevent all non-admin users from accessing this organization. The organization will remain in the system but will be inaccessible to regular users."
        confirmationSlug={orgSlug}
        confirmButtonText="Disable Organization"
        onConfirm={async () => {
          await disableMutation.mutateAsync();
        }}
      />

      <DestructiveActionModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        title="Request Organization Deletion"
        description="This will submit a deletion request for platform administrator review. The organization will enter a pending state and a platform admin must finalize the deletion before it takes effect."
        confirmationSlug={orgSlug}
        confirmButtonText="Request Deletion"
        onConfirm={async () => {
          await deleteMutation.mutateAsync(undefined);
        }}
      />
    </div>
  );
}
