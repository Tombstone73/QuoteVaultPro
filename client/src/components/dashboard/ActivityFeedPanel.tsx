import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export type ActivityFeedItem = {
  id: string;
  timestamp?: string | null;
  text?: string | null;
  tag?: string | null;
};

type ActivityFeedPanelProps = {
  items?: ActivityFeedItem[];
  onViewAll?: () => void;
};

export default function ActivityFeedPanel({ items = [], onViewAll }: ActivityFeedPanelProps) {
  const storageKey = "titan:dashboard:activityFeedCollapsed";
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      setCollapsed(raw === "true");
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, collapsed ? "true" : "false");
    } catch {
      // noop
    }
  }, [collapsed]);

  return (
    <Card className="border-border bg-card h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm uppercase tracking-wider">Activity Feed {items.length > 0 ? `(${items.length})` : ""}</CardTitle>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onViewAll} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            View All
          </button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCollapsed((v) => !v)} aria-label="Toggle activity feed">
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {!collapsed ? <CardContent>
        {items.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground">
            No recent activity available.
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.id} className="flex gap-3">
                <div className="mt-0.5 rounded-full bg-primary/10 p-1">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{item.timestamp || "Not available"}</p>
                  <p className="text-sm">{item.text || "Not available"}</p>
                  {item.tag ? <p className="text-[11px] text-muted-foreground">{item.tag}</p> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent> : null}
    </Card>
  );
}
