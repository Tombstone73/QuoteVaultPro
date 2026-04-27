ALTER TABLE quote_line_items
    ADD COLUMN IF NOT EXISTS requires_design_snapshot boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS design_brief_required_snapshot boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS estimated_design_minutes_snapshot integer,
    ADD COLUMN IF NOT EXISTS included_design_minutes_snapshot integer,
    ADD COLUMN IF NOT EXISTS design_pricing_mode_snapshot varchar(50) NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS flat_fee_amount_snapshot decimal(10, 2),
    ADD COLUMN IF NOT EXISTS hourly_rate_snapshot decimal(10, 2),
    ADD COLUMN IF NOT EXISTS overage_rate_snapshot decimal(10, 2),
    ADD COLUMN IF NOT EXISTS internal_labor_rate_snapshot decimal(10, 2),
    ADD COLUMN IF NOT EXISTS needs_design_override boolean;

ALTER TABLE order_line_items
    ADD COLUMN IF NOT EXISTS requires_design_snapshot boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS design_brief_required_snapshot boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS estimated_design_minutes_snapshot integer,
    ADD COLUMN IF NOT EXISTS included_design_minutes_snapshot integer,
    ADD COLUMN IF NOT EXISTS design_pricing_mode_snapshot varchar(50) NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS flat_fee_amount_snapshot decimal(10, 2),
    ADD COLUMN IF NOT EXISTS hourly_rate_snapshot decimal(10, 2),
    ADD COLUMN IF NOT EXISTS overage_rate_snapshot decimal(10, 2),
    ADD COLUMN IF NOT EXISTS internal_labor_rate_snapshot decimal(10, 2),
    ADD COLUMN IF NOT EXISTS needs_design_override boolean;