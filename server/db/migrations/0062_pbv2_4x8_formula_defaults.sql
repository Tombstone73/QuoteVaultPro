-- Migration 0062: repair PBV2 4x8 sheet-yield formula defaults.
-- Some environments already had the final-dollar formula expression but still
-- carried stale test defaults such as minimum_billable_sqft=3. The formula
-- library defaults are the source of truth for Product Editor preview and
-- quote/order pricing when the product does not intentionally override them.

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
WHERE upper(coalesce(code, '')) = '4X8_WITH_WASTE_CALCULATION';
