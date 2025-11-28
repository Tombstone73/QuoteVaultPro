import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Plus, Building2 } from "lucide-react";

type Customer = {
  id: string;
  companyName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  customerType: string;
  currentBalance: string;
  availableCredit: string;
  createdAt: string;
};

interface CustomerListProps {
  selectedCustomerId?: string;
  onSelectCustomer: (customerId: string) => void;
  onNewCustomer: () => void;
  search: string;
  collapseOnSelect?: boolean;
}

export default function CustomerList({
  selectedCustomerId,
  onSelectCustomer,
  onNewCustomer,
  search,
  collapseOnSelect = false,
}: CustomerListProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: [
      "/api/customers",
      {
        search,
        status: statusFilter === "all" ? undefined : statusFilter,
        customerType: typeFilter === "all" ? undefined : typeFilter,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (typeFilter !== "all") params.append("customerType", typeFilter);

      const url = `/api/customers${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customers");
      return response.json();
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "status-success";
      case "suspended":
        return "status-danger";
      case "on_hold":
        return "status-warning";
      default:
        return "status-muted";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "retail":
        return "status-muted";
      case "wholesale":
        return "status-muted";
      case "corporate":
        return "status-muted";
      default:
        return "status-muted";
    }
  };

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));
  };

  const collapse = Boolean(
    collapseOnSelect && selectedCustomerId && search.trim().length === 0
  );

  return (
    <div className="flex flex-col h-full">
      {/* Compact header: just filters, no title or extra copy */}
      {/* Compact header: just filters, no title or extra copy */}
      {!collapse && (
        <div className="p-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="grid grid-cols-2 gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className=""
                style={{
                  backgroundColor: "var(--bg-surface-soft)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              >
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger
                className=""
                style={{
                  backgroundColor: "var(--bg-surface-soft)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              >
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="retail">Retail</SelectItem>
                <SelectItem value="wholesale">Wholesale</SelectItem>
                <SelectItem value="corporate">Corporate</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Customer List */}
      {!collapse && (
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                <span className="text-sm text-muted-foreground">
                  Loading customers...
                </span>
              </div>
            </div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Building2
                className="w-12 h-12 mb-3"
                style={{ color: "var(--text-muted)" }}
              />
              <h3
                className="font-medium mb-1"
                style={{ color: "var(--text-primary)" }}
              >
                No customers found
              </h3>
              <p
                className="text-sm mb-4"
                style={{ color: "var(--text-muted)" }}
              >
                {search || statusFilter !== "all" || typeFilter !== "all"
                  ? "Try adjusting your filters"
                  : "Get started by adding your first customer"}
              </p>
              {!search &&
                statusFilter === "all" &&
                typeFilter === "all" && (
                  <Button onClick={onNewCustomer} size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Customer
                  </Button>
                )}
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {customers.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() => onSelectCustomer(customer.id)}
                  className={`
                    w-full text-left p-4 rounded-lg border backdrop-blur-sm transition-all
                    ${selectedCustomerId === customer.id ? "selected" : "base"}
                  `}
                  style={{
                    backgroundColor:
                      selectedCustomerId === customer.id
                        ? "var(--bg-surface-hover)"
                        : "var(--bg-surface-soft)",
                    borderColor:
                      selectedCustomerId === customer.id
                        ? "var(--accent-primary)"
                        : "var(--border-subtle)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="w-10 h-10 flex-shrink-0">
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                        {customer.companyName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-medium truncate mb-1"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {customer.companyName}
                      </div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Badge
                          variant="outline"
                          style={
                            getStatusColor(customer.status) === "status-success"
                              ? {
                                backgroundColor:
                                  "var(--badge-success-bg)",
                                color: "var(--badge-success-text)",
                                borderColor:
                                  "var(--badge-success-border)",
                              }
                              : getStatusColor(customer.status) ===
                                "status-danger"
                                ? {
                                  backgroundColor:
                                    "var(--badge-danger-bg)",
                                  color: "var(--badge-danger-text)",
                                  borderColor:
                                    "var(--badge-danger-border)",
                                }
                                : getStatusColor(customer.status) ===
                                  "status-warning"
                                  ? {
                                    backgroundColor:
                                      "var(--badge-warning-bg)",
                                    color: "var(--badge-warning-text)",
                                    borderColor:
                                      "var(--badge-warning-border)",
                                  }
                                  : {
                                    backgroundColor:
                                      "var(--badge-muted-bg)",
                                    color: "var(--badge-muted-text)",
                                    borderColor:
                                      "var(--badge-muted-border)",
                                  }
                          }
                        >
                          {customer.status.replace("_", " ")}
                        </Badge>
                        <Badge
                          variant="outline"
                          style={{
                            backgroundColor: "var(--badge-muted-bg)",
                            color: "var(--badge-muted-text)",
                            borderColor: "var(--badge-muted-border)",
                          }}
                        >
                          {customer.customerType}
                        </Badge>
                      </div>
                      {customer.email && (
                        <div
                          className="text-xs truncate mb-1"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {customer.email}
                        </div>
                      )}
                      {customer.phone && (
                        <div
                          className="text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {customer.phone}
                        </div>
                      )}
                      <div
                        className="flex items-center justify-between mt-2 pt-2 border-t"
                        style={{ borderColor: "var(--border-subtle)" }}
                      >
                        <div
                          className="text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          Balance
                        </div>
                        <div
                          className="text-xs font-medium"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {formatCurrency(customer.currentBalance || "0")}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
