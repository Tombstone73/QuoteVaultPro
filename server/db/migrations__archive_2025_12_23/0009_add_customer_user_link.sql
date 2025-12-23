-- Migration: Add user_id to customers table to link customers with user accounts
-- This enables direct authentication and quote/order management for customer users

-- Add user_id column to customers table
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS customers_user_id_idx ON customers(user_id);

-- Create index for email lookups (used during sync)
CREATE INDEX IF NOT EXISTS customers_email_idx ON customers(email);

-- Add comment for documentation
COMMENT ON COLUMN customers.user_id IS 'Links customer to their user account for authentication and self-service';
