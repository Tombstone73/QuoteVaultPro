import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Building2, Mail, Phone, MapPin, Globe, Edit, DollarSign, FileText, Users, MessageSquare, CreditCard, Trash2, Package, Plus, Calendar } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import CustomerForm from "@/components/customer-form";
import ContactForm from "@/components/contact-form";
import NoteForm from "@/components/note-form";
import CreditForm from "@/components/credit-form";
import { useOrders } from "@/hooks/useOrders";
import { OrderStatusBadge, OrderPriorityBadge } from "@/components/order-status-badge";
import { format } from "date-fns";

// Component for showing customer orders
function OrdersForCustomer({ customerId }: { customerId: string }) {
  const { data: orders, isLoading } = useOrders({ customerId });

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy");
    } catch {
      return "-";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <span className="text-muted-foreground">Loading orders...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white">Orders</CardTitle>
          <Button size="sm" variant="secondary" className="bg-white/10 hover:bg-white/20 text-white">
            Configure Columns
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!orders || orders.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No orders yet</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1000px]">
              <div className="grid grid-cols-9 gap-3 px-4 py-2 text-xs text-muted-foreground">
                <div>Order #</div>
                <div>Date</div>
                <div>Product</div>
                <div>PO</div>
                <div>Qty</div>
                <div className="text-right">Amount</div>
                <div>Due Date</div>
                <div>Status</div>
                <div className="text-right">Actions</div>
              </div>
              <div className="space-y-2">
                {orders.map((order: any) => (
                  <div key={order.id} className="grid grid-cols-9 gap-3 items-center px-4 py-3 border border-white/10 rounded-lg bg-white/5">
                    <div className="font-mono text-white">{order.orderNumber}</div>
                    <div className="text-sm text-white/80">{formatDate(order.createdAt)}</div>
                    <div className="text-sm text-white/80 truncate">{Array.isArray(order.lineItems) && order.lineItems[0]?.productName || '—'}</div>
                    <div className="text-sm text-white/60">{order.purchaseOrderNumber || '—'}</div>
                    <div className="text-sm text-white/80">{Array.isArray(order.lineItems) ? order.lineItems.reduce((sum: number, li: any) => sum + (li.quantity || 0), 0) : 0}</div>
                    <div className="text-sm text-right text-white">{formatCurrency(order.total)}</div>
                    <div className="text-sm text-white/60">{formatDate(order.dueDate)}</div>
                    <div><OrderStatusBadge status={order.status} /></div>
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/orders/${order.id}`}><Button variant="ghost" size="icon" className="hover:bg-white/10"><Eye className="w-4 h-4" /></Button></Link>
                      <Link href={`/orders/${order.id}`}><Button variant="ghost" size="icon" className="hover:bg-white/10"><Edit2 className="w-4 h-4" /></Button></Link>
                      <Button variant="ghost" size="icon" className="hover:bg-white/10"><Download className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" className="hover:bg-white/10"><MailIcon className="w-4 h-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type CustomerContact = {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  isBilling: boolean;
};

type CustomerNote = {
  id: string;
  noteType: string;
  subject: string | null;
  content: string;
  createdAt: string;
};

type CustomerCreditTransaction = {
  id: string;
  transactionType: string;
  amount: string;
  balanceAfter: string;
  reason: string;
  status: string;
  createdAt: string;
};

type Quote = {
  id: string;
  quoteNumber: number;
  totalPrice: string;
  status: string;
  createdAt: string;
};

type CustomerWithRelations = {
  id: string;
  companyName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: string;
  customerType: string;
  shippingAddressLine1: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZipCode: string | null;
  billingAddressLine1: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZipCode: string | null;
  currentBalance: string;
  creditLimit: string;
  availableCredit: string;
  paymentTerms: string;
  internalNotes: string | null;
  contacts: CustomerContact[];
  notes: CustomerNote[];
  creditTransactions: CustomerCreditTransaction[];
  quotes: Quote[];
};

export default function CustomerDetail() {
  const { id } = useParams();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showEditForm, setShowEditForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showCreditForm, setShowCreditForm] = useState(false);
  const [editingContact, setEditingContact] = useState<CustomerContact | undefined>(undefined);
  const [contactToDelete, setContactToDelete] = useState<CustomerContact | null>(null);

  const { data: customer, isLoading } = useQuery<CustomerWithRelations>({
    queryKey: [`/api/customers/${id}`],
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const response = await fetch(`/api/customer-contacts/${contactId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete contact");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
      toast({ title: "Success", description: "Contact deleted successfully" });
      setContactToDelete(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading customer...</p>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Building2 className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Customer not found</p>
          <Link href="/customers">
            <Button className="mt-4">Back to Customers</Button>
          </Link>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "inactive": return "bg-gray-500/10 text-gray-500 border-gray-500/20";
      case "suspended": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "on_hold": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/customers">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-4">
                <Avatar className="w-12 h-12">
                  <AvatarFallback className="text-lg">{customer.companyName[0]}</AvatarFallback>
                </Avatar>
                <div>
                  <h1 className="text-2xl font-bold">{customer.companyName}</h1>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={getStatusColor(customer.status)}>
                      {customer.status.replace("_", " ")}
                    </Badge>
                    <Badge variant="outline">
                      {customer.customerType}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
            <Button onClick={() => setShowEditForm(true)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit Customer
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Contacts Section */}
        {customer.contacts.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Contacts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {customer.contacts.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => {
                      // Scroll to contacts tab
                      const contactsTab = document.querySelector('[value="contacts"]') as HTMLElement;
                      contactsTab?.click();
                      // Small delay to let tab switch, then scroll to contact
                      setTimeout(() => {
                        const contactElement = document.getElementById(`contact-${contact.id}`);
                        contactElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 100);
                    }}
                    className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent transition-colors cursor-pointer text-left"
                  >
                    <Avatar className="w-10 h-10">
                      <AvatarFallback>
                        {contact.firstName[0]}{contact.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium text-sm">
                        {contact.firstName} {contact.lastName}
                        {contact.isPrimary && (
                          <Badge variant="outline" className="ml-2 text-xs">Primary</Badge>
                        )}
                      </div>
                      {contact.title && (
                        <div className="text-xs text-muted-foreground">{contact.title}</div>
                      )}
                      {contact.email && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <Mail className="w-3 h-3" />
                          {contact.email}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Overview Cards */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Current Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${parseFloat(customer.currentBalance || '0').toFixed(2)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                ${(parseFloat(customer.creditLimit || '0') - parseFloat(customer.currentBalance || '0')).toFixed(2)} available credit
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Credit Limit</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${parseFloat(customer.creditLimit || '0').toFixed(2)}</div>
              <p className="text-xs text-muted-foreground mt-1">{(customer as any).creditTerms || 'Net 30'}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Quotes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{customer.quotes.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {customer.contacts.length} contact{customer.contacts.length !== 1 ? 's' : ''}
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">
              <Building2 className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="contacts">
              <Users className="w-4 h-4 mr-2" />
              Contacts ({customer.contacts.length})
            </TabsTrigger>
            <TabsTrigger value="quotes">
              <FileText className="w-4 h-4 mr-2" />
              Quotes ({customer.quotes.length})
            </TabsTrigger>
            <TabsTrigger value="orders">
              <Package className="w-4 h-4 mr-2" />
              Orders
            </TabsTrigger>
            <TabsTrigger value="activity">
              <MessageSquare className="w-4 h-4 mr-2" />
              Activity
            </TabsTrigger>
            <TabsTrigger value="credits">
              <CreditCard className="w-4 h-4 mr-2" />
              Credits
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Contact Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {customer.email && (
                    <div className="flex items-center gap-3">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium">Email</div>
                        <div className="text-sm text-muted-foreground">{customer.email}</div>
                      </div>
                    </div>
                  )}
                  {customer.phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium">Phone</div>
                        <div className="text-sm text-muted-foreground">{customer.phone}</div>
                      </div>
                    </div>
                  )}
                  {customer.website && (
                    <div className="flex items-center gap-3">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium">Website</div>
                        <div className="text-sm text-muted-foreground">{customer.website}</div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Shipping Address</CardTitle>
                </CardHeader>
                <CardContent>
                  {customer.shippingAddressLine1 ? (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-1" />
                      <div className="text-sm">
                        <div>{customer.shippingAddressLine1}</div>
                        {customer.shippingCity && (
                          <div>
                            {customer.shippingCity}, {customer.shippingState} {customer.shippingZipCode}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No shipping address</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="contacts">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Contacts</CardTitle>
                  <Button size="sm" onClick={() => setShowContactForm(true)}>
                    <Users className="w-4 h-4 mr-2" />
                    Add Contact
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {customer.contacts.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No contacts yet</p>
                ) : (
                  <div className="space-y-4">
                    {customer.contacts.map((contact) => (
                      <div
                        key={contact.id}
                        id={`contact-${contact.id}`}
                        className="flex items-center justify-between p-4 border rounded-lg scroll-mt-24"
                      >
                        <div className="flex items-center gap-4">
                          <Avatar>
                            <AvatarFallback>
                              {contact.firstName[0]}{contact.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">
                              {contact.firstName} {contact.lastName}
                              {contact.isPrimary && (
                                <Badge variant="outline" className="ml-2">Primary</Badge>
                              )}
                              {contact.isBilling && (
                                <Badge variant="outline" className="ml-2">Billing</Badge>
                              )}
                            </div>
                            {contact.title && (
                              <div className="text-sm text-muted-foreground">{contact.title}</div>
                            )}
                            <div className="flex gap-4 mt-1">
                              {contact.email && (
                                <div className="text-sm text-muted-foreground flex items-center gap-1">
                                  <Mail className="w-3 h-3" />
                                  {contact.email}
                                </div>
                              )}
                              {contact.phone && (
                                <div className="text-sm text-muted-foreground flex items-center gap-1">
                                  <Phone className="w-3 h-3" />
                                  {contact.phone}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingContact(contact);
                              setShowContactForm(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setContactToDelete(contact)}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quotes">
            <Card>
              <CardHeader>
                <CardTitle>Quotes</CardTitle>
              </CardHeader>
              <CardContent>
                {customer.quotes.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No quotes yet</p>
                ) : (
                  <div className="space-y-2">
                    {customer.quotes.map((quote) => (
                      <Link key={quote.id} href={`/quotes/${quote.id}/edit`}>
                        <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent cursor-pointer">
                          <div>
                            <div className="font-medium">Quote #{quote.quoteNumber}</div>
                            <div className="text-sm text-muted-foreground">
                              {new Date(quote.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">${parseFloat(quote.totalPrice).toFixed(2)}</div>
                            <Badge variant="outline">{quote.status}</Badge>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders">
            <OrdersForCustomer customerId={customer.id} />
          </TabsContent>

          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Activity Timeline</CardTitle>
                  <Button size="sm" onClick={() => setShowNoteForm(true)}>
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Add Note
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-center text-muted-foreground py-8">Activity timeline coming soon</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credits">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Credit Transactions</CardTitle>
                  {isAdmin && (
                    <Button size="sm" onClick={() => setShowCreditForm(true)}>
                      <DollarSign className="w-4 h-4 mr-2" />
                      Apply Credit
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {customer.creditTransactions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No credit transactions yet</p>
                ) : (
                  <div className="space-y-2">
                    {customer.creditTransactions.map((transaction) => (
                      <div key={transaction.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <div className="font-medium capitalize">{transaction.transactionType}</div>
                          <div className="text-sm text-muted-foreground">{transaction.reason}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(transaction.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`font-medium ${transaction.transactionType === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                            {transaction.transactionType === 'credit' ? '+' : '-'}${parseFloat(transaction.amount).toFixed(2)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Balance: ${parseFloat(transaction.balanceAfter).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <CustomerForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        customer={customer as any}
      />

      <ContactForm
        open={showContactForm}
        onOpenChange={(open) => {
          setShowContactForm(open);
          if (!open) setEditingContact(undefined);
        }}
        customerId={id!}
        contact={editingContact}
      />

      <NoteForm
        open={showNoteForm}
        onOpenChange={setShowNoteForm}
        customerId={id!}
      />

      {isAdmin && (
        <CreditForm
          open={showCreditForm}
          onOpenChange={setShowCreditForm}
          customerId={id!}
          currentBalance={parseFloat(customer.currentBalance || '0')}
          creditLimit={parseFloat(customer.creditLimit || '0')}
        />
      )}

      {/* Delete Contact Confirmation Dialog */}
      <AlertDialog open={!!contactToDelete} onOpenChange={(open) => !open && setContactToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {contactToDelete?.firstName} {contactToDelete?.lastName}? This action cannot be undone and will be logged in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => contactToDelete && deleteContactMutation.mutate(contactToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


