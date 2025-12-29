/**
 * Hook to get effective workflow state for a quote
 */

import { 
  getEffectiveWorkflowState,
  type QuoteStatusDB,
  type QuoteWorkflowState 
} from "@shared/quoteWorkflow";

export interface QuoteForWorkflow {
  status: QuoteStatusDB | string;
  validUntil?: string | null;
  convertedToOrderId?: string | null;
}

export function useQuoteWorkflowState(quote: QuoteForWorkflow | null | undefined): QuoteWorkflowState | null {
  if (!quote) return null;
  
  const dbStatus = quote.status as QuoteStatusDB;
  const validUntil = quote.validUntil ?? null;
  const hasOrder = !!quote.convertedToOrderId;
  
  return getEffectiveWorkflowState(dbStatus, validUntil, hasOrder);
}
