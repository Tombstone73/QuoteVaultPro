-- Keep the actual calendar date separate from immutable handoff and entry timestamps.
-- Null legacy values retain their existing handed_off_at date semantics on read.
ALTER TABLE pickup_handoffs ADD COLUMN effective_pickup_date date;
