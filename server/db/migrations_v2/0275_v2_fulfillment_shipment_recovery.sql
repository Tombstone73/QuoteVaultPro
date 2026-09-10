-- M7.8B: prepared shipment work is a recoverable operational draft, never an
-- implicit fulfillment fact.  Revisions and their proposed allocations are
-- append-only evidence.  Only the later immutable shipment handoffs satisfy
-- a customer Order.

ALTER TABLE v2_fulfillment_shipments
  ADD COLUMN prepared_revision_id varchar,
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_principal_kind varchar(32),
  ADD COLUMN voided_principal_subject varchar(255),
  ADD COLUMN voided_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN void_reason varchar(1000);

ALTER TABLE v2_fulfillment_shipments
  ADD CONSTRAINT v2_fulfillment_shipments_id_org_uidx UNIQUE (id, organization_id);

ALTER TABLE v2_fulfillment_shipments
  DROP CONSTRAINT v2_fulfillment_shipments_status_chk,
  DROP CONSTRAINT v2_fulfillment_shipments_shipped_chk,
  ADD CONSTRAINT v2_fulfillment_shipments_status_chk
    CHECK (shipment_status IN ('prepared','shipped','voided')),
  ADD CONSTRAINT v2_fulfillment_shipments_lifecycle_chk CHECK (
    (shipment_status='prepared'
      AND shipped_at IS NULL AND shipped_principal_kind IS NULL AND shipped_principal_subject IS NULL
      AND voided_at IS NULL AND voided_principal_kind IS NULL AND voided_principal_subject IS NULL
      AND voided_staff_actor_user_id IS NULL AND void_reason IS NULL)
    OR
    (shipment_status='shipped'
      AND shipped_at IS NOT NULL AND shipped_principal_kind IS NOT NULL AND shipped_principal_subject IS NOT NULL
      AND voided_at IS NULL AND voided_principal_kind IS NULL AND voided_principal_subject IS NULL
      AND voided_staff_actor_user_id IS NULL AND void_reason IS NULL)
    OR
    (shipment_status='voided'
      AND shipped_at IS NULL AND shipped_principal_kind IS NULL AND shipped_principal_subject IS NULL
      AND voided_at IS NOT NULL AND voided_principal_kind IS NOT NULL AND voided_principal_subject IS NOT NULL
      AND length(btrim(void_reason)) > 0)
  ),
  ADD CONSTRAINT v2_fulfillment_shipments_voided_actor_chk
    CHECK (voided_principal_kind IS NULL OR voided_principal_kind IN ('staff','delegated_ai','portal','service'));

CREATE TABLE v2_fulfillment_shipment_prepared_revisions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  shipment_id varchar NOT NULL,
  revision_number integer NOT NULL,
  revision_kind varchar(16) NOT NULL,
  supersedes_revision_id varchar,
  customer_id varchar REFERENCES customers(id) ON DELETE RESTRICT,
  destination jsonb,
  manual_carrier_name varchar(120),
  manual_carrier_service varchar(120),
  manual_tracking_number varchar(180),
  notes varchar(2000),
  package_count integer,
  correction_reason varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_prepared_revisions_shipment_fk
    FOREIGN KEY (shipment_id, organization_id)
    REFERENCES v2_fulfillment_shipments(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_prepared_revisions_id_org_shipment_uidx
    UNIQUE (id, organization_id, shipment_id),
  CONSTRAINT v2_fulfillment_shipment_prepared_revisions_number_uidx
    UNIQUE (organization_id, shipment_id, revision_number),
  CONSTRAINT v2_fulfillment_shipment_prepared_revisions_number_chk CHECK (revision_number > 0),
  CONSTRAINT v2_fulfillment_shipment_prepared_revisions_kind_chk
    CHECK (revision_kind IN ('initial','correction')),
  CONSTRAINT v2_fulfillment_shipment_prepared_revisions_correction_chk CHECK (
    (revision_kind='initial' AND supersedes_revision_id IS NULL AND correction_reason IS NULL)
    OR (revision_kind='correction' AND supersedes_revision_id IS NOT NULL AND length(btrim(correction_reason)) > 0)
  ),
  CONSTRAINT v2_fulfillment_shipment_prepared_revisions_package_count_chk
    CHECK (package_count IS NULL OR package_count > 0),
  CONSTRAINT v2_fulfillment_shipment_prepared_revisions_actor_chk
    CHECK (created_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(created_principal_subject)) > 0)
);

CREATE INDEX v2_fulfillment_shipment_prepared_revisions_org_shipment_created_idx
  ON v2_fulfillment_shipment_prepared_revisions(organization_id, shipment_id, revision_number DESC);

CREATE TABLE v2_fulfillment_shipment_prepared_revision_lines (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  shipment_id varchar NOT NULL,
  revision_id varchar NOT NULL,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  quantity integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_fulfillment_shipment_prepared_revision_lines_revision_fk
    FOREIGN KEY (revision_id, organization_id, shipment_id)
    REFERENCES v2_fulfillment_shipment_prepared_revisions(id, organization_id, shipment_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_prepared_revision_lines_order_line_fk
    FOREIGN KEY (order_line_id, organization_id, order_document_id)
    REFERENCES v2_sales_document_lines(id, organization_id, document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_prepared_revision_lines_once_uidx
    UNIQUE (organization_id, revision_id, order_line_id),
  CONSTRAINT v2_fulfillment_shipment_prepared_revision_lines_quantity_chk CHECK (quantity > 0)
);

CREATE INDEX v2_fulfillment_shipment_prepared_revision_lines_shipment_idx
  ON v2_fulfillment_shipment_prepared_revision_lines(organization_id, shipment_id, revision_id);

ALTER TABLE v2_fulfillment_shipments
  ADD CONSTRAINT v2_fulfillment_shipments_prepared_revision_fk
  FOREIGN KEY (prepared_revision_id)
  REFERENCES v2_fulfillment_shipment_prepared_revisions(id) ON DELETE RESTRICT;

-- The event ledger is append-only operational evidence.  A current prepared
-- revision is a pointer to one of its immutable versions; it is not mutable
-- draft-row state.
CREATE TABLE v2_fulfillment_shipment_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  shipment_id varchar NOT NULL,
  sequence_number integer NOT NULL,
  event_type varchar(24) NOT NULL,
  prepared_revision_id varchar,
  reason varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(255) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_events_shipment_fk
    FOREIGN KEY (shipment_id, organization_id)
    REFERENCES v2_fulfillment_shipments(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_events_revision_fk
    FOREIGN KEY (prepared_revision_id)
    REFERENCES v2_fulfillment_shipment_prepared_revisions(id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_events_sequence_uidx
    UNIQUE (organization_id, shipment_id, sequence_number),
  CONSTRAINT v2_fulfillment_shipment_events_sequence_chk CHECK (sequence_number > 0),
  CONSTRAINT v2_fulfillment_shipment_events_type_chk
    CHECK (event_type IN ('prepared','corrected','voided','shipped')),
  CONSTRAINT v2_fulfillment_shipment_events_actor_chk
    CHECK (principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(principal_subject)) > 0)
);

CREATE INDEX v2_fulfillment_shipment_events_history_idx
  ON v2_fulfillment_shipment_events(organization_id, shipment_id, sequence_number);

CREATE OR REPLACE FUNCTION v2_fulfillment_shipment_recovery_immutable_validate() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Shipment recovery evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER v2_fulfillment_shipment_prepared_revisions_immutable_trigger
  BEFORE UPDATE OR DELETE ON v2_fulfillment_shipment_prepared_revisions
  FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_recovery_immutable_validate();
CREATE TRIGGER v2_fulfillment_shipment_prepared_revision_lines_immutable_trigger
  BEFORE UPDATE OR DELETE ON v2_fulfillment_shipment_prepared_revision_lines
  FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_recovery_immutable_validate();
CREATE TRIGGER v2_fulfillment_shipment_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON v2_fulfillment_shipment_events
  FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_recovery_immutable_validate();

-- Preserve legacy prepared containers as the first immutable draft revision.
-- They had no persisted line allocations, so no quantity is inferred here.
WITH legacy_prepared AS (
  INSERT INTO v2_fulfillment_shipment_prepared_revisions(
    id, organization_id, shipment_id, revision_number, revision_kind,
    customer_id, destination, manual_carrier_name, manual_carrier_service,
    manual_tracking_number, notes, package_count, created_at,
    created_principal_kind, created_principal_subject, created_staff_actor_user_id
  )
  SELECT gen_random_uuid()::text, s.organization_id, s.id, 1, 'initial',
    s.customer_id, s.destination, s.manual_carrier_name, s.manual_carrier_service,
    s.manual_tracking_number, s.notes, s.package_count, s.created_at,
    s.created_principal_kind, s.created_principal_subject, s.created_staff_actor_user_id
  FROM v2_fulfillment_shipments s
  WHERE s.shipment_status='prepared'
  RETURNING id, organization_id, shipment_id, created_at,
    created_principal_kind, created_principal_subject, created_staff_actor_user_id
), pointed AS (
  UPDATE v2_fulfillment_shipments s
  SET prepared_revision_id=r.id
  FROM legacy_prepared r
  WHERE s.organization_id=r.organization_id AND s.id=r.shipment_id
  RETURNING s.organization_id, s.id
)
INSERT INTO v2_fulfillment_shipment_events(
  organization_id, shipment_id, sequence_number, event_type,
  prepared_revision_id, created_at, principal_kind, principal_subject, staff_actor_user_id
)
SELECT r.organization_id, r.shipment_id, 1, 'prepared', r.id,
  r.created_at, r.created_principal_kind, r.created_principal_subject, r.created_staff_actor_user_id
FROM legacy_prepared r
JOIN pointed p ON p.organization_id=r.organization_id AND p.id=r.shipment_id;

CREATE OR REPLACE FUNCTION v2_fulfillment_shipment_prepared_revision_pointer_validate() RETURNS trigger AS $$
BEGIN
  IF NEW.prepared_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM v2_fulfillment_shipment_prepared_revisions r
    WHERE r.id=NEW.prepared_revision_id
      AND r.organization_id=NEW.organization_id
      AND r.shipment_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'Shipment prepared revision must belong to the same tenant and shipment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER v2_fulfillment_shipment_prepared_revision_pointer_trigger
  BEFORE INSERT OR UPDATE OF prepared_revision_id ON v2_fulfillment_shipments
  FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_prepared_revision_pointer_validate();

CREATE OR REPLACE FUNCTION v2_fulfillment_shipment_revision_lineage_validate() RETURNS trigger AS $$
BEGIN
  IF NEW.revision_kind='correction' AND NOT EXISTS (
    SELECT 1
    FROM v2_fulfillment_shipment_prepared_revisions prior
    WHERE prior.id=NEW.supersedes_revision_id
      AND prior.organization_id=NEW.organization_id
      AND prior.shipment_id=NEW.shipment_id
      AND prior.revision_number=NEW.revision_number-1
  ) THEN
    RAISE EXCEPTION 'Shipment correction must supersede the immediately prior revision in the same tenant and shipment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER v2_fulfillment_shipment_revision_lineage_trigger
  BEFORE INSERT ON v2_fulfillment_shipment_prepared_revisions
  FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_revision_lineage_validate();

CREATE OR REPLACE FUNCTION v2_fulfillment_shipment_event_validate() RETURNS trigger AS $$
BEGIN
  IF NEW.prepared_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM v2_fulfillment_shipment_prepared_revisions revision
    WHERE revision.id=NEW.prepared_revision_id
      AND revision.organization_id=NEW.organization_id
      AND revision.shipment_id=NEW.shipment_id
  ) THEN
    RAISE EXCEPTION 'Shipment event revision must belong to the same tenant and shipment' USING ERRCODE='23514';
  END IF;
  IF NEW.sequence_number <> COALESCE((
    SELECT max(event.sequence_number)+1
    FROM v2_fulfillment_shipment_events event
    WHERE event.organization_id=NEW.organization_id AND event.shipment_id=NEW.shipment_id
  ),1) THEN
    RAISE EXCEPTION 'Shipment event sequence must be the next sequence number' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER v2_fulfillment_shipment_event_validate_trigger
  BEFORE INSERT ON v2_fulfillment_shipment_events
  FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_event_validate();

CREATE OR REPLACE FUNCTION v2_fulfillment_shipment_state_transition_validate() RETURNS trigger AS $$
BEGIN
  IF OLD.shipment_status IN ('shipped','voided') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Shipped and voided shipment containers are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.shipment_status='prepared' AND NEW.shipment_status='prepared' AND (
    NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
    NEW.destination IS DISTINCT FROM OLD.destination OR
    NEW.manual_carrier_name IS DISTINCT FROM OLD.manual_carrier_name OR
    NEW.manual_carrier_service IS DISTINCT FROM OLD.manual_carrier_service OR
    NEW.manual_tracking_number IS DISTINCT FROM OLD.manual_tracking_number OR
    NEW.notes IS DISTINCT FROM OLD.notes OR
    NEW.package_count IS DISTINCT FROM OLD.package_count
  ) THEN
    RAISE EXCEPTION 'Prepared shipment facts must be corrected by a new immutable revision' USING ERRCODE='23514';
  END IF;
  IF OLD.shipment_status='prepared' AND NEW.shipment_status='shipped' AND NOT EXISTS (
    SELECT 1
    FROM v2_fulfillment_shipment_prepared_revision_lines line
    WHERE line.organization_id=NEW.organization_id
      AND line.shipment_id=NEW.id
      AND line.revision_id=NEW.prepared_revision_id
  ) THEN
    RAISE EXCEPTION 'A shipment requires one or more prepared reservation lines before it can be shipped' USING ERRCODE='23514';
  END IF;
  IF OLD.shipment_status='prepared' AND NEW.shipment_status NOT IN ('prepared','shipped','voided') THEN
    RAISE EXCEPTION 'Invalid shipment status transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER v2_fulfillment_shipment_state_transition_trigger
  BEFORE UPDATE ON v2_fulfillment_shipments
  FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_state_transition_validate();

-- 0267 used an immediate trigger which forced an unsafe ordering choice:
-- either label a container shipped before its handoffs existed, or attach only
-- later. Atomic finalization creates immutable handoffs and the attachment
-- first, then performs PREPARED -> SHIPPED; this invariant belongs at commit.
DROP TRIGGER IF EXISTS v2_fulfillment_shipment_handoff_validate_trigger
  ON v2_fulfillment_shipment_handoffs;
CREATE OR REPLACE FUNCTION v2_fulfillment_shipment_handoff_validate() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM v2_fulfillment_handoffs h
    JOIN v2_fulfillment_shipments s
      ON s.organization_id=h.organization_id AND s.id=NEW.shipment_id
    WHERE h.organization_id=NEW.organization_id
      AND h.id=NEW.handoff_id
      AND h.handoff_method='shipment'
      AND s.shipment_status='shipped'
  ) THEN
    RAISE EXCEPTION 'Only shipped containers may contain immutable shipment handoffs' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER v2_fulfillment_shipment_handoff_validate_trigger
AFTER INSERT OR UPDATE ON v2_fulfillment_shipment_handoffs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_handoff_validate();

COMMENT ON TABLE v2_fulfillment_shipment_prepared_revisions IS
  'Append-only prepared shipment snapshots. They reserve no fulfillment quantity and are superseded, never edited.';
COMMENT ON TABLE v2_fulfillment_shipment_prepared_revision_lines IS
  'Append-only proposed line allocations for one prepared shipment revision; immutable handoffs remain fulfillment authority.';
COMMENT ON TABLE v2_fulfillment_shipment_events IS
  'Append-only shipment recovery state-transition evidence.';
