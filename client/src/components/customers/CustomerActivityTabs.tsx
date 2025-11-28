import React from "react";
import { useLocation } from "wouter";
import TitanCard from "@/components/ui/TitanCard";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";

interface ActivityItem {
  id: string;
  title: string;
  subtitle: string;
  status: string;
}

interface CustomerActivityTabsProps {
  items?: ActivityItem[];
  type: "order" | "quote" | "invoice";
}

export default function CustomerActivityTabs({ items, type }: CustomerActivityTabsProps) {
  const [, setLocation] = useLocation();

  const handleClick = (id: string) => {
    // Navigate to the respective detail page
    // Note: Ensure these routes exist in your application
    if (type === "order") {
      setLocation(`/orders/${id}`);
    } else if (type === "quote") {
      setLocation(`/quotes/${id}`);
    } else if (type === "invoice") {
      setLocation(`/invoices/${id}`);
    }
  };

  if (!items?.length)
    return (
      <div className="text-sm text-[var(--app-text-muted)] p-4">
        No {type}s found.
      </div>
    );

  return (
    <div className="space-y-3 mt-4">
      {items.map((item) => (
        <TitanCard
          key={item.id}
          className="p-4 hover:-translate-y-[2px] transition hover:shadow-[var(--app-card-shadow-strong)] cursor-pointer"
          onClick={() => handleClick(item.id)}
        >
          <div className="flex justify-between items-center">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--app-text-primary)]">
                  {item.title}
                </span>
                <Badge
                  className={`${item.status === "completed" || item.status === "paid" || item.status === "accepted"
                      ? "bg-[var(--app-success-bg)] text-[var(--app-success-foreground)]"
                      : item.status === "pending" || item.status === "sent"
                        ? "bg-[var(--app-warning-bg)] text-[var(--app-warning-foreground)]"
                        : "bg-[var(--app-surface-tertiary)] text-[var(--app-text-muted)]"
                    }`}
                >
                  {item.status}
                </Badge>
              </div>

              <div className="text-sm text-[var(--app-text-secondary)]">
                {item.subtitle}
              </div>
            </div>

            <ArrowRight className="w-5 h-5 text-[var(--app-text-muted)]" />
          </div>
        </TitanCard>
      ))}
    </div>
  );
}
