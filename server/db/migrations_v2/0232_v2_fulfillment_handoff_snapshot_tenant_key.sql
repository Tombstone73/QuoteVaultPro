-- 0231 used the tenant-paired handoff key for its foreign key. PostgreSQL
-- requires that pair to be an explicit unique target in addition to the id PK.
ALTER TABLE v2_fulfillment_handoffs
  ADD CONSTRAINT v2_fulfillment_handoffs_id_org_uidx UNIQUE (id, organization_id);
