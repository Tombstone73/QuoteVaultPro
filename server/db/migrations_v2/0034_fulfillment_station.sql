-- Migration 0034: Seed Fulfillment station for all organisations
--
-- The Fulfillment station is the canonical terminal production station.
-- Production jobs at Roll/Flatbed/CNC/etc. route here on completion.
-- Fulfillment job completion marks the line item as completed.
--
-- Uses ON CONFLICT DO NOTHING so re-running is safe and orgs that
-- already configured a "fulfillment" station are unaffected.

INSERT INTO stations (organization_id, key, name, sort, active)
SELECT o.id, 'fulfillment', 'Fulfillment', 90, true
FROM organizations o
ON CONFLICT (organization_id, key) DO NOTHING;
