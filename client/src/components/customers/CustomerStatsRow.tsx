import React, { useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { DataCard } from "@/components/titan";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type StatKey =
  | "quotes"
  | "orders"
  | "sales"
  | "avgOrder"
  | "lastContact"
  | "ranking"
  | "lifetimeValue";

interface CustomerStats {
  quotes: number;
  quoteChange: number | null;
  quoteSpark?: string[];
  orders: number;
  orderChange: number | null;
  orderSpark?: string[];
  sales: number;
  salesChange: number | null;
  salesSpark?: string[];
  avgOrder: number;
  avgOrderChange: number | null;
  avgOrderSpark?: string[];
  lastContactFriendly: string;
  ranking: string;
  rankingChange: number | null;
  ltv: number;
  ltvChange: number | null;
  ltvSpark?: string[];
  lastContactDetails?: unknown;
  rankingDetails?: unknown;
}

export interface CustomerStatsRowProps {
  stats: CustomerStats;
  visible?: StatKey[];
}

export default function CustomerStatsRow({ stats, visible }: CustomerStatsRowProps) {
  const [showLastContact, setShowLastContact] = useState(false);
  const [showRanking, setShowRanking] = useState(false);

  const safeVisible: StatKey[] =
    (visible && visible.length > 0
      ? visible
      : [
          "quotes",
          "orders",
          "sales",
          "avgOrder",
          "lastContact",
          "ranking",
          "lifetimeValue",
        ]);

  const cards: Array<
    {
      key: StatKey;
      label: string;
      value: string | number;
      change?: number | null;
      spark?: string[];
      clickable?: boolean;
      onClick?: () => void;
    }
  > = [
    {
      key: "quotes",
      label: "Quotes",
      value: stats.quotes,
      change: stats.quoteChange,
      spark: stats.quoteSpark,
    },
    {
      key: "orders",
      label: "Orders",
      value: stats.orders,
      change: stats.orderChange,
      spark: stats.orderSpark,
    },
    {
      key: "sales",
      label: "Sales",
      value: `$${stats.sales}k`,
      change: stats.salesChange,
      spark: stats.salesSpark,
    },
    {
      key: "avgOrder",
      label: "Avg Order",
      value: `$${stats.avgOrder}k`,
      change: stats.avgOrderChange,
      spark: stats.avgOrderSpark,
    },
    {
      key: "lastContact",
      label: "Last Contact",
      value: stats.lastContactFriendly,
      change: null,
      clickable: true,
      onClick: () => setShowLastContact(true),
    },
    {
      key: "ranking",
      label: "Company Rank",
      value: stats.ranking,
      change: stats.rankingChange,
      clickable: true,
      onClick: () => setShowRanking(true),
    },
    {
      key: "lifetimeValue",
      label: "Lifetime Value",
      value: `$${stats.ltv}k`,
      change: stats.ltvChange,
      spark: stats.ltvSpark,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {cards
          .filter((c) => safeVisible.includes(c.key))
          .map((card) => {
            const isPositive = card.change && card.change > 0;

            const trendIcon = isPositive ? (
              <ArrowUpRight className="w-4 h-4 text-green-500" />
            ) : card.change ? (
              <ArrowDownRight className="w-4 h-4 text-red-500" />
            ) : null;

            return (
              <div
                key={card.key}
                className={
                  card.clickable
                    ? "cursor-pointer hover:-translate-y-[2px] transition hover:shadow-lg ring-1 ring-transparent hover:ring-primary"
                    : ""
                }
                onClick={card.clickable ? card.onClick : undefined}
              >
                <DataCard className="p-3 flex flex-col justify-between" noPadding>
                <div className="p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {card.label}
                  </div>
                  <div className="text-2xl font-semibold mt-1 text-foreground">
                    {card.value}
                  </div>

                  {card.change !== null && (
                    <div className="flex items-center justify-between mt-4">
                      {/* Trend */}
                      <div className="flex items-center gap-1 text-sm">
                        {trendIcon}
                        <span
                          className={
                            isPositive
                              ? "text-green-500"
                              : "text-red-500"
                          }
                        >
                          {card.change}%
                        </span>
                        <span className="text-muted-foreground text-xs">
                          vs prev month
                        </span>
                      </div>

                      {/* Sparkline */}
                      <div className="w-16 h-8 rounded overflow-hidden bg-muted/50">
                        {/* Minimal inline SVG sparkline */}
                        <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
                          <polyline
                            fill="none"
                            stroke={isPositive ? "#22c55e" : "#ef4444"}
                            strokeWidth="3"
                            points={card.spark?.join(" ") || ""}
                          />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
                </DataCard>
              </div>
            );
          })}
      </div>

      {/* Last Contact Modal */}
      <Dialog open={showLastContact} onOpenChange={setShowLastContact}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Last Contact Details</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Last contact details modal not yet implemented.
          </p>
          <div className="flex justify-end mt-4">
            <Button onClick={() => setShowLastContact(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ranking Modal */}
      <Dialog open={showRanking} onOpenChange={setShowRanking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Company Ranking</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ranking modal not yet implemented.
          </p>
          <div className="flex justify-end mt-4">
            <Button onClick={() => setShowRanking(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { CustomerStatsRow };
