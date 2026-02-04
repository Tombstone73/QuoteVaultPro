-- Run this in Neon SQL Editor to check if pbv2_tree_versions has rows
-- Replace <PRODUCT_ID> with your actual product ID

SELECT 
  id,
  organization_id,
  product_id,
  status,
  schema_version,
  created_at,
  updated_at,
  jsonb_typeof(tree_json) as tree_json_type,
  jsonb_object_keys(tree_json->'nodes') as node_ids
FROM pbv2_tree_versions
WHERE product_id = '<PRODUCT_ID>'
ORDER BY updated_at DESC;

-- Count all DRAFT rows
SELECT COUNT(*) as total_draft_rows
FROM pbv2_tree_versions
WHERE status = 'DRAFT';

-- Check all rows in table
SELECT COUNT(*) as total_rows
FROM pbv2_tree_versions;
