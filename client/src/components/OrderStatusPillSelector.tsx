/**
 * TitanOS Order Status Pill Selector
 * 
 * Dropdown selector for org-configured status pills within current state
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrderStatusPills, useAssignOrderStatusPill } from '@/hooks/useOrderStatusPills';
import type { OrderState } from '@/hooks/useOrderState';
import { Loader2 } from 'lucide-react';

interface OrderStatusPillSelectorProps {
  orderId: string;
  currentState: OrderState;
  currentPillValue?: string | null;
  disabled?: boolean;
  className?: string;
}

export function OrderStatusPillSelector({
  orderId,
  currentState,
  currentPillValue,
  disabled = false,
  className = '',
}: OrderStatusPillSelectorProps) {
  const { data: pills, isLoading } = useOrderStatusPills(currentState);
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
    return (
      <span className="text-sm text-muted-foreground">
        No status pills configured for this state
      </span>
    );
  }

  return (
    <Select
      value={currentPillValue || ''}
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
                  backgroundColor: pills.find(p => p.name === currentPillValue)?.color || '#3b82f6',
                }}
              />
              {currentPillValue}
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {pills.map((pill) => (
          <SelectItem key={pill.id} value={pill.name}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: pill.color }} />
              {pill.name}
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
