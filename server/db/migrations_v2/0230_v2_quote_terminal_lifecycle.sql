-- M6: terminal Quote outcomes are distinct from delivery and acceptance.
-- Existing Quotes stay open/discoverable and retain their historical states.
ALTER TABLE v2_sales_quote_details
  ADD COLUMN lifecycle_state varchar(24) NOT NULL DEFAULT 'open',
  ADD CONSTRAINT v2_sales_quote_details_lifecycle_state_chk CHECK (lifecycle_state IN ('open','declined','voided'));
ALTER TABLE v2_sales_quote_checkpoints
  DROP CONSTRAINT v2_sales_quote_checkpoints_kind_chk,
  ADD CONSTRAINT v2_sales_quote_checkpoints_kind_chk CHECK (checkpoint_kind IN ('quote_sent', 'quote_accepted', 'quote_converted', 'quote_declined', 'quote_voided'));
