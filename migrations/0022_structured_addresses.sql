-- Migration: Add structured address fields to customers and customer_contacts
-- Date: 2024
-- Description: Replaces text blob addresses with structured fields (street1, street2, city, state, postalCode, country)
--              Keeps old billingAddress/shippingAddress fields for backward compatibility

-- Add structured billing address fields to customers table
DO $$ 
BEGIN
  -- Billing address fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'billing_street1') THEN
    ALTER TABLE customers ADD COLUMN billing_street1 VARCHAR(255);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'billing_street2') THEN
    ALTER TABLE customers ADD COLUMN billing_street2 VARCHAR(255);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'billing_city') THEN
    ALTER TABLE customers ADD COLUMN billing_city VARCHAR(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'billing_state') THEN
    ALTER TABLE customers ADD COLUMN billing_state VARCHAR(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'billing_postal_code') THEN
    ALTER TABLE customers ADD COLUMN billing_postal_code VARCHAR(20);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'billing_country') THEN
    ALTER TABLE customers ADD COLUMN billing_country VARCHAR(100);
  END IF;
  
  -- Shipping address fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'shipping_street1') THEN
    ALTER TABLE customers ADD COLUMN shipping_street1 VARCHAR(255);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'shipping_street2') THEN
    ALTER TABLE customers ADD COLUMN shipping_street2 VARCHAR(255);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'shipping_city') THEN
    ALTER TABLE customers ADD COLUMN shipping_city VARCHAR(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'shipping_state') THEN
    ALTER TABLE customers ADD COLUMN shipping_state VARCHAR(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'shipping_postal_code') THEN
    ALTER TABLE customers ADD COLUMN shipping_postal_code VARCHAR(20);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'shipping_country') THEN
    ALTER TABLE customers ADD COLUMN shipping_country VARCHAR(100);
  END IF;
END $$;

-- Add structured address fields to customer_contacts table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_contacts' AND column_name = 'street1') THEN
    ALTER TABLE customer_contacts ADD COLUMN street1 VARCHAR(255);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_contacts' AND column_name = 'street2') THEN
    ALTER TABLE customer_contacts ADD COLUMN street2 VARCHAR(255);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_contacts' AND column_name = 'city') THEN
    ALTER TABLE customer_contacts ADD COLUMN city VARCHAR(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_contacts' AND column_name = 'state') THEN
    ALTER TABLE customer_contacts ADD COLUMN state VARCHAR(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_contacts' AND column_name = 'postal_code') THEN
    ALTER TABLE customer_contacts ADD COLUMN postal_code VARCHAR(20);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_contacts' AND column_name = 'country') THEN
    ALTER TABLE customer_contacts ADD COLUMN country VARCHAR(100);
  END IF;
END $$;

-- NOTE: Old billingAddress and shippingAddress text fields are kept for backward compatibility
-- Applications can migrate data from text fields to structured fields as needed
