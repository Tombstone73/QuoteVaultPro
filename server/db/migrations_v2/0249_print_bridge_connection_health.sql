-- Optional, bounded agent-reported status. Legacy agents retain unknown health.
ALTER TABLE local_bridge_agents ADD COLUMN IF NOT EXISTS connection_health jsonb;
