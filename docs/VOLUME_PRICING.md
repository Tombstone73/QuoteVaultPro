# Volume Pricing for Nesting Calculator

This document explains how to configure volume pricing tiers for products using the nesting calculator.

## Features

### 1. Minimum Price Per Item
Set a minimum price threshold for each piece to ensure profitability on small orders.

**Configuration:**
- Go to Admin Settings → Products
- Edit a product with Nesting Calculator enabled
- Set "Minimum Price Per Item" field
- Example: `10.00` ensures no piece is priced below $10

### 2. Volume Pricing Tiers
Automatically reduce the price per sheet as the order quantity increases.

**How it works:**
- The system calculates how many sheets are needed for the order
- It finds the applicable pricing tier based on sheet count
- The adjusted sheet price is used to calculate the final price per piece

## Setting Up Volume Pricing Tiers

Volume pricing tiers are stored in the `nesting_volume_pricing` JSONB column in the `products` table.

### Example SQL

```sql
-- Example: Foam Board with volume pricing
UPDATE products 
SET nesting_volume_pricing = '{
  "enabled": true,
  "tiers": [
    {
      "minSheets": 1,
      "maxSheets": 4,
      "pricePerSheet": 18.00
    },
    {
      "minSheets": 5,
      "maxSheets": 9,
      "pricePerSheet": 16.00
    },
    {
      "minSheets": 10,
      "pricePerSheet": 14.00
    }
  ]
}'::jsonb
WHERE name = 'Foam Board';
```

### Tier Structure

Each tier has:
- `minSheets` (required): Minimum number of sheets for this tier
- `maxSheets` (optional): Maximum number of sheets (omit for "and above")
- `pricePerSheet` (required): Price per sheet at this tier

### Example Scenarios

**Scenario 1: Small Order (2 sheets needed)**
- Tier: 1-4 sheets @ $18/sheet
- Result: $18/sheet pricing applied

**Scenario 2: Medium Order (7 sheets needed)**
- Tier: 5-9 sheets @ $16/sheet
- Result: $16/sheet pricing applied (saves $2/sheet)

**Scenario 3: Large Order (15 sheets needed)**
- Tier: 10+ sheets @ $14/sheet
- Result: $14/sheet pricing applied (saves $4/sheet)

## Combined with Minimum Price

When both minimum price and volume pricing are enabled:

1. Volume pricing adjusts the sheet cost based on quantity
2. Price per piece is calculated: `(adjusted sheet cost) / (pieces per sheet)`
3. If result is below minimum price, minimum price is applied

**Example:**
- Sheet: 48×96, costs $18 (volume tier applied)
- Pieces: 24×36, fits 5 per sheet
- Calculated price: $18 / 5 = $3.60 per piece
- Minimum price: $10.00
- **Final price: $10.00 per piece** (minimum applied)

## Testing

1. Set up a product with nesting calculator
2. Configure minimum price (e.g., $10)
3. Add volume pricing tiers via SQL
4. Test with different quantities to see pricing changes
5. Check console logs for pricing calculations

## Future Enhancements

- UI for managing volume pricing tiers in admin panel
- Preview of pricing tiers before saving
- Import/export tier configurations
- Copy tiers between products

