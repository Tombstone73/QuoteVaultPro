-- Operator tasks retain the entire staff request, not a 2,000-character summary.
-- Match the existing 32,000-character message contract; do not truncate data.
ALTER TABLE public.ai_operator_tasks
  ALTER COLUMN goal TYPE varchar(32000);
