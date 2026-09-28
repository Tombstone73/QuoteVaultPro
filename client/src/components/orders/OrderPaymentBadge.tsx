import { Badge } from '@/components/ui/badge';
import type { OrderPaymentSummary } from '@shared/orderPaymentSummary';

export function OrderPaymentBadge({ summary }: { summary?: OrderPaymentSummary }) {
  const color = summary?.status === 'paid' ? 'bg-green-100 text-green-800 border-green-300'
    : summary?.status === 'partial' ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
    : 'bg-gray-100 text-gray-800 border-gray-300';
  return <Badge variant="outline" className={`text-xs ${color}`} onClick={(event) => event.stopPropagation()}>
    {summary?.label ?? 'Payment unavailable'}
  </Badge>;
}
