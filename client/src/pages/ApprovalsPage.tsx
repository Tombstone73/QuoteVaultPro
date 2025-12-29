import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  ExternalLink, 
  CheckCircle, 
  Loader2,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface PendingApproval {
  id: string;
  quoteNumber: number;
  customerName: string;
  customerId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  totalPrice: string;
  createdAt: string;
  updatedAt: string;
  requestedBy: string;
  requestedAt: string;
  status: string;
}

export default function ApprovalsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { preferences } = useOrgPreferences();
  const queryClient = useQueryClient();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveAndSendingId, setApproveAndSendingId] = useState<string | null>(null);

  // Check permissions
  const userRole = (user?.role || '').toLowerCase();
  const isApprover = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
  const requireApproval = preferences?.quotes?.requireApproval || false;

  // Fetch pending approvals
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/quotes/pending-approvals"],
    queryFn: async () => {
      const res = await fetch("/api/quotes/pending-approvals", {
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to fetch pending approvals");
      }
      return res.json() as Promise<{
        success: boolean;
        data: PendingApproval[];
        count: number;
      }>;
    },
    enabled: isApprover && requireApproval,
  });

  const approveMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      const res = await fetch(`/api/quotes/${quoteId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toState: "approved" }),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to approve quote");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      toast({ title: "Quote Approved", description: "Quote has been approved and locked" });
      setApprovingId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Approval Failed", description: error.message, variant: "destructive" });
      setApprovingId(null);
    },
  });

  const approveAndSendMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      // Step 1: Approve
      const approveRes = await fetch(`/api/quotes/${quoteId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toState: "approved" }),
        credentials: "include",
      });
      if (!approveRes.ok) {
        const error = await approveRes.json();
        throw new Error(error.error || "Failed to approve quote");
      }

      // Step 2: Send
      const sendRes = await fetch(`/api/quotes/${quoteId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toState: "sent" }),
        credentials: "include",
      });
      if (!sendRes.ok) {
        const error = await sendRes.json();
        throw new Error(error.error || "Failed to send quote");
      }
      return sendRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      toast({ title: "Quote Approved & Sent", description: "Quote has been approved and marked as sent" });
      setApproveAndSendingId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Approve & Send Failed", description: error.message, variant: "destructive" });
      setApproveAndSendingId(null);
    },
  });

  const handleApprove = (quoteId: string) => {
    setApprovingId(quoteId);
    approveMutation.mutate(quoteId);
  };

  const handleApproveAndSend = (quoteId: string) => {
    setApproveAndSendingId(quoteId);
    approveAndSendMutation.mutate(quoteId);
  };

  // Redirect if not authorized
  if (!isApprover || !requireApproval) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              <p>You don't have permission to view this page.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p>Loading pending approvals...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>Failed to load pending approvals: {error.message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const approvals = data?.data || [];
  const count = data?.count || 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Approvals Queue</h1>
        <p className="text-muted-foreground mt-1">
          {count} {count === 1 ? 'quote' : 'quotes'} pending approval
        </p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Pending Approvals</CardTitle>
            {count > 0 && (
              <Badge variant="default" className="text-sm">
                {count} pending
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {count === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No pending approvals</p>
              <p className="text-sm mt-1">All quotes have been reviewed</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quote #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvals.map((approval) => (
                    <TableRow key={approval.id}>
                      <TableCell className="font-mono font-medium">
                        #{approval.quoteNumber}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[200px] truncate">
                          {approval.customerName}
                        </div>
                      </TableCell>
                      <TableCell>
                        {approval.contactName ? (
                          <div className="text-sm">
                            <div className="font-medium">{approval.contactName}</div>
                            {approval.contactEmail && (
                              <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {approval.contactEmail}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Number(approval.totalPrice).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(approval.requestedAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-sm">
                        {approval.requestedBy}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/quotes/${approval.id}`)}
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Open
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleApprove(approval.id)}
                            disabled={approvingId === approval.id || approveAndSendingId === approval.id}
                          >
                            {approvingId === approval.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle className="h-4 w-4 mr-1" />
                            )}
                            Approve
                          </Button>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleApproveAndSend(approval.id)}
                            disabled={approvingId === approval.id || approveAndSendingId === approval.id}
                          >
                            {approveAndSendingId === approval.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle className="h-4 w-4 mr-1" />
                            )}
                            Approve & Send
                          </Button>
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
    </div>
  );
}
