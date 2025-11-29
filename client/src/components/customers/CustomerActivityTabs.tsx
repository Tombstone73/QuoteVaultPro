import React from "react";
import { useLocation } from "wouter";
import { DataCard } from "@/components/titan";
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

  const getStatusBadgeClass = (status: string) => {
    if (status === "completed" || status === "paid" || status === "accepted") {
      return "bg-green-500/10 text-green-600 border-green-500/20";
    }
    if (status === "pending" || status === "sent" || status === "new") {
      return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
    }
    return "bg-muted text-muted-foreground";
  };

  if (!items?.length)
    return (
      <div className="text-sm text-muted-foreground p-4">
        No {type}s found.
      </div>
    );

  return (
    <div className="space-y-3 mt-4">
      {items.map((item) => (
        <DataCard
          key={item.id}
          className="hover:-translate-y-[2px] transition hover:shadow-lg cursor-pointer"
          noPadding
          onClick={() => handleClick(item.id)}
        >
          <div className="flex justify-between items-center p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">
                  {item.title}
                </span>
                <Badge variant="outline" className={getStatusBadgeClass(item.status)}>
                  {item.status}
                </Badge>
              </div>

              <div className="text-sm text-muted-foreground">
                {item.subtitle}
              </div>
            </div>

            <ArrowRight className="w-5 h-5 text-muted-foreground" />
          </div>
        </DataCard>
      ))}
    </div>
  );
}
