import { useAuth } from "@/hooks/useAuth";
import { Redirect } from "wouter";
import AdminDashboard from "@/components/admin-dashboard";
import AdminSettings from "@/components/admin-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
          <p className="text-muted-foreground">Manage quotes, products, and settings</p>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList data-testid="tabs-admin">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" data-testid="content-dashboard">
          <AdminDashboard />
        </TabsContent>

        <TabsContent value="settings" data-testid="content-settings">
          <AdminSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
