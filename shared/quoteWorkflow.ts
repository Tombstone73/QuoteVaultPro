/**
 * QUOTE WORKFLOW - PHASE 1: Formal State Machine Definition
 * 
 * CRITICAL CONSTRAINT:
 * Database enum is ['draft', 'pending', 'active', 'canceled']
 * This module maps to enterprise workflow states using semantic mapping:
 * - 'draft' → Draft (new quotes being created)
 * - 'pending' → Sent (quote sent to customer, awaiting response)
 * - 'active' → Approved (customer accepted, quote locked)
 * - 'canceled' → Rejected (customer or internal rejection)
 * 
 * DERIVED STATES (not stored in DB):
 * - Expired: validUntil date has passed
 * - Converted: order exists referencing this quote
 * 
 * Future schema migration will align DB enum with enterprise labels.
 */

import { z } from "zod";

// ============================================================================
// DATABASE-ALIGNED TYPES (existing schema)
// ============================================================================

/**
 * Database enum values (from shared/schema.ts line 32)
 * DO NOT MODIFY without schema migration approval
 */
export type QuoteStatusDB = 'draft' | 'pending_approval' | 'pending' | 'active' | 'canceled';

/**
 * Enterprise workflow states (semantic layer)
 * These are what users see and what business logic operates on
 */
export type QuoteWorkflowState = 'draft' | 'pending_approval' | 'sent' | 'approved' | 'rejected' | 'expired' | 'converted';

// ============================================================================
// SEMANTIC MAPPING (DB ↔ Enterprise)
// ============================================================================

/**
 * Maps database enum values to enterprise workflow states
 */
export const DB_TO_WORKFLOW: Record<QuoteStatusDB, QuoteWorkflowState> = {
  draft: 'draft',
  pending_approval: 'pending_approval', // Awaiting internal approval
  pending: 'sent',      // Semantic: quote sent to customer
  active: 'approved',   // Semantic: customer approved (LOCKED)
  canceled: 'rejected', // Semantic: explicitly rejected
};

/**
 * Maps enterprise workflow states to database enum values
 */
export const WORKFLOW_TO_DB: Record<Exclude<QuoteWorkflowState, 'expired' | 'converted'>, QuoteStatusDB> = {
  draft: 'draft',
  pending_approval: 'pending_approval',
  sent: 'pending',
  approved: 'active',
  rejected: 'canceled',
};

/**
 * Human-readable labels for UI display
 */
export const WORKFLOW_LABELS: Record<QuoteWorkflowState, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  sent: 'Sent',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  converted: 'Converted',
};

/**
 * Badge variants for UI styling
 */
export const WORKFLOW_BADGE_VARIANTS: Record<QuoteWorkflowState, 'default' | 'secondary' | 'success' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  pending_approval: 'default',
  sent: 'default',
  approved: 'success',
  rejected: 'destructive',
  expired: 'outline',
  converted: 'outline',
};

// ============================================================================
// STATE MACHINE DEFINITION
// ============================================================================

/**
 * Valid state transitions matrix
 * Key: current state → Array of allowed next states
 */
export const ALLOWED_TRANSITIONS: Record<QuoteWorkflowState, QuoteWorkflowState[]> = {
  draft: ['pending_approval', 'sent', 'approved', 'rejected'], // Can request approval or approve directly
  pending_approval: ['approved', 'rejected', 'draft'], // Approvers can approve/reject, non-approvers can return to draft
  sent: ['approved', 'rejected', 'expired', 'draft'], // Can return to draft for edits
  approved: ['sent'], // Can send after approval (for Approve & Send workflow)
  rejected: [], // TERMINAL: Use "Revise Quote" to create new draft
  expired: [], // TERMINAL: Use "Revise Quote" to create new draft
  converted: [], // TERMINAL: Order already created (informational only)
};

/**
 * Terminal states that cannot transition to other states
 */
export const TERMINAL_STATES: QuoteWorkflowState[] = ['approved', 'converted'];

/**
 * States where quote content is locked (no edits allowed)
 */
export const LOCKED_STATES: QuoteWorkflowState[] = ['approved', 'converted'];

/**
 * States where conversion to order is allowed
 */
export const CONVERTIBLE_STATES: QuoteWorkflowState[] = ['approved'];

/**
 * States where conversion requires override (normally blocked)
 */
export const CONVERSION_OVERRIDE_REQUIRED: QuoteWorkflowState[] = ['expired'];

// ============================================================================
// VALIDATION & BUSINESS LOGIC
// ============================================================================

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: QuoteWorkflowState, to: QuoteWorkflowState): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Check if a quote is locked (immutable)
 */
export function isQuoteLocked(state: QuoteWorkflowState): boolean {
  return LOCKED_STATES.includes(state);
}

/**
 * Check if a quote is in a terminal state
 */
export function isTerminalState(state: QuoteWorkflowState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Check if a quote can be converted to an order
 */
export function canConvertToOrder(state: QuoteWorkflowState, allowOverride: boolean = false): boolean {
  if (CONVERTIBLE_STATES.includes(state)) return true;
  if (allowOverride && CONVERSION_OVERRIDE_REQUIRED.includes(state)) return true;
  return false;
}

/**
 * Get reason why a transition is blocked (for user messaging)
 */
export function getTransitionBlockReason(from: QuoteWorkflowState, to: QuoteWorkflowState): string | null {
  if (isValidTransition(from, to)) return null;
  
  if (isTerminalState(from)) {
    if (from === 'approved') {
      return 'Approved quotes are locked. Use "Revise Quote" to create a new draft based on this quote.';
    }
    if (from === 'converted') {
      return 'This quote has been converted to an order and cannot be modified.';
    }
  }
  
  return `Cannot transition from ${WORKFLOW_LABELS[from]} to ${WORKFLOW_LABELS[to]}.`;
}

/**
 * Get available actions for a quote in a given state
 */
export function getAvailableActions(state: QuoteWorkflowState, hasOrder: boolean): {
  action: string;
  label: string;
  targetState: QuoteWorkflowState;
  requiresConfirmation?: boolean;
  description?: string;
}[] {
  const actions: ReturnType<typeof getAvailableActions> = [];
  
  // Derived "converted" state takes precedence
  const effectiveState = hasOrder ? 'converted' : state;
  
  const allowed = ALLOWED_TRANSITIONS[effectiveState];
  
  for (const targetState of allowed) {
    switch (targetState) {
      case 'pending_approval':
        actions.push({
          action: 'request_approval',
          label: 'Request Approval',
          targetState: 'pending_approval',
          description: 'Submit this quote for internal approval',
        });
        break;
      case 'sent':
        actions.push({
          action: 'send',
          label: 'Send Quote',
          targetState: 'sent',
          description: 'Mark this quote as sent to the customer',
        });
        break;
      case 'approved':
        actions.push({
          action: 'approve',
          label: 'Approve Quote',
          targetState: 'approved',
          requiresConfirmation: true,
          description: 'Mark as approved. Quote will be locked and ready for conversion.',
        });
        break;
      case 'rejected':
        actions.push({
          action: 'reject',
          label: 'Reject Quote',
          targetState: 'rejected',
          requiresConfirmation: true,
          description: 'Mark this quote as rejected',
        });
        break;
      case 'draft':
        actions.push({
          action: 'return_to_draft',
          label: 'Return to Draft',
          targetState: 'draft',
          description: 'Return quote to draft for further edits',
        });
        break;
      case 'expired':
        // Expiration is automatic, not a manual action
        break;
    }
  }
  
  return actions;
}

/**
 * Determine effective workflow state including derived states
 * 
 * @param dbStatus - Status from database
 * @param validUntil - validUntil date from quote (ISO string or null)
 * @param hasOrder - Whether an order exists for this quote
 */
export function getEffectiveWorkflowState(
  dbStatus: QuoteStatusDB,
  validUntil: string | null | undefined,
  hasOrder: boolean
): QuoteWorkflowState {
  // Converted state takes precedence (derived from order existence)
  if (hasOrder) {
    return 'converted';
  }
  
  // Map DB status to workflow state
  const baseState = DB_TO_WORKFLOW[dbStatus];
  
  // Check for expiration (only for 'sent' quotes)
  if (baseState === 'sent' && validUntil) {
    try {
      const expiry = new Date(validUntil);
      const now = new Date();
      if (expiry < now) {
        return 'expired';
      }
    } catch {
      // Invalid date, ignore expiration check
    }
  }
  
  return baseState;
}

/**
 * Convert workflow state back to DB enum (for storage)
 * Throws if trying to store a derived state
 */
export function workflowStateToDb(state: QuoteWorkflowState): QuoteStatusDB {
  if (state === 'expired' || state === 'converted') {
    throw new Error(`Cannot store derived state "${state}" in database. Use the base state instead.`);
  }
  return WORKFLOW_TO_DB[state];
}

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

export const quoteStatusDBSchema = z.enum(['draft', 'pending_approval', 'pending', 'active', 'canceled']);

export const quoteWorkflowStateSchema = z.enum(['draft', 'pending_approval', 'sent', 'approved', 'rejected', 'expired', 'converted']);

export const transitionRequestSchema = z.object({
  toState: quoteWorkflowStateSchema,
  reason: z.string().optional(),
  overrideExpired: z.boolean().optional().default(false),
});

export type TransitionRequest = z.infer<typeof transitionRequestSchema>;

// ============================================================================
// CONSTANTS FOR ENTERPRISE RULES
// ============================================================================

/**
 * Default validity period for quotes (days)
 */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

/**
 * Grace period after expiration before hard blocking (days)
 */
export const EXPIRATION_GRACE_PERIOD_DAYS = 7;

/**
 * Lock message for approved quotes
 */
export const APPROVED_LOCK_MESSAGE = 'Approved quotes are locked and cannot be edited. Use "Revise Quote" to create a new draft.';

/**
 * Lock message for converted quotes
 */
export const CONVERTED_LOCK_MESSAGE = 'This quote has been converted to an order and cannot be modified.';
