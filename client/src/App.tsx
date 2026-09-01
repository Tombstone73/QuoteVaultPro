import { useEffect, useRef } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { SettingsLayout, CompanySettings, PreferencesSettings, AccountingSettings, ProductionSettings, InventorySettings, NotificationsSettings, AppearanceSettings } from "@/pages/settings/SettingsLayout";
import LocalBridgeSettings from "@/pages/settings/LocalBridgeSettings";
import EmailSettings from "@/pages/settings/email";
import UsersSettings from "@/pages/settings/users";
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
import TitanDashboard from "@/pages/titan-dashboard";
import AdminDashboard from "@/pages/admin-dashboard";
import { QuoteEditorPage } from "@/features/quotes/editor/QuoteEditorPage";
import CustomerQuotes from "@/pages/customer-quotes";
import InternalQuotes from "@/pages/internal-quotes";
import ApprovalsPage from "@/pages/ApprovalsPage";
import StaffProofingPage from "@/pages/StaffProofingPage";
import Admin from "@/pages/admin";
import Customers from "@/pages/customers";
import CustomerPortalAccessPage from "@/pages/CustomerPortalAccessPage";
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
import PortalDashboardPage from "@/pages/portal/dashboard";
import PortalDocumentsPage from "@/pages/portal/documents";
import PortalProfilePage from "@/pages/portal/profile";
import PortalOrderDetailPage from "@/pages/portal/order-detail";
import PortalProofDetailPage from "@/pages/portal/proof-detail";
import PortalProofsPage from "@/pages/portal/proofs";
import PortalQuoteDetailPage from "@/pages/portal/quote-detail";
import PortalInvoicesPage from "@/pages/portal/invoices";
import PortalInvoiceDetailPage from "@/pages/portal/invoice-detail";
import { PortalLayout } from "@/components/portal/PortalLayout";
import PortalProofPage from "@/pages/portal/portal-proof";
import ProductionBoard from "@/pages/production";
import ProductionJobDetailPage from "@/pages/production-job-detail";
import ProductionTicketPage from "@/pages/production-ticket";
import OrderTravelerPage from "@/pages/order-traveler";
import JobDetail from "@/pages/job-detail";
import ProductTypesSettings from "@/pages/settings/product-types";
import PricingFormulasSettings from "@/pages/settings/pricing-formulas";
import SettingsIntegrations from "@/pages/settings/integrations";
import QuickBooksSyncQueuePage from "@/pages/settings/quickbooks-sync-queue";
import AdminTools from "@/pages/settings/admin-tools";
import SetupSettings from "@/pages/settings/SetupSettings";
import StorageSettingsPage from "@/pages/settings/storage";
import AiSettingsPage from "@/pages/settings/ai";
import AiKnowledgePage from "@/pages/settings/ai-knowledge";
import PrinterSettingsPage from "@/pages/settings/printers";
import InvoicesListPage from "@/pages/invoices";
import InvoiceDetailPage from "@/pages/invoice-detail";
import MaterialsListPage from "@/pages/materials";
import MaterialDetailPage from "@/pages/material-detail";
import VendorsPage from "@/pages/vendors";
import VendorDetailPage from "@/pages/vendor-detail";
import PurchaseOrdersPage from "@/pages/purchase-orders";
import PurchaseOrderDetailPage from "@/pages/purchase-order-detail";
import PurchaseOrderNewPage from "@/pages/purchase-order-new";
import ProductsPage from "@/pages/products";
import ProductEditorPage from "@/pages/ProductEditorPage";
import PrepressPage from "@/pages/prepress";
import DesignProductionPage from "@/pages/DesignProductionPage";
import PrepressProductionPageV2 from "@/pages/PrepressProductionPageV2";
import ProductBuilderV2Page from "@/pages/product-builder-v2";
import PlatformDeveloperToolsPage from "@/pages/platform/PlatformDeveloperToolsPage";
import PlatformOrgCreatePage from "@/pages/platform/PlatformOrgCreatePage";
import AcceptInvitePage from "@/pages/accept-invite";
import SelectOrgPage from "@/pages/SelectOrgPage";
import BugReportsPage from "@/pages/admin/BugReportsPage";
import CatalogMigrationLab from "@/pages/admin/CatalogMigrationLab";
import ProductIntakeDraftReviewPage from "@/pages/admin/ProductIntakeDraftReviewPage";
import ProductImportExport from "@/pages/admin/ProductImportExport";
import PricingAuditPage from "@/pages/admin/PricingAuditPage";
import MaterialsImportExport from "@/pages/admin/MaterialsImportExport";
import QBInvoiceInspectorPage from "@/pages/admin/QBInvoiceInspectorPage";
import QBCustomerInspectorPage from "@/pages/admin/QBCustomerInspectorPage";
import CustomerContactMigrationPage from "@/pages/admin/CustomerContactMigrationPage";
import { NavigationGuardProvider } from "@/contexts/NavigationGuardContext";
import { useToast } from "@/hooks/use-toast";
import { SESSION_EXPIRED_EVENT, SESSION_EXPIRED_MESSAGE } from "@/lib/authUtils";
import FulfillmentPage from "@/pages/fulfillment";
import FulfillmentShipmentDetailPage from "@/pages/fulfillment-shipment-detail";
import FulfillmentWorkspacePage from "@/pages/fulfillment-workspace";
import FulfillmentShipmentManifestPage from "@/pages/fulfillment-shipment-manifest";
import LabelsPage from "@/pages/labels";
import ReportsPage from "@/pages/reports";
import ReportStudioRoute from "@/pages/report-studio";
import SharedReportPage from "@/pages/shared-report";
import FinancePage from "@/pages/finance";
import InboundOrdersPage from "@/pages/inbound-orders";
import {
  ProductPlanningBacklogPage,
  ProductPlanningDashboardPage,
  ProductPlanningImportsPage,
  ProductPlanningIndexRedirect,
  ProductPlanningKanbanPage,
  ProductPlanningRoadmapPage,
  ProductPlanningWorkItemDetailPage,
} from "@/pages/product-planning/ProductPlanningPages";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import SupportPage from "@/pages/support";
import Landing from "@/pages/landing";
import ByosPage from "@/pages/byos";

function PortalInvoiceLoginRedirect() {
  const location = useLocation();
  const returnTo = `${location.pathname}`;
  return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
}

function Router() {
  const { user, isAuthenticated, isLoading, mustChangePassword, isPortalCustomer } = useAuth();

  // While loading auth status, show nothing (or a loading spinner)
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // If not authenticated, only show login route (plus truly public routes)
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/byos" element={<ByosPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/portal/invoices/:id" element={<PortalInvoiceLoginRedirect />} />
        {/* Token-based proof review — no account required; the token IS the auth */}
        <Route path="/portal/proof/:token" element={<PortalProofPage />} />
        <Route path="/shared/reports/:token" element={<SharedReportPage />} />
        {/* Public legal/support pages */}
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // If authenticated but must change password (invited user), force password change
  if (mustChangePassword) {
    return (
      <Routes>
        <Route path="/force-password-change" element={<ForcePasswordChange />} />
        <Route path="/shared/reports/:token" element={<SharedReportPage />} />
        <Route path="/byos" element={<ByosPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="*" element={<Navigate to="/force-password-change" replace />} />
      </Routes>
    );
  }

  // Legacy: If user has mustSetPassword flag, redirect to set-password
  if (user?.mustSetPassword) {
    return (
      <Routes>
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/byos" element={<ByosPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="*" element={<Navigate to="/set-password" replace />} />
      </Routes>
    );
  }

  if (isPortalCustomer) {
    return (
      <Routes>
        <Route path="/portal/proof/:token" element={<PortalProofPage />} />
        <Route path="/shared/reports/:token" element={<SharedReportPage />} />
        <Route path="/portal" element={<PortalLayout />}>
          <Route index element={<PortalDashboardPage />} />
          <Route path="dashboard" element={<Navigate to="/portal" replace />} />
          <Route path="invoices" element={<PortalInvoicesPage />} />
          <Route path="invoices/:id" element={<PortalInvoiceDetailPage />} />
          <Route path="orders" element={<MyOrders />} />
          <Route path="my-orders" element={<Navigate to="/portal/orders" replace />} />
          <Route path="orders/:id" element={<PortalOrderDetailPage />} />
          <Route path="proofs" element={<PortalProofsPage />} />
          <Route path="proofs/:id" element={<PortalProofDetailPage />} />
          <Route path="quotes" element={<MyQuotes />} />
          <Route path="my-quotes" element={<Navigate to="/portal/quotes" replace />} />
          <Route path="quotes/:id" element={<PortalQuoteDetailPage />} />
          <Route path="documents" element={<PortalDocumentsPage />} />
          <Route path="profile" element={<PortalProfilePage />} />
          <Route path="quotes/:id/checkout" element={<Navigate to="/portal/quotes" replace />} />
        </Route>
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/login" element={<Navigate to="/portal" replace />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Public marketing landing page. Authenticated users keep /dashboard as the app home. */}
      <Route path="/" element={<Landing />} />
      <Route path="/byos" element={<ByosPage />} />
      <Route path="/shared/reports/:token" element={<SharedReportPage />} />

      {/* Redirect login to dashboard if already authenticated */}
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />

      {/* All authenticated routes share the AppLayout */}
      <Route element={<AppLayout />}>
        {/* Admin dashboard */}
        <Route path="/system/admin" element={<AdminDashboard />} />

        {/* Dashboard route compatibility */}
        <Route path="/dashboard" element={<TitanDashboard />} />

        {/* Quote routes */}
        <Route path={ROUTES.quotes.new} element={<QuoteEditorRoute />} />
        <Route path={ROUTES.quotes.edit(":id")} element={<QuoteEditorPage mode="edit" />} />
        <Route path={ROUTES.quotes.detail(":id")} element={<QuoteEditorPage mode="view" />} />
        <Route path={ROUTES.quotes.list} element={<InternalQuotes />} />
        <Route path="/my-quotes" element={<CustomerQuotes />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/production/proofing" element={<StaffProofingPage />} />

        {/* Admin routes */}
        <Route path="/admin/users" element={<Navigate to="/settings/users" replace />} />
        <Route path="/admin/products" element={<Navigate to="/settings/products" replace />} />
        <Route path="/admin/product-types" element={<Navigate to="/settings/product-types" replace />} />
        <Route path="/admin/bug-reports" element={<BugReportsPage />} />
        <Route path={ROUTES.admin.catalogMigrationLab} element={<CatalogMigrationLab />} />
        <Route path={ROUTES.admin.productIntakeReview(":sessionId")} element={<ProductIntakeDraftReviewPage />} />
        <Route path="/admin/products/import-export" element={<ProductImportExport />} />
        <Route path="/admin/pricing-audit" element={<PricingAuditPage />} />
        <Route path="/admin/materials/import-export" element={<MaterialsImportExport />} />
        <Route path="/admin/developer/qb-invoice-inspector" element={<QBInvoiceInspectorPage />} />
        <Route path="/admin/developer/qb-customer-inspector" element={<QBCustomerInspectorPage />} />
        <Route path={ROUTES.developer.customerContactMigration} element={<CustomerContactMigrationPage />} />
        <Route path="/users" element={<Navigate to="/settings/users" replace />} />
        <Route path="/admin/settings" element={<Navigate to="/settings" replace />} />
        <Route path="/system/admin/settings" element={<Navigate to="/settings" replace />} />
        <Route path="/admin" element={<Admin />} />
        
        {/* Prepress (standalone PDF preflight tool) */}
        <Route path="/prepress" element={<PrepressPage />} />

        {/* Customer routes */}
        <Route path={ROUTES.customers.portalAccess} element={<Navigate to={ROUTES.settings.customerPortal} replace />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/customers" element={<Customers />} />

        {/* Contact routes */}
        <Route path="/contacts/:id" element={<ContactDetail />} />
        <Route path="/contacts" element={<Contacts />} />

        {/* Order routes */}
        <Route path={ROUTES.orders.new} element={<OrderNewRoute />} />
        <Route path={ROUTES.orders.edit(":id")} element={<OrderDetail />} />
        <Route path={ROUTES.orders.detail(":id")} element={<OrderDetail />} />
        <Route path={ROUTES.orders.list} element={<Orders />} />
        <Route path={ROUTES.inboundOrders.list} element={<InboundOrdersPage />} />
        <Route path={ROUTES.productPlanning.root} element={<ProductPlanningIndexRedirect />} />
        <Route path={ROUTES.productPlanning.dashboard} element={<ProductPlanningDashboardPage />} />
        <Route path={ROUTES.productPlanning.backlog} element={<ProductPlanningBacklogPage />} />
        <Route path={ROUTES.productPlanning.workItemDetail(":id")} element={<ProductPlanningWorkItemDetailPage />} />
        <Route path={ROUTES.productPlanning.kanban} element={<ProductPlanningKanbanPage />} />
        <Route path={ROUTES.productPlanning.roadmap} element={<ProductPlanningRoadmapPage />} />
        <Route path={ROUTES.productPlanning.imports} element={<ProductPlanningImportsPage />} />

        {/* Inventory / Materials routes */}
        <Route path="/materials/:id" element={<MaterialDetailRoute />} />
        <Route path="/materials" element={<MaterialsListPage />} />

        {/* Procurement routes */}
        <Route path="/vendors/:id" element={<VendorDetailPage />} />
        <Route path="/vendors" element={<VendorsPage />} />
        <Route path="/purchase-orders/new" element={<PurchaseOrderNewPage />} />
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
        <Route path="/production/design" element={<DesignProductionPage />} />
        <Route path="/production/prepress" element={<PrepressProductionPageV2 />} />
        <Route path="/production/jobs/:jobId" element={<ProductionJobDetailPage />} />
        <Route path="/jobs/:id" element={<JobDetail />} />

        {/* Fulfillment routes */}
        <Route path={ROUTES.fulfillment.list} element={<FulfillmentPage />} />
        <Route path="/fulfillment/orders/:orderId" element={<FulfillmentWorkspacePage />} />
        <Route path="/fulfillment/shipments/:shipmentId/manifest" element={<FulfillmentShipmentManifestPage />} />
        <Route path="/fulfillment/shipments/:shipmentId" element={<FulfillmentShipmentDetailPage />} />
        <Route path={ROUTES.labels} element={<LabelsPage />} />
        <Route path={ROUTES.reports} element={<ReportsPage />} />
        <Route path="/reports/:reportId" element={<ReportStudioRoute />} />
        <Route path={ROUTES.finance} element={<FinancePage />} />

        {/* Product Catalog (standalone) */}
        <Route path="/products" element={<ProductsPage />} />

        {/* Product Editor */}
        <Route path="/products/new" element={<ProductEditorPage />} />
        <Route path="/products/:productId/edit" element={<ProductEditorPage />} />

        {/* PBV2 Builder V2 (full-screen, responsive 3-column layout) */}
        <Route path="/products/:productId/builder-v2" element={<ProductBuilderV2Page />} />

        {/* Settings routes - nested under SettingsLayout */}
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<CompanySettings />} />
          <Route path="company" element={<CompanySettings />} />
          <Route path="preferences" element={<PreferencesSettings />} />
          <Route path="customer-portal" element={<CustomerPortalAccessPage />} />
          <Route path="users" element={<UsersSettings />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="product-types" element={<ProductTypesSettings />} />
          <Route path="pricing-formulas" element={<PricingFormulasSettings />} />
          <Route path="integrations" element={<SettingsIntegrations />} />
          <Route path="integrations/quickbooks-sync-queue" element={<QuickBooksSyncQueuePage />} />
          <Route path="email" element={<EmailSettings />} />
          <Route path="ai" element={<AiSettingsPage />} />
          <Route path="ai/knowledge" element={<AiKnowledgePage />} />
          <Route path="storage" element={<StorageSettingsPage />} />
          <Route path="local-bridge" element={<LocalBridgeSettings />} />
          <Route path="production" element={<ProductionSettings />} />
          <Route path="printers" element={<PrinterSettingsPage />} />
          <Route path="inventory" element={<InventorySettings />} />
          <Route path="notifications" element={<NotificationsSettings />} />
          <Route path="appearance" element={<AppearanceSettings />} />
          <Route path="setup" element={<SetupSettings />} />
          <Route path="admin-tools" element={<AdminTools />} />
        </Route>

        {/* Misc */}
        <Route path="/debug-user" element={<DebugUser />} />

        {/* Platform admin */}
        <Route path={ROUTES.platform.tools} element={<PlatformDeveloperToolsPage />} />
        <Route path={ROUTES.platform.orgsNew} element={<PlatformOrgCreatePage />} />

        {/* Org picker (multi-org users) */}
        <Route path="/select-org" element={<SelectOrgPage />} />

        {/* Public invite acceptance (accessible while authenticated too) */}
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
      </Route>

      {/* Production ticket + order traveler — standalone, no app shell, so the
          browser print flow renders only the thermal ticket. Auth required. */}
      <Route path="/production/jobs/:jobId/ticket" element={<ProductionTicketPage />} />
      <Route path="/orders/:orderId/traveler" element={<OrderTravelerPage />} />

      {/* Proof review — standalone, no layout wrapper; token IS the auth.
          Rendered consistently whether or not the viewer is logged in. */}
      <Route path="/portal/proof/:token" element={<PortalProofPage />} />

      {/* Portal shell (auth-required portal pages with sidebar layout) */}
      <Route path="/portal" element={<PortalLayout />}>
        <Route index element={<PortalDashboardPage />} />
        <Route path="dashboard" element={<Navigate to="/portal" replace />} />
        <Route path="invoices" element={<PortalInvoicesPage />} />
        <Route path="invoices/:id" element={<PortalInvoiceDetailPage />} />
        <Route path="orders" element={<MyOrders />} />
        <Route path="my-orders" element={<Navigate to="/portal/orders" replace />} />
        <Route path="orders/:id" element={<PortalOrderDetailPage />} />
        <Route path="proofs" element={<PortalProofsPage />} />
        <Route path="proofs/:id" element={<PortalProofDetailPage />} />
        <Route path="quotes" element={<MyQuotes />} />
        <Route path="my-quotes" element={<Navigate to="/portal/quotes" replace />} />
        <Route path="quotes/:id" element={<PortalQuoteDetailPage />} />
        <Route path="documents" element={<PortalDocumentsPage />} />
        <Route path="profile" element={<PortalProfilePage />} />
        <Route path="quotes/:id/checkout" element={<Navigate to="/portal/quotes" replace />} />
      </Route>

      {/* Public legal/support pages — standalone, no app shell */}
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/support" element={<SupportPage />} />

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

function SessionExpiredRedirector() {
  const { toast } = useToast();
  const location = useLocation();
  const handledRef = useRef(false);

  useEffect(() => {
    const handleSessionExpired = () => {
      if (handledRef.current) return;
      if (/^\/(login|forgot-password|reset-password|set-password|accept-invite)(\/|$)/i.test(location.pathname)) {
        return;
      }

      handledRef.current = true;
      toast({
        title: "Session expired",
        description: SESSION_EXPIRED_MESSAGE,
        variant: "destructive",
      });
      queryClient.clear();

      const redirect = `${location.pathname}${location.search}`;
      window.setTimeout(() => {
        window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
      }, 250);
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [location.pathname, location.search, toast]);

  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <NavigationGuardProvider>
            <Toaster />
            <SessionExpiredRedirector />
            <Router />
          </NavigationGuardProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
