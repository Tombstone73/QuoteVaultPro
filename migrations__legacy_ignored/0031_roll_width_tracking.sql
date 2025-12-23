-- Migration 0031: Roll Width Tracking for Production Jobs
-- Adds optional roll_width_used_inches field to jobs table for production tracking
-- This field is only set during production, NOT required at quote/order creation time

-- Add roll_width_used_inches column to jobs table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'jobs' AND column_name = 'roll_width_used_inches'
  ) THEN
    ALTER TABLE jobs ADD COLUMN roll_width_used_inches DECIMAL(10, 2);
  END IF;
END $$;

-- Add material_id column to jobs for direct material reference (for inventory deduction later)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'jobs' AND column_name = 'material_id'
  ) THEN
    ALTER TABLE jobs ADD COLUMN material_id TEXT REFERENCES materials(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add index for material lookups
CREATE INDEX IF NOT EXISTS idx_jobs_material_id ON jobs(material_id);

-- Comments for documentation
COMMENT ON COLUMN jobs.roll_width_used_inches IS 'Roll width in inches actually used in production. Optional - set by production staff after printing. Used for inventory tracking and actual cost calculations.';
COMMENT ON COLUMN jobs.material_id IS 'Direct reference to material used in production. Enables inventory deduction and actual cost analysis.';
