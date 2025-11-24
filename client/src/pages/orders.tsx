import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Search, Calendar, DollarSign, Package, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrders, useUpdateOrder } from "@/hooks/useOrders";
import { OrderStatusBadge, OrderPriorityBadge } from "@/components/order-status-badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function Orders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  
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
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Orders</h1>
                <p className="text-sm text-muted-foreground">Manage production orders and job tracking</p>
              </div>
            </div>
            <Link href="/orders/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Order
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
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
          </CardContent>
        </Card>

        {/* Orders Table */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                      <span className="text-muted-foreground">Loading orders...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : !orders || orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="w-12 h-12 text-muted-foreground/50" />
                      <p className="text-muted-foreground">No orders found</p>
                      <Link href="/orders/new">
                        <Button variant="outline" size="sm">
                          <Plus className="w-4 h-4 mr-2" />
                          Create first order
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order: any) => (
                  <TableRow key={order.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-mono font-medium">
                      <Link href={`/orders/${order.id}`}>
                        <span className="text-primary hover:underline">{order.orderNumber}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          {order.customer ? (
                            <Link href={`/customers/${order.customer.id}`}>
                              <div className="font-medium text-primary hover:underline cursor-pointer">
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
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
                          className={isAdminOrOwner ? "cursor-pointer hover:bg-muted/50 px-2 py-1 rounded inline-block" : ""}
                          onClick={() => isAdminOrOwner && handleStartEdit(order.id, 'status', order.status)}
                        >
                          <OrderStatusBadge status={order.status} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
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
                          className={isAdminOrOwner ? "cursor-pointer hover:bg-muted/50 px-2 py-1 rounded inline-block" : ""}
                          onClick={() => isAdminOrOwner && handleStartEdit(order.id, 'priority', order.priority)}
                        >
                          <OrderPriorityBadge priority={order.priority} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
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
                          className={isAdminOrOwner ? "cursor-pointer hover:bg-muted/50 px-2 py-1 rounded" : ""}
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
                    <TableCell>
                      <span className="text-muted-foreground">
                        {(Array.isArray(order.lineItems) ? order.lineItems.length : 0)} {(Array.isArray(order.lineItems) ? order.lineItems.length : 0) !== 1 ? 'items' : 'item'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end">
                        <span className="font-medium">{formatCurrency(order.total)}</span>
                        {parseFloat(order.discount) > 0 && (
                          <span className="text-xs text-muted-foreground">
                            -{formatCurrency(order.discount)} discount
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{formatDate(order.createdAt)}</span>
                    </TableCell>
                    <TableCell>
                      <Link href={`/orders/${order.id}`}>
                        <Button variant="outline" size="sm">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </main>
    </div>
  );
}
