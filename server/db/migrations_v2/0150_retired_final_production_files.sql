-- Retire an active final-production relationship without touching its canonical
-- file record or physical object. Historical job and bridge records retain IDs.
ALTER TYPE line_item_file_status ADD VALUE IF NOT EXISTS 'retired';
