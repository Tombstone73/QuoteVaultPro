-- Migration: Add thickness_unit column to materials table
-- Description: Adds support for thickness units (in, mm, mil, gauge) to materials

-- Add thickness_unit column to materials table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'materials' AND column_name = 'thickness_unit') THEN
    ALTER TABLE materials ADD COLUMN thickness_unit VARCHAR(20);
  END IF;
END $$;

-- Add comment explaining the field
COMMENT ON COLUMN materials.thickness_unit IS 'Unit for thickness measurement: in (inches), mm (millimeters), mil (thousandths of an inch), gauge';
