ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS weight_value numeric(12, 6),
  ADD COLUMN IF NOT EXISTS weight_unit varchar(20),
  ADD COLUMN IF NOT EXISTS weight_basis varchar(30),
  ADD COLUMN IF NOT EXISTS weight_oz_per_basis numeric(12, 6);

ALTER TABLE materials
  ADD CONSTRAINT materials_weight_unit_check
  CHECK (weight_unit IS NULL OR weight_unit IN ('oz', 'lb', 'g', 'kg'));

ALTER TABLE materials
  ADD CONSTRAINT materials_weight_basis_check
  CHECK (weight_basis IS NULL OR weight_basis IN ('each', 'sqft', 'sheet', 'linear_ft', 'roll'));

ALTER TABLE materials
  ADD CONSTRAINT materials_weight_value_positive_check
  CHECK (weight_value IS NULL OR weight_value > 0);

ALTER TABLE materials
  ADD CONSTRAINT materials_weight_oz_per_basis_positive_check
  CHECK (weight_oz_per_basis IS NULL OR weight_oz_per_basis > 0);
