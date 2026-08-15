-- Sales scalar header fields are the one mutable owner for context, rep, and
-- notes. terms_json stores only terms-code/forward-compatible terms; it must
-- never become a second mutable copy of these named fields.
ALTER TABLE v2_sales_documents
  ADD CONSTRAINT v2_sales_documents_terms_no_duplicate_projection_chk
  CHECK (NOT (terms_json ?| ARRAY['taxContextReference', 'salesRepresentativeId', 'commercialNotes']));
