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
  // TitanOS rule: canceled is a terminal workflow state and should not have editable pills
  if (currentState === 'canceled') {
    return (
      <span className={`text-sm text-muted-foreground ${className}`.trim()}>
        {currentPillValue || 'Canceled'}
      </span>
    );
  }

  const { data: pills, isLoading } = useOrderStatusPills();
  const assignPill = useAssignOrderStatusPill(orderId);

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

  const choices = buildOrderStatusPillChoices(pills, currentPillId, currentPillValue);

  return (
    <Select
      value={resolveOrderStatusPillId(currentPillId, currentPillValue, choices)}
      onValueChange={(value) => assignPill.mutate(value || null)}
      disabled={disabled || assignPill.isPending}
    >
      <SelectTrigger className={`w-[200px] ${className}`}>
        <SelectValue placeholder="Select status">
          {currentPillValue && (
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: choices.find(p => p.id === currentPillId || p.name === currentPillValue)?.color || '#3b82f6',
                }}
              />
              {currentPillValue}
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
