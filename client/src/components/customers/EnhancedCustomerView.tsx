import React, { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import CustomerStatsRow from "./CustomerStatsRow";
import CustomerActivityTabs from "./CustomerActivityTabs";
import { DataCard } from "@/components/titan";
import { formatDistanceToNow } from "date-fns";

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
    name: string;
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
}

export default function EnhancedCustomerView({
  customer: propCustomer,
  stats: propStats,
  activity: propActivity,
  customerId,
  onEdit,
  onToggleView,
  onSelectCustomer
}: EnhancedCustomerViewProps) {
  const [showCustomize, setShowCustomize] = useState(false);
  const [visibleStats, setVisibleStats] = useState<StatKey[]>([]);

  // Fetch data if not provided via props
  const { data: fetchedCustomer, isLoading: isLoadingCustomer } = useQuery({
    queryKey: [`/api/customers/${customerId}`],
    queryFn: async () => {
      if (!customerId) return null;
      const res = await fetch(`/api/customers/${customerId}`);
      if (!res.ok) throw new Error("Failed to fetch customer");
      return res.json();
    },
    enabled: !!customerId && !propCustomer,
  });

  const { data: fetchedQuotes } = useQuery({
    queryKey: [`/api/quotes`, { customerId }],
    queryFn: async () => {
      if (!customerId) return [];
      const res = await fetch(`/api/quotes?customerId=${customerId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!customerId && !propActivity?.quotes,
  });

  const { data: fetchedOrders } = useQuery({
    queryKey: [`/api/orders`, { customerId }],
    queryFn: async () => {
      if (!customerId) return [];
      const res = await fetch(`/api/orders?customerId=${customerId}`);
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
      subtitle: `Created: ${new Date(q.createdAt).toLocaleDateString()} • Total: $${parseFloat(q.totalPrice || "0").toFixed(2)}`,
      status: q.status
    }));

    const mapOrders = (orders: any[]) => orders.map(o => ({
      id: o.id,
      title: `Order #${o.orderNumber || 'N/A'}`,
      subtitle: `Created: ${new Date(o.createdAt).toLocaleDateString()} • Total: $${parseFloat(o.totalPrice || o.total || "0").toFixed(2)}`,
      status: o.status
    }));

    return {
      quotes: mapQuotes(fetchedQuotes || []),
      orders: mapOrders(fetchedOrders || []),
      invoices: [], // Invoices endpoint not confirmed yet
    };
  }, [propActivity, fetchedQuotes, fetchedOrders]);

  const stats = useMemo(() => {
    if (propStats) return propStats;

    const quotesCount = activity.quotes?.length || 0;
    const ordersCount = activity.orders?.length || 0;

    // Calculate total sales from orders
    const totalSales = activity.orders?.reduce((sum: number, order: any) => {
      // Need to handle the mapped structure (subtitle has total) or use fetchedOrders directly?
      // Actually, activity.orders is mapped now, so it doesn't have totalPrice directly.
      // But wait, I can use fetchedOrders directly here if I include it in dependency array.
      // Or I can parse it from subtitle (ugly).
      // Better: Use fetchedOrders/fetchedQuotes directly for stats calculation if propStats is missing.
      return sum;
    }, 0) || 0;

    // Re-implement stats calculation using raw fetched data for accuracy
    const rawOrders = fetchedOrders || [];
    const rawQuotes = fetchedQuotes || [];

    const calculatedSales = rawOrders.reduce((sum: number, o: any) => sum + (parseFloat(o.totalPrice || o.total || "0") || 0), 0);
    const calculatedAvgOrder = rawOrders.length > 0 ? calculatedSales / rawOrders.length : 0;

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
      orders: rawOrders.length,
      orderChange: null,
      sales: Math.round(calculatedSales / 1000), // Display in k
      salesChange: null,
      avgOrder: Math.round(calculatedAvgOrder / 1000 * 10) / 10, // Display in k with 1 decimal
      avgOrderChange: null,
      lastContactFriendly: lastContactDate ? formatDistanceToNow(lastContactDate, { addSuffix: true }) : "Never",
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
