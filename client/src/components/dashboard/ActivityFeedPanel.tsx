import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type ActivityFeedItem = {
  id: string;
  timestamp?: string | null;
  text?: string | null;
  tag?: string | null;
};

type ActivityFeedPanelProps = {
  items?: ActivityFeedItem[];
  onViewAll?: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

export default function ActivityFeedPanel({
  items = [],
  onViewAll,
  collapsed,
  onCollapsedChange,
}: ActivityFeedPanelProps) {
  if (collapsed) {
    return (
      <Card className="border-border bg-card h-full">
        <CardContent className="h-full p-0">
          <button
            type="button"
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => onCollapsedChange(false)}
            aria-label="Expand activity feed"
            title="Expand activity feed"
          >
            <ChevronDown className="h-4 w-4" />
            <span className="text-[10px] font-medium uppercase tracking-widest [writing-mode:vertical-rl] rotate-180">Activity</span>
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm uppercase tracking-wider">Activity Feed {items.length > 0 ? `(${items.length})` : ""}</CardTitle>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onViewAll} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            View All
          </button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onCollapsedChange(!collapsed)} aria-label="Toggle activity feed">
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
