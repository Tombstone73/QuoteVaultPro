import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, Users, Package, Building2, Bug, AlertTriangle, Trash2, Ban } from "lucide-react";
import { TitanCard } from "@/components/titan";
import { DestructiveActionModal } from "@/components/DestructiveActionModal";
import { useToast } from "@/hooks/use-toast";

type Organization = {
  id: string;
  slug: string;
  name: string;
};

export default function AdminTools() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [resetModalOpen, setResetModalOpen] = useState(false);
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

  // Reset organization mutation
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
    onSuccess: () => {
      toast({
        title: "Organization reset initiated",
        description: "Transactional data is being deleted. This may take a few moments.",
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

  // Delete organization mutation (actually requests deletion)
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
            {/* Reset Organization Data */}
            <div className="flex items-start justify-between p-4 border border-border rounded-lg">
              <div className="space-y-1 flex-1">
                <h4 className="text-sm font-semibold text-titan-text-primary">Reset Organization Data</h4>
                <p className="text-xs text-titan-text-secondary">
                  Deletes transactional data (orders, invoices, quotes, production records) but preserves organization, users, and core configuration.
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

      {/* Confirmation Modals */}
      <DestructiveActionModal
        open={resetModalOpen}
        onOpenChange={setResetModalOpen}
        title="Reset Organization Data"
        description="This will permanently delete all transactional data including orders, invoices, quotes, and production records. Your organization, users, and core configuration will be preserved."
        confirmationSlug={orgSlug}
        confirmButtonText="Reset Data"
        onConfirm={async () => {
          await resetMutation.mutateAsync();
        }}
      />

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
