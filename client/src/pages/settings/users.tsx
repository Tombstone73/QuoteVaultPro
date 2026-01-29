import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TitanCard } from "@/components/titan";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/apiConfig";
import { Loader2, UserPlus, RefreshCw, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type OrgUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isAdmin: boolean;
  mustSetPassword: boolean;
  createdAt: string;
};

export default function UsersSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  const [formData, setFormData] = React.useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "employee" as "owner" | "admin" | "manager" | "employee",
  });

  // Fetch users list
  const { data: usersResponse, isLoading } = useQuery<{ success: boolean; data: OrgUser[] }>({
    queryKey: [getApiUrl("/api/admin/users")],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/api/admin/users"), {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }
      return response.json();
    },
  });

  const users = usersResponse?.data || [];

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch(getApiUrl("/api/admin/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Failed to create user");
      }
      return result;
    },
    onSuccess: (data) => {
      toast({
        title: "User invited",
        description: data.message || "User has been invited successfully",
      });
      queryClient.invalidateQueries({ queryKey: [getApiUrl("/api/admin/users")] });
      setIsAddDialogOpen(false);
      setFormData({ email: "", firstName: "", lastName: "", role: "employee" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch(getApiUrl(`/api/admin/users/${userId}/reset-password`), {
        method: "POST",
        credentials: "include",
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Failed to reset password");
      }
      return result;
    },
    onSuccess: (data) => {
      toast({
        title: "Password reset",
        description: data.message || "User will receive new credentials via email",
      });
      queryClient.invalidateQueries({ queryKey: [getApiUrl("/api/admin/users")] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    createUserMutation.mutate(formData);
  };

  const handleResetPassword = (userId: string) => {
    if (confirm("Are you sure you want to reset this user's password? They will receive a new temporary password via email.")) {
      resetPasswordMutation.mutate(userId);
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "owner":
        return "default";
      case "admin":
        return "secondary";
      case "manager":
        return "outline";
      default:
        return "outline";
    }
  };

  return (
    <div className="space-y-6">
      <TitanCard className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-titan-text-primary">Users & Roles</h2>
            <p className="text-sm text-titan-text-secondary mt-1">
              Manage user accounts and permissions for your organization
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-titan-text-secondary" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-titan-text-secondary">No users found</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>
                    {user.firstName || user.lastName
                      ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                      : <span className="text-titan-text-secondary italic">No name</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getRoleBadgeVariant(user.role)}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.mustSetPassword ? (
                      <div className="flex items-center gap-1 text-amber-600">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-sm">Pending setup</span>
                      </div>
                    ) : (
                      <span className="text-sm text-titan-text-secondary">Active</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-titan-text-secondary">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleResetPassword(user.id)}
                      disabled={resetPasswordMutation.isPending}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Reset Password
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TitanCard>

      {/* Add User Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <form onSubmit={handleCreateUser}>
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Invite a new user to your organization. They will receive an email with temporary login credentials.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  placeholder="user@example.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    placeholder="John"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role *</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value: any) => setFormData({ ...formData, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-titan-text-secondary">
                  Owner and Admin roles have full access to settings and management features.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddDialogOpen(false)}
                disabled={createUserMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createUserMutation.isPending}>
                {createUserMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Send Invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
