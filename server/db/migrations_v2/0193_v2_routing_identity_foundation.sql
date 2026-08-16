-- M1.8: Routing owns internal work movement identity. No route progression,
-- Production work, or public routing API is introduced by this migration.

CREATE TABLE v2_route_templates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  normalized_name varchar(160) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1,
  definition_fingerprint varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_route_templates_name_chk CHECK (length(btrim(name)) > 0),
  CONSTRAINT v2_route_templates_normalized_name_chk CHECK (length(btrim(normalized_name)) > 0),
  CONSTRAINT v2_route_templates_revision_chk CHECK (revision > 0),
  CONSTRAINT v2_route_templates_fingerprint_chk CHECK (length(btrim(definition_fingerprint)) > 0),
  CONSTRAINT v2_route_templates_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_route_templates_org_name_uidx UNIQUE (organization_id, normalized_name)
);

CREATE TABLE v2_route_template_steps (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL,
  route_template_id varchar NOT NULL,
  position integer NOT NULL,
  step_kind varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_route_template_steps_position_chk CHECK (position >= 0),
  CONSTRAINT v2_route_template_steps_kind_chk CHECK (step_kind IN ('proofing','prepress','production','fulfillment')),
  CONSTRAINT v2_route_template_steps_id_template_organization_uidx UNIQUE (id, route_template_id, organization_id),
  CONSTRAINT v2_route_template_steps_template_position_uidx UNIQUE (route_template_id, organization_id, position),
  CONSTRAINT v2_route_template_steps_template_tenant_fk FOREIGN KEY (route_template_id, organization_id)
    REFERENCES v2_route_templates(id, organization_id) ON DELETE RESTRICT
);

-- Products owns this policy/reference. Existing V1 types are deliberately
-- unconfigured: V2 never guesses from legacy station/default fields.
ALTER TABLE product_types
  ADD COLUMN routing_mode varchar(24) NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN default_route_template_id varchar;
ALTER TABLE product_types
  ADD CONSTRAINT product_types_routing_mode_chk CHECK (routing_mode IN ('unconfigured','no_route','route_required')),
  ADD CONSTRAINT product_types_routing_policy_chk CHECK (
    (routing_mode = 'route_required' AND default_route_template_id IS NOT NULL)
    OR (routing_mode IN ('unconfigured','no_route') AND default_route_template_id IS NULL)
  ),
  ADD CONSTRAINT product_types_default_route_template_tenant_fk FOREIGN KEY (default_route_template_id, organization_id)
    REFERENCES v2_route_templates(id, organization_id) ON DELETE RESTRICT;

CREATE TABLE v2_route_instances (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_kind varchar(32) NOT NULL DEFAULT 'sales_order_line',
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  source_template_id varchar NOT NULL,
  source_template_revision bigint NOT NULL,
  source_template_fingerprint varchar(128) NOT NULL,
  route_state varchar(24) NOT NULL DEFAULT 'pending',
  current_step_id varchar NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_route_instances_work_kind_chk CHECK (work_kind = 'sales_order_line'),
  CONSTRAINT v2_route_instances_template_revision_chk CHECK (source_template_revision > 0),
  CONSTRAINT v2_route_instances_template_fingerprint_chk CHECK (length(btrim(source_template_fingerprint)) > 0),
  CONSTRAINT v2_route_instances_state_chk CHECK (route_state IN ('pending','active','completed')),
  CONSTRAINT v2_route_instances_current_position_chk CHECK (
    (route_state IN ('pending','active') AND current_step_id IS NOT NULL)
    OR (route_state = 'completed' AND current_step_id IS NULL)
  ),
  CONSTRAINT v2_route_instances_revision_chk CHECK (revision > 0),
  CONSTRAINT v2_route_instances_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_route_instances_org_work_uidx UNIQUE (organization_id, work_kind, order_line_id),
  CONSTRAINT v2_route_instances_source_template_tenant_fk FOREIGN KEY (source_template_id, organization_id)
    REFERENCES v2_route_templates(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE v2_route_instance_steps (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL,
  route_instance_id varchar NOT NULL,
  source_template_step_id varchar NOT NULL,
  position integer NOT NULL,
  step_kind varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_route_instance_steps_position_chk CHECK (position >= 0),
  CONSTRAINT v2_route_instance_steps_kind_chk CHECK (step_kind IN ('proofing','prepress','production','fulfillment')),
  CONSTRAINT v2_route_instance_steps_id_instance_organization_uidx UNIQUE (id, route_instance_id, organization_id),
  CONSTRAINT v2_route_instance_steps_instance_position_uidx UNIQUE (route_instance_id, organization_id, position),
  CONSTRAINT v2_route_instance_steps_instance_tenant_fk FOREIGN KEY (route_instance_id, organization_id)
    REFERENCES v2_route_instances(id, organization_id) ON DELETE RESTRICT
);

-- The cyclic link is deferred so a caller-owned transaction can insert the
-- instance with its generated first-step ID, insert frozen steps, then commit.
ALTER TABLE v2_route_instances
  ADD CONSTRAINT v2_route_instances_current_step_instance_fk FOREIGN KEY (current_step_id, id, organization_id)
    REFERENCES v2_route_instance_steps(id, route_instance_id, organization_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX v2_route_templates_org_active_idx ON v2_route_templates (organization_id, active, normalized_name);
CREATE INDEX v2_route_instances_org_state_idx ON v2_route_instances (organization_id, route_state, updated_at DESC);
