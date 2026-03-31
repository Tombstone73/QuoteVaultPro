import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RuntimeConfigProvider } from "@/contexts/RuntimeConfigContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PortalLayout } from "@/components/PortalLayout";
import Login from "@/pages/portal/Login";
import Dashboard from "@/pages/portal/Dashboard";
import OrdersList from "@/pages/portal/OrdersList";
import QuotesList from "@/pages/portal/QuotesList";
import InvoicesList from "@/pages/portal/InvoicesList";
import InvoiceDetail from "@/pages/portal/InvoiceDetail";
import OrderDetail from "@/pages/portal/OrderDetail";
import QuoteDetail from "@/pages/portal/QuoteDetail";
import Account from "@/pages/portal/Account";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <RuntimeConfigProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/orders"
                element={
                  <ProtectedRoute>
                    <PortalLayout>
                      <OrdersList />
                    </PortalLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders/:orderId"
                element={
                  <ProtectedRoute>
                    <PortalLayout>
                      <OrderDetail />
                    </PortalLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/quotes"
                element={
                  <ProtectedRoute>
                    <PortalLayout>
                      <QuotesList />
                    </PortalLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/quotes/:quoteId"
                element={
                  <ProtectedRoute>
                    <PortalLayout>
                      <QuoteDetail />
                    </PortalLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/invoices"
                element={
                  <ProtectedRoute>
                    <PortalLayout>
                      <InvoicesList />
                    </PortalLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/invoices/:invoiceId"
                element={
                  <ProtectedRoute>
                    <PortalLayout>
                      <InvoiceDetail />
                    </PortalLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/account"
                element={
                  <ProtectedRoute>
                    <PortalLayout>
                      <Account />
                    </PortalLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <PortalLayout>
                      <Dashboard />
                    </PortalLayout>
                  </ProtectedRoute>
                }
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </RuntimeConfigProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
