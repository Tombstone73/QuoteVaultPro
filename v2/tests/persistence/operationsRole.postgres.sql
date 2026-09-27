-- Disposable PostgreSQL regression only; all fixtures are rolled back.
BEGIN;
CREATE SCHEMA operations_role_regression;
SET LOCAL search_path TO operations_role_regression, public;
CREATE TABLE organizations(id varchar PRIMARY KEY);
CREATE TABLE users(id varchar PRIMARY KEY);
CREATE TABLE user_organizations(user_id varchar,organization_id varchar,role text,PRIMARY KEY(user_id,organization_id));
CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar);
CREATE TABLE customer_portal_access(id varchar PRIMARY KEY,organization_id varchar);
INSERT INTO organizations VALUES('org-a'),('org-b');
INSERT INTO users VALUES('sales-user');
INSERT INTO user_organizations VALUES('sales-user','org-a','member');
\ir ../../../server/db/migrations_v2/0181_v2_permission_set_foundation.sql
\ir ../../../server/db/migrations_v2/0182_v2_permission_admin_floor.sql
\ir ../../../server/db/migrations_v2/0183_permission_set_assignment_kind_hardening.sql
\ir ../../../server/db/migrations_v2/0235_v2_team_access_membership_bootstrap.sql
-- Later domain catalog entries: no application business tables are needed.
INSERT INTO v2_permission_capabilities(id,module,label) VALUES
('customer.view','test','Existing capability'),
('customer.edit','test','Existing capability'),
('quote.view','test','Existing capability'),
('quote.create','test','Existing capability'),
('quote.edit','test','Existing capability'),
('quote.send','test','Existing capability'),
('quote.convert','test','Existing capability'),
('quote.overridePrice','test','Existing capability'),
('order.view','test','Existing capability'),
('order.create','test','Existing capability'),
('order.edit','test','Existing capability'),
('order.overridePrice','test','Existing capability'),
('product.view','test','Existing capability'),
('pricing.preview','test','Existing capability'),
('artwork.view','test','Existing capability'),
('artwork.adopt','test','Existing capability'),
('artwork.assign','test','Existing capability'),
('proof.view','test','Existing capability'),
('proof.prepare','test','Existing capability'),
('proof.issue','test','Existing capability'),
('prepress.view','test','Existing capability'),
('prepress.work','test','Existing capability'),
('prepress.complete','test','Existing capability'),
('production.view','test','Existing capability'),
('production.work','test','Existing capability'),
('production.run.create','test','Existing capability'),
('production.run.execute','test','Existing capability'),
('production.complete','test','Existing capability'),
('production.hold','test','Existing capability'),
('production.note','test','Existing capability'),
('production.rework','test','Existing capability'),
('production.output.reject','test','Existing capability'),
('fulfillment.view','test','Existing capability'),
('fulfillment.pickup','test','Existing capability'),
('fulfillment.ship','test','Existing capability'),
('fulfillment.replace','test','Existing capability'),
('fulfillment.shipping.cost','test','Existing capability'),
('fulfillment.shipping.price','test','Existing capability'),
('invoice.view','test','Existing capability'),
('invoice.editDraft','test','Existing capability'),
('invoice.editIssued','test','Existing capability'),
('invoice.issue','test','Existing capability'),
('invoice.send','test','Existing capability'),
('payment.view','test','Existing capability'),
('route.view','test','Existing capability'),
('route.advance','test','Existing capability')
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE before_templates AS SELECT * FROM v2_permission_set_templates;
CREATE TEMP TABLE before_template_grants AS SELECT * FROM v2_permission_set_template_capabilities;
CREATE TEMP TABLE before_sets AS SELECT * FROM v2_permission_sets;
CREATE TEMP TABLE before_grants AS SELECT * FROM v2_permission_set_capabilities;
CREATE TEMP TABLE before_assignments AS SELECT * FROM v2_staff_permission_set_assignments;
\ir ../../../server/db/migrations_v2/0292_v2_operations_permission_role.sql
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM v2_permission_set_templates WHERE template_key='operations' AND name='Operations' AND principal_kind='staff')=1;
  ASSERT (SELECT count(*) FROM v2_permission_sets WHERE source_template_key='operations')=2;
  ASSERT (SELECT count(*) FROM v2_permission_set_template_capabilities tc JOIN v2_permission_set_templates t ON t.id=tc.template_id WHERE t.template_key='operations')=46;
  ASSERT NOT EXISTS((SELECT * FROM before_templates EXCEPT SELECT * FROM v2_permission_set_templates) UNION ALL (SELECT * FROM v2_permission_set_templates WHERE template_key<>'operations' EXCEPT SELECT * FROM before_templates)), 'Every old template, including Sales, Manager, Production, Owner and Administrator, is unchanged';
  ASSERT NOT EXISTS((SELECT * FROM before_template_grants EXCEPT SELECT * FROM v2_permission_set_template_capabilities) UNION ALL (SELECT tc.* FROM v2_permission_set_template_capabilities tc JOIN before_templates t ON t.id=tc.template_id EXCEPT SELECT * FROM before_template_grants)), 'Existing role capabilities are unchanged';
  ASSERT NOT EXISTS(SELECT * FROM before_sets EXCEPT SELECT * FROM v2_permission_sets), 'Existing tenant sets retained exactly';
  ASSERT NOT EXISTS(SELECT * FROM before_grants EXCEPT SELECT * FROM v2_permission_set_capabilities), 'Existing tenant grants retained';
  ASSERT NOT EXISTS((SELECT * FROM before_assignments EXCEPT SELECT * FROM v2_staff_permission_set_assignments) UNION ALL (SELECT * FROM v2_staff_permission_set_assignments EXCEPT SELECT * FROM before_assignments)), 'No implicit user assignment';
  ASSERT NOT EXISTS(SELECT 1 FROM v2_permission_set_capabilities c JOIN v2_permission_sets s ON s.id=c.permission_set_id WHERE s.source_template_key='operations' AND c.capability_id IN ('organization.configure','permissions.manageSets','permissions.assignStaff','payment.record','refund.issue','pricing.publish'));
END $$;
CREATE TEMP TABLE after_revisions AS SELECT organization_id,authority_revision FROM v2_permission_organization_state;
-- Retry does not duplicate the role, grants, or authority revision.
\ir ../../../server/db/migrations_v2/0292_v2_operations_permission_role.sql
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM v2_permission_sets WHERE source_template_key='operations')=2;
  ASSERT NOT EXISTS(SELECT * FROM after_revisions EXCEPT SELECT organization_id,authority_revision FROM v2_permission_organization_state);
END $$;
-- Existing canonical organization bootstrap automatically handles the new role.
INSERT INTO organizations VALUES('future-org');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM v2_permission_set_capabilities c JOIN v2_permission_sets s ON s.id=c.permission_set_id WHERE s.organization_id='future-org' AND s.source_template_key='operations')=46;
END $$;
ROLLBACK;
