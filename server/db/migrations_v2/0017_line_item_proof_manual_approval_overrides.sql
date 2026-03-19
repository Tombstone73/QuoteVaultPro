CREATE TABLE IF NOT EXISTS line_item_proof_manual_approval_overrides (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
    proof_version_id varchar NOT NULL REFERENCES line_item_proof_versions(id) ON DELETE CASCADE,
    source varchar(50) NOT NULL DEFAULT 'manual_override',
    override_reason text NOT NULL,
    internal_note text,
    actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    actor_name varchar(255),
    actor_email varchar(255),
    overridden_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS line_item_proof_manual_approval_overrides_org_idx
    ON line_item_proof_manual_approval_overrides (organization_id);

CREATE INDEX IF NOT EXISTS line_item_proof_manual_approval_overrides_order_idx
    ON line_item_proof_manual_approval_overrides (order_id);

CREATE INDEX IF NOT EXISTS line_item_proof_manual_approval_overrides_line_item_idx
    ON line_item_proof_manual_approval_overrides (line_item_id);

CREATE INDEX IF NOT EXISTS line_item_proof_manual_approval_overrides_created_at_idx
    ON line_item_proof_manual_approval_overrides (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS line_item_proof_manual_approval_overrides_version_uidx
    ON line_item_proof_manual_approval_overrides (proof_version_id);