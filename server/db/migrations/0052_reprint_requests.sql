-- Migration 0052: reprint_requests table
-- Stores detailed reprint requests from the production board

CREATE TABLE IF NOT EXISTS reprint_requests (
  id                      varchar         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id         varchar         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  line_item_id            varchar         NOT NULL REFERENCES order_line_items(id) ON DELETE RESTRICT,
  file_id                 varchar         REFERENCES line_item_files(id) ON DELETE SET NULL,
  filename                text            NOT NULL,
  quantity                decimal(10, 2)  NOT NULL CHECK (quantity > 0),
  units                   text            NOT NULL,
  reason                  text            NOT NULL,
  no_prints_completed_yet boolean         NOT NULL DEFAULT false,
  created_by_user_id      varchar         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at              timestamptz     NOT NULL DEFAULT now(),
  status                  text            NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'closed'))
);

CREATE INDEX IF NOT EXISTS reprint_requests_org_idx         ON reprint_requests(organization_id);
CREATE INDEX IF NOT EXISTS reprint_requests_line_item_idx   ON reprint_requests(line_item_id);
CREATE INDEX IF NOT EXISTS reprint_requests_status_idx      ON reprint_requests(status);
CREATE INDEX IF NOT EXISTS reprint_requests_org_status_idx  ON reprint_requests(organization_id, status);
