import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/landing";
import Home from "@/pages/home";
import EditQuote from "@/pages/edit-quote";
import QuoteDetail from "@/pages/quote-detail";
import QuoteEditor from "@/pages/quote-editor";
import CustomerQuotes from "@/pages/customer-quotes";
import InternalQuotes from "@/pages/internal-quotes";
import Admin from "@/pages/admin";
import AdminUsers from "@/pages/admin-users";
import UserManagement from "@/pages/user-management";
import Customers from "@/pages/customers";
import CustomerDetail from "@/pages/customer-detail";
import Orders from "@/pages/orders";
import OrderDetail from "@/pages/order-detail";
import CreateOrder from "@/pages/create-order";
import Contacts from "@/pages/contacts";
import ContactDetail from "@/pages/contact-detail";
import CompanySettings from "@/pages/company-settings";
import DebugUser from "@/pages/debug-user";
import NotFound from "@/pages/not-found";
import MyQuotes from "@/pages/portal/my-quotes";
import MyOrders from "@/pages/portal/my-orders";
import QuoteCheckout from "@/pages/portal/quote-checkout";
import ProductionBoard from "@/pages/production";
import JobDetail from "@/pages/job-detail";
import ProductTypesSettings from "@/pages/settings/product-types";
import SettingsIntegrations from "@/pages/settings/integrations";
import InvoicesListPage from "@/pages/invoices";
import InvoiceDetailPage from "@/pages/invoice-detail";
import MaterialsListPage from "@/pages/materials";
import MaterialDetailPage from "@/pages/material-detail";
import VendorsPage from "@/pages/vendors";
import VendorDetailPage from "@/pages/vendor-detail";
import PurchaseOrdersPage from "@/pages/purchase-orders";
import PurchaseOrderDetailPage from "@/pages/purchase-order-detail";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      {isLoading || !isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          {/* Portal routes (customer-facing) */}
          <Route path="/portal/my-quotes" component={MyQuotes} />
          <Route path="/portal/my-orders" component={MyOrders} />
          <Route path="/portal/quotes/:id/checkout" component={QuoteCheckout} />
          
          {/* Quote routes */}
          <Route path="/quotes/new" component={QuoteEditor} />
          <Route path="/quotes/:id/edit" component={EditQuote} />
          <Route path="/quotes/:id" component={QuoteDetail} />
          <Route path="/quotes" component={InternalQuotes} />
          <Route path="/my-quotes" component={CustomerQuotes} />
          
          {/* Admin routes */}
          <Route path="/admin/users" component={AdminUsers} />
          <Route path="/users" component={UserManagement} />
          <Route path="/admin" component={Admin} />
          
          {/* Customer routes */}
          <Route path="/customers/:id" component={CustomerDetail} />
          <Route path="/customers">{() => <Customers />}</Route>
          
          {/* Contact routes */}
          <Route path="/contacts/:id" component={ContactDetail} />
          <Route path="/contacts" component={Contacts} />
          
          {/* Order routes */}
          <Route path="/orders/new" component={CreateOrder} />
          <Route path="/orders/:id" component={OrderDetail} />
          <Route path="/orders" component={Orders} />

          {/* Inventory / Materials routes */}
          <Route path="/materials/:id" component={MaterialDetailPage} />
          <Route path="/materials" component={MaterialsListPage} />

          {/* Procurement routes */}
          <Route path="/vendors/:id" component={VendorDetailPage} />
          <Route path="/vendors" component={VendorsPage} />
          <Route path="/purchase-orders/:id" component={PurchaseOrderDetailPage} />
          <Route path="/purchase-orders" component={PurchaseOrdersPage} />

          {/* Invoice routes */}
          <Route path="/invoices/:id" component={InvoiceDetailPage} />
          <Route path="/invoices" component={InvoicesListPage} />

          {/* Production workflow routes */}
          <Route path="/production" component={ProductionBoard} />
          <Route path="/jobs/:id" component={JobDetail} />
          
          {/* Settings routes */}
          <Route path="/settings/integrations" component={SettingsIntegrations} />
          <Route path="/settings/product-types" component={ProductTypesSettings} />
          <Route path="/settings" component={CompanySettings} />
          <Route path="/debug-user" component={DebugUser} />
          
          {/* Home */}
          <Route path="/" component={Home} />
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
