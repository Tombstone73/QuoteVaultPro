-- M1.8 repair: a completed route has no current step. This preserves the
-- pending/active pointer invariant while making the declared completed state
-- physically reachable for its future named Routing transition.

ALTER TABLE v2_route_instances
  ALTER COLUMN current_step_id DROP NOT NULL;

-- Frozen instance steps carry their own durable identity, position, and kind.
-- A reference into a mutable template-step row cannot remain valid after an
-- intentional template definition update, so it is not retained as provenance.
ALTER TABLE v2_route_instance_steps
  DROP COLUMN source_template_step_id;
