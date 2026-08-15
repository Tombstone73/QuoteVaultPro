-- M1.5 final permission-set foundation.  V1 membership roles are bootstrap evidence only.
ALTER TABLE user_organizations ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE customers ADD CONSTRAINT customers_id_organization_uidx UNIQUE (id, organization_id);
ALTER TABLE customer_portal_access ADD CONSTRAINT customer_portal_access_id_organization_uidx UNIQUE (id, organization_id);

CREATE TABLE v2_permission_capabilities (
  id varchar(100) PRIMARY KEY, module varchar(64) NOT NULL, label varchar(160) NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE v2_permission_set_templates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text, template_key varchar(80) NOT NULL UNIQUE, name varchar(120) NOT NULL,
  principal_kind varchar(16) NOT NULL, description varchar(500), CONSTRAINT v2_permission_set_templates_kind_chk CHECK (principal_kind IN ('staff','portal'))
);
CREATE TABLE v2_permission_set_template_capabilities (
  template_id varchar NOT NULL REFERENCES v2_permission_set_templates(id) ON DELETE CASCADE,
  capability_id varchar(100) NOT NULL REFERENCES v2_permission_capabilities(id) ON DELETE RESTRICT,
  PRIMARY KEY (template_id, capability_id)
);
CREATE TABLE v2_permission_organization_state (
  organization_id varchar PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  authority_revision bigint NOT NULL DEFAULT 1 CHECK (authority_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE v2_permission_sets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL, normalized_name varchar(120) NOT NULL, description varchar(500), active boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0), source_template_key varchar(80), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_permission_sets_id_org_uidx UNIQUE (id, organization_id), CONSTRAINT v2_permission_sets_name_uidx UNIQUE (organization_id, normalized_name)
);
CREATE UNIQUE INDEX v2_permission_sets_template_org_uidx ON v2_permission_sets(organization_id, source_template_key) WHERE source_template_key IS NOT NULL;
CREATE INDEX v2_permission_sets_org_active_idx ON v2_permission_sets(organization_id, active);
CREATE TABLE v2_permission_set_capabilities (
  organization_id varchar NOT NULL, permission_set_id varchar NOT NULL, capability_id varchar(100) NOT NULL REFERENCES v2_permission_capabilities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, permission_set_id, capability_id),
  CONSTRAINT v2_permission_set_capabilities_set_org_fk FOREIGN KEY(permission_set_id, organization_id) REFERENCES v2_permission_sets(id, organization_id) ON DELETE CASCADE
);
CREATE TABLE v2_staff_permission_set_assignments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text, organization_id varchar NOT NULL, user_id varchar NOT NULL, permission_set_id varchar NOT NULL,
  active boolean NOT NULL DEFAULT true, assignment_source varchar(40) NOT NULL DEFAULT 'manual', bootstrap_legacy_role varchar(24), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_staff_permission_set_assignments_uidx UNIQUE(organization_id,user_id,permission_set_id),
  CONSTRAINT v2_staff_permission_set_assignments_member_org_fk FOREIGN KEY(user_id,organization_id) REFERENCES user_organizations(user_id,organization_id) ON DELETE CASCADE,
  CONSTRAINT v2_staff_permission_set_assignments_set_org_fk FOREIGN KEY(permission_set_id,organization_id) REFERENCES v2_permission_sets(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_staff_permission_set_assignments_lookup_idx ON v2_staff_permission_set_assignments(organization_id,user_id) WHERE active;
CREATE TABLE v2_portal_permission_set_assignments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text, organization_id varchar NOT NULL, portal_access_id varchar NOT NULL, permission_set_id varchar NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_portal_permission_set_assignments_uidx UNIQUE(organization_id,portal_access_id,permission_set_id),
  CONSTRAINT v2_portal_permission_set_assignments_access_org_fk FOREIGN KEY(portal_access_id,organization_id) REFERENCES customer_portal_access(id,organization_id) ON DELETE CASCADE,
  CONSTRAINT v2_portal_permission_set_assignments_set_org_fk FOREIGN KEY(permission_set_id,organization_id) REFERENCES v2_permission_sets(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_portal_permission_set_assignments_lookup_idx ON v2_portal_permission_set_assignments(organization_id,portal_access_id) WHERE active;
CREATE TABLE v2_organization_portal_capability_defaults (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, capability_id varchar(100) NOT NULL REFERENCES v2_permission_capabilities(id) ON DELETE RESTRICT,
  PRIMARY KEY(organization_id,capability_id)
);
CREATE TABLE v2_customer_portal_ceiling_policies (
  organization_id varchar NOT NULL, customer_id varchar NOT NULL, revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,customer_id), CONSTRAINT v2_customer_portal_ceiling_customer_org_fk FOREIGN KEY(customer_id,organization_id) REFERENCES customers(id,organization_id) ON DELETE CASCADE
);
CREATE TABLE v2_customer_portal_ceiling_capabilities (
  organization_id varchar NOT NULL, customer_id varchar NOT NULL, capability_id varchar(100) NOT NULL REFERENCES v2_permission_capabilities(id) ON DELETE RESTRICT,
  PRIMARY KEY(organization_id,customer_id,capability_id), CONSTRAINT v2_customer_portal_ceiling_policy_fk FOREIGN KEY(organization_id,customer_id) REFERENCES v2_customer_portal_ceiling_policies(organization_id,customer_id) ON DELETE CASCADE
);
CREATE TABLE v2_permission_audit_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type varchar(80) NOT NULL, actor_principal_kind varchar(32) NOT NULL, actor_principal_subject varchar(160) NOT NULL, staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  permission_set_id varchar, target_user_id varchar, portal_access_id varchar, customer_id varchar, correlation_id varchar(160), detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX v2_permission_audit_events_org_created_idx ON v2_permission_audit_events(organization_id,created_at DESC);

INSERT INTO v2_permission_capabilities(id,module,label) VALUES
 ('quote.view','sales','View quotes'),('quote.create','sales','Create quotes'),('quote.edit','sales','Edit quotes'),('quote.send','sales','Send quotes'),('quote.convert','sales','Convert quotes'),
 ('order.view','sales','View orders'),('order.create','sales','Create orders'),('order.edit','sales','Edit orders'),('order.cancel','sales','Cancel orders'),
 ('customer.view','customers','View customers'),('customer.edit','customers','Edit customers'),('product.view','products','View products'),('product.edit','products','Edit products'),
 ('pricing.preview','pricing','Preview pricing'),('pricing.configure','pricing','Configure pricing'),('pricing.publish','pricing','Publish pricing'),
 ('invoice.view','billing','View invoices'),('invoice.editDraft','billing','Edit draft invoices'),('invoice.editIssued','billing','Edit issued invoices'),('invoice.issue','billing','Issue invoices'),('payment.record','billing','Record payments'),('refund.issue','billing','Issue refunds'),
 ('permissions.view','permissions','View permission sets'),('permissions.manageSets','permissions','Manage permission sets'),('permissions.assignStaff','permissions','Assign Staff permission sets'),('permissions.assignPortal','permissions','Assign Portal permission sets'),
 ('route.view','routing','View routes'),('route.reroute','routing','Reroute work'),('route.skipStep','routing','Skip route steps'),('route.manageTemplates','routing','Manage route templates'),('proof.respond','artwork','Respond to proofs'),('fulfillment.pickup','fulfillment','Record pickup') ON CONFLICT(id) DO NOTHING;

INSERT INTO v2_permission_set_templates(template_key,name,principal_kind) VALUES
 ('owner','Owner','staff'),('administrator','Administrator','staff'),('manager','Manager','staff'),('sales','Sales','staff'),('production','Production','staff'),('accounting','Accounting','staff'),('staff_basic','Staff Basic','staff'),('customer_full_portal','Customer Full Portal','portal'),('customer_view_only','Customer View Only','portal') ON CONFLICT(template_key) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT t.id,c.capability_id FROM (VALUES
 ('owner','quote.view'),('owner','quote.create'),('owner','quote.edit'),('owner','quote.send'),('owner','quote.convert'),('owner','order.view'),('owner','order.create'),('owner','order.edit'),('owner','order.cancel'),('owner','customer.view'),('owner','customer.edit'),('owner','product.view'),('owner','product.edit'),('owner','pricing.preview'),('owner','pricing.configure'),('owner','pricing.publish'),('owner','invoice.view'),('owner','invoice.editDraft'),('owner','invoice.editIssued'),('owner','invoice.issue'),('owner','payment.record'),('owner','refund.issue'),('owner','permissions.view'),('owner','permissions.manageSets'),('owner','permissions.assignStaff'),('owner','permissions.assignPortal'),('owner','route.view'),('owner','route.reroute'),('owner','route.skipStep'),('owner','route.manageTemplates'),('owner','proof.respond'),('owner','fulfillment.pickup'),
 ('administrator','quote.view'),('administrator','quote.create'),('administrator','quote.edit'),('administrator','quote.send'),('administrator','quote.convert'),('administrator','order.view'),('administrator','order.create'),('administrator','order.edit'),('administrator','customer.view'),('administrator','customer.edit'),('administrator','product.view'),('administrator','product.edit'),('administrator','pricing.preview'),('administrator','invoice.view'),('administrator','invoice.editDraft'),('administrator','permissions.view'),('administrator','permissions.manageSets'),('administrator','permissions.assignStaff'),('administrator','permissions.assignPortal'),
 ('manager','quote.view'),('manager','quote.create'),('manager','quote.edit'),('manager','quote.send'),('manager','quote.convert'),('manager','order.view'),('manager','order.create'),('manager','order.edit'),('manager','customer.view'),('manager','product.view'),('manager','pricing.preview'),('manager','invoice.view'),('manager','invoice.editDraft'),
 ('sales','quote.view'),('sales','quote.create'),('sales','quote.edit'),('sales','quote.send'),('sales','quote.convert'),('sales','order.view'),('sales','order.create'),('sales','order.edit'),('sales','customer.view'),('sales','product.view'),('sales','pricing.preview'),
 ('production','order.view'),('production','product.view'),('production','route.view'),('production','proof.respond'),('production','fulfillment.pickup'),
 ('accounting','invoice.view'),('accounting','invoice.editDraft'),('accounting','invoice.issue'),('accounting','payment.record'),('accounting','refund.issue'),('accounting','order.view'),
 ('staff_basic','quote.view'),('staff_basic','order.view'),('staff_basic','customer.view'),('staff_basic','product.view'),('staff_basic','pricing.preview'),('staff_basic','invoice.view'),
 ('customer_full_portal','quote.view'),('customer_full_portal','quote.create'),('customer_full_portal','order.view'),('customer_full_portal','invoice.view'),('customer_full_portal','proof.respond'),
 ('customer_view_only','quote.view'),('customer_view_only','order.view'),('customer_view_only','invoice.view')
 ) c(template_key,capability_id) JOIN v2_permission_set_templates t ON t.template_key=c.template_key ON CONFLICT DO NOTHING;

INSERT INTO v2_permission_organization_state(organization_id) SELECT id FROM organizations ON CONFLICT DO NOTHING;
INSERT INTO v2_permission_sets(organization_id,name,normalized_name,source_template_key)
SELECT o.id,t.name,lower(t.name),t.template_key FROM organizations o CROSS JOIN v2_permission_set_templates t ON CONFLICT(organization_id,normalized_name) DO NOTHING;
INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
SELECT ps.organization_id,ps.id,tc.capability_id FROM v2_permission_sets ps JOIN v2_permission_set_templates t ON t.template_key=ps.source_template_key JOIN v2_permission_set_template_capabilities tc ON tc.template_id=t.id ON CONFLICT DO NOTHING;
INSERT INTO v2_organization_portal_capability_defaults(organization_id,capability_id)
SELECT o.id,c.capability_id FROM organizations o CROSS JOIN (VALUES ('quote.view'),('order.view'),('invoice.view'),('proof.respond')) c(capability_id) ON CONFLICT DO NOTHING;
INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,assignment_source,bootstrap_legacy_role)
SELECT uo.organization_id,uo.user_id,ps.id,'legacy_role_bootstrap',uo.role::text FROM user_organizations uo JOIN v2_permission_sets ps ON ps.organization_id=uo.organization_id AND ps.source_template_key=CASE uo.role::text WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'administrator' WHEN 'manager' THEN 'manager' ELSE 'staff_basic' END WHERE uo.is_active ON CONFLICT(organization_id,user_id,permission_set_id) DO NOTHING;
INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,permission_set_id,target_user_id,detail)
SELECT a.organization_id,'staff_assignment_bootstrapped','service','m1.5-bootstrap',a.permission_set_id,a.user_id,jsonb_build_object('source','legacy_role_bootstrap','legacyRole',a.bootstrap_legacy_role) FROM v2_staff_permission_set_assignments a WHERE a.assignment_source='legacy_role_bootstrap';
