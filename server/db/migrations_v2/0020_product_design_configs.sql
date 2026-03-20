CREATE TABLE IF NOT EXISTS product_design_configs (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id varchar NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    requires_design boolean NOT NULL DEFAULT false,
    design_brief_required boolean NOT NULL DEFAULT false,
    use_key_instructions boolean NOT NULL DEFAULT true,
    use_design_objective boolean NOT NULL DEFAULT true,
    use_requested_content boolean NOT NULL DEFAULT false,
    use_layout_notes boolean NOT NULL DEFAULT false,
    use_brand_style_notes boolean NOT NULL DEFAULT false,
    use_reference_notes boolean NOT NULL DEFAULT false,
    use_priority_notes boolean NOT NULL DEFAULT false,
    require_key_instructions boolean NOT NULL DEFAULT false,
    require_design_objective boolean NOT NULL DEFAULT false,
    estimated_design_minutes integer,
    included_design_minutes integer,
    allow_design_start_when_brief_missing boolean NOT NULL DEFAULT false,
    design_pricing_mode varchar(50) NOT NULL DEFAULT 'none',
    flat_fee_amount decimal(10, 2),
    hourly_rate decimal(10, 2),
    overage_rate decimal(10, 2),
    internal_labor_rate decimal(10, 2),
    cost_tracking_enabled boolean NOT NULL DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_design_configs_product_id_unique
    ON product_design_configs (product_id);

CREATE INDEX IF NOT EXISTS product_design_configs_organization_id_idx
    ON product_design_configs (organization_id);