import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useOrders } from "@/hooks/useOrders";
import { useQuotes } from "@/hooks/useQuotes";
import { useInvoices } from "@/hooks/useInvoices";
import { Package, FileText, Receipt, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface ActivityItem {
  id: string;
  type: "order" | "quote" | "invoice";
  label: string;
  number: string;
  status: string;
  statusVariant: "default" | "secondary" | "destructive" | "outline";
  date: string;
  href: string;
  amount: number;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: quotes, isLoading: quotesLoading } = useQuotes();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices();

  const openOrders = orders?.filter((o) => o.state === "open") ?? [];
  const pendingQuotes = quotes?.filter((q) => q.state === "sent") ?? [];
  const unpaidInvoices = invoices?.filter((i) => i.status === "billed") ?? [];

  const cards = [
    {
      title: "Open Orders",
      count: openOrders.length,
      icon: Package,
      loading: ordersLoading,
      href: "/orders",
      description: "Orders currently in progress",
    },
    {
      title: "Pending Quotes",
      count: pendingQuotes.length,
      icon: FileText,
      loading: quotesLoading,
      href: "/quotes",
      description: "Quotes awaiting your approval",
    },
    {
      title: "Unpaid Invoices",
      count: unpaidInvoices.length,
      icon: Receipt,
      loading: invoicesLoading,
      href: "/invoices",
      description: "Invoices awaiting payment",
    },
  ];

  const isActivityLoading = ordersLoading || quotesLoading || invoicesLoading;

  const recentActivity: ActivityItem[] = [
    ...(orders ?? []).map((o) => ({
      id: o.id,
      type: "order" as const,
      label: "Order",
      number: o.orderNumber,
      status: o.stateLabel,
      statusVariant: (o.state === "open" ? "default" : o.state === "canceled" ? "destructive" : "secondary") as ActivityItem["statusVariant"],
      date: o.createdAt,
      href: `/orders/${o.id}`,
      amount: o.total,
    })),
    ...(quotes ?? []).map((q) => ({
      id: q.id,
      type: "quote" as const,
      label: "Quote",
      number: q.quoteNumber,
      status: q.stateLabel,
      statusVariant: (q.state === "sent" ? "default" : q.state === "expired" || q.state === "rejected" ? "destructive" : "secondary") as ActivityItem["statusVariant"],
      date: q.createdAt,
      href: `/quotes/${q.id}`,
      amount: q.total,
    })),
    ...(invoices ?? []).map((i) => ({
      id: i.id,
      type: "invoice" as const,
      label: "Invoice",
      number: i.invoiceNumber,
      status: i.statusLabel,
      statusVariant: (i.status === "billed" ? "destructive" : i.status === "paid" ? "secondary" : "outline") as ActivityItem["statusVariant"],
      date: i.createdAt,
      href: `/invoices/${i.id}`,
      amount: i.total,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);

  const typeIcon = { order: Package, quote: FileText, invoice: Receipt };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome to your customer portal</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Card
            key={card.title}
            className="cursor-pointer transition-shadow hover:shadow-md"
            onClick={() => navigate(card.href)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {card.loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-3xl font-bold text-foreground">{card.count}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
              <Button variant="link" className="px-0 mt-2 text-primary" size="sm">
                View all <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {isActivityLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          ) : (
            <div className="divide-y divide-border">
              {recentActivity.map((item) => {
                const Icon = typeIcon[item.type];
                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    className="flex items-center justify-between py-3 cursor-pointer hover:bg-muted/50 -mx-4 px-4 rounded-md transition-colors"
                    onClick={() => navigate(item.href)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.label} #{item.number}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(item.date), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={item.statusVariant}>{item.status}</Badge>
                      <span className="text-sm font-medium text-foreground w-20 text-right">
                        ${item.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
