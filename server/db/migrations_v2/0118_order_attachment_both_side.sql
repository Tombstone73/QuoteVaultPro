-- One order attachment may explicitly supply both sides of a double-sided line item.
ALTER TYPE file_side ADD VALUE IF NOT EXISTS 'both';
