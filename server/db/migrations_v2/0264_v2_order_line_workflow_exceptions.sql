-- M7.5D: current tenant-scoped operational exceptions. Immutable Product,
-- pricing, and execution history remain untouched.
CREATE TABLE v2_sales_line_workflow_exceptions (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  prepress_requirement varchar(24) NOT NULL DEFAULT 'not_required',
  production_requirement varchar(24),
  production_destination varchar(24),
  reason text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_principal_kind varchar(32) NOT NULL,
  updated_principal_subject varchar(255) NOT NULL,
  updated_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (organization_id, order_line_id),
  CONSTRAINT v2_sales_line_workflow_exception_line_fk FOREIGN KEY (order_line_id, organization_id, order_document_id)
    REFERENCES v2_sales_document_lines(id, organization_id, document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_line_workflow_exception_prepress_chk CHECK (prepress_requirement = 'not_required'),
  CONSTRAINT v2_sales_line_workflow_exception_production_chk CHECK (production_requirement IS NULL OR production_requirement = 'not_required'),
  CONSTRAINT v2_sales_line_workflow_exception_destination_chk CHECK (production_destination IS NULL OR production_destination IN ('flatbed','roll')),
  CONSTRAINT v2_sales_line_workflow_exception_shape_chk CHECK (
    (production_requirement IS NULL AND production_destination IN ('flatbed','roll'))
    OR (production_requirement = 'not_required' AND production_destination IS NULL)
  ),
  CONSTRAINT v2_sales_line_workflow_exception_reason_chk CHECK (length(btrim(reason)) > 0),
  CONSTRAINT v2_sales_line_workflow_exception_revision_chk CHECK (revision > 0),
  CONSTRAINT v2_sales_line_workflow_exception_actor_chk CHECK (
    created_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(created_principal_subject)) > 0
    AND updated_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(updated_principal_subject)) > 0
  )
);
CREATE INDEX v2_sales_line_workflow_exception_order_idx ON v2_sales_line_workflow_exceptions(organization_id, order_document_id);

INSERT INTO v2_permission_capabilities(id,module,label)
VALUES ('workflow.override','workflow','Authorize explicit Order-line workflow exceptions') ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,'workflow.override' FROM v2_permission_set_templates WHERE template_key IN ('owner','administrator') ON CONFLICT DO NOTHING;
WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT organization_id,id,'workflow.override' FROM v2_permission_sets WHERE source_template_key IN ('owner','administrator')
  ON CONFLICT DO NOTHING RETURNING organization_id
)
UPDATE v2_permission_organization_state state SET authority_revision=authority_revision+1,updated_at=now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);
