/**
 * Quote Workflow Actions Component
 * Displays available workflow action buttons based on current state
 */

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { Button } from "@/components/ui/button";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  getAvailableActions,
  type QuoteWorkflowState 
} from "@shared/quoteWorkflow";
import { 
  Send, 
  CheckCircle, 
  XCircle, 
  FileEdit,
  Loader2,
} from "lucide-react";

interface QuoteWorkflowActionsProps {
  quoteId: string;
  currentState: QuoteWorkflowState;
  hasOrder: boolean;
  onTransitionComplete?: () => void;
  className?: string;
}

const ACTION_ICONS = {
  send: Send,
  approve: CheckCircle,
  reject: XCircle,
  reopen: FileEdit,
  request_approval: Send,
  return_to_draft: FileEdit,
};

export function QuoteWorkflowActions({ 
  quoteId, 
  currentState, 
  hasOrder,
  onTransitionComplete,
  className 
}: QuoteWorkflowActionsProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { preferences, isLoading: prefsLoading } = useOrgPreferences();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ReturnType<typeof getAvailableActions>[0] | null>(null);
  const [reason, setReason] = useState("");
  const [isApproveAndSending, setIsApproveAndSending] = useState(false);
  
  // Check if user can approve quotes (case-insensitive role check)
  const userRole = (user?.role || '').toLowerCase();
  const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
  const requireApproval = preferences?.quotes?.requireApproval || false;

  const transitionMutation = useMutation({
    mutationFn: async ({ 
      toState, 
      reason,
      overrideExpired 
    }: { 
      toState: QuoteWorkflowState; 
      reason?: string;
      overrideExpired?: boolean;
    }) => {
      const response = await fetch(`/api/quotes/${quoteId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toState, reason, overrideExpired }),
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || data.message || "Transition failed");
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Status Updated",
        description: `Quote status changed to ${data.data.newState}`,
      });
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      
      setDialogOpen(false);
      setPendingAction(null);
      setReason("");
      
      if (onTransitionComplete) {
        onTransitionComplete();
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Transition Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  let availableActions = getAvailableActions(currentState, hasOrder);
  
  // Show Approve & Send only for approvers when in draft or pending_approval
  const showApproveAndSend = requireApproval && 
    (currentState === 'draft' || currentState === 'pending_approval') && 
    isInternalUser;
  
  // Filter actions based on requireApproval preference and user permissions
  if (requireApproval) {
    if (currentState === 'draft') {
      if (!isInternalUser) {
        // Non-approvers: only show request_approval action
        availableActions = availableActions.filter(action => action.action === 'request_approval');
      } else {
        // Approvers: can approve directly or request approval (remove request_approval for cleaner UX)
        availableActions = availableActions.filter(action => action.action !== 'request_approval');
      }
    } else if (currentState === 'pending_approval') {
      if (!isInternalUser) {
        // Non-approvers: can only return to draft
        availableActions = availableActions.filter(action => action.action === 'return_to_draft');
      }
      // Approvers see approve/reject from getAvailableActions
    }
  } else {
    // No approval required: remove request_approval action
    availableActions = availableActions.filter(action => action.action !== 'request_approval');
  }
  
  // Always filter out actions user doesn't have permission for
  if (!isInternalUser) {
    availableActions = availableActions.filter(action => action.action !== 'approve');
  }

  if (availableActions.length === 0 && !showApproveAndSend && !(requireApproval && currentState === 'draft')) {
    return null;
  }

  const handleActionClick = (action: ReturnType<typeof getAvailableActions>[0]) => {
    if (action.requiresConfirmation) {
      setPendingAction(action);
      setDialogOpen(true);
    } else {
      transitionMutation.mutate({ toState: action.targetState });
    }
  };

  const handleConfirm = () => {
    if (pendingAction) {
      transitionMutation.mutate({ 
        toState: pendingAction.targetState,
        reason: reason.trim() || undefined,
        overrideExpired: currentState === 'expired',
      });
    }
  };
  
  // Approve & Send: explicit two-step transition (draft → approved → sent)
  const handleApproveAndSend = async () => {
    setIsApproveAndSending(true);
    
    try {
      // Step 1: Approve
      const approveResponse = await fetch(`/api/quotes/${quoteId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toState: 'approved' }),
        credentials: "include",
      });
      
      if (!approveResponse.ok) {
        const data = await approveResponse.json();
        throw new Error(data.error || data.message || "Failed to approve quote");
      }
      
      // Step 2: Send
      const sendResponse = await fetch(`/api/quotes/${quoteId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toState: 'sent' }),
        credentials: "include",
      });
      
      if (!sendResponse.ok) {
        const data = await sendResponse.json();
        throw new Error(data.error || data.message || "Failed to send quote");
      }
      
      toast({
        title: "Quote Approved & Sent",
        description: "Quote has been approved and marked as sent",
      });
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      
      if (onTransitionComplete) {
        onTransitionComplete();
      }
    } catch (error: any) {
      toast({
        title: "Approve & Send Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsApproveAndSending(false);
    }
  };

  const Icon = pendingAction ? ACTION_ICONS[pendingAction.action as keyof typeof ACTION_ICONS] : null;
  
  return (
    <>
      <div className="space-y-2">
        {requireApproval && currentState === 'pending_approval' && !isInternalUser && (
          <div className="text-sm text-muted-foreground p-2 bg-muted/50 rounded-md">
            ⏳ <strong>Pending Approval</strong> — Waiting for authorized user to approve.
          </div>
        )}
        
        <div className={`flex flex-wrap gap-2 ${className || ''}`}>
          {availableActions.map((action) => {
          const ActionIcon = ACTION_ICONS[action.action as keyof typeof ACTION_ICONS];
          return (
            <Button
              key={action.action}
              variant={action.action === 'approve' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleActionClick(action)}
              disabled={transitionMutation.isPending || isApproveAndSending}
              title={action.description}
            >
              {transitionMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                ActionIcon && <ActionIcon className="mr-2 h-4 w-4" />
              )}
              {action.label}
            </Button>
          );
        })}
        
        {showApproveAndSend && (
          <Button
            variant="default"
            size="sm"
            onClick={handleApproveAndSend}
            disabled={transitionMutation.isPending || isApproveAndSending}
            title="Approve the quote and mark as sent in one action"
          >
            {isApproveAndSending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="mr-2 h-4 w-4" />
            )}
            {isApproveAndSending ? "Processing..." : "Approve & Send"}
          </Button>
        )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {Icon && <Icon className="h-5 w-5" />}
              {pendingAction?.label}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">
                Reason (optional)
              </Label>
              <Textarea
                id="reason"
                placeholder="Add a note about this action..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                setPendingAction(null);
                setReason("");
              }}
              disabled={transitionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={transitionMutation.isPending}
            >
              {transitionMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
