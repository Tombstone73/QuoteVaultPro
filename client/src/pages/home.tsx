import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Calculator, FileText, Settings, User, Eye, Shield, Package, UserCircle, ShoppingCart, Factory, ClipboardList, AlertCircle } from "lucide-react";
import CalculatorComponent from "@/components/calculator";
import AdminDashboard from "@/components/admin-dashboard";
import AdminSettings from "@/components/admin-settings";
import CustomersPage from "@/pages/customers";
import OrdersPage from "@/pages/orders";
import AuditLogs from "@/pages/audit-logs";
import { Page, PageHeader, ContentLayout, DataCard } from "@/components/titan";
import { cn } from "@/lib/utils";

export default function Home() {
  console.log('[PAGE_MOUNT] Home');
  
  useEffect(() => {
    return () => console.log('[PAGE_UNMOUNT] Home');
  }, []);
  
  const { user, isLoading, isAuthenticated, isAdmin } = useAuth();
  const { preferences } = useOrgPreferences();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("calculator");
  const [viewMode, setViewMode] = useState<"admin" | "customer">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("viewMode");
      return saved === "customer" ? "customer" : "admin";
    }
    return "admin";
  });

  // Check if user is owner
  const isOwner = user?.role === "owner";

  // Check if user is approver
  const userRole = (user?.role || '').toLowerCase();
  const isApprover = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
  const requireApproval = preferences?.quotes?.requireApproval || false;
  const showApprovalsCard = isApprover && requireApproval && viewMode === "admin";

  // Fetch pending approvals count
  const { data: approvalsData } = useQuery({
    queryKey: ["/api/quotes/pending-approvals"],
    queryFn: async () => {
      const res = await fetch("/api/quotes/pending-approvals", {
        credentials: "include",
      });
      if (!res.ok) return { count: 0 };
      const data = await res.json();
      return data;
    },
    enabled: showApprovalsCard,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: 120_000,
  });

  const pendingApprovalsCount = approvalsData?.count || 0;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("viewMode", viewMode);
    }
  }, [viewMode]);

  const handleViewModeChange = (checked: boolean) => {
    const newMode = checked ? "admin" : "customer";
    setViewMode(newMode);
    if (newMode === "customer" && (activeTab === "admin" || activeTab === "settings")) {
      setActiveTab("calculator");
    }
  };

  const handleTabChange = (value: string) => {
    if (value === "quotes") {
      // Navigate to appropriate quotes page instead of showing tab content
      if (viewMode === "admin" && isAdmin) {
        navigate(ROUTES.quotes.list);
      } else {
        navigate(ROUTES.myQuotes);
      }
    } else if (value === "contacts") {
      navigate("/contacts");
    } else if (value === "portal-quotes") {
      navigate("/portal/my-quotes");
    } else if (value === "portal-orders") {
      navigate("/portal/my-orders");
    } else if (value === "production") {
      navigate("/production");
    } else {
      setActiveTab(value);
    }
  };

  const showAdminFeatures = isAdmin && viewMode === "admin";

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-titan-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-titan-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-titan-text-muted">Loading...</p>
        </div>
      </div>
    );
  }

  const initials = user.firstName && user.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user.email?.[0]?.toUpperCase() || "U";

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        subtitle="Pricing calculator and quick access to your workspace"
        className="pb-3"
        actions={
          <div className="flex items-center gap-4">
            {showAdminFeatures && (
              <Button
                onClick={() => navigate("/production")}
                size="sm"
                className="bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md text-titan-sm font-medium"
                data-testid="button-production"
              >
                <Factory className="h-4 w-4 mr-2" />
                Production
              </Button>
            )}
            {isAdmin && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-titan-md border border-titan-border bg-titan-bg-card-elevated" data-testid="container-view-toggle">
                <Eye className="w-4 h-4 text-titan-text-muted" />
                <Label htmlFor="view-mode" className="text-titan-sm text-titan-text-secondary cursor-pointer" data-testid="label-view-mode">
                  {viewMode === "admin" ? "Admin View" : "Customer View"}
                </Label>
                <Switch
                  id="view-mode"
                  checked={viewMode === "admin"}
                  onCheckedChange={handleViewModeChange}
                  data-testid="switch-view-mode"
                />
              </div>
            )}
          </div>
        }
      />

      <ContentLayout>
        {/* Pending Approvals Alert Card */}
        {showApprovalsCard && pendingApprovalsCount > 0 && (
          <Card className="mb-6 border-l-4 border-l-orange-500 bg-orange-50 dark:bg-orange-950/20">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-orange-100 dark:bg-orange-900/30 p-2">
                  <ClipboardList className="h-5 w-5 text-orange-600 dark:text-orange-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-orange-900 dark:text-orange-100">
                    Pending Approvals
                  </h3>
                  <p className="text-sm text-orange-700 dark:text-orange-300">
                    {pendingApprovalsCount} {pendingApprovalsCount === 1 ? 'quote requires' : 'quotes require'} your approval
                  </p>
                </div>
              </div>
              <Button
                onClick={() => navigate("/approvals")}
                variant="default"
                size="sm"
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                Review {pendingApprovalsCount}
              </Button>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full" data-testid="tabs-main">
          <TabsList 
            className={cn(
              "grid w-full max-w-3xl mx-auto bg-titan-bg-card-elevated border border-titan-border rounded-titan-lg p-1",
              showAdminFeatures
                ? 'grid-cols-6'
                : viewMode === 'customer'
                  ? 'grid-cols-3'
                  : 'grid-cols-5'
            )}
          >
            <TabsTrigger 
              value="calculator" 
              className="rounded-titan-md data-[state=active]:bg-titan-accent data-[state=active]:text-white text-titan-text-secondary"
              data-testid="tab-calculator"
            >
              <Calculator className="w-4 h-4 mr-2" />
              Calculator
            </TabsTrigger>
            {viewMode === 'customer' ? (
              <>
                <TabsTrigger 
                  value="portal-quotes" 
                  className="rounded-titan-md data-[state=active]:bg-titan-accent data-[state=active]:text-white text-titan-text-secondary"
                  data-testid="tab-portal-quotes"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  My Quotes
                </TabsTrigger>
                <TabsTrigger 
                  value="portal-orders" 
                  className="rounded-titan-md data-[state=active]:bg-titan-accent data-[state=active]:text-white text-titan-text-secondary"
                  data-testid="tab-portal-orders"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  My Orders
                </TabsTrigger>
              </>
            ) : (
              <TabsTrigger 
                value="quotes" 
                className="rounded-titan-md data-[state=active]:bg-titan-accent data-[state=active]:text-white text-titan-text-secondary"
                data-testid="tab-quotes"
              >
                <FileText className="w-4 h-4 mr-2" />
                {viewMode === 'admin' ? 'Quotes' : 'My Quotes'}
              </TabsTrigger>
            )}
            {viewMode === 'admin' && (
              <>
                <TabsTrigger 
                  value="contacts" 
                  className="rounded-titan-md data-[state=active]:bg-titan-accent data-[state=active]:text-white text-titan-text-secondary"
                  data-testid="tab-contacts"
                >
                  <UserCircle className="w-4 h-4 mr-2" />
                  Contacts
                </TabsTrigger>
                <TabsTrigger 
                  value="orders" 
                  className="rounded-titan-md data-[state=active]:bg-titan-accent data-[state=active]:text-white text-titan-text-secondary"
                  data-testid="tab-orders"
                >
                  <Package className="w-4 h-4 mr-2" />
                  Orders
                </TabsTrigger>
              </>
            )}
            {showAdminFeatures && (
              <>
                <TabsTrigger 
                  value="admin" 
                  className="rounded-titan-md data-[state=active]:bg-titan-accent data-[state=active]:text-white text-titan-text-secondary"
                  data-testid="tab-admin"
                >
                  <User className="w-4 h-4 mr-2" />
                  Admin
                </TabsTrigger>
                <TabsTrigger 
                  value="settings" 
                  className="rounded-titan-md data-[state=active]:bg-titan-accent data-[state=active]:text-white text-titan-text-secondary"
                  data-testid="tab-settings"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </TabsTrigger>
              </>
            )}
            {isOwner && (
              <TabsTrigger 
                value="audit-logs" 
                className="rounded-titan-md data-[state=active]:bg-titan-accent data-[state=active]:text-white text-titan-text-secondary"
                data-testid="tab-audit-logs"
              >
                <Shield className="w-4 h-4 mr-2" />
                Audit Log
              </TabsTrigger>
            )}
          </TabsList>

          <div className="mt-6">
            <TabsContent value="calculator" className="mt-0" data-testid="content-calculator">
              <DataCard className="bg-titan-bg-card border-titan-border-subtle">
                <CalculatorComponent />
              </DataCard>
            </TabsContent>

            {/* Quotes tab now navigates directly, no content needed */}

            {viewMode === 'admin' && (
              <>
                <TabsContent value="customers" className="mt-0" data-testid="content-customers">
                  <CustomersPage embedded={true} />
                </TabsContent>
                <TabsContent value="orders" className="mt-0" data-testid="content-orders">
                  <OrdersPage />
                </TabsContent>
              </>
            )}

            {showAdminFeatures && (
              <>
                <TabsContent value="admin" className="mt-0" data-testid="content-admin">
                  <DataCard className="bg-titan-bg-card border-titan-border-subtle">
                    <AdminDashboard />
                  </DataCard>
                </TabsContent>

                <TabsContent value="settings" className="mt-0" data-testid="content-settings">
                  <DataCard className="bg-titan-bg-card border-titan-border-subtle">
                    <AdminSettings />
                  </DataCard>
                </TabsContent>
              </>
            )}

            {isOwner && (
              <TabsContent value="audit-logs" className="mt-0" data-testid="content-audit-logs">
                <AuditLogs />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </ContentLayout>
    </Page>
  );
}
