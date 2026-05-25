-- Migration 0061: PBV2 sheet-yield formula library entries return final dollars.
-- Formula helper output is geometry (billed sqft); PBV2 pricing formulas must
-- return final dollars, so the reusable 4x8 formula must multiply by base_price.

UPDATE pricing_formulas
SET expression = 'sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price',
    config = jsonb_set(
      coalesce(config, '{}'::jsonb),
      '{variables}',
      coalesce(config->'variables', '{}'::jsonb) || '{
        "sheet_width": 48,
        "sheet_length": 96,
        "usable_drop_min": 0,
        "billable_length_increment": 1,
        "minimum_billable_sqft": 32
      }'::jsonb,
      true
    ),
    updated_at = NOW()
WHERE upper(coalesce(code, '')) = '4X8_WITH_WASTE_CALCULATION'
  AND (
    regexp_replace(coalesce(expression, ''), '\s+', '', 'g') = 'sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft)'
    OR regexp_replace(coalesce(expression, ''), '\s+', '', 'g') = 'sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft)*base_price'
  );
