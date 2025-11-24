/*
 * CONTACT DETAIL PAGE
 * 
 * Shows comprehensive information about a single contact including:
 * - Contact details (name, title, email, phone)
 * - Parent company information with link
 * - Recent orders (last 10)
 * - Recent quotes (last 10)
 * 
 * Complements the customer-detail page which shows all contacts for a company.
 * This provides a contact-centric view with activity history.
 */

import { useLocation, useRoute } from "wouter";
import { useContactDetail } from "@/hooks/useContacts";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mail, Phone, Building2, User, ExternalLink, Package, FileText } from "lucide-react";
import { Link } from "wouter";

export default function ContactDetailPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/contacts/:id");
  const contactId = params?.id;

  const { data, isLoading, error } = useContactDetail(contactId);

  // Role check - only internal users can access
  if (user?.role === "customer") {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-4">This page is only available to staff members.</p>
          <Button onClick={() => navigate("/")}>Return Home</Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading contact...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Contact Not Found</h1>
          <p className="text-muted-foreground mb-4">
            The contact you're looking for doesn't exist or you don't have permission to view it.
          </p>
          <Button onClick={() => navigate("/contacts")}>Back to Contacts</Button>
        </div>
      </div>
    );
  }

  const { contact, customer, recentOrders, recentQuotes } = data;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getOrderStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      new: "bg-blue-500",
      scheduled: "bg-indigo-500",
      in_production: "bg-yellow-500",
      ready_for_pickup: "bg-green-500",
      shipped: "bg-teal-500",
      completed: "bg-gray-500",
      on_hold: "bg-orange-500",
      canceled: "bg-red-500",
    };
    return colors[status] || "bg-gray-500";
  };

  const getQuoteStatusColor = (status: string | null) => {
    if (!status) return "bg-gray-500";
    const colors: Record<string, string> = {
      draft: "bg-gray-500",
      sent: "bg-blue-500",
      accepted: "bg-green-500",
      rejected: "bg-red-500",
      expired: "bg-orange-500",
    };
    return colors[status] || "bg-gray-500";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/contacts")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">
                {contact.firstName} {contact.lastName}
              </h1>
              {contact.title && (
                <p className="text-sm text-muted-foreground">{contact.title}</p>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-6 md:grid-cols-2 mb-6">
          {/* Contact Information Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Name</div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {contact.firstName} {contact.lastName}
                  </span>
                  {contact.isPrimary && (
                    <Badge variant="secondary">Primary Contact</Badge>
                  )}
                </div>
              </div>

              {contact.title && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Title</div>
                  <div>{contact.title}</div>
                </div>
              )}

              {contact.email && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Email</div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <a href={`mailto:${contact.email}`} className="hover:underline">
                      {contact.email}
                    </a>
                  </div>
                </div>
              )}

              {contact.phone && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Phone</div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <a href={`tel:${contact.phone}`} className="hover:underline">
                      {contact.phone}
                    </a>
                  </div>
                </div>
              )}

              {contact.mobile && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Mobile</div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <a href={`tel:${contact.mobile}`} className="hover:underline">
                      {contact.mobile}
                    </a>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Company Information Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Company Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Company Name</div>
                <div className="font-medium">{customer.companyName}</div>
              </div>

              {customer.email && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Company Email</div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <a href={`mailto:${customer.email}`} className="hover:underline">
                      {customer.email}
                    </a>
                  </div>
                </div>
              )}

              {customer.phone && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Company Phone</div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <a href={`tel:${customer.phone}`} className="hover:underline">
                      {customer.phone}
                    </a>
                  </div>
                </div>
              )}

              {customer.address && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Address</div>
                  <div className="text-sm">{customer.address}</div>
                </div>
              )}

              <div className="pt-4">
                <Link href={`/customers/${customer.id}`}>
                  <Button variant="outline" className="w-full">
                    View Company Details
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Orders */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Recent Orders
            </CardTitle>
            <CardDescription>Last 10 orders for this contact</CardDescription>
          </CardHeader>
          <CardContent>
            {recentOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No orders found for this contact.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.map((order) => (
                    <TableRow
                      key={order.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/orders/${order.id}`)}
                    >
                      <TableCell className="font-medium">{order.orderNumber}</TableCell>
                      <TableCell>
                        <Badge className={getOrderStatusColor(order.status)}>
                          {order.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(order.createdAt)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(order.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recent Quotes */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Recent Quotes
            </CardTitle>
            <CardDescription>Last 10 quotes for this contact</CardDescription>
          </CardHeader>
          <CardContent>
            {recentQuotes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No quotes found for this contact.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quote #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentQuotes.map((quote) => (
                    <TableRow
                      key={quote.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/quotes/${quote.id}`)}
                    >
                      <TableCell className="font-medium">#{quote.quoteNumber}</TableCell>
                      <TableCell>
                        {quote.status ? (
                          <Badge className={getQuoteStatusColor(quote.status)}>
                            {quote.status}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(quote.createdAt)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(quote.totalPrice)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
