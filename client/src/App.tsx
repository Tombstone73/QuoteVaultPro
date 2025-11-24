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
          
          {/* Settings routes */}
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
