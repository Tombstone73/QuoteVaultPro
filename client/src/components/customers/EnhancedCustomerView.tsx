import React, { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronDown } from "lucide-react";
import CustomerStatsRow from "./CustomerStatsRow";
import CustomerActivityTabs from "./CustomerActivityTabs";
import TitanCard from "@/components/ui/TitanCard";

export default function EnhancedCustomerView({ customer, stats, activity }) {
  const [showCustomize, setShowCustomize] = useState(false);
  const [visibleStats, setVisibleStats] = useState<string[]>([]);

  // Load stat visibility from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("customer_stats_visible");
    if (saved) {
      setVisibleStats(JSON.parse(saved));
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

  const toggleStat = (key: string) => {
    const updated = visibleStats.includes(key)
      ? visibleStats.filter((s) => s !== key)
      : [...visibleStats, key];
    setVisibleStats(updated);
    localStorage.setItem("customer_stats_visible", JSON.stringify(updated));
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--app-text-primary)]">
          {customer.name}
        </h2>

        <button
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-[var(--app-border-color)]
          bg-[var(--app-surface-secondary)] hover:bg-[var(--app-surface-tertiary)]
          transition text-[var(--app-text-muted)]"
          onClick={() => setShowCustomize((v) => !v)}
        >
          Customize
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Customize Panel */}
      {showCustomize && (
        <TitanCard className="p-4">
          <h3 className="text-sm font-semibold mb-3 text-[var(--app-text-primary)]">
            Visible Stats
          </h3>

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
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visibleStats.includes(key)}
                  onChange={() => toggleStat(key)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-[var(--app-text-secondary)]">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </TitanCard>
      )}

      {/* Stats Row */}
      <CustomerStatsRow stats={stats} visible={visibleStats} />

      {/* Tabs Section */}
      <TitanCard className="p-4">
        <Tabs defaultValue="orders">
          <TabsList className="bg-[var(--app-surface-secondary)]">
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
      </TitanCard>
    </div>
  );
}
