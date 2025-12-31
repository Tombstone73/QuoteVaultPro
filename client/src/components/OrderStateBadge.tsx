/**
 * TitanOS Order State Badge
 * 
 * Read-only badge showing canonical order state
 */

import { Badge } from '@/components/ui/badge';
import type { OrderState } from '@/hooks/useOrderState';
import { getStateDisplayName, getStateColor } from '@/hooks/useOrderState';

interface OrderStateBadgeProps {
  state: OrderState;
  className?: string;
}

export function OrderStateBadge({ state, className }: OrderStateBadgeProps) {
  const displayName = getStateDisplayName(state);
  const colorClass = getStateColor(state);

  return (
    <Badge variant="outline" className={`${colorClass} ${className || ''}`}>
      {displayName}
    </Badge>
  );
}
