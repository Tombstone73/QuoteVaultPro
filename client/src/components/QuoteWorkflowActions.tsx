/**
 * Quote Workflow Actions Component
 * Displays available workflow action buttons based on current state
 */

import { useState } from "react";
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
};

export function QuoteWorkflowActions({ 
  quoteId, 
  currentState, 
  hasOrder,
  onTransitionComplete,
  className 
}: QuoteWorkflowActionsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ReturnType<typeof getAvailableActions>[0] | null>(null);
  const [reason, setReason] = useState("");

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

  const availableActions = getAvailableActions(currentState, hasOrder);

  if (availableActions.length === 0) {
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

  const Icon = pendingAction ? ACTION_ICONS[pendingAction.action as keyof typeof ACTION_ICONS] : null;

  return (
    <>
      <div className={`flex flex-wrap gap-2 ${className || ''}`}>
        {availableActions.map((action) => {
          const ActionIcon = ACTION_ICONS[action.action as keyof typeof ACTION_ICONS];
          return (
            <Button
              key={action.action}
              variant={action.action === 'approve' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleActionClick(action)}
              disabled={transitionMutation.isPending}
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
