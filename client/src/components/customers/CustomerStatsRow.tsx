import React, { useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { TitanCard } from "@/components/ui/TitanCard";

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
              <ArrowUpRight className="w-4 h-4 text-[var(--app-success-foreground)]" />
            ) : card.change ? (
              <ArrowDownRight className="w-4 h-4 text-[var(--app-danger-foreground)]" />
            ) : null;

            return (
              <div
                key={card.key}
                className={
                  card.clickable
                    ? "cursor-pointer hover:-translate-y-[2px] transition hover:shadow-[var(--app-card-shadow-strong)] ring-1 ring-transparent hover:ring-[var(--app-accent)]"
                    : ""
                }
                onClick={card.clickable ? card.onClick : undefined}
              >
                <TitanCard className="p-3 flex flex-col justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-[var(--app-text-muted)]">
                    {card.label}
                  </div>
                  <div className="text-2xl font-semibold mt-1 text-[var(--app-text-primary)]">
                    {card.value}
                  </div>
                </div>

                {card.change !== null && (
                  <div className="flex items-center justify-between mt-4">
                    {/* Trend */}
                    <div className="flex items-center gap-1 text-sm">
                      {trendIcon}
                      <span
                        className={
                          isPositive
                            ? "text-[var(--app-success-foreground)]"
                            : "text-[var(--app-danger-foreground)]"
                        }
                      >
                        {card.change}%
                      </span>
                      <span className="text-[var(--app-text-muted)] text-xs">
                        vs prev month
                      </span>
                    </div>

                    {/* Sparkline */}
                    <div className="w-16 h-8 rounded overflow-hidden bg-[var(--app-surface-tertiary)]">
                      {/* Minimal inline SVG sparkline */}
                      <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
                        <polyline
                          fill="none"
                          stroke={
                            isPositive
                              ? "var(--app-chart-positive)"
                              : "var(--app-chart-negative)"
                          }
                          strokeWidth="3"
                          points={card.spark?.join(" ") || ""}
                        />
                      </svg>
                    </div>
                  </div>
                )}
                </TitanCard>
              </div>
            );
          })}
      </div>

      {/* Modals intentionally stubbed for now to unblock build */}
      {showLastContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-lg bg-[var(--bg-surface)] p-4 shadow-xl max-w-sm w-full">
            <div className="text-sm mb-3" style={{ color: "var(--text-primary)" }}>
              Last contact details modal not yet implemented.
            </div>
            <button
              onClick={() => setShowLastContact(false)}
              className="mt-2 px-3 py-1 rounded text-sm"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "#ffffff",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showRanking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-lg bg-[var(--bg-surface)] p-4 shadow-xl max-w-sm w-full">
            <div className="text-sm mb-3" style={{ color: "var(--text-primary)" }}>
              Ranking modal not yet implemented.
            </div>
            <button
              onClick={() => setShowRanking(false)}
              className="mt-2 px-3 py-1 rounded text-sm"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "#ffffff",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export { CustomerStatsRow };
