-- Checkout already records this event atomically with its Order and Invoice.
-- Extend the existing allowlist without changing historical events or records.
ALTER TABLE public.portal_follow_up_items
  DROP CONSTRAINT portal_follow_up_items_event_type_ck;
--> statement-breakpoint
ALTER TABLE public.portal_follow_up_items
  ADD CONSTRAINT portal_follow_up_items_event_type_ck CHECK (event_type IN (
    'QUOTE_APPROVED', 'QUOTE_DECLINED', 'QUOTE_REVISION_REQUESTED',
    'PROOF_APPROVED', 'PROOF_REJECTED', 'PROOF_REVISION_REQUESTED',
    'INVOICE_PAYMENT_SUCCEEDED', 'ORDER_SUBMITTED'
  ));
