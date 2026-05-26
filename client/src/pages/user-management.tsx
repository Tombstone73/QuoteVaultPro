import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, ArrowLeft, Crown, Loader2, Shield, Trash2, UserCog, UserPlus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type OrgRole = "owner" | "admin" | "manager" | "member";

type OrgUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role?: string;
  orgRole: OrgRole;
  isInvited: boolean;
  createdAt: string;
  updatedAt: string;
};

type UserManagementProps = {
  embedded?: boolean;
};

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body?.message || body?.error || fallback;
  } catch {
    return fallback;
  }
}

function roleOptionsFor(actorRole: string): Array<{ value: OrgRole; label: string }> {
  if (actorRole === "owner") {
    return [
      { value: "owner", label: "Owner" },
      { value: "admin", label: "Admin" },
      { value: "manager", label: "Manager" },
      { value: "member", label: "Member" },
    ];
  }

  if (actorRole === "admin") {
    return [
      { value: "admin", label: "Admin" },
      { value: "manager", label: "Manager" },
      { value: "member", label: "Member" },
    ];
  }

  return [];
}

export default function UserManagement({ embedded = false }: UserManagementProps) {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [userToDelete, setUserToDelete] = useState<OrgUser | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");

  const {
    data: users = [],
    isLoading,
    isError,
    error,
  } = useQuery<OrgUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const response = await fetch("/api/users", { credentials: "include" });
      if (!response.ok) {
        const message = response.status === 403
          ? "Permission denied"
          : await readErrorMessage(response, "Failed to load users");
        throw new Error(message);
      }
      return response.json();
    },
  });

  const currentOrgRole = users.find((u) => u.id === currentUser?.id)?.orgRole ?? "";
  const canManageUsers = currentOrgRole === "owner" || currentOrgRole === "admin";
  const ownerCount = users.filter((u) => u.orgRole === "owner").length;
  const assignableRoles = roleOptionsFor(currentOrgRole);

  const inviteUserMutation = useMutation({
    mutationFn: async ({ email, orgRole }: { email: string; orgRole: OrgRole }) => {
      const response = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, orgRole }),
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Invite failed"));
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "User invited",
        description: "The new member was added after the backend invite completed.",
      });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("member");
    },
    onError: (error: Error) => {
      toast({
        title: "Invite failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, orgRole }: { id: string; orgRole: OrgRole }) => {
      const response = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgRole }),
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to update user role"));
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Role updated",
        description: "The organization role was updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Role update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to remove user"));
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "User removed",
        description: "The member was removed from this organization.",
      });
      setUserToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Remove failed",
        description: error.message,
        variant: "destructive",
      });
      setUserToDelete(null);
    },
  });

  const handleInviteSubmit = () => {
    const email = inviteEmail.trim();
    if (!email) {
      toast({
        title: "Invite failed",
        description: "Email is required",
        variant: "destructive",
      });
      return;
    }

    if (!assignableRoles.some((role) => role.value === inviteRole)) {
      toast({
        title: "Invite failed",
        description: "You do not have permission to assign that role.",
        variant: "destructive",
      });
      return;
    }

    inviteUserMutation.mutate({ email, orgRole: inviteRole });
  };

  const handleRoleChange = (userId: string, newRole: OrgRole) => {
    updateUserMutation.mutate({ id: userId, orgRole: newRole });
  };

  const handleDeleteUser = () => {
    if (userToDelete) {
      deleteUserMutation.mutate(userToDelete.id);
    }
  };

  const canEditRole = (user: OrgUser) => {
    if (!canManageUsers || user.id === currentUser?.id) return false;
    if (user.orgRole === "owner") return currentOrgRole === "owner" && ownerCount > 1;
    return true;
  };

  const canRemoveUser = (user: OrgUser) => {
    if (!canManageUsers || user.id === currentUser?.id) return false;
    if (user.orgRole === "owner") return currentOrgRole === "owner" && ownerCount > 1;
    return true;
  };

  const getOrgRoleBadge = (orgRole: OrgRole, isInvited: boolean) => {
    const badgeContent = (
      <>
        {orgRole === "admin" && <Shield className="w-3 h-3 mr-1" />}
        {orgRole === "owner" && <Crown className="w-3 h-3 mr-1" />}
        {ROLE_LABELS[orgRole]}
        {isInvited && <span className="ml-1 text-xs">(Invited)</span>}
      </>
    );

    switch (orgRole) {
      case "owner":
        return <Badge className="bg-purple-600">{badgeContent}</Badge>;
      case "admin":
        return <Badge className="bg-primary">{badgeContent}</Badge>;
      case "manager":
        return <Badge variant="secondary">{badgeContent}</Badge>;
      case "member":
      default:
        return <Badge variant="outline">{badgeContent}</Badge>;
    }
  };

  const inviteControl = canManageUsers ? (
    <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="w-4 h-4 mr-2" />
          Add / Invite User
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite User to Organization</DialogTitle>
          <DialogDescription>
            The member is added only after the backend invite succeeds.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email Address</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="user@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Organization Role</Label>
            <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as OrgRole)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleInviteSubmit} disabled={inviteUserMutation.isPending}>
            {inviteUserMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              "Send Invitation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  if (isLoading) {
    return (
      <div className={embedded ? "flex items-center justify-center py-10" : "min-h-screen bg-background flex items-center justify-center"}>
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span>Loading users...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={embedded ? "space-y-6" : "min-h-screen bg-background"}>
        <main className={embedded ? "space-y-6" : "container mx-auto px-4 py-6"}>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Failed to load users</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : "Failed to load users"}</AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className={embedded ? "space-y-6" : "min-h-screen bg-background"}>
      {!embedded && (
        <header className="border-b sticky top-0 bg-background z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div className="flex-1">
                <h1 className="text-2xl font-bold">User Management</h1>
                <p className="text-sm text-muted-foreground">
                  Manage user roles and permissions for your organization
                </p>
              </div>
              {inviteControl}
            </div>
          </div>
        </header>
      )}

      <main className={embedded ? "space-y-6" : "container mx-auto px-4 py-6"}>
        {embedded && (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-titan-lg font-semibold text-titan-text-primary">Users & Roles</h2>
              <p className="text-titan-sm text-titan-text-secondary mt-1">
                Manage organization members, roles, and access.
              </p>
            </div>
            {inviteControl}
          </div>
        )}

        {!canManageUsers && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Permission denied</AlertTitle>
            <AlertDescription>
              Only organization owners and admins can invite users, change roles, or remove members.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Organization Members</CardTitle>
            <CardDescription>
              {users.length} member{users.length !== 1 ? "s" : ""} in your organization
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    {canManageUsers && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => {
                    const isCurrentUser = user.id === currentUser?.id;
                    const editAllowed = canEditRole(user);
                    const removeAllowed = canRemoveUser(user);

                    return (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="font-medium">
                            {user.firstName || user.lastName
                              ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                              : user.email}
                          </div>
                          {isCurrentUser && (
                            <Badge variant="secondary" className="mt-1">You</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell>
                          {editAllowed ? (
                            <Select
                              value={user.orgRole}
                              onValueChange={(value) => handleRoleChange(user.id, value as OrgRole)}
                              disabled={updateUserMutation.isPending}
                            >
                              <SelectTrigger className="w-[140px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {assignableRoles.map((role) => (
                                  <SelectItem key={role.value} value={role.value}>
                                    {role.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            getOrgRoleBadge(user.orgRole, user.isInvited)
                          )}
                        </TableCell>
                        <TableCell>
                          {user.isInvited ? (
                            <Badge variant="outline" className="border-yellow-600 text-yellow-600">
                              Pending
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-green-600 text-green-600">
                              Active
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(user.createdAt), "MMM d, yyyy")}
                        </TableCell>
                        {canManageUsers && (
                          <TableCell className="text-right">
                            {removeAllowed && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setUserToDelete(user)}
                                disabled={deleteUserMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {users.length === 0 && (
              <div className="text-center py-12">
                <UserCog className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No members found</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!userToDelete} onOpenChange={() => setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {userToDelete?.email} from your organization? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
