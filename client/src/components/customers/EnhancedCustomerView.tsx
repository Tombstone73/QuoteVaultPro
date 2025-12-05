/**
 * EnhancedCustomerView - SALES-ORIENTED CRM DASHBOARD
 * 
 * This component provides a comprehensive view of a customer for sales teams.
 * It combines customer profile information with sales metrics, activity tracking,
 * and CRM relationship data in a command-station style layout.
 * 
 * Features:
 * - Customer editing via modal form (same as main Customers page)
 * - Sales metrics: lifetime value, open quotes/orders, avg order
 * - CRM snapshot: account owner, lead source, last contact, next follow-up
 * - Activity timeline: quotes, orders, invoices with status tracking
 * - Responsive 2-column layout (Profile + Sales CRM)
 * - Graceful degradation for missing data fields
 */

import React, { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  ChevronDown, Pencil, Mail, Phone, Globe, MapPin, 
  DollarSign, TrendingUp, Calendar, User, Target,
  FileText, Package, Clock, AlertCircle
} from "lucide-react";
import CustomerStatsRow from "./CustomerStatsRow";
import CustomerActivityTabs from "./CustomerActivityTabs";
import CustomerForm from "@/components/customer-form";
import { DataCard } from "@/components/titan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDistanceToNow, format } from "date-fns";

type StatKey =
  | "quotes"
  | "orders"
  | "sales"
  | "avgOrder"
  | "lastContact"
  | "ranking"
  | "lifetimeValue";

interface EnhancedCustomerViewProps {
  customer?: {
    name?: string;
    companyName?: string;
    email?: string;
    phone?: string;
    website?: string;
    billingStreet1?: string;
    billingStreet2?: string;
    billingCity?: string;
    billingState?: string;
    billingPostalCode?: string;
    billingCountry?: string;
    shippingStreet1?: string;
    shippingStreet2?: string;
    shippingCity?: string;
    shippingState?: string;
    shippingPostalCode?: string;
    shippingCountry?: string;
    assignedTo?: string;
    salesRepName?: string;
    leadSource?: string;
    createdAt?: string;
    tags?: string[];
    nextFollowUpDate?: string;
    isTaxExempt?: boolean;
    pricingTier?: string;
    creditLimit?: string;
    currentBalance?: string;
    [key: string]: any;
  };
  stats?: any;
  activity?: {
    orders?: any[];
    quotes?: any[];
    invoices?: any[];
  };
  customerId?: string;
  onEdit?: () => void;
  onToggleView?: () => void;
  onSelectCustomer?: (id: string) => void;
  layoutMode?: 'full' | 'embedded';
}

export default function EnhancedCustomerView({
  customer: propCustomer,
  stats: propStats,
  activity: propActivity,
  customerId,
  onEdit,
  onToggleView,
  onSelectCustomer,
  layoutMode = 'full'
}: EnhancedCustomerViewProps) {
  const queryClient = useQueryClient();
  const [showCustomize, setShowCustomize] = useState(false);
  const [visibleStats, setVisibleStats] = useState<StatKey[]>([]);
  
  // Edit customer state
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);

  // Fetch data if not provided via props
  const { data: fetchedCustomer, isLoading: isLoadingCustomer } = useQuery({
    queryKey: [`/api/customers/${customerId}`],
    queryFn: async () => {
      if (!customerId) return null;
      const res = await fetch(`/api/customers/${customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch customer");
      return res.json();
    },
    enabled: !!customerId && !propCustomer,
  });

  // Fetch customer for editing (separate query to avoid stale data)
  const { data: editingCustomer } = useQuery({
    queryKey: [`/api/customers/${editingCustomerId}`],
    queryFn: async () => {
      if (!editingCustomerId) return null;
      const res = await fetch(`/api/customers/${editingCustomerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch customer");
      return res.json();
    },
    enabled: !!editingCustomerId && showEditForm,
  });

  const { data: fetchedQuotes } = useQuery({
    queryKey: [`/api/quotes`, { customerId }],
    queryFn: async () => {
      if (!customerId) return [];
      const res = await fetch(`/api/quotes?customerId=${customerId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!customerId && !propActivity?.quotes,
  });

  const { data: fetchedOrders } = useQuery({
    queryKey: [`/api/orders`, { customerId }],
    queryFn: async () => {
      if (!customerId) return [];
      const res = await fetch(`/api/orders?customerId=${customerId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!customerId && !propActivity?.orders,
  });

  // Calculate stats and activity
  const customer = propCustomer || fetchedCustomer;

  const activity = useMemo(() => {
    if (propActivity) return propActivity;

    const mapQuotes = (quotes: any[]) => quotes.map(q => ({
      id: q.id,
      title: `Quote #${q.quoteNumber || 'N/A'}`,
      subtitle: `Created: ${new Date(q.createdAt).toLocaleDateString()} • Total: $${parseFloat(q.totalPrice || q.total || "0").toFixed(2)}`,
      status: q.status,
      createdAt: q.createdAt
    }));

    const mapOrders = (orders: any[]) => orders.map(o => ({
      id: o.id,
      title: `Order #${o.orderNumber || 'N/A'}`,
      subtitle: `Created: ${new Date(o.createdAt).toLocaleDateString()} • Total: $${parseFloat(o.totalPrice || o.total || "0").toFixed(2)}`,
      status: o.status,
      createdAt: o.createdAt
    }));

    return {
      quotes: mapQuotes(fetchedQuotes || []),
      orders: mapOrders(fetchedOrders || []),
      invoices: [],
    };
  }, [propActivity, fetchedQuotes, fetchedOrders]);

  const stats = useMemo(() => {
    if (propStats) return propStats;

    const rawOrders = fetchedOrders || [];
    const rawQuotes = fetchedQuotes || [];

    const calculatedSales = rawOrders.reduce((sum: number, o: any) => sum + (parseFloat(o.totalPrice || o.total || "0") || 0), 0);
    const calculatedAvgOrder = rawOrders.length > 0 ? calculatedSales / rawOrders.length : 0;

    // Calculate open quotes value
    const openQuotes = rawQuotes.filter((q: any) => q.status === 'pending' || q.status === 'draft');
    const openQuotesValue = openQuotes.reduce((sum: number, q: any) => sum + (parseFloat(q.totalPrice || q.total || "0") || 0), 0);

    // Calculate open orders value
    const openOrders = rawOrders.filter((o: any) => o.status === 'new' || o.status === 'in_production');
    const openOrdersValue = openOrders.reduce((sum: number, o: any) => sum + (parseFloat(o.totalPrice || o.total || "0") || 0), 0);

    // Determine last contact
    let lastContactDate = null;
    const allItems = [...rawQuotes, ...rawOrders];
    if (allItems.length > 0) {
      allItems.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      lastContactDate = new Date(allItems[0].createdAt);
    }

    return {
      quotes: rawQuotes.length,
      quoteChange: null,
      openQuotesCount: openQuotes.length,
      openQuotesValue: openQuotesValue,
      orders: rawOrders.length,
      orderChange: null,
      openOrdersCount: openOrders.length,
      openOrdersValue: openOrdersValue,
      sales: calculatedSales,
      salesK: Math.round(calculatedSales / 1000), // Display in k
      salesChange: null,
      avgOrder: calculatedAvgOrder,
      avgOrderK: Math.round(calculatedAvgOrder / 1000 * 10) / 10, // Display in k with 1 decimal
      avgOrderChange: null,
      lastContactFriendly: lastContactDate ? formatDistanceToNow(lastContactDate, { addSuffix: true }) : "Never",
      lastContactDate: lastContactDate,
      ranking: "B",
      rankingChange: null,
      ltv: Math.round(calculatedSales / 1000),
      ltvChange: null,
      lifetimeValue: calculatedSales,
    };
  }, [propStats, fetchedOrders, fetchedQuotes]);

  // Load stat visibility from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("customer_stats_visible");
    if (saved) {
      try {
        setVisibleStats(JSON.parse(saved));
      } catch (e) {
        setVisibleStats([
          "quotes",
          "orders",
          "sales",
          "avgOrder",
          "lastContact",
          "ranking",
          "lifetimeValue",
        ]);
      }
    } else {
      setVisibleStats([
        "quotes",
        "orders",
        "sales",
        "avgOrder",
        "lastContact",
        "ranking",
        "lifetimeValue",
      ]);
    }
  }, []);

  const toggleStat = (key: StatKey) => {
    const updated = visibleStats.includes(key)
      ? visibleStats.filter((s) => s !== key)
      : [...visibleStats, key];
    setVisibleStats(updated);
    localStorage.setItem("customer_stats_visible", JSON.stringify(updated));
  };

  // Handle edit customer
  const handleEditCustomer = () => {
    if (customer?.id) {
      setEditingCustomerId(customer.id);
      setShowEditForm(true);
    } else if (customerId) {
      setEditingCustomerId(customerId);
      setShowEditForm(true);
    }
  };

  // Handle form close
  const handleFormClose = (open: boolean) => {
    setShowEditForm(open);
    if (!open) {
      setEditingCustomerId(null);
      // Invalidate queries to refresh data
      if (customerId || customer?.id) {
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId || customer?.id}`] });
      }
    }
  };

  // Format address helper
  const formatAddress = (
    street1?: string,
    street2?: string,
    city?: string,
    state?: string,
    postal?: string,
    country?: string
  ) => {
    const parts = [
      street1,
      street2,
      [city, state].filter(Boolean).join(', '),
      postal,
      country !== 'USA' ? country : null
    ].filter(Boolean);
    return parts.length > 0 ? parts.join('\n') : null;
  };

  // Get last activity summary
  const getLastActivity = () => {
    const allActivities = [
      ...(activity.quotes || []).map((q: any) => ({ ...q, type: 'quote' })),
      ...(activity.orders || []).map((o: any) => ({ ...o, type: 'order' }))
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (allActivities.length === 0) return null;

    const latest = allActivities[0];
    const timeAgo = formatDistanceToNow(new Date(latest.createdAt), { addSuffix: true });
    return {
      type: latest.type === 'quote' ? 'Quote' : 'Order',
      title: latest.title,
      timeAgo,
      status: latest.status
    };
  };

  // Handle case where customer data is not available
  if (!customer) {
    return (
      <div className="p-6 space-y-6">
        <div className="text-center text-muted-foreground">
          {customerId && isLoadingCustomer ? "Loading customer data..." : "Select a customer to view details"}
        </div>
      </div>
    );
  }

  const billingAddress = formatAddress(
    customer.billingStreet1,
    customer.billingStreet2,
    customer.billingCity,
    customer.billingState,
    customer.billingPostalCode,
    customer.billingCountry
  );

  const shippingAddress = formatAddress(
    customer.shippingStreet1,
    customer.shippingStreet2,
    customer.shippingCity,
    customer.shippingState,
    customer.shippingPostalCode,
    customer.shippingCountry
  );

  const lastActivity = getLastActivity();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {customer.companyName || customer.name || "Unknown Customer"}
          </h2>
          
          {/* Owner Badge */}
          {customer.salesRepName && (
            <Badge variant="outline" className="gap-1.5">
              <User className="w-3 h-3" />
              Owner: {customer.salesRepName}
            </Badge>
          )}
          
          {/* Tags */}
          {customer.tags && customer.tags.length > 0 && (
            <div className="flex gap-1.5">
              {customer.tags.map((tag: string, idx: number) => (
                <Badge key={idx} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleEditCustomer}
          >
            <Pencil className="w-4 h-4 mr-2" />
            Edit Customer
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCustomize((v) => !v)}
          >
            Customize
            <ChevronDown className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>

      {/* Customize Panel */}
      {showCustomize && (
        <DataCard title="Visible Stats">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              ["quotes", "Quotes"],
              ["orders", "Orders"],
              ["sales", "Sales"],
              ["avgOrder", "Average Order"],
              ["lastContact", "Last Contact"],
              ["ranking", "Company Rank"],
              ["lifetimeValue", "Lifetime Value"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleStats.includes(key as StatKey)}
                  onChange={() => toggleStat(key as StatKey)}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="text-sm text-muted-foreground">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </DataCard>
      )}

      {/* Stats Row */}
      <CustomerStatsRow 
        stats={{
          ...stats,
          sales: stats.salesK,
          avgOrder: stats.avgOrderK,
        }} 
        visible={visibleStats} 
      />

      {/* 2-COLUMN LAYOUT: Profile (Left) + Sales CRM (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* LEFT COLUMN: Profile & Logistics */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-4">
          
          {/* Company & Contacts Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <User className="w-4 h-4" />
                Company & Contacts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="font-medium text-base">
                  {customer.companyName || customer.name || "—"}
                </div>
                {customer.name && customer.companyName && customer.name !== customer.companyName && (
                  <div className="text-sm text-muted-foreground mt-0.5">
                    Contact: {customer.name}
                  </div>
                )}
              </div>

              <Separator />

              {customer.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <a href={`mailto:${customer.email}`} className="text-blue-600 hover:underline">
                    {customer.email}
                  </a>
                </div>
              )}

              {customer.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <a href={`tel:${customer.phone}`} className="text-blue-600 hover:underline">
                    {customer.phone}
                  </a>
                </div>
              )}

              {customer.website && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <a 
                    href={customer.website.startsWith('http') ? customer.website : `https://${customer.website}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {customer.website}
                  </a>
                </div>
              )}

              {/* Pricing Tier & Tax Status */}
              {customer.pricingTier && (
                <div className="pt-2">
                  <Badge variant={customer.pricingTier === 'wholesale' ? 'default' : 'secondary'}>
                    {customer.pricingTier.charAt(0).toUpperCase() + customer.pricingTier.slice(1)} Pricing
                  </Badge>
                  {customer.isTaxExempt && (
                    <Badge variant="outline" className="ml-2 text-green-600 border-green-300">
                      Tax Exempt
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Addresses Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Addresses
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Billing Address */}
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">
                  Billing Address
                </div>
                {billingAddress ? (
                  <div className="text-sm whitespace-pre-line">
                    {billingAddress}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground italic">
                    No billing address on file
                  </div>
                )}
              </div>

              {/* Shipping Address */}
              {shippingAddress && shippingAddress !== billingAddress && (
                <>
                  <Separator />
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">
                      Shipping Address
                    </div>
                    <div className="text-sm whitespace-pre-line">
                      {shippingAddress}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* RIGHT COLUMN: Sales CRM */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-4">
          
          {/* Sales Overview Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Sales Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {/* Lifetime Sales */}
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Lifetime Sales</div>
                  <div className="text-2xl font-bold text-green-600">
                    ${(stats.lifetimeValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>

                {/* Avg Order Value */}
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Avg Order Value</div>
                  <div className="text-2xl font-bold">
                    ${(stats.avgOrder || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>

                {/* Open Quotes */}
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    Open Quotes
                  </div>
                  <div className="text-lg font-semibold">
                    {stats.openQuotesCount || 0} 
                    <span className="text-sm text-muted-foreground ml-2">
                      (${(stats.openQuotesValue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })})
                    </span>
                  </div>
                </div>

                {/* Open Orders */}
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Package className="w-3 h-3" />
                    Open Orders
                  </div>
                  <div className="text-lg font-semibold">
                    {stats.openOrdersCount || 0}
                    <span className="text-sm text-muted-foreground ml-2">
                      (${(stats.openOrdersValue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })})
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CRM Snapshot Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="w-4 h-4" />
                CRM Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              
              {/* Account Owner */}
              {customer.salesRepName && (
                <div className="flex items-start justify-between">
                  <span className="text-sm text-muted-foreground">Account Owner</span>
                  <span className="text-sm font-medium">{customer.salesRepName}</span>
                </div>
              )}

              {/* Lead Source */}
              {customer.leadSource && (
                <div className="flex items-start justify-between">
                  <span className="text-sm text-muted-foreground">Lead Source</span>
                  <span className="text-sm font-medium">{customer.leadSource}</span>
                </div>
              )}

              {/* Customer Since */}
              {customer.createdAt && (
                <div className="flex items-start justify-between">
                  <span className="text-sm text-muted-foreground">Customer Since</span>
                  <span className="text-sm font-medium">
                    {format(new Date(customer.createdAt), 'MMM d, yyyy')}
                  </span>
                </div>
              )}

              <Separator />

              {/* Last Contact */}
              <div className="flex items-start justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Last Contact
                </span>
                <span className="text-sm font-medium">
                  {stats.lastContactFriendly || "Never"}
                </span>
              </div>

              {/* Next Follow-Up */}
              {customer.nextFollowUpDate && (
                <div className="flex items-start justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Next Follow-Up
                  </span>
                  <span className="text-sm font-medium text-orange-600">
                    {format(new Date(customer.nextFollowUpDate), 'MMM d, yyyy')}
                  </span>
                </div>
              )}

              {/* Credit Info */}
              {customer.creditLimit && (
                <>
                  <Separator />
                  <div className="flex items-start justify-between">
                    <span className="text-sm text-muted-foreground">Credit Limit</span>
                    <span className="text-sm font-medium">
                      ${parseFloat(customer.creditLimit || '0').toFixed(2)}
                    </span>
                  </div>
                  {customer.currentBalance && (
                    <div className="flex items-start justify-between">
                      <span className="text-sm text-muted-foreground">Current Balance</span>
                      <span className={`text-sm font-medium ${parseFloat(customer.currentBalance) > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                        ${parseFloat(customer.currentBalance || '0').toFixed(2)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Activity & Follow-Up Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Activity & Follow-Up
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lastActivity ? (
                <div className="p-3 bg-muted/50 rounded-md">
                  <div className="text-xs text-muted-foreground mb-1">Last Activity</div>
                  <div className="text-sm font-medium">{lastActivity.type}: {lastActivity.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {lastActivity.timeAgo} • 
                    <Badge variant="outline" className="ml-2 text-xs">
                      {lastActivity.status}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">
                  No recent activity
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Activity Tabs Section (Full Width) */}
      <DataCard>
        <Tabs defaultValue="orders">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="orders">
              Orders ({activity.orders?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="quotes">
              Quotes ({activity.quotes?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="invoices">
              Invoices ({activity.invoices?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            <CustomerActivityTabs items={activity.orders} type="order" />
          </TabsContent>

          <TabsContent value="quotes">
            <CustomerActivityTabs items={activity.quotes} type="quote" />
          </TabsContent>

          <TabsContent value="invoices">
            <CustomerActivityTabs items={activity.invoices} type="invoice" />
          </TabsContent>
        </Tabs>
      </DataCard>

      {/* Customer Edit Form Modal */}
      <CustomerForm
        open={showEditForm}
        onOpenChange={handleFormClose}
        customer={editingCustomer}
      />
    </div>
  );
}
      ranking: "B", // Placeholder
      rankingChange: null,
      ltv: Math.round(calculatedSales / 1000), // Display in k
      ltvChange: null,
    };
  }, [propStats, activity, fetchedOrders, fetchedQuotes]);

  // Load stat visibility from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("customer_stats_visible");
    if (saved) {
      try {
        setVisibleStats(JSON.parse(saved));
      } catch (e) {
        setVisibleStats([
          "quotes",
          "orders",
          "sales",
          "avgOrder",
          "lastContact",
          "ranking",
          "lifetimeValue",
        ]);
      }
    } else {
      setVisibleStats([
        "quotes",
        "orders",
        "sales",
        "avgOrder",
        "lastContact",
        "ranking",
        "lifetimeValue",
      ]);
    }
  }, []);

  const toggleStat = (key: StatKey) => {
    const updated = visibleStats.includes(key)
      ? visibleStats.filter((s) => s !== key)
      : [...visibleStats, key];
    setVisibleStats(updated);
    localStorage.setItem("customer_stats_visible", JSON.stringify(updated));
  };

  // Handle case where customer data is not available
  if (!customer) {
    return (
      <div className="p-6 space-y-6">
        <div className="text-center text-muted-foreground">
          {customerId && isLoadingCustomer ? "Loading customer data..." : "Select a customer to view details"}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {customer.name || customer.companyName || "Unknown Customer"}
        </h2>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCustomize((v) => !v)}
        >
          Customize
          <ChevronDown className="w-4 h-4 ml-2" />
        </Button>
      </div>

      {/* Customize Panel */}
      {showCustomize && (
        <DataCard title="Visible Stats">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              ["quotes", "Quotes"],
              ["orders", "Orders"],
              ["sales", "Sales"],
              ["avgOrder", "Average Order"],
              ["lastContact", "Last Contact"],
              ["ranking", "Company Rank"],
              ["lifetimeValue", "Lifetime Value"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleStats.includes(key as StatKey)}
                  onChange={() => toggleStat(key as StatKey)}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="text-sm text-muted-foreground">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </DataCard>
      )}

      {/* Stats Row */}
      <CustomerStatsRow stats={stats} visible={visibleStats} />

      {/* Tabs Section */}
      <DataCard>
        <Tabs defaultValue="orders">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="quotes">Quotes</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            <CustomerActivityTabs items={activity.orders} type="order" />
          </TabsContent>

          <TabsContent value="quotes">
            <CustomerActivityTabs items={activity.quotes} type="quote" />
          </TabsContent>

          <TabsContent value="invoices">
            <CustomerActivityTabs items={activity.invoices} type="invoice" />
          </TabsContent>
        </Tabs>
      </DataCard>
    </div>
  );
}
