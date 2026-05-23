import { useAuth } from "@/hooks/useAuth";
import { Redirect, Link } from "wouter";
import AdminDashboard from "@/components/admin-dashboard";
import { Button } from "@/components/ui/button";
import { Settings, Users } from "lucide-react";

export default function Admin() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user || !user.isAdmin) {
    return <Redirect to="/" />;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Panel</h1>
          <p className="text-muted-foreground">Manage operational admin reporting</p>
        </div>
        <div className="flex items-center gap-2">
          {user.role === "owner" && (
            <Link href="/settings/users">
              <Button variant="outline">
                <Users className="w-4 h-4 mr-2" />
                Manage Users
              </Button>
            </Link>
          )}
          <Link href="/settings">
            <Button variant="outline">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
          </Link>
        </div>
      </div>

      <AdminDashboard />
    </div>
  );
}
