import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { SettingsLayout, CompanySettings, PreferencesSettings, UsersSettings, AccountingSettings, ProductionSettings, InventorySettings, NotificationsSettings, AppearanceSettings } from "@/pages/settings/SettingsLayout";
import EmailSettings from "@/pages/settings/email";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { ROUTES } from "@/config/routes";
import Login from "@/pages/login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import SetPasswordPage from "@/pages/set-password";
import ForcePasswordChange from "@/pages/force-password-change";
import Home from "@/pages/home";
import { QuoteEditorPage } from "@/features/quotes/editor/QuoteEditorPage";
import CustomerQuotes from "@/pages/customer-quotes";
import InternalQuotes from "@/pages/internal-quotes";
import ApprovalsPage from "@/pages/ApprovalsPage";
import Admin from "@/pages/admin";
import AdminUsers from "@/pages/admin-users";
import UserManagement from "@/pages/user-management";
import Customers from "@/pages/customers";
import CustomerDetail from "@/pages/customer-detail-enhanced";
import Orders from "@/pages/orders";
import OrderDetail from "@/pages/order-detail";
import QuoteEditorRoute from "@/pages/quote-editor";
import OrderNewRoute from "@/pages/order-new";
import Contacts from "@/pages/contacts";
import ContactDetail from "@/pages/contact-detail";
import CompanySettingsPage from "@/pages/company-settings";
import DebugUser from "@/pages/debug-user";
import NotFound from "@/pages/not-found";
import MyQuotes from "@/pages/portal/my-quotes";
import MyOrders from "@/pages/portal/my-orders";
import QuoteCheckout from "@/pages/portal/quote-checkout";
import ProductionBoard from "@/pages/production";
import ProductionJobDetailPage from "@/pages/production-job-detail";
import JobDetail from "@/pages/job-detail";
import ProductTypesSettings from "@/pages/settings/product-types";
import PricingFormulasSettings from "@/pages/settings/pricing-formulas";
import SettingsIntegrations from "@/pages/settings/integrations";
import InvoicesListPage from "@/pages/invoices";
import InvoiceDetailPage from "@/pages/invoice-detail";
import MaterialsListPage from "@/pages/materials";
import MaterialDetailPage from "@/pages/material-detail";
import VendorsPage from "@/pages/vendors";
import VendorDetailPage from "@/pages/vendor-detail";
import PurchaseOrdersPage from "@/pages/purchase-orders";
import PurchaseOrderDetailPage from "@/pages/purchase-order-detail";
import ProductsPage from "@/pages/products";
import ProductEditorPage from "@/pages/ProductEditorPage";
import PrepressPage from "@/pages/prepress";
import ProductBuilderV2Page from "@/pages/product-builder-v2";

function Router() {
  const { user, isAuthenticated, isLoading, mustChangePassword } = useAuth();

  // While loading auth status, show nothing (or a loading spinner)
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // If not authenticated, only show login route
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // If authenticated but must change password (invited user), force password change
  if (mustChangePassword) {
    return (
      <Routes>
        <Route path="/force-password-change" element={<ForcePasswordChange />} />
        <Route path="*" element={<Navigate to="/force-password-change" replace />} />
      </Routes>
    );
  }

  // Legacy: If user has mustSetPassword flag, redirect to set-password
  if (user?.mustSetPassword) {
    return (
      <Routes>
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="*" element={<Navigate to="/set-password" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Redirect login to dashboard if already authenticated */}
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />

      {/* All authenticated routes share the AppLayout */}
      <Route element={<AppLayout />}>
        {/* Root redirect to dashboard */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Dashboard */}
        <Route path="/dashboard" element={<Home />} />

        {/* Portal routes (customer-facing) */}
        <Route path="/portal/my-quotes" element={<MyQuotes />} />
        <Route path="/portal/my-orders" element={<MyOrders />} />
        <Route path="/portal/quotes/:id/checkout" element={<QuoteCheckout />} />

        {/* Quote routes */}
        <Route path={ROUTES.quotes.new} element={<QuoteEditorRoute />} />
        <Route path={ROUTES.quotes.edit(":id")} element={<QuoteEditorPage mode="edit" />} />
        <Route path={ROUTES.quotes.detail(":id")} element={<QuoteEditorPage mode="view" />} />
        <Route path={ROUTES.quotes.list} element={<InternalQuotes />} />
        <Route path="/my-quotes" element={<CustomerQuotes />} />
        <Route path="/approvals" element={<ApprovalsPage />} />

        {/* Admin routes */}
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/products" element={<ProductsPage />} />
        <Route path="/admin/product-types" element={<ProductTypesSettings />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/admin" element={<Admin />} />
        
        {/* Prepress (standalone PDF preflight tool) */}
        <Route path="/prepress" element={<PrepressPage />} />

        {/* Customer routes */}
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/customers" element={<Customers />} />

        {/* Contact routes */}
        <Route path="/contacts/:id" element={<ContactDetail />} />
        <Route path="/contacts" element={<Contacts />} />

        {/* Order routes */}
        <Route path={ROUTES.orders.new} element={<OrderNewRoute />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/orders" element={<Orders />} />

        {/* Inventory / Materials routes */}
        <Route path="/materials/:id" element={<MaterialDetailRoute />} />
        <Route path="/materials" element={<MaterialsListPage />} />

        {/* Procurement routes */}
        <Route path="/vendors/:id" element={<VendorDetailPage />} />
        <Route path="/vendors" element={<VendorsPage />} />
        <Route
          path="/purchase-orders/:id"
          element={<PurchaseOrderDetailPage />}
        />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />

        {/* Invoice routes */}
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/invoices" element={<InvoicesListPage />} />

        {/* Production workflow routes */}
        <Route path="/production" element={<ProductionBoard />} />
        <Route path="/production/flatbed" element={<ProductionBoard />} />
        <Route path="/production/roll" element={<ProductionBoard />} />
        <Route path="/production/apparel" element={<ProductionBoard />} />
        <Route path="/production/jobs/:jobId" element={<ProductionJobDetailPage />} />
        <Route path="/jobs/:id" element={<JobDetail />} />

        {/* Product Catalog (standalone) */}
        <Route path="/products" element={<ProductsPage />} />

        {/* Product Editor (legacy V1 with V1 tree view) */}
        <Route path="/products/new" element={<ProductEditorPage />} />
        <Route path="/products/:productId/edit" element={<ProductEditorPage />} />

        {/* PBV2 Builder V2 (full-screen, responsive 3-column layout) */}
        <Route path="/products/:productId/builder-v2" element={<ProductBuilderV2Page />} />

        {/* Settings routes - nested under SettingsLayout */}
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<CompanySettings />} />
          <Route path="company" element={<CompanySettings />} />
          <Route path="preferences" element={<PreferencesSettings />} />
          <Route path="users" element={<UsersSettings />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="product-types" element={<ProductTypesSettings />} />
          <Route path="pricing-formulas" element={<PricingFormulasSettings />} />
          <Route path="integrations" element={<SettingsIntegrations />} />
          <Route path="email" element={<EmailSettings />} />
          <Route path="production" element={<ProductionSettings />} />
          <Route path="inventory" element={<InventorySettings />} />
          <Route path="notifications" element={<NotificationsSettings />} />
          <Route path="appearance" element={<AppearanceSettings />} />
        </Route>

        {/* Misc */}
        <Route path="/debug-user" element={<DebugUser />} />
      </Route>

      {/* Catch-all not found */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function MaterialDetailRoute() {
  const { id } = useParams<{ id: string }>();
  // `MaterialDetailPage` expects a `{ params }` prop; adapt React Router params here.
  return <MaterialDetailPage params={{ id: id ?? "" }} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
