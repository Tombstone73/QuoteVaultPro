/**
 * TitanOS State Transition Buttons
 * 
 * Action buttons for transitioning order states
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useTransitionOrderState, useReopenOrder } from '@/hooks/useOrderState';
import type { OrderState } from '@/hooks/useOrderState';
import { AlertCircle, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';

interface CompleteProductionButtonProps {
  orderId: string;
  disabled?: boolean;
}

export function CompleteProductionButton({ orderId, disabled }: CompleteProductionButtonProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [notes, setNotes] = useState('');
  const transitionState = useTransitionOrderState(orderId);

  const handleConfirm = () => {
    transitionState.mutate(
      { nextState: 'production_complete', notes: notes || undefined },
      {
        onSuccess: () => {
          setShowDialog(false);
          setNotes('');
        },
      }
    );
  };

  return (
    <>
      <Button
        onClick={() => setShowDialog(true)}
        disabled={disabled}
        variant="default"
        className="bg-purple-600 hover:bg-purple-700"
      >
        <CheckCircle2 className="mr-2 h-4 w-4" />
        Complete Production
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Production</DialogTitle>
            <DialogDescription>
              Mark this order as production complete. The order will be routed to the next workflow stage.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about the production completion..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={transitionState.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={transitionState.isPending}>
              {transitionState.isPending ? 'Processing...' : 'Complete Production'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface CloseOrderButtonProps {
  orderId: string;
  disabled?: boolean;
}

export function CloseOrderButton({ orderId, disabled }: CloseOrderButtonProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [notes, setNotes] = useState('');
  const transitionState = useTransitionOrderState(orderId);

  const handleConfirm = () => {
    transitionState.mutate(
      { nextState: 'closed', notes: notes || undefined },
      {
        onSuccess: () => {
          setShowDialog(false);
          setNotes('');
        },
      }
    );
  };

  return (
    <>
      <Button onClick={() => setShowDialog(true)} disabled={disabled} variant="default">
        <CheckCircle2 className="mr-2 h-4 w-4" />
        Close Order
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Order</DialogTitle>
            <DialogDescription>
              Mark this order as closed. This is a terminal state and the order cannot be modified
              without using the Reopen action.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about closing this order..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={transitionState.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={transitionState.isPending}>
              {transitionState.isPending ? 'Processing...' : 'Close Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface CancelOrderButtonProps {
  orderId: string;
  disabled?: boolean;
}

export function CancelOrderButton({ orderId, disabled }: CancelOrderButtonProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [reason, setReason] = useState('');
  const transitionState = useTransitionOrderState(orderId);

  const handleConfirm = () => {
    if (!reason.trim()) {
      return; // Reason is required
    }

    transitionState.mutate(
      { nextState: 'canceled', notes: reason },
      {
        onSuccess: () => {
          setShowDialog(false);
          setReason('');
        },
      }
    );
  };

  return (
    <>
      <Button
        onClick={() => setShowDialog(true)}
        disabled={disabled}
        variant="destructive"
      >
        <XCircle className="mr-2 h-4 w-4" />
        Cancel Order
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Order</DialogTitle>
            <DialogDescription className="flex items-start gap-2 text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>
                Canceling this order is permanent. The order will be moved to a terminal state
                and cannot be resumed without using the Reopen action.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">
                Cancellation Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this order is being canceled..."
                rows={3}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={transitionState.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={transitionState.isPending || !reason.trim()}
              variant="destructive"
            >
              {transitionState.isPending ? 'Processing...' : 'Cancel Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ReopenOrderButtonProps {
  orderId: string;
  disabled?: boolean;
}

export function ReopenOrderButton({ orderId, disabled }: ReopenOrderButtonProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [reason, setReason] = useState('');
  const [targetState, setTargetState] = useState<'production_complete' | 'open'>('production_complete');
  const reopenOrder = useReopenOrder(orderId);

  const handleConfirm = () => {
    if (!reason.trim()) {
      return; // Reason is required
    }

    reopenOrder.mutate(
      { reason, targetState },
      {
        onSuccess: () => {
          setShowDialog(false);
          setReason('');
          setTargetState('production_complete');
        },
      }
    );
  };

  return (
    <>
      <Button
        onClick={() => setShowDialog(true)}
        disabled={disabled}
        variant="outline"
      >
        <RotateCcw className="mr-2 h-4 w-4" />
        Reopen Order
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen Closed Order</DialogTitle>
            <DialogDescription className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 text-yellow-600" />
              <span>
                Reopening a closed order will move it back into the active workflow.
                Invoices and payment records will NOT be affected. A reason is required for audit purposes.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reopen-reason">
                Reason for Reopening <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reopen-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this order needs to be reopened..."
                rows={3}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="target-state">Reopen To</Label>
              <select
                id="target-state"
                value={targetState}
                onChange={(e) => setTargetState(e.target.value as 'production_complete' | 'open')}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="production_complete">Production Complete (default)</option>
                <option value="open">Open (WIP)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Choose the state to resume the order in. Production Complete is recommended for most cases.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={reopenOrder.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={reopenOrder.isPending || !reason.trim()}
            >
              {reopenOrder.isPending ? 'Processing...' : 'Reopen Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
