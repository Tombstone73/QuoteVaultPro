-- M7.5I: tenant/customer-scoped portal catalog access and commercial policy.
-- ProductVersions remain immutable.  These rows express customer access and
-- agreements only; Sales freezes their applied evidence onto each line.
CREATE TABLE v2_customer_product_entitlements (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id varchar NOT NULL,
  product_id varchar NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, customer_id, product_id),
  CONSTRAINT v2_customer_product_entitlement_customer_fk FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_customer_product_entitlement_product_fk FOREIGN KEY (product_id, organization_id)
    REFERENCES products(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_customer_product_entitlements_enabled_idx
  ON v2_customer_product_entitlements(organization_id, customer_id, product_id)
  WHERE enabled=true;

CREATE TABLE v2_customer_product_pricing_agreements (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id varchar NOT NULL,
  product_id varchar NOT NULL,
  product_version_id varchar,
  currency varchar(3) NOT NULL,
  pricing_mode varchar(32) NOT NULL,
  pricing_value integer NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_customer_product_pricing_customer_fk FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_customer_product_pricing_product_fk FOREIGN KEY (product_id, organization_id)
    REFERENCES products(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_customer_product_pricing_product_version_fk FOREIGN KEY (product_version_id, organization_id, product_id)
    REFERENCES pbv2_tree_versions(id, organization_id, product_id) ON DELETE RESTRICT,
  CONSTRAINT v2_customer_product_pricing_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT v2_customer_product_pricing_mode_chk CHECK (pricing_mode IN ('fixed_unit','percent_adjustment')),
  CONSTRAINT v2_customer_product_pricing_value_chk CHECK ((pricing_mode='fixed_unit' AND pricing_value >= 0) OR (pricing_mode='percent_adjustment' AND pricing_value >= -10000)),
  CONSTRAINT v2_customer_product_pricing_active_shape_chk CHECK ((active=true AND superseded_at IS NULL) OR (active=false AND superseded_at IS NOT NULL))
);
CREATE UNIQUE INDEX v2_customer_product_pricing_current_generic_uidx
  ON v2_customer_product_pricing_agreements(organization_id, customer_id, product_id)
  WHERE active=true AND product_version_id IS NULL;
CREATE UNIQUE INDEX v2_customer_product_pricing_current_version_uidx
  ON v2_customer_product_pricing_agreements(organization_id, customer_id, product_id, product_version_id)
  WHERE active=true AND product_version_id IS NOT NULL;
CREATE INDEX v2_customer_product_pricing_lookup_idx
  ON v2_customer_product_pricing_agreements(organization_id, customer_id, product_id, effective_from DESC)
  WHERE active=true;

CREATE TABLE v2_customer_product_commercial_events (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id varchar NOT NULL,
  product_id varchar NOT NULL,
  event_type varchar(64) NOT NULL,
  event_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(255) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  operation_id varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_customer_product_commercial_events_customer_fk FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_customer_product_commercial_events_product_fk FOREIGN KEY (product_id, organization_id)
    REFERENCES products(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_customer_product_commercial_events_detail_chk CHECK (jsonb_typeof(event_detail)='object'),
  CONSTRAINT v2_customer_product_commercial_events_actor_chk CHECK (principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(principal_subject)) > 0)
);
CREATE INDEX v2_customer_product_commercial_events_history_idx
  ON v2_customer_product_commercial_events(organization_id, customer_id, product_id, created_at DESC);

-- Product visibility is still constrained by the entitlement table above.
-- `order.create` is intentionally granted only to the existing full portal
-- template. The ceiling default only makes that assigned capability usable;
-- it does not grant it to customer_view_only or to an unassigned portal user.
INSERT INTO v2_permission_set_template_capabilities(template_id, capability_id)
SELECT id, capability_id
FROM v2_permission_set_templates
CROSS JOIN (VALUES ('product.view'), ('order.create')) AS required(capability_id)
WHERE template_key='customer_full_portal'
ON CONFLICT DO NOTHING;
INSERT INTO v2_permission_set_capabilities(organization_id, permission_set_id, capability_id)
SELECT organization_id, id, required.capability_id
FROM v2_permission_sets
CROSS JOIN (VALUES ('product.view'), ('order.create')) AS required(capability_id)
WHERE source_template_key='customer_full_portal'
ON CONFLICT DO NOTHING;
INSERT INTO v2_organization_portal_capability_defaults(organization_id, capability_id)
SELECT id, required.capability_id
FROM organizations
CROSS JOIN (VALUES ('product.view'), ('order.create')) AS required(capability_id)
ON CONFLICT DO NOTHING;
