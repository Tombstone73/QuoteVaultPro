ALTER TABLE order_line_items
ADD COLUMN IF NOT EXISTS requires_proof_approval boolean NOT NULL DEFAULT false;

ALTER TABLE order_line_items
ADD COLUMN IF NOT EXISTS approved_proof_version_id varchar;

DO $$
BEGIN
    CREATE TYPE line_item_proof_version_status AS ENUM (
        'draft',
        'awaiting_response',
        'approved',
        'rejected',
        'revision_requested',
        'superseded'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE line_item_proof_response_decision AS ENUM (
        'approved',
        'rejected',
        'revision_requested'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS line_item_proof_versions (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
    proof_file_id varchar NOT NULL REFERENCES order_attachments(id) ON DELETE RESTRICT,
    version_number integer NOT NULL,
    status line_item_proof_version_status NOT NULL DEFAULT 'draft',
    internal_notes text,
    customer_message text,
    sent_to_name varchar(255),
    sent_to_email varchar(255),
    sent_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    sent_at timestamp with time zone,
    created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS line_item_proof_versions_org_idx
    ON line_item_proof_versions (organization_id);

CREATE INDEX IF NOT EXISTS line_item_proof_versions_order_idx
    ON line_item_proof_versions (order_id);

CREATE INDEX IF NOT EXISTS line_item_proof_versions_line_item_idx
    ON line_item_proof_versions (line_item_id);

CREATE INDEX IF NOT EXISTS line_item_proof_versions_status_idx
    ON line_item_proof_versions (status);

CREATE INDEX IF NOT EXISTS line_item_proof_versions_proof_file_idx
    ON line_item_proof_versions (proof_file_id);

CREATE UNIQUE INDEX IF NOT EXISTS line_item_proof_versions_line_item_version_uidx
    ON line_item_proof_versions (line_item_id, version_number);

CREATE UNIQUE INDEX IF NOT EXISTS line_item_proof_versions_active_review_uidx
    ON line_item_proof_versions (line_item_id)
    WHERE status = 'awaiting_response';

CREATE TABLE IF NOT EXISTS line_item_proof_approvals (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
    proof_version_id varchar NOT NULL REFERENCES line_item_proof_versions(id) ON DELETE CASCADE,
    decision line_item_proof_response_decision NOT NULL,
    response_notes text,
    responder_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    responder_name varchar(255),
    responder_email varchar(255),
    responder_source varchar(50) NOT NULL DEFAULT 'internal',
    responded_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS line_item_proof_approvals_org_idx
    ON line_item_proof_approvals (organization_id);

CREATE INDEX IF NOT EXISTS line_item_proof_approvals_order_idx
    ON line_item_proof_approvals (order_id);

CREATE INDEX IF NOT EXISTS line_item_proof_approvals_line_item_idx
    ON line_item_proof_approvals (line_item_id);

CREATE INDEX IF NOT EXISTS line_item_proof_approvals_decision_idx
    ON line_item_proof_approvals (decision);

CREATE UNIQUE INDEX IF NOT EXISTS line_item_proof_approvals_version_uidx
    ON line_item_proof_approvals (proof_version_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'order_line_items_approved_proof_version_id_fkey'
    ) THEN
        ALTER TABLE order_line_items
        ADD CONSTRAINT order_line_items_approved_proof_version_id_fkey
        FOREIGN KEY (approved_proof_version_id)
        REFERENCES line_item_proof_versions(id)
        ON DELETE SET NULL;
    END IF;
END $$;
