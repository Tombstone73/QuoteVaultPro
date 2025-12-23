-- Add nesting calculator fields to products table
ALTER TABLE "products" 
ADD COLUMN "use_nesting_calculator" boolean DEFAULT false NOT NULL,
ADD COLUMN "sheet_width" numeric(10, 2),
ADD COLUMN "sheet_height" numeric(10, 2),
ADD COLUMN "material_type" varchar(50) DEFAULT 'sheet';

