-- Migration: 0014_add_quote_order_snapshots.sql
-- Purpose: Add customer/shipping snapshot fields to quotes and orders tables
-- Author: TITAN KERNEL
-- Date: 2025-01-XX

-- ============================================================================
-- PART 1: QUOTES TABLE ENHANCEMENTS
-- ============================================================================

-- Add status field with enum values
DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "status" VARCHAR(50) DEFAULT 'pending';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- Add customer snapshot fields (billing)
DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToName" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToCompany" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToAddress1" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToAddress2" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToCity" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToState" VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToPostalCode" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToCountry" VARCHAR(100) DEFAULT 'US';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToPhone" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "billToEmail" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add shipping snapshot fields
DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shippingMethod" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shippingMode" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToName" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToCompany" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToAddress1" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToAddress2" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToCity" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToState" VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToPostalCode" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToCountry" VARCHAR(100) DEFAULT 'US';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToPhone" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipToEmail" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "carrier" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "carrierAccountNumber" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shippingInstructions" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add date fields
DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "requestedDueDate" TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "validUntil" TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add quote-to-order linking
DO $$ BEGIN
  ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "convertedToOrderId" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add foreign key constraint for convertedToOrderId
DO $$ BEGIN
  ALTER TABLE "quotes" 
  ADD CONSTRAINT "fk_quotes_converted_to_order" 
  FOREIGN KEY ("convertedToOrderId") 
  REFERENCES "orders"("id") 
  ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 2: ORDERS TABLE ENHANCEMENTS
-- ============================================================================

-- Add customer snapshot fields (billing)
DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToName" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToCompany" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToAddress1" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToAddress2" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToCity" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToState" VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToPostalCode" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToCountry" VARCHAR(100) DEFAULT 'US';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToPhone" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billToEmail" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add shipping snapshot fields
DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shippingMethod" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shippingMode" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToName" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToCompany" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToAddress1" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToAddress2" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToCity" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToState" VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToPostalCode" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToCountry" VARCHAR(100) DEFAULT 'US';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToPhone" VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipToEmail" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "carrier" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "carrierAccountNumber" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shippingInstructions" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "trackingNumber" VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shippedAt" TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add date fields
DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "requestedDueDate" TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "productionDueDate" TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================================================
-- PART 3: SET DEFAULT STATUS VALUES FOR EXISTING RECORDS
-- ============================================================================

-- Set default status for existing quotes (if any have NULL status)
UPDATE "quotes" SET "status" = 'pending' WHERE "status" IS NULL;

-- Set default status for existing orders (if any have incompatible status values)
-- This migration standardizes to: new, in_production, on_hold, ready_for_shipment, completed, canceled
UPDATE "orders" SET "status" = 'new' WHERE "status" IS NULL;

-- Map old status values to new standardized enums (if they exist)
UPDATE "orders" SET "status" = 'ready_for_shipment' WHERE "status" IN ('ready_for_pickup', 'shipped');
UPDATE "orders" SET "status" = 'in_production' WHERE "status" = 'scheduled';

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index for quote status filtering
CREATE INDEX IF NOT EXISTS "idx_quotes_status" ON "quotes"("status");

-- Index for quote-to-order conversion lookup
CREATE INDEX IF NOT EXISTS "idx_quotes_converted_to_order_id" ON "quotes"("convertedToOrderId");

-- Index for order-to-quote reverse lookup (quoteId already has FK, add index)
CREATE INDEX IF NOT EXISTS "idx_orders_quote_id" ON "orders"("quoteId");

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verification query (uncomment to test)
-- SELECT 
--   COUNT(*) as total_quotes,
--   COUNT("convertedToOrderId") as converted_quotes,
--   COUNT(DISTINCT "status") as unique_statuses
-- FROM "quotes";
