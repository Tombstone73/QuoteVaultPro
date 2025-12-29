/**
 * Quote Workflow Status Badge
 * Displays enterprise workflow state labels (not raw DB enum values)
 */

import { Badge } from "@/components/ui/badge";
import { 
  WORKFLOW_LABELS, 
  WORKFLOW_BADGE_VARIANTS,
  type QuoteWorkflowState 
} from "@shared/quoteWorkflow";

interface QuoteWorkflowBadgeProps {
  state: QuoteWorkflowState;
  className?: string;
}

export function QuoteWorkflowBadge({ state, className }: QuoteWorkflowBadgeProps) {
  const label = WORKFLOW_LABELS[state];
  const variant = WORKFLOW_BADGE_VARIANTS[state];
  
  return (
    <Badge variant={variant as any} className={className}>
      {label}
    </Badge>
  );
}
