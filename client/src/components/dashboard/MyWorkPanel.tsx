import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type MyWorkItem = {
  id: string;
  priority?: string | null;
  subject?: string | null;
  stage?: string | null;
  station?: string | null;
  due?: string | null;
  actionLabel?: string | null;
  onAction?: () => void;
};

type MyWorkPanelProps = {
  items?: MyWorkItem[];
  assignedCount?: number | null;
  onViewAll?: () => void;
};

function priorityBadgeVariant(priority?: string | null): "destructive" | "secondary" | "outline" {
  const p = (priority || "").toLowerCase();
  if (p === "high") return "destructive";
  if (p === "medium") return "secondary";
  return "outline";
}

export default function MyWorkPanel({ items = [], assignedCount, onViewAll }: MyWorkPanelProps) {
  const count = assignedCount ?? (items.length > 0 ? items.length : "—");

  return (
    <Card className="border-border bg-card h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">My Work</CardTitle>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {count} Assigned
          </Badge>
        </div>
        <button onClick={onViewAll} className="text-xs font-medium text-muted-foreground hover:text-foreground" type="button">
          View All
        </button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20">
              <TableHead className="h-10 text-[11px] uppercase tracking-wide">ID</TableHead>
              <TableHead className="h-10 text-[11px] uppercase tracking-wide">Priority</TableHead>
              <TableHead className="h-10 text-[11px] uppercase tracking-wide">Subject / Task</TableHead>
              <TableHead className="h-10 text-[11px] uppercase tracking-wide">Stage</TableHead>
              <TableHead className="h-10 text-[11px] uppercase tracking-wide">Station</TableHead>
              <TableHead className="h-10 text-[11px] uppercase tracking-wide">Due</TableHead>
              <TableHead className="h-10 text-right text-[11px] uppercase tracking-wide">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No assigned work yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.id}</TableCell>
                  <TableCell>
                    <Badge variant={priorityBadgeVariant(item.priority)} className="text-[10px] uppercase tracking-wide">
                      {item.priority || "Not available"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{item.subject || "Not available"}</TableCell>
                  <TableCell className="text-muted-foreground">{item.stage || "Not available"}</TableCell>
                  <TableCell className="text-muted-foreground">{item.station || "No station assigned"}</TableCell>
                  <TableCell className="text-muted-foreground">{item.due || "Not available"}</TableCell>
                  <TableCell className="text-right">
                    {item.onAction ? (
                      <button type="button" onClick={item.onAction} className="text-primary hover:text-primary/80">
                        {item.actionLabel || "Open"}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">Not available</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
