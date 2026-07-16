-- Explicitly represent one artwork file assigned to both print sides.
ALTER TYPE file_side ADD VALUE IF NOT EXISTS 'both';
