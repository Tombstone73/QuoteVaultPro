import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Edit, Trash2, Users, Shield, Crown, Briefcase, UserCircle, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { User } from "@shared/schema";
import { format } from "date-fns";

const ROLE_ICONS = {
  owner: Crown,
  admin: Shield,
  manager: Briefcase,
  employee: UserCircle,
  member: UserCircle,
  customer: Users,
};

const ROLE_COLORS = {
  owner: "text-yellow-600 dark:text-yellow-400",
  admin: "text-blue-600 dark:text-blue-400",
  manager: "text-purple-600 dark:text-purple-400",
  employee: "text-green-600 dark:text-green-400",
  member: "text-green-600 dark:text-green-400",
  customer: "text-gray-600 dark:text-gray-400",
};

const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Member",
  employee: "Employee",
  customer: "Customer",
};

interface OrgUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  role: 'owner' | 'admin' | 'manager' | 'member';
}

export default function UsersSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState<OrgUser | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    role: "member" as 'owner' | 'admin' | 'manager' | 'member',
  });
  const [inviteForm, setInviteForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "member" as 'owner' | 'admin' | 'manager' | 'member',
  });

  const { data: users, isLoading } = useQuery<OrgUser[]>({
    queryKey: ["/api/users"],
  });

  const { data: currentUser } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  const inviteUserMutation = useMutation({
    mutationFn: async (data: typeof inviteForm) => {
      return await apiRequest("POST", "/api/users", data);
    },
    onSuccess: () => {
      toast({
        title: "User Invited",
        description: "User has been added to the organization successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsInviteDialogOpen(false);
      setInviteForm({ email: "", firstName: "", lastName: "", role: "member" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { role?: string } }) => {
      return await apiRequest("PATCH", `/api/users/${id}`, updates);
    },
    onSuccess: () => {
      toast({
        title: "User Updated",
        description: "User role has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsEditDialogOpen(false);
      setEditingUser(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "User Removed",
        description: "User has been removed from the organization successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleInviteUser = () => {
    if (!inviteForm.email) {
      toast({
        title: "Email Required",
        description: "Please enter an email address",
        variant: "destructive",
      });
      return;
    }
    inviteUserMutation.mutate(inviteForm);
  };

  const handleEditUser = (user: OrgUser) => {
    setEditingUser(user);
    setEditForm({
      role: user.role,
    });
    setIsEditDialogOpen(true);
  };

  const handleSaveUser = () => {
    if (!editingUser) return;
    updateUserMutation.mutate({
      id: editingUser.id,
      updates: {
        role: editForm.role,
      },
    });
  };

  const handleDeleteUser = (id: string) => {
    if (currentUser?.id === id) {
      toast({
        title: "Cannot Remove",
        description: "You cannot remove yourself from the organization.",
        variant: "destructive",
      });
      return;
    }
    deleteUserMutation.mutate(id);
  };

  const getRoleBadge = (role: string) => {
    const Icon = ROLE_ICONS[role as keyof typeof ROLE_ICONS] || UserCircle;
    const color = ROLE_COLORS[role as keyof typeof ROLE_COLORS] || "text-gray-600";
    const label = ROLE_LABELS[role as keyof typeof ROLE_LABELS] || role;
    
    return (
      <Badge variant="outline" className="gap-1">
        <Icon className={`w-3 h-3 ${color}`} />
        <span className="capitalize">{label}</span>
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Users & Roles
              </CardTitle>
              <CardDescription>
                Manage user accounts and permissions for your organization.
              </CardDescription>
            </div>
            <Button onClick={() => setIsInviteDialogOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Invite User
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users && users.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">
                        {user.firstName || user.lastName
                          ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                          : "—"}
                      </div>
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>
                      {user.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditUser(user)}
                          disabled={currentUser?.id === user.id}
                          title="Edit role"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={currentUser?.id === user.id}
                              title="Remove from organization"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove User</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to remove {user.email} from this organization? They will lose access to all organization resources.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteUser(user.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No users found in this organization
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite User Dialog */}
      <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              Add a new user to your organization. If they don't have an account, one will be created.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email *</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="invite-firstName">First Name</Label>
                <Input
                  id="invite-firstName"
                  placeholder="John"
                  value={inviteForm.firstName}
                  onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-lastName">Last Name</Label>
                <Input
                  id="invite-lastName"
                  placeholder="Doe"
                  value={inviteForm.lastName}
                  onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteForm.role} onValueChange={(value: any) => setInviteForm({ ...inviteForm, role: value })}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">
                    <div className="flex items-center gap-2">
                      <Crown className="w-4 h-4 text-yellow-600" />
                      Owner - Full access
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-600" />
                      Admin - Manage users & settings
                    </div>
                  </SelectItem>
                  <SelectItem value="manager">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-purple-600" />
                      Manager - Operations & reporting
                    </div>
                  </SelectItem>
                  <SelectItem value="member">
                    <div className="flex items-center gap-2">
                      <UserCircle className="w-4 h-4 text-green-600" />
                      Member - Standard access
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Owners and admins can manage users and organization settings
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsInviteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleInviteUser} disabled={inviteUserMutation.isPending}>
              {inviteUserMutation.isPending ? "Inviting..." : "Invite User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Role Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User Role</DialogTitle>
            <DialogDescription>
              Change the role for {editingUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>User</Label>
              <Input
                value={
                  editingUser?.firstName || editingUser?.lastName
                    ? `${editingUser.firstName || ""} ${editingUser.lastName || ""}`.trim()
                    : editingUser?.email || ""
                }
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editForm.role} onValueChange={(value: any) => setEditForm({ ...editForm, role: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">
                    <div className="flex items-center gap-2">
                      <Crown className="w-4 h-4 text-yellow-600" />
                      Owner
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-600" />
                      Admin
                    </div>
                  </SelectItem>
                  <SelectItem value="manager">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-purple-600" />
                      Manager
                    </div>
                  </SelectItem>
                  <SelectItem value="member">
                    <div className="flex items-center gap-2">
                      <UserCircle className="w-4 h-4 text-green-600" />
                      Member
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Owner/Admin: Full system access • Manager: Operations management • Member: Standard access
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveUser} disabled={updateUserMutation.isPending}>
              {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}