-- Migration 0052: reprint_requests table
-- Stores detailed reprint requests from the production board

CREATE TABLE IF NOT EXISTS reprint_requests (
  id              VARCHAR         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  line_item_id    VARCHAR                  REFERENCES order_line_items(id) ON DELETE SET NULL,
  file_id         VARCHAR,
  filename        TEXT            NOT NULL,
  quantity        DECIMAL(10, 2)  NOT NULL,
  units           TEXT            NOT NULL,
  reason          TEXT            NOT NULL,
  no_prints_completed_yet BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id VARCHAR      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  status          TEXT            NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS reprint_requests_org_idx       ON reprint_requests(organization_id);
CREATE INDEX IF NOT EXISTS reprint_requests_line_item_idx ON reprint_requests(line_item_id);
CREATE INDEX IF NOT EXISTS reprint_requests_status_idx    ON reprint_requests(status);
