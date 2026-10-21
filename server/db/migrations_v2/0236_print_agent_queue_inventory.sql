-- A paired Print Agent reports its installed Windows queues. The original
-- Traveler selection remains for older agents and existing profile mappings.
ALTER TABLE public.local_bridge_agents
  ADD COLUMN known_windows_queues jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN inventory_reported_at timestamptz;
