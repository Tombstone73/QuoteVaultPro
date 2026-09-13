-- A paired local print agent owns one explicitly configured Traveler queue.
-- This keeps the browser and other tenants from discovering a workstation's
-- printer inventory while allowing the installer to register its selection.
ALTER TABLE local_bridge_agents
  ADD COLUMN IF NOT EXISTS configured_traveler_printer_name varchar(255);
