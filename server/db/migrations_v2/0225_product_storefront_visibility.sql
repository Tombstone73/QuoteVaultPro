-- Customer Portal Storefront visibility is an explicit opt-in.
-- Existing active products remain private until staff enable them individually.
ALTER TABLE products ADD COLUMN storefront_visible boolean NOT NULL DEFAULT false;
