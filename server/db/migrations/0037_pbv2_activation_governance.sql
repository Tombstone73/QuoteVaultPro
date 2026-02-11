-- Migration 0037: PBV2 Activation Governance
-- Add organization setting to control PBV2 activation behavior
-- Default is 'auto_on_save' for better UX (save → active)
-- Can be set to 'manual_publish' to require explicit publish step

DO $$
BEGIN
  -- Add pbv2_activation_mode column to organizations table
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organizations' 
    AND column_name = 'pbv2_activation_mode'
  ) THEN
    ALTER TABLE organizations 
    ADD COLUMN pbv2_activation_mode TEXT DEFAULT 'auto_on_save' NOT NULL
    CHECK (pbv2_activation_mode IN ('auto_on_save', 'manual_publish'));
    
    COMMENT ON COLUMN organizations.pbv2_activation_mode IS 
      'Controls PBV2 tree activation: auto_on_save (default, activates on save if valid) or manual_publish (requires explicit publish action)';
  END IF;
END $$;
