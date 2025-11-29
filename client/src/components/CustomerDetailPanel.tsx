import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Building2, Mail, Phone, MapPin, Globe, Edit, DollarSign, FileText, Users, MessageSquare, CreditCard, Trash2, Package, Settings, Eye, Edit2, Download, Mail as MailIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import CustomerForm from "@/components/customer-form";
import ContactForm from "@/components/contact-form";
import NoteForm from "@/components/note-form";
import CreditForm from "@/components/credit-form";
import { useOrders } from "@/hooks/useOrders";
import { OrderStatusBadge, OrderPriorityBadge } from "@/components/order-status-badge";
import { format } from "date-fns";
import ColumnConfigModal from "@/components/ColumnConfigModal";

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
      <Card className="bg-card/50 border-border/60 backdrop-blur-sm">
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
    <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-foreground">Orders</CardTitle>
      </CardHeader>
      <CardContent>
        {!orders || orders.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No orders yet</p>
        ) : (
          <div className="space-y-2">
            {orders.map((order: any) => (
              <Link key={order.id} href={`/orders/${order.id}`}>
                <div className="flex items-center justify-between p-4 border border-border/60 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                  <div className="flex-1">
                    <div className="font-medium font-mono text-foreground">{order.orderNumber}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatDate(order.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <OrderStatusBadge status={order.status} />
                    <OrderPriorityBadge priority={order.priority} />
                    <div className="text-right">
                      <div className="font-medium text-foreground">{formatCurrency(order.total)}</div>
                      <div className="text-xs text-muted-foreground">
                        {Array.isArray(order.lineItems) ? order.lineItems.length : 0} items
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
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

interface CustomerDetailPanelProps {
  customerId: string | null;
  onEdit?: () => void;
  viewMode?: "split" | "enhanced";
  onToggleView?: () => void;
}

export default function CustomerDetailPanel({ customerId, onEdit, viewMode = "split", onToggleView }: CustomerDetailPanelProps) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showEditForm, setShowEditForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showCreditForm, setShowCreditForm] = useState(false);
  const [editingContact, setEditingContact] = useState<CustomerContact | undefined>(undefined);
  const [contactToDelete, setContactToDelete] = useState<CustomerContact | null>(null);
  const [showCustomizeCards, setShowCustomizeCards] = useState(false);
  const [showQuotesConfig, setShowQuotesConfig] = useState(false);
  const [showOrdersConfig, setShowOrdersConfig] = useState(false);
  const [enabledCards, setEnabledCards] = useState<{[key:string]: boolean}>({
    quotes: true,
    orders: true,
    sales: true,
    avgOrder: true,
    pendingQuotes: true,
    lastContact: true,
    customerRank: true,
  });

  const defaultQuoteColumns = [
    { id: 'quoteNumber', label: 'Quote #', enabled: true },
    { id: 'date', label: 'Date', enabled: true },
    { id: 'product', label: 'Product', enabled: true },
    { id: 'po', label: 'PO', enabled: true },
    { id: 'qty', label: 'Qty', enabled: true },
    { id: 'amount', label: 'Amount', enabled: true },
    { id: 'dueDate', label: 'Due Date', enabled: true },
    { id: 'status', label: 'Status', enabled: true },
    { id: 'actions', label: 'Actions', enabled: true },
  ];

  const [quoteColumns, setQuoteColumns] = useState(() => {
    const saved = localStorage.getItem('quoteColumns');
    return saved ? JSON.parse(saved) : defaultQuoteColumns;
  });

  const handleSaveQuoteColumns = (columns: typeof quoteColumns) => {
    setQuoteColumns(columns);
    localStorage.setItem('quoteColumns', JSON.stringify(columns));
  };

  const { data: customer, isLoading } = useQuery<CustomerWithRelations>({
    queryKey: [`/api/customers/${customerId}`],
    queryFn: async () => {
      if (!customerId) return null;
      const response = await fetch(`/api/customers/${customerId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customer");
      return response.json();
    },
    enabled: !!customerId,
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
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: "Success", description: "Contact deleted successfully" });
      setContactToDelete(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "inactive": return "bg-gray-500/10 text-gray-500 border-gray-500/20";
      case "suspended": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "on_hold": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  // Empty state
  if (!customerId) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background p-8">
        <Building2 className="w-16 h-16 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">No Customer Selected</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Select a customer from the list to view their details, contacts, quotes, and orders.
        </p>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading customer details...</p>
        </div>
      </div>
    );
  }

  // Not found state
  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background p-8">
        <Building2 className="w-16 h-16 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">Customer Not Found</h3>
        <p className="text-sm text-muted-foreground">
          The selected customer could not be found.
        </p>
      </div>
    );
  }

  return (
    <div className={viewMode === "enhanced" ? "flex flex-col h-full bg-background px-4" : "flex flex-col h-full bg-background"}>
      {/* Header */}
      <div className="p-6 border-b border-border/60">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <Avatar className="w-12 h-12">
              <AvatarFallback className="bg-primary/20 text-primary text-lg">
                {customer.companyName[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-xl font-bold text-foreground">{customer.companyName}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={getStatusColor(customer.status)}>
                  {customer.status.replace("_", " ")}
                </Badge>
                <Badge variant="outline" className="text-muted-foreground">
                  {customer.customerType}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {customerId && (
              <Button
                onClick={onToggleView}
                size="sm"
                variant="secondary"
                title={viewMode === "enhanced" ? "Switch to Split View" : "Switch to Enhanced View"}
              >
                {viewMode === "enhanced" ? "Split View" : "Enhanced View"}
              </Button>
            )}
            <Button 
            onClick={() => {
              setShowEditForm(true);
              onEdit?.();
            }}
            size="sm"
            variant="secondary"
          >
            <Edit className="w-4 h-4 mr-2" />
            Edit
            </Button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className={viewMode === "enhanced" ? `grid ${Object.values(enabledCards).filter(Boolean).length >= 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-4` : "grid grid-cols-3 gap-4"}>
          <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-foreground">
                ${parseFloat(customer.currentBalance || '0').toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                ${(parseFloat(customer.creditLimit || '0') - parseFloat(customer.currentBalance || '0')).toFixed(2)} available
              </p>
            </CardContent>
          </Card>

          {enabledCards.sales && (
          <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Sales</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-foreground">$0.00</div>
              <p className="text-xs text-muted-foreground mt-1">+0.0% vs prev month</p>
            </CardContent>
          </Card>
          )}

          {enabledCards.avgOrder && (
          <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Avg Order</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-foreground">$0.00</div>
              <p className="text-xs text-muted-foreground mt-1">-0.0% vs prev month</p>
            </CardContent>
          </Card>
          )}

          {viewMode === "enhanced" && enabledCards.pendingQuotes && (
            <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Pending Quotes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold text-foreground">0</div>
                <p className="text-xs text-muted-foreground mt-1">—</p>
              </CardContent>
            </Card>
          )}

          {viewMode === "enhanced" && enabledCards.lastContact && (
            <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Last Contact</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold text-foreground">—</div>
                <p className="text-xs text-muted-foreground mt-1">No recent activity</p>
              </CardContent>
            </Card>
          )}

          {viewMode === "enhanced" && enabledCards.customerRank && (
            <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Customer Rank</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold text-foreground">#—</div>
                <p className="text-xs text-muted-foreground mt-1">of —</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Tabs Content */}
      <div className={viewMode === "enhanced" ? "flex-1 overflow-y-auto p-6 max-w-6xl mx-auto" : "flex-1 overflow-y-auto p-6"}>
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-muted border border-border/60">
            <TabsTrigger value="overview" className="data-[state=active]:bg-background">
              <Building2 className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="contacts" className="data-[state=active]:bg-background">
              <Users className="w-4 h-4 mr-2" />
              Contacts ({customer.contacts.length})
            </TabsTrigger>
            <TabsTrigger value="quotes" className="data-[state=active]:bg-background">
              <FileText className="w-4 h-4 mr-2" />
              Quotes ({customer.quotes.length})
            </TabsTrigger>
            <TabsTrigger value="orders" className="data-[state=active]:bg-background">
              <Package className="w-4 h-4 mr-2" />
              Orders
            </TabsTrigger>
            <TabsTrigger value="activity" className="data-[state=active]:bg-background">
              <MessageSquare className="w-4 h-4 mr-2" />
              Activity
            </TabsTrigger>
            <TabsTrigger value="credits" className="data-[state=active]:bg-background">
              <CreditCard className="w-4 h-4 mr-2" />
              Credits
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
                <CardHeader>
                  <CardTitle className="text-foreground">Contact Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {customer.email && (
                    <div className="flex items-center gap-3">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium text-foreground">Email</div>
                        <div className="text-sm text-muted-foreground">{customer.email}</div>
                      </div>
                    </div>
                  )}
                  {customer.phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium text-foreground">Phone</div>
                        <div className="text-sm text-muted-foreground">{customer.phone}</div>
                      </div>
                    </div>
                  )}
                  {customer.website && (
                    <div className="flex items-center gap-3">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium text-foreground">Website</div>
                        <div className="text-sm text-muted-foreground">{customer.website}</div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
                <CardHeader>
                  <CardTitle className="text-foreground">Shipping Address</CardTitle>
                </CardHeader>
                <CardContent>
                  {customer.shippingAddressLine1 ? (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-1" />
                      <div className="text-sm text-foreground">
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
            <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-foreground">Contacts</CardTitle>
                  <Button size="sm" onClick={() => setShowContactForm(true)} variant="secondary">
                    <Users className="w-4 h-4 mr-2" />
                    Add Contact
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {customer.contacts.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No contacts yet</p>
                ) : (
                  <div className="space-y-3">
                    {customer.contacts.map((contact) => (
                      <div
                        key={contact.id}
                        id={`contact-${contact.id}`}
                        className="flex items-center justify-between p-4 border border-border/60 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <Avatar>
                            <AvatarFallback className="bg-primary/20 text-primary">
                              {contact.firstName[0]}{contact.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-foreground">
                              {contact.firstName} {contact.lastName}
                              {contact.isPrimary && (
                                <Badge variant="outline" className="ml-2 border-primary/20 text-primary bg-primary/10">Primary</Badge>
                              )}
                              {contact.isBilling && (
                                <Badge variant="outline" className="ml-2 text-muted-foreground">Billing</Badge>
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
            <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
              <CardHeader>
               <div className="flex items-center justify-between">
                   <CardTitle className="text-foreground">Quotes</CardTitle>
                   <div className="flex gap-2">
                     <Button size="sm" variant="secondary" onClick={() => setShowCustomizeCards(true)}>
                       <Settings className="w-4 h-4 mr-2" /> Customize
                     </Button>
                     <Button size="sm" variant="secondary" onClick={() => setShowQuotesConfig(true)}>
                       <Settings className="w-4 h-4 mr-2" /> Columns
                     </Button>
                   </div>
                 </div>
              </CardHeader>
              <CardContent>
                {customer.quotes.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No quotes yet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="min-w-[900px]">
                      <div className={`grid gap-3 px-4 py-2 text-xs text-muted-foreground`} style={{ gridTemplateColumns: `repeat(${quoteColumns.filter((c: any) => c.enabled).length}, minmax(0, 1fr))` }}>
                        {quoteColumns.filter((c: any) => c.enabled).map((col: any) => (
                          <div key={col.id} className={col.id === 'amount' || col.id === 'actions' ? 'text-right' : ''}>{col.label}</div>
                        ))}
                      </div>
                      <div className="space-y-2">
                        {customer.quotes.map((quote) => {
                          const cellData: Record<string, React.ReactNode> = {
                            quoteNumber: <div className="font-mono text-foreground">{quote.quoteNumber}</div>,
                            date: <div className="text-sm text-muted-foreground">{new Date(quote.createdAt).toLocaleDateString()}</div>,
                            product: <div className="text-sm text-muted-foreground truncate">—</div>,
                            po: <div className="text-sm text-muted-foreground">—</div>,
                            qty: <div className="text-sm text-muted-foreground">—</div>,
                            amount: <div className="text-sm text-right text-foreground">${parseFloat(quote.totalPrice).toFixed(2)}</div>,
                            dueDate: <div className="text-sm text-muted-foreground">—</div>,
                            status: <div><Badge variant="outline" className="text-muted-foreground">{quote.status}</Badge></div>,
                            actions: (
                              <div className="flex items-center justify-end gap-2">
                                <Link href={`/quotes/${quote.id}`}><Button variant="ghost" size="icon"><Eye className="w-4 h-4" /></Button></Link>
                                <Link href={`/quotes/${quote.id}/edit`}><Button variant="ghost" size="icon"><Edit2 className="w-4 h-4" /></Button></Link>
                                <Button variant="ghost" size="icon"><Download className="w-4 h-4" /></Button>
                                <Button variant="ghost" size="icon"><MailIcon className="w-4 h-4" /></Button>
                              </div>
                            ),
                          };
                          return (
                            <div key={quote.id} className="grid gap-3 items-center px-4 py-3 border border-border/60 rounded-lg bg-muted/30" style={{ gridTemplateColumns: `repeat(${quoteColumns.filter((c: any) => c.enabled).length}, minmax(0, 1fr))` }}>
                              {quoteColumns.filter((c: any) => c.enabled).map((col: any) => (
                                <div key={col.id}>{cellData[col.id]}</div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders">
            <OrdersForCustomer customerId={customer.id} />
          </TabsContent>

          <TabsContent value="activity">
            <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-foreground">Activity Timeline</CardTitle>
                  <Button size="sm" onClick={() => setShowNoteForm(true)} variant="secondary">
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
            <Card className="bg-card/50 border-border/60 backdrop-blur-sm shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-foreground">Credit Transactions</CardTitle>
                  {isAdmin && (
                    <Button size="sm" onClick={() => setShowCreditForm(true)} variant="secondary">
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
                      <div key={transaction.id} className="flex items-center justify-between p-4 border border-border/60 rounded-lg bg-muted/30">
                        <div>
                          <div className="font-medium capitalize text-foreground">{transaction.transactionType}</div>
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
      </div>

      {/* Forms */}
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
        customerId={customerId}
        contact={editingContact}
      />

      <NoteForm
        open={showNoteForm}
        onOpenChange={setShowNoteForm}
        customerId={customerId}
      />

      {isAdmin && (
        <CreditForm
          open={showCreditForm}
          onOpenChange={setShowCreditForm}
          customerId={customerId}
          currentBalance={parseFloat(customer.currentBalance || '0')}
          creditLimit={parseFloat(customer.creditLimit || '0')}
        />
      )}

      {/* Column Config Modals */}
      <ColumnConfigModal
        open={showQuotesConfig}
        onOpenChange={setShowQuotesConfig}
        columns={quoteColumns}
        onSave={handleSaveQuoteColumns}
        title="Configure Quote Columns"
      />

      {/* Customize Cards Dialog */}
      <AlertDialog open={showCustomizeCards} onOpenChange={setShowCustomizeCards}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Customize Dashboard Cards</AlertDialogTitle>
            <AlertDialogDescription>
              Toggle which cards are visible. Hidden cards will free up space and the grid will auto-resize.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {Object.keys(enabledCards).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabledCards[key]}
                  onChange={(e) => setEnabledCards((prev) => ({ ...prev, [key]: e.target.checked }))}
                />
                <span className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
              </label>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction onClick={() => setShowCustomizeCards(false)}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Contact Dialog */}
      <AlertDialog open={!!contactToDelete} onOpenChange={(open) => !open && setContactToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {contactToDelete?.firstName} {contactToDelete?.lastName}? This action cannot be undone.
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
