import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Download, Search, Filter } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Page, PageHeader, ContentLayout, DataCard, StatusPill } from "@/components/titan";

interface AuditLog {
  id: string;
  userId: string | null;
  userName: string | null;
  actionType: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  description: string;
  oldValues: any;
  newValues: any;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export default function AuditLogs() {
  const [actionTypeFilter, setActionTypeFilter] = useState<string>("");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit-logs", actionTypeFilter, entityTypeFilter, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (actionTypeFilter) params.append("actionType", actionTypeFilter);
      if (entityTypeFilter) params.append("entityType", entityTypeFilter);
      if (startDate) params.append("startDate", startDate.toISOString());
      if (endDate) params.append("endDate", endDate.toISOString());
      params.append("limit", "1000");

      const response = await fetch(`/api/audit-logs?${params}`);
      if (!response.ok) throw new Error("Failed to fetch audit logs");
      return response.json();
    },
  });

  const filteredLogs = logs.filter((log) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      log.description.toLowerCase().includes(search) ||
      log.userName?.toLowerCase().includes(search) ||
      log.entityName?.toLowerCase().includes(search) ||
      log.entityType.toLowerCase().includes(search)
    );
  });

  const exportToCSV = () => {
    const headers = ["Date", "User", "Action", "Entity Type", "Entity Name", "Description", "IP Address"];
    const rows = filteredLogs.map((log) => [
      format(new Date(log.createdAt), "yyyy-MM-dd HH:mm:ss"),
      log.userName || "System",
      log.actionType,
      log.entityType,
      log.entityName || "",
      log.description,
      log.ipAddress || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getActionVariant = (action: string): "success" | "warning" | "error" | "info" | "default" => {
    switch (action) {
      case "delete":
        return "error";
      case "create":
        return "success";
      case "update":
        return "info";
      default:
        return "default";
    }
  };

  return (
    <Page>
      <PageHeader
        title="Audit Log"
        subtitle="Complete history of all system changes, deletions, and critical actions"
        className="pb-3"
        actions={
          <Button 
            onClick={exportToCSV} 
            variant="outline" 
            size="sm"
            className="border-titan-border text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      <ContentLayout className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-titan-text-muted" />
            <Input
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-9 bg-titan-bg-input border-titan-border-subtle text-titan-text-primary placeholder:text-titan-text-muted rounded-titan-md"
            />
          </div>

          <Select value={actionTypeFilter || "all"} onValueChange={(value) => setActionTypeFilter(value === "all" ? "" : value)}>
            <SelectTrigger className="h-9 bg-titan-bg-input border-titan-border-subtle text-titan-text-primary rounded-titan-md">
              <SelectValue placeholder="Action Type" />
            </SelectTrigger>
            <SelectContent className="bg-titan-bg-card border-titan-border">
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>

          <Select value={entityTypeFilter || "all"} onValueChange={(value) => setEntityTypeFilter(value === "all" ? "" : value)}>
            <SelectTrigger className="h-9 bg-titan-bg-input border-titan-border-subtle text-titan-text-primary rounded-titan-md">
              <SelectValue placeholder="Entity Type" />
            </SelectTrigger>
            <SelectContent className="bg-titan-bg-card border-titan-border">
              <SelectItem value="all">All Entities</SelectItem>
              <SelectItem value="contact">Contact</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="quote">Quote</SelectItem>
              <SelectItem value="order">Order</SelectItem>
              <SelectItem value="pricing">Pricing</SelectItem>
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                className={cn(
                  "h-9 border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md",
                  !startDate && "text-titan-text-muted"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {startDate ? format(startDate, "PPP") : "Start Date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-titan-bg-card border-titan-border">
              <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                className={cn(
                  "h-9 border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md",
                  !endDate && "text-titan-text-muted"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, "PPP") : "End Date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-titan-bg-card border-titan-border">
              <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex justify-between items-center">
          <p className="text-titan-sm text-titan-text-muted">
            Showing {filteredLogs.length} of {logs.length} logs
          </p>
        </div>

        {/* Audit Log Table */}
        <DataCard 
          title="Activity Log"
          className="bg-titan-bg-card border-titan-border-subtle"
        >
          <div className="rounded-titan-lg border border-titan-border-subtle overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                  <TableHead className="text-titan-text-secondary">Date & Time</TableHead>
                  <TableHead className="text-titan-text-secondary">User</TableHead>
                  <TableHead className="text-titan-text-secondary">Action</TableHead>
                  <TableHead className="text-titan-text-secondary">Entity</TableHead>
                  <TableHead className="text-titan-text-secondary">Description</TableHead>
                  <TableHead className="text-titan-text-secondary">IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-titan-text-muted">
                      Loading audit logs...
                    </TableCell>
                  </TableRow>
                ) : filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-titan-text-muted">
                      No audit logs found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => (
                    <>
                      <TableRow
                        key={log.id}
                        className="cursor-pointer hover:bg-titan-bg-card-elevated/50 border-b border-titan-border-subtle"
                        onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                      >
                        <TableCell className="font-mono text-titan-sm text-titan-text-secondary">
                          {format(new Date(log.createdAt), "MMM dd, yyyy HH:mm:ss")}
                        </TableCell>
                        <TableCell className="text-titan-text-primary">{log.userName || "System"}</TableCell>
                        <TableCell>
                          <StatusPill variant={getActionVariant(log.actionType)}>
                            {log.actionType.toUpperCase()}
                          </StatusPill>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium text-titan-text-primary">{log.entityType}</div>
                            {log.entityName && (
                              <div className="text-titan-sm text-titan-text-muted">{log.entityName}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md truncate text-titan-text-secondary">{log.description}</TableCell>
                        <TableCell className="font-mono text-xs text-titan-text-muted">
                          {log.ipAddress || "N/A"}
                        </TableCell>
                      </TableRow>
                      {expandedRow === log.id && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-titan-bg-card-elevated/30 border-b border-titan-border-subtle">
                            <div className="p-4 space-y-4">
                              <div>
                                <h4 className="font-semibold mb-2 text-titan-text-primary">Full Description</h4>
                                <p className="text-titan-sm text-titan-text-secondary">{log.description}</p>
                              </div>

                              {log.oldValues && (
                                <div>
                                  <h4 className="font-semibold mb-2 text-titan-text-primary">Previous Values</h4>
                                  <pre className="bg-titan-bg p-3 rounded-titan-md text-xs overflow-auto max-h-64 text-titan-text-secondary border border-titan-border-subtle">
                                    {JSON.stringify(log.oldValues, null, 2)}
                                  </pre>
                                </div>
                              )}

                              {log.newValues && (
                                <div>
                                  <h4 className="font-semibold mb-2 text-titan-text-primary">New Values</h4>
                                  <pre className="bg-titan-bg p-3 rounded-titan-md text-xs overflow-auto max-h-64 text-titan-text-secondary border border-titan-border-subtle">
                                    {JSON.stringify(log.newValues, null, 2)}
                                  </pre>
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-4 text-titan-sm">
                                <div>
                                  <span className="font-semibold text-titan-text-primary">User Agent:</span>
                                  <p className="text-titan-text-muted break-all">{log.userAgent || "N/A"}</p>
                                </div>
                                <div>
                                  <span className="font-semibold text-titan-text-primary">Entity ID:</span>
                                  <p className="text-titan-text-muted font-mono">{log.entityId || "N/A"}</p>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DataCard>
      </ContentLayout>
    </Page>
  );
}

