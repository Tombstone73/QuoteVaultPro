import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Search, Calendar, DollarSign, Package, Check, X, Eye, ChevronUp, ChevronDown, Copy, Edit, Printer } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrders, useUpdateOrder } from "@/hooks/useOrders";
import { OrderStatusBadge, OrderPriorityBadge } from "@/components/order-status-badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Page, PageHeader, ContentLayout, FilterPanel, DataCard, ColumnConfig, useColumnSettings, isColumnVisible, type ColumnDefinition } from "@/components/titan";

type SortKey = "date" | "orderNumber" | "customer" | "total" | "dueDate" | "status" | "priority" | "items";

// Column definitions for orders table
const ORDER_COLUMNS: ColumnDefinition[] = [
  { key: "orderNumber", label: "Order #", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "customer", label: "Customer", defaultVisible: true, defaultWidth: 180, minWidth: 120, maxWidth: 300, sortable: true },
  { key: "status", label: "Status", defaultVisible: true, defaultWidth: 130, minWidth: 100, maxWidth: 180, sortable: true },
  { key: "priority", label: "Priority", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "dueDate", label: "Due Date", defaultVisible: true, defaultWidth: 120, minWidth: 100, maxWidth: 180, sortable: true },
  { key: "items", label: "Items", defaultVisible: true, defaultWidth: 80, minWidth: 60, maxWidth: 120, sortable: true },
  { key: "total", label: "Total", defaultVisible: true, defaultWidth: 110, minWidth: 80, maxWidth: 150, sortable: true, align: "right" },
  { key: "created", label: "Created", defaultVisible: true, defaultWidth: 110, minWidth: 90, maxWidth: 150, sortable: true },
  { key: "actions", label: "Actions", defaultVisible: true, defaultWidth: 160, minWidth: 120, maxWidth: 200 },
];

export default function Orders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  
  // Column settings
  const [columnSettings, setColumnSettings] = useColumnSettings(ORDER_COLUMNS, "orders_column_settings");
  
  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  
  // Inline editing state
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'status' | 'priority' | 'dueDate' | null>(null);
  const [tempValue, setTempValue] = useState("");

  const { data: orders, isLoading } = useOrders({
    search,
    status: statusFilter !== "all" ? statusFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
  });

  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';
  
  // Helper to get column width style
  const getColStyle = (key: string) => {
    const settings = columnSettings[key];
    if (!settings?.visible) return { display: "none" as const };
    return { width: settings.width, minWidth: settings.width };
  };
  
  // Helper to check column visibility
  const isVisible = (key: string) => isColumnVisible(columnSettings, key);
  
  // Count visible columns for colspan
  const visibleColumnCount = ORDER_COLUMNS.filter(col => isVisible(col.key)).length;

  // Sorted orders
  const sortedOrders = useMemo(() => {
    if (!orders) return [];
    return [...orders].sort((a: any, b: any) => {
      let comparison = 0;
      switch (sortKey) {
        case "date":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "orderNumber":
          comparison = (a.orderNumber || "").localeCompare(b.orderNumber || "", undefined, { numeric: true });
          break;
        case "customer":
          const customerA = a.customer?.companyName || "";
          const customerB = b.customer?.companyName || "";
          comparison = customerA.localeCompare(customerB);
          break;
        case "total":
          comparison = parseFloat(a.total || "0") - parseFloat(b.total || "0");
          break;
        case "dueDate":
          const dueDateA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
          const dueDateB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
          comparison = dueDateA - dueDateB;
          break;
        case "status":
          const statusOrder = ['new', 'scheduled', 'in_production', 'ready_for_pickup', 'shipped', 'completed', 'on_hold', 'canceled'];
          comparison = statusOrder.indexOf(a.status || '') - statusOrder.indexOf(b.status || '');
          break;
        case "priority":
          const priorityOrder = ['rush', 'normal', 'low'];
          comparison = priorityOrder.indexOf(a.priority || '') - priorityOrder.indexOf(b.priority || '');
          break;
        case "items":
          const itemsA = Array.isArray(a.lineItems) ? a.lineItems.length : 0;
          const itemsB = Array.isArray(b.lineItems) ? b.lineItems.length : 0;
          comparison = itemsA - itemsB;
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [orders, sortKey, sortDirection]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Default direction based on column type
      setSortDirection(key === "customer" || key === "orderNumber" || key === "status" || key === "priority" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return null;
    return sortDirection === "asc" 
      ? <ChevronUp className="inline w-4 h-4 ml-1" />
      : <ChevronDown className="inline w-4 h-4 ml-1" />;
  };

  const handleStartEdit = (orderId: string, field: 'status' | 'priority' | 'dueDate', currentValue: string) => {
    if (!isAdminOrOwner) return;
    setEditingOrderId(orderId);
    setEditingField(field);
    setTempValue(currentValue);
  };

  const handleSaveEdit = async (orderId: string) => {
    if (!editingField) return;

    try {
      let updateData: any = {};
      
      if (editingField === 'dueDate') {
        updateData.dueDate = tempValue ? new Date(tempValue) : null;
      } else {
        updateData[editingField] = tempValue;
      }

      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to update order');

      toast({
        title: "Success",
        description: `Order ${editingField} updated`,
      });

      // Refresh orders list
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update order",
        variant: "destructive",
      });
    } finally {
      setEditingOrderId(null);
      setEditingField(null);
      setTempValue("");
    }
  };

  const handleCancelEdit = () => {
    setEditingOrderId(null);
    setEditingField(null);
    setTempValue("");
  };

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy");
    } catch {
      return "-";
    }
  };

  return (
    <Page>
      <PageHeader
        title="Orders"
        subtitle="Manage production orders and job tracking"
        backButton={
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
        }
        actions={
          <Link to="/orders/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Order
            </Button>
          </Link>
        }
      />

      <ContentLayout>
        {/* Filters */}
        <FilterPanel title="Filter Orders" description="Search and narrow down orders">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search orders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="in_production">In Production</SelectItem>
                <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="canceled">Canceled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="rush">Rush</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            {orders && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Package className="w-4 h-4" />
                <span>{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </FilterPanel>

        {/* Orders Table */}
        <DataCard
          title="Orders"
          description={`${orders?.length ?? 0} order${orders?.length !== 1 ? 's' : ''} found`}
          headerActions={
            <ColumnConfig
              columns={ORDER_COLUMNS}
              storageKey="orders_column_settings"
              settings={columnSettings}
              onSettingsChange={setColumnSettings}
            />
          }
          noPadding
        >
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow className="text-left">
                {isVisible("orderNumber") && (
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    style={getColStyle("orderNumber")}
                    onClick={() => handleSort("orderNumber")}
                  >
                    Order #<SortIcon columnKey="orderNumber" />
                  </TableHead>
                )}
                {isVisible("customer") && (
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    style={getColStyle("customer")}
                    onClick={() => handleSort("customer")}
                  >
                    Customer<SortIcon columnKey="customer" />
                  </TableHead>
                )}
                {isVisible("status") && (
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    style={getColStyle("status")}
                    onClick={() => handleSort("status")}
                  >
                    Status<SortIcon columnKey="status" />
                  </TableHead>
                )}
                {isVisible("priority") && (
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    style={getColStyle("priority")}
                    onClick={() => handleSort("priority")}
                  >
                    Priority<SortIcon columnKey="priority" />
                  </TableHead>
                )}
                {isVisible("dueDate") && (
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    style={getColStyle("dueDate")}
                    onClick={() => handleSort("dueDate")}
                  >
                    Due Date<SortIcon columnKey="dueDate" />
                  </TableHead>
                )}
                {isVisible("items") && (
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    style={getColStyle("items")}
                    onClick={() => handleSort("items")}
                  >
                    Items<SortIcon columnKey="items" />
                  </TableHead>
                )}
                {isVisible("total") && (
                  <TableHead 
                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                    style={getColStyle("total")}
                    onClick={() => handleSort("total")}
                  >
                    Total<SortIcon columnKey="total" />
                  </TableHead>
                )}
                {isVisible("created") && (
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    style={getColStyle("created")}
                    onClick={() => handleSort("date")}
                  >
                    Created<SortIcon columnKey="date" />
                  </TableHead>
                )}
                {isVisible("actions") && (
                  <TableHead style={getColStyle("actions")}>Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnCount} className="text-center py-8 text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                      <span>Loading orders...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : !orders || orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnCount} className="text-center py-8 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="w-12 h-12 text-muted-foreground" />
                      <p>No orders found</p>
                      <Link to="/orders/new">
                        <Button variant="outline" size="sm">
                          <Plus className="w-4 h-4 mr-2" />
                          Create first order
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                sortedOrders.map((order: any) => (
                  <TableRow key={order.id} className="cursor-pointer hover:bg-muted/50">
                    {isVisible("orderNumber") && (
                      <TableCell className="font-mono font-medium" style={getColStyle("orderNumber")}>
                        <Link to={`/orders/${order.id}`}>
                          <span className="hover:underline text-primary">{order.orderNumber}</span>
                        </Link>
                      </TableCell>
                    )}
                    {isVisible("customer") && (
                      <TableCell style={getColStyle("customer")}>
                        <div className="flex items-center gap-2">
                          <div>
                            {order.customer ? (
                              <Link to={`/customers/${order.customer.id}`}>
                                <div className="font-medium hover:underline cursor-pointer text-primary">
                                  {order.customer.companyName}
                                </div>
                              </Link>
                            ) : (
                              <div className="font-medium text-muted-foreground">Unknown</div>
                            )}
                            {order.contact && (
                              <div className="text-xs text-muted-foreground">
                                {order.contact.firstName} {order.contact.lastName}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    )}
                    {isVisible("status") && (
                      <TableCell onClick={(e) => e.stopPropagation()} style={getColStyle("status")}>
                        {isAdminOrOwner && editingOrderId === order.id && editingField === 'status' ? (
                          <div className="flex items-center gap-1">
                            <Select value={tempValue} onValueChange={setTempValue}>
                              <SelectTrigger className="h-8 w-[140px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="new">New</SelectItem>
                                <SelectItem value="scheduled">Scheduled</SelectItem>
                                <SelectItem value="in_production">In Production</SelectItem>
                                <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                                <SelectItem value="shipped">Shipped</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="on_hold">On Hold</SelectItem>
                                <SelectItem value="canceled">Canceled</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveEdit(order.id)}>
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelEdit}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <div 
                            className={isAdminOrOwner ? "cursor-pointer px-2 py-1 rounded inline-block" : ""}
                            onClick={() => isAdminOrOwner && handleStartEdit(order.id, 'status', order.status)}
                          >
                            <OrderStatusBadge status={order.status} />
                          </div>
                        )}
                      </TableCell>
                    )}
                    {isVisible("priority") && (
                      <TableCell onClick={(e) => e.stopPropagation()} style={getColStyle("priority")}>
                        {isAdminOrOwner && editingOrderId === order.id && editingField === 'priority' ? (
                          <div className="flex items-center gap-1">
                            <Select value={tempValue} onValueChange={setTempValue}>
                              <SelectTrigger className="h-8 w-[100px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="rush">Rush</SelectItem>
                                <SelectItem value="normal">Normal</SelectItem>
                                <SelectItem value="low">Low</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveEdit(order.id)}>
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelEdit}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <div 
                            className={isAdminOrOwner ? "cursor-pointer px-2 py-1 rounded inline-block" : ""}
                            onClick={() => isAdminOrOwner && handleStartEdit(order.id, 'priority', order.priority)}
                          >
                            <OrderPriorityBadge priority={order.priority} />
                          </div>
                        )}
                      </TableCell>
                    )}
                    {isVisible("dueDate") && (
                      <TableCell onClick={(e) => e.stopPropagation()} style={getColStyle("dueDate")}>
                        {isAdminOrOwner && editingOrderId === order.id && editingField === 'dueDate' ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="date"
                              value={tempValue}
                              onChange={(e) => setTempValue(e.target.value)}
                              className="h-8 w-[140px]"
                              autoFocus
                            />
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveEdit(order.id)}>
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelEdit}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <div 
                            className={isAdminOrOwner ? "cursor-pointer px-2 py-1 rounded" : ""}
                            onClick={() => isAdminOrOwner && handleStartEdit(order.id, 'dueDate', order.dueDate ? format(new Date(order.dueDate), 'yyyy-MM-dd') : '')}
                          >
                            {order.dueDate ? (
                              <div className="flex items-center gap-1">
                                <Calendar className="w-4 h-4 text-muted-foreground" />
                                <span>{formatDate(order.dueDate)}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                    )}
                    {isVisible("items") && (
                      <TableCell style={getColStyle("items")}>
                        <span className="text-muted-foreground">
                          {(Array.isArray(order.lineItems) ? order.lineItems.length : 0)} {(Array.isArray(order.lineItems) ? order.lineItems.length : 0) !== 1 ? 'items' : 'item'}
                        </span>
                      </TableCell>
                    )}
                    {isVisible("total") && (
                      <TableCell className="text-right" style={getColStyle("total")}>
                        <div className="flex flex-col items-end">
                          <span className="font-medium">{formatCurrency(order.total)}</span>
                          {parseFloat(order.discount) > 0 && (
                            <span className="text-xs text-muted-foreground">
                              -{formatCurrency(order.discount)} discount
                            </span>
                          )}
                        </div>
                      </TableCell>
                    )}
                    {isVisible("created") && (
                      <TableCell style={getColStyle("created")}>
                        <span className="text-sm text-muted-foreground">{formatDate(order.createdAt)}</span>
                      </TableCell>
                    )}
                    {isVisible("actions") && (
                      <TableCell onClick={(e) => e.stopPropagation()} style={getColStyle("actions")}>
                        <div className="flex gap-1 justify-end flex-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/orders/${order.id}`)}
                          title="View order"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/orders/${order.id}/edit`)}
                          title="Edit order"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/orders/new?duplicate=${order.id}`)}
                          title="Duplicate order"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`/orders/${order.id}/print`, '_blank')}
                          title="Print order"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
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
