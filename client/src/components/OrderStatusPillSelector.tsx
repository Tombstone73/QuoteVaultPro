/**
 * TitanOS Order Status Pill Selector
 * 
 * Dropdown selector for the tenant's active operational status-pill catalog.
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrderStatusPills, useAssignOrderStatusPill } from '@/hooks/useOrderStatusPills';
import type { OrderState } from '@/hooks/useOrderState';
import { Loader2 } from 'lucide-react';
import { buildOrderStatusPillChoices, resolveOrderStatusPillId } from '@/lib/orderStatusPills';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface OrderStatusPillSelectorProps {
  orderId: string;
  currentState: OrderState;
  currentPillId?: string | null;
  currentPillValue?: string | null;
  disabled?: boolean;
  className?: string;
}

export function OrderStatusPillSelector({
  orderId,
  currentState,
  currentPillId,
  currentPillValue,
  disabled = false,
  className = '',
}: OrderStatusPillSelectorProps) {
  const { data: pills, isLoading } = useOrderStatusPills();
  const assignPill = useAssignOrderStatusPill(orderId);
  const choices = buildOrderStatusPillChoices(pills, currentPillId, currentPillValue);
  const controlledPillId = resolveOrderStatusPillId(currentPillId, currentPillValue, choices);
  const [pendingSelection, setPendingSelection] = useState<{
    pillId: string;
    baselinePillId: string;
    confirmed: boolean;
  } | null>(null);

  useEffect(() => {
    setPendingSelection(null);
  }, [orderId]);

  useEffect(() => {
    if (!pendingSelection) return;
    if (controlledPillId === pendingSelection.pillId) {
      setPendingSelection(null);
      return;
    }
    if (pendingSelection.confirmed && controlledPillId !== pendingSelection.baselinePillId) {
      setPendingSelection(null);
    }
  }, [controlledPillId, pendingSelection]);

  const displayedPillId = pendingSelection?.pillId ?? controlledPillId;
  const displayedPill = choices.find((pill) => pill.id === displayedPillId)
    ?? choices.find((pill) => pill.name === currentPillValue);

  // TitanOS rule: canceled is a terminal workflow state and should not have editable pills
  if (currentState === 'canceled') {
    return (
      <span className={`text-sm text-muted-foreground ${className}`.trim()}>
        {currentPillValue || 'Canceled'}
      </span>
    );
  }

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!pills || pills.length === 0) {
    return null;
  }

  return (
    <Select
      value={displayedPillId}
      onValueChange={(value) => {
        setPendingSelection({ pillId: value, baselinePillId: controlledPillId, confirmed: false });
        assignPill.mutate(value || null, {
          onSuccess: (data: any) => {
            const confirmedPillId = data?.statusPill?.id ?? data?.data?.statusPillId ?? value;
            setPendingSelection((current) => current?.pillId === value
              ? { ...current, pillId: confirmedPillId, confirmed: true }
              : current);
          },
          onError: () => {
            setPendingSelection((current) => current?.pillId === value ? null : current);
          },
        });
      }}
      disabled={disabled || assignPill.isPending}
    >
      <SelectTrigger className={cn('w-[200px]', className)}>
        <SelectValue placeholder="Select status">
          {displayedPill && (
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: displayedPill.color || '#3b82f6' }}
              />
              {displayedPill.name}
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {choices.map((pill) => (
          <SelectItem key={pill.id} value={pill.id} disabled={!pill.assignable}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: pill.color }} />
              {pill.name}{pill.currentInactive ? ' (inactive)' : ''}
              {pill.isDefault && (
                <span className="text-xs text-muted-foreground ml-1">(default)</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
