ALTER TABLE "products"
ADD COLUMN IF NOT EXISTS "shop_name" varchar(120);

COMMENT ON COLUMN "products"."shop_name" IS
  'Short tenant-editable internal product name used on production-facing screens.';
