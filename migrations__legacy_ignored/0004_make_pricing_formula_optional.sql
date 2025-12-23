-- Make pricing_formula optional (nullable) since it's not needed when using nesting calculator
ALTER TABLE "products" 
ALTER COLUMN "pricing_formula" DROP NOT NULL;

