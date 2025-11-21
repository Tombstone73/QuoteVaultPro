import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Plus, Search, Building2, Mail, Phone, DollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import CustomerForm from "@/components/customer-form";

type Customer = {
  id: string;
  companyName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  status: "active" | "inactive" | "suspended" | "on_hold";
  customerType: "retail" | "wholesale" | "corporate";
  currentBalance: string;
  availableCredit: string;
  createdAt: string;
};

interface CustomersProps {
  embedded?: boolean;
}

export default function Customers({ embedded = false }: CustomersProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showCustomerForm, setShowCustomerForm] = useState(false);

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers", { search, status: statusFilter !== "all" ? statusFilter : undefined, customerType: typeFilter !== "all" ? typeFilter : undefined }],
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
      case "active": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "inactive": return "bg-gray-500/10 text-gray-500 border-gray-500/20";
      case "suspended": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "on_hold": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "retail": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "wholesale": return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "corporate": return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  return (
    <div className={embedded ? "" : "min-h-screen bg-background"}>
      {!embedded && (
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
                  <h1 className="text-2xl font-bold">Companies</h1>
                  <p className="text-sm text-muted-foreground">Manage your company relationships</p>
                </div>
              </div>
              <Button onClick={() => setShowCustomerForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                New Company
              </Button>
            </div>
          </div>
        </header>
      )}

      <main className={embedded ? "" : "container mx-auto px-4 py-8"}>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Company List</CardTitle>
                <CardDescription>View and manage all companies</CardDescription>
              </div>
              {embedded && (
                <Button onClick={() => setShowCustomerForm(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Company
                </Button>
              )}
            </div>
            <div className="flex gap-4 mt-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search companies..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
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
                <SelectTrigger className="w-[180px]">
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
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-muted-foreground">Loading companies...</p>
              </div>
            ) : !customers || customers.length === 0 ? (
              <div className="text-center py-8">
                <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No companies found</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell>
                          <Link href={`/customers/${customer.id}`}>
                            <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
                              <Avatar>
                                <AvatarFallback>{customer.companyName[0]}</AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="font-medium text-primary hover:underline">{customer.companyName}</div>
                                {customer.displayName && (
                                  <div className="text-sm text-muted-foreground">{customer.displayName}</div>
                                )}
                              </div>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {customer.email && (
                              <div className="flex items-center gap-2 text-sm">
                                <Mail className="w-3 h-3 text-muted-foreground" />
                                <span>{customer.email}</span>
                              </div>
                            )}
                            {customer.phone && (
                              <div className="flex items-center gap-2 text-sm">
                                <Phone className="w-3 h-3 text-muted-foreground" />
                                <span>{customer.phone}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getTypeColor(customer.customerType)}>
                            {customer.customerType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getStatusColor(customer.status)}>
                            {customer.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            <div className="font-medium">
                              ${parseFloat(customer.currentBalance).toFixed(2)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              ${parseFloat(customer.availableCredit).toFixed(2)} available
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <CustomerForm
        open={showCustomerForm}
        onOpenChange={setShowCustomerForm}
      />
    </div>
  );
}


