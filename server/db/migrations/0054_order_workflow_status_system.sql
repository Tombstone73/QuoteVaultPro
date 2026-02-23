-- 0054_order_workflow_status_system_FIXED.sql
-- Per-organization configurable order workflow statuses (Phase 1)
-- Fixes included:
-- 1) Enforces ONE default status per workflow version
-- 2) Prevents accidental multiple defaults during backfill

-- 1) Workflow versions
CREATE TABLE IF NOT EXISTS order_workflow_versions (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default Workflow',
  is_active boolean NOT NULL DEFAULT false,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS order_workflow_versions_org_idx
  ON order_workflow_versions(organization_id);

CREATE INDEX IF NOT EXISTS order_workflow_versions_org_active_idx
  ON order_workflow_versions(organization_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS order_workflow_versions_one_active_per_org_uidx
  ON order_workflow_versions(organization_id)
  WHERE is_active = true;

-- 2) Workflow statuses
CREATE TABLE IF NOT EXISTS order_workflow_statuses (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_version_id varchar(64) NOT NULL REFERENCES order_workflow_versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  category varchar(32) NOT NULL,
  color text,
  sort_order integer NOT NULL DEFAULT 0,
  is_default_for_new boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_workflow_statuses_org_idx
  ON order_workflow_statuses(organization_id);

CREATE INDEX IF NOT EXISTS order_workflow_statuses_version_idx
  ON order_workflow_statuses(workflow_version_id);

CREATE INDEX IF NOT EXISTS order_workflow_statuses_category_idx
  ON order_workflow_statuses(category);

CREATE UNIQUE INDEX IF NOT EXISTS order_workflow_statuses_version_key_uidx
  ON order_workflow_statuses(workflow_version_id, key);

-- Enforce exactly one default per workflow version (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS order_workflow_statuses_one_default_per_version_uidx
  ON order_workflow_statuses(workflow_version_id)
  WHERE is_default_for_new = true;

-- 3) Workflow transitions (Phase 2-ready)
CREATE TABLE IF NOT EXISTS order_workflow_transitions (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_version_id varchar(64) NOT NULL REFERENCES order_workflow_versions(id) ON DELETE CASCADE,
  from_status_id varchar(64) NOT NULL REFERENCES order_workflow_statuses(id) ON DELETE CASCADE,
  to_status_id varchar(64) NOT NULL REFERENCES order_workflow_statuses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS order_workflow_transitions_org_idx
  ON order_workflow_transitions(organization_id);

CREATE INDEX IF NOT EXISTS order_workflow_transitions_version_idx
  ON order_workflow_transitions(workflow_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS order_workflow_transitions_unique
  ON order_workflow_transitions(workflow_version_id, from_status_id, to_status_id);

-- 4) Status change events (audit)
CREATE TABLE IF NOT EXISTS order_status_events (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status_id varchar(64) REFERENCES order_workflow_statuses(id) ON DELETE SET NULL,
  to_status_id varchar(64) REFERENCES order_workflow_statuses(id) ON DELETE SET NULL,
  from_status_label text,
  to_status_label text,
  changed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  note text
);

CREATE INDEX IF NOT EXISTS order_status_events_org_order_idx
  ON order_status_events(organization_id, order_id);

CREATE INDEX IF NOT EXISTS order_status_events_changed_at_idx
  ON order_status_events(changed_at);

-- 5) Orders table additions
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS workflow_status_id varchar(64),
  ADD COLUMN IF NOT EXISTS canonical_state varchar(32);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_workflow_status_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_workflow_status_id_fkey
      FOREIGN KEY (workflow_status_id)
      REFERENCES order_workflow_statuses(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orders_workflow_status_id_idx
  ON orders(workflow_status_id);

CREATE INDEX IF NOT EXISTS orders_canonical_state_idx
  ON orders(canonical_state);

-- ------------------------------------------------------------------
-- Backfill (idempotent)
-- ------------------------------------------------------------------
DO $$
DECLARE
  org_rec RECORD;
  active_version_id varchar(64);
  st RECORD;
  chosen_default_id varchar(64);
BEGIN
  FOR org_rec IN SELECT id FROM organizations LOOP
    -- Ensure one active workflow per org
    SELECT id INTO active_version_id
    FROM order_workflow_versions
    WHERE organization_id = org_rec.id AND is_active = true
    ORDER BY created_at DESC
    LIMIT 1;

    IF active_version_id IS NULL THEN
      INSERT INTO order_workflow_versions (organization_id, name, is_active, created_at, published_at)
      VALUES (org_rec.id, 'Default Workflow', true, now(), now())
      RETURNING id INTO active_version_id;
    END IF;

    -- Create statuses from distinct legacy orders.status values
    FOR st IN
      SELECT DISTINCT COALESCE(NULLIF(TRIM(o.status), ''), 'active') AS raw_status
      FROM orders o
      WHERE o.organization_id = org_rec.id
    LOOP
      INSERT INTO order_workflow_statuses (
        organization_id,
        workflow_version_id,
        key,
        label,
        category,
        color,
        sort_order,
        is_default_for_new,
        is_active,
        created_at
      )
      VALUES (
        org_rec.id,
        active_version_id,
        LEFT(regexp_replace(lower(st.raw_status), '[^a-z0-9]+', '_', 'g'), 40) || '_' || substr(md5(st.raw_status), 1, 6),
        INITCAP(replace(st.raw_status, '_', ' ')),
        CASE lower(st.raw_status)
          WHEN 'new' THEN 'new'
          WHEN 'in_production' THEN 'active'
          WHEN 'on_hold' THEN 'on_hold'
          WHEN 'ready_for_pickup' THEN 'ready'
          WHEN 'ready_for_shipment' THEN 'ready'
          WHEN 'completed' THEN 'completed'
          WHEN 'canceled' THEN 'canceled'
          ELSE 'active'
        END,
        NULL,
        100,
        false,   -- IMPORTANT: never set default here to avoid duplicates
        true,
        now()
      )
      ON CONFLICT (workflow_version_id, key) DO NOTHING;
    END LOOP;

    -- Ensure baseline statuses exist (do NOT set any defaults here)
    INSERT INTO order_workflow_statuses (
      organization_id, workflow_version_id, key, label, category, sort_order, is_default_for_new, is_active, created_at
    )
    VALUES
      (org_rec.id, active_version_id, 'new', 'New', 'new', 10, false, true, now()),
      (org_rec.id, active_version_id, 'in_production', 'In Production', 'active', 20, false, true, now()),
      (org_rec.id, active_version_id, 'on_hold', 'On Hold', 'on_hold', 30, false, true, now())
    ON CONFLICT (workflow_version_id, key) DO NOTHING;

    -- Choose exactly one default per workflow version:
    -- Prefer category='new', else first active by sort_order/created_at
    SELECT s.id INTO chosen_default_id
    FROM order_workflow_statuses s
    WHERE s.workflow_version_id = active_version_id
      AND s.is_active = true
      AND s.category = 'new'
    ORDER BY s.sort_order ASC, s.created_at ASC
    LIMIT 1;

    IF chosen_default_id IS NULL THEN
      SELECT s.id INTO chosen_default_id
      FROM order_workflow_statuses s
      WHERE s.workflow_version_id = active_version_id
        AND s.is_active = true
      ORDER BY s.sort_order ASC, s.created_at ASC
      LIMIT 1;
    END IF;

    -- Clear any existing defaults, then set the chosen one
    UPDATE order_workflow_statuses
    SET is_default_for_new = false
    WHERE workflow_version_id = active_version_id
      AND is_default_for_new = true;

    IF chosen_default_id IS NOT NULL THEN
      UPDATE order_workflow_statuses
      SET is_default_for_new = true
      WHERE id = chosen_default_id;
    END IF;

    -- Backfill orders.workflow_status_id only if missing
    UPDATE orders o
    SET workflow_status_id = s.id
    FROM order_workflow_statuses s
    WHERE o.organization_id = org_rec.id
      AND o.workflow_status_id IS NULL
      AND s.workflow_version_id = active_version_id
      AND s.key = LEFT(regexp_replace(lower(COALESCE(NULLIF(TRIM(o.status), ''), 'active')), '[^a-z0-9]+', '_', 'g'), 40) || '_' || substr(md5(COALESCE(NULLIF(TRIM(o.status), ''), 'active')), 1, 6);

    -- Backfill canonical_state from mapped workflow status category
    UPDATE orders o
    SET canonical_state = s.category
    FROM order_workflow_statuses s
    WHERE o.organization_id = org_rec.id
      AND o.workflow_status_id = s.id
      AND (o.canonical_state IS NULL OR o.canonical_state = '');

    -- Fallback canonical_state when no workflow status mapped
    UPDATE orders o
    SET canonical_state = CASE lower(COALESCE(NULLIF(TRIM(o.status), ''), 'active'))
      WHEN 'new' THEN 'new'
      WHEN 'in_production' THEN 'active'
      WHEN 'on_hold' THEN 'on_hold'
      WHEN 'ready_for_pickup' THEN 'ready'
      WHEN 'ready_for_shipment' THEN 'ready'
      WHEN 'completed' THEN 'completed'
      WHEN 'canceled' THEN 'canceled'
      ELSE 'active'
    END
    WHERE o.organization_id = org_rec.id
      AND (o.canonical_state IS NULL OR o.canonical_state = '');
  END LOOP;
END $$;

-- ------------------------------------------------------------------
-- Sanity checks (optional but recommended)
-- ------------------------------------------------------------------

-- 1) More than one active workflow per org should return zero rows
-- SELECT organization_id, COUNT(*)
-- FROM order_workflow_versions
-- WHERE is_active = true
-- GROUP BY organization_id
-- HAVING COUNT(*) > 1;

-- 2) Exactly one default per workflow version should return zero rows
-- SELECT workflow_version_id, COUNT(*)
-- FROM order_workflow_statuses
-- WHERE is_default_for_new = true
-- GROUP BY workflow_version_id
-- HAVING COUNT(*) != 1;

-- 3) Orders missing backfill should be near zero (existing nulls are still allowed)
-- SELECT
--   SUM(CASE WHEN workflow_status_id IS NULL THEN 1 ELSE 0 END) AS missing_workflow_status_id,
--   SUM(CASE WHEN canonical_state IS NULL OR canonical_state = '' THEN 1 ELSE 0 END) AS missing_canonical_state
-- FROM orders;