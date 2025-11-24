import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Calculator, FileText, LogOut, Settings, User, Eye, Users, Shield, Crown, Package, UserCircle, ShoppingCart } from "lucide-react";
import CalculatorComponent from "@/components/calculator";
import QuoteHistory from "@/components/quote-history";
import AdminDashboard from "@/components/admin-dashboard";
import AdminSettings from "@/components/admin-settings";
import CustomersPage from "@/pages/customers";
import OrdersPage from "@/pages/orders";
import AuditLogs from "@/pages/audit-logs";
import GlobalSearch from "@/components/global-search";

export default function Home() {
  const { user, isLoading, isAuthenticated, isAdmin } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
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
        navigate("/quotes");
      } else {
        navigate("/my-quotes");
      }
    } else if (value === "contacts") {
      navigate("/contacts");
    } else if (value === "portal-quotes") {
      navigate("/portal/my-quotes");
    } else if (value === "portal-orders") {
      navigate("/portal/my-orders");
    } else {
      setActiveTab(value);
    }
  };

  const showAdminFeatures = isAdmin && viewMode === "admin";

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const initials = user.firstName && user.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user.email?.[0]?.toUpperCase() || "U";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Calculator className="w-6 h-6 text-primary" data-testid="logo-calculator" />
              <h1 className="text-xl font-semibold" data-testid="text-app-title">Pricing Calculator</h1>
            </div>

            <div className="flex-1 max-w-md mx-4">
              <GlobalSearch />
            </div>

            <div className="flex items-center gap-4">
              {isAdmin && (
                <div className="flex items-center gap-2" data-testid="container-view-toggle">
                  <Eye className="w-4 h-4 text-muted-foreground" />
                  <Label htmlFor="view-mode" className="text-sm text-muted-foreground cursor-pointer" data-testid="label-view-mode">
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

              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full" data-testid="button-user-menu">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={user.profileImageUrl || undefined} alt={user.email || "User"} />
                    <AvatarFallback data-testid="text-user-initials">{initials}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" data-testid="menu-user">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none" data-testid="text-user-name">
                      {user.firstName && user.lastName
                        ? `${user.firstName} ${user.lastName}`
                        : "User"}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground" data-testid="text-user-email">
                      {user.email || "No email"}
                    </p>
                    {user.role === "owner" && (
                      <p className="text-xs leading-none text-purple-600 font-medium flex items-center gap-1" data-testid="text-owner-badge">
                        <Crown className="w-3 h-3" />
                        Owner
                      </p>
                    )}
                    {user.role === "admin" && (
                      <p className="text-xs leading-none text-primary font-medium flex items-center gap-1" data-testid="text-admin-badge">
                        <Shield className="w-3 h-3" />
                        Admin
                      </p>
                    )}
                    {user.role === "manager" && (
                      <p className="text-xs leading-none text-muted-foreground font-medium" data-testid="text-manager-badge">
                        Manager
                      </p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isAdmin && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link href="/users" data-testid="link-user-management">
                        <Users className="w-4 h-4 mr-2" />
                        User Management
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/admin" data-testid="link-admin-settings">
                        <Settings className="w-4 h-4 mr-2" />
                        Admin Settings
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/settings" data-testid="link-company-settings">
                        <Settings className="w-4 h-4 mr-2" />
                        Company Settings
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem asChild>
                  <a href="/api/logout" data-testid="button-logout">
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={handleTabChange} data-testid="tabs-main">
          <TabsList className="grid w-full max-w-3xl mx-auto" style={{
            gridTemplateColumns: showAdminFeatures
              ? 'repeat(6, 1fr)'
              : viewMode === 'customer'
                ? 'repeat(3, 1fr)'
                : 'repeat(5, 1fr)'
          }}>
            <TabsTrigger value="calculator" data-testid="tab-calculator">
              <Calculator className="w-4 h-4 mr-2" />
              Calculator
            </TabsTrigger>
            {viewMode === 'customer' ? (
              <>
                <TabsTrigger value="portal-quotes" data-testid="tab-portal-quotes">
                  <FileText className="w-4 h-4 mr-2" />
                  My Quotes
                </TabsTrigger>
                <TabsTrigger value="portal-orders" data-testid="tab-portal-orders">
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  My Orders
                </TabsTrigger>
              </>
            ) : (
              <TabsTrigger value="quotes" data-testid="tab-quotes">
                <FileText className="w-4 h-4 mr-2" />
                {viewMode === 'admin' ? 'Quotes' : 'My Quotes'}
              </TabsTrigger>
            )}
            {viewMode === 'admin' && (
              <>
                <TabsTrigger value="customers" data-testid="tab-customers">
                  <Users className="w-4 h-4 mr-2" />
                  Companies
                </TabsTrigger>
                <TabsTrigger value="contacts" data-testid="tab-contacts">
                  <UserCircle className="w-4 h-4 mr-2" />
                  Contacts
                </TabsTrigger>
                <TabsTrigger value="orders" data-testid="tab-orders">
                  <Package className="w-4 h-4 mr-2" />
                  Orders
                </TabsTrigger>
              </>
            )}
            {showAdminFeatures && (
              <>
                <TabsTrigger value="admin" data-testid="tab-admin">
                  <User className="w-4 h-4 mr-2" />
                  Admin
                </TabsTrigger>
                <TabsTrigger value="settings" data-testid="tab-settings">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </TabsTrigger>
              </>
            )}
            {isOwner && (
              <TabsTrigger value="audit-logs" data-testid="tab-audit-logs">
                <Shield className="w-4 h-4 mr-2" />
                Audit Log
              </TabsTrigger>
            )}
          </TabsList>

          <div className="mt-8">
            <TabsContent value="calculator" data-testid="content-calculator">
              <CalculatorComponent />
            </TabsContent>

            {/* Quotes tab now navigates directly, no content needed */}

            {viewMode === 'admin' && (
              <>
                <TabsContent value="customers" data-testid="content-customers">
                  <CustomersPage embedded={true} />
                </TabsContent>
                <TabsContent value="orders" data-testid="content-orders">
                  <OrdersPage />
                </TabsContent>
              </>
            )}

            {showAdminFeatures && (
              <>
                <TabsContent value="admin" data-testid="content-admin">
                  <AdminDashboard />
                </TabsContent>

                <TabsContent value="settings" data-testid="content-settings">
                  <AdminSettings />
                </TabsContent>
              </>
            )}

            {isOwner && (
              <TabsContent value="audit-logs" data-testid="content-audit-logs">
                <AuditLogs />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </main>
    </div>
  );
}
