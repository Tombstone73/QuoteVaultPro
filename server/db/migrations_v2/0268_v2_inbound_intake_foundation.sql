-- M7.5H: durable V2 inbound-work intake. Source messages are evidence, never
-- Orders. Conversion is explicitly operator-reviewed and references the
-- canonical V2 Sales Order only after the Sales boundary succeeds.
CREATE TABLE v2_inbound_intakes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_provider varchar(32) NOT NULL,
  source_message_id varchar(512),
  source_mailbox varchar(320),
  sender_name varchar(320),
  sender_email varchar(320),
  recipient_email varchar(320),
  subject varchar(1000),
  received_at timestamptz NOT NULL,
  raw_source jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_body text,
  extracted_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  intake_state varchar(24) NOT NULL DEFAULT 'received',
  matched_customer_id varchar,
  matched_contact_id varchar,
  conversion_request_id varchar(255),
  converted_order_id varchar,
  decision_reason varchar(1000),
  failure_code varchar(80),
  failure_message varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  CONSTRAINT v2_inbound_intakes_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_inbound_intakes_customer_tenant_fk FOREIGN KEY (matched_customer_id, organization_id)
    REFERENCES customers(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inbound_intakes_contact_tenant_fk FOREIGN KEY (matched_contact_id, organization_id)
    REFERENCES customer_contacts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inbound_intakes_converted_order_tenant_fk FOREIGN KEY (converted_order_id, organization_id)
    REFERENCES v2_sales_order_details(document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inbound_intakes_provider_chk CHECK (source_provider IN ('gmail', 'manual', 'imported')),
  CONSTRAINT v2_inbound_intakes_state_chk CHECK (intake_state IN ('received', 'needs_review', 'ready', 'converting', 'converted', 'duplicate', 'rejected', 'failed', 'action_required')),
  CONSTRAINT v2_inbound_intakes_source_message_chk CHECK (source_message_id IS NULL OR length(btrim(source_message_id)) > 0),
  CONSTRAINT v2_inbound_intakes_raw_source_object_chk CHECK (jsonb_typeof(raw_source) = 'object'),
  CONSTRAINT v2_inbound_intakes_extracted_draft_object_chk CHECK (jsonb_typeof(extracted_draft) = 'object'),
  CONSTRAINT v2_inbound_intakes_review_draft_object_chk CHECK (jsonb_typeof(review_draft) = 'object'),
  CONSTRAINT v2_inbound_intakes_conversion_shape_chk CHECK (
    (intake_state = 'converted' AND converted_order_id IS NOT NULL AND converted_at IS NOT NULL)
    OR (intake_state <> 'converted' AND converted_order_id IS NULL AND converted_at IS NULL)
  )
);
CREATE UNIQUE INDEX v2_inbound_intakes_provider_message_uidx
  ON v2_inbound_intakes(organization_id, source_provider, source_message_id)
  WHERE source_message_id IS NOT NULL;
CREATE INDEX v2_inbound_intakes_queue_idx
  ON v2_inbound_intakes(organization_id, intake_state, received_at DESC, id DESC);
CREATE INDEX v2_inbound_intakes_customer_idx
  ON v2_inbound_intakes(organization_id, matched_customer_id, received_at DESC);

-- These records only identify immutable source evidence/adopted canonical
-- artwork. They deliberately do not own another binary-storage universe.
CREATE TABLE v2_inbound_intake_attachments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  intake_id varchar NOT NULL,
  source_attachment_id varchar(512) NOT NULL,
  filename varchar(512) NOT NULL,
  content_type varchar(255),
  byte_size bigint,
  source_reference jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_artwork_file_id varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_inbound_intake_attachments_source_ref_object_chk CHECK (jsonb_typeof(source_reference) = 'object'),
  CONSTRAINT v2_inbound_intake_attachments_name_chk CHECK (length(btrim(filename)) > 0),
  CONSTRAINT v2_inbound_intake_attachments_size_chk CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT v2_inbound_intake_attachments_intake_fk FOREIGN KEY (intake_id, organization_id)
    REFERENCES v2_inbound_intakes(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inbound_intake_attachments_artwork_fk FOREIGN KEY (canonical_artwork_file_id, organization_id)
    REFERENCES v2_artwork_files(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inbound_intake_attachments_once_uidx UNIQUE (organization_id, intake_id, source_attachment_id)
);
CREATE INDEX v2_inbound_intake_attachments_intake_idx
  ON v2_inbound_intake_attachments(organization_id, intake_id, created_at);

CREATE TABLE v2_inbound_intake_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  intake_id varchar NOT NULL,
  event_type varchar(64) NOT NULL,
  business_request_id varchar(255),
  event_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(255) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_inbound_intake_events_detail_object_chk CHECK (jsonb_typeof(event_detail) = 'object'),
  CONSTRAINT v2_inbound_intake_events_actor_chk CHECK (principal_kind IN ('staff', 'delegated_ai', 'portal', 'service') AND length(btrim(principal_subject)) > 0),
  CONSTRAINT v2_inbound_intake_events_intake_fk FOREIGN KEY (intake_id, organization_id)
    REFERENCES v2_inbound_intakes(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inbound_intake_events_request_uidx UNIQUE (organization_id, intake_id, event_type, business_request_id)
);
CREATE INDEX v2_inbound_intake_events_history_idx
  ON v2_inbound_intake_events(organization_id, intake_id, created_at);

INSERT INTO v2_permission_capabilities(id,module,label)
VALUES
  ('inbound.view', 'inbound', 'View inbound customer work'),
  ('inbound.review', 'inbound', 'Review and resolve inbound customer work')
ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id, capability_id)
SELECT id, capability_id
FROM v2_permission_set_templates
CROSS JOIN (VALUES ('inbound.view'), ('inbound.review')) AS capabilities(capability_id)
WHERE template_key IN ('owner', 'administrator')
ON CONFLICT DO NOTHING;
WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id, permission_set_id, capability_id)
  SELECT permission_set_id.organization_id, permission_set_id.id, capabilities.capability_id
  FROM v2_permission_sets permission_set_id
  CROSS JOIN (VALUES ('inbound.view'), ('inbound.review')) AS capabilities(capability_id)
  WHERE permission_set_id.source_template_key IN ('owner', 'administrator')
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision = authority_revision + 1, updated_at = now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);
