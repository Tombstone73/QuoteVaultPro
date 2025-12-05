# Quote & Order Snapshot Enhancement - Phase 1 Complete

## What Was Implemented

### 1. Schema Enhancements (`shared/schema.ts`)

#### Quotes Table - New Fields (26 total)
- **Status Management**: `status` field with enum validation (draft, pending, accepted, rejected, canceled, expired)
- **Customer Snapshot** (10 fields): 
  - `billToName`, `billToCompany`, `billToAddress1`, `billToAddress2`
  - `billToCity`, `billToState`, `billToPostalCode`, `billToCountry`
  - `billToPhone`, `billToEmail`
- **Shipping Snapshot** (15 fields):
  - `shippingMethod` (pickup, ship, deliver)
  - `shippingMode` (single_shipment, multi_shipment)
  - `shipToName`, `shipToCompany`, `shipToAddress1`, `shipToAddress2`
  - `shipToCity`, `shipToState`, `shipToPostalCode`, `shipToCountry`
  - `shipToPhone`, `shipToEmail`
  - `carrier`, `carrierAccountNumber`, `shippingInstructions`
- **Dates**: `requestedDueDate`, `validUntil`
- **Linking**: `convertedToOrderId` (references orders.id)

#### Orders Table - New Fields (28 total)
- **Customer Snapshot** (10 fields): Same as quotes (billTo* fields)
- **Shipping Snapshot** (17 fields): Same as quotes PLUS:
  - `trackingNumber`
  - `shippedAt` (timestamp)
- **Dates**: `requestedDueDate`, `productionDueDate`
- **Shipping Method/Mode**: `shippingMethod`, `shippingMode` (same enums as quotes)

### 2. Zod Validation Schemas

Updated schemas to validate new fields:
- `insertQuoteSchema`: Validates status, shippingMethod, shippingMode enums + date fields
- `updateQuoteSchema`: Uses `.partial()` so inherits all new fields
- `insertOrderSchema`: Validates status (updated to 6 standardized values), shippingMethod, shippingMode, date fields
- `updateOrderSchema`: Uses `.partial()` so inherits all new fields

**Status Enum Changes**:
- **Quotes**: draft, pending, accepted, rejected, canceled, expired (6 statuses)
- **Orders**: new, in_production, on_hold, ready_for_shipment, completed, canceled (6 statuses)
  - Removed: scheduled, ready_for_pickup, shipped
  - Mapped: shipped → ready_for_shipment, scheduled → in_production

### 3. Database Migration

Applied via `npm run db:push` (Drizzle schema push to Neon PostgreSQL)

**Verified Columns** (all successfully added):

Quotes table:
```
status, bill_to_name, bill_to_company, bill_to_address1, bill_to_address2,
bill_to_city, bill_to_state, bill_to_postal_code, bill_to_country,
bill_to_phone, bill_to_email, shipping_method, shipping_mode,
ship_to_name, ship_to_company, ship_to_address1, ship_to_address2,
ship_to_city, ship_to_state, ship_to_postal_code, ship_to_country,
ship_to_phone, ship_to_email, carrier, carrier_account_number,
shipping_instructions, requested_due_date, valid_until, converted_to_order_id
```

Orders table:
```
bill_to_name, bill_to_company, bill_to_address1, bill_to_address2,
bill_to_city, bill_to_state, bill_to_postal_code, bill_to_country,
bill_to_phone, bill_to_email, shipping_method, shipping_mode,
ship_to_name, ship_to_company, ship_to_address1, ship_to_address2,
ship_to_city, ship_to_state, ship_to_postal_code, ship_to_country,
ship_to_phone, ship_to_email, carrier, carrier_account_number,
shipping_instructions, tracking_number, shipped_at,
requested_due_date, production_due_date
```

## Next Steps (Phase 2 - Backend Logic)

### 1. Quote Creation/Update - Snapshot Population
**File**: `server/routes.ts` (quotes endpoints)
**Task**: When quote is created/updated with `customerId`:
1. Fetch customer record + linked contact (if contactId provided)
2. Populate `billTo*` fields from customer billing data
3. Populate `shipTo*` fields based on shippingMethod:
   - If "pickup" → copy billTo* to shipTo*
   - If "ship"/"deliver" → use customer shipping address or allow custom

**Example Logic**:
```typescript
// POST /api/quotes
router.post('/api/quotes', isAuthenticated, tenantContext, async (req, res) => {
  const { customerId, contactId, shippingMethod, ...quoteData } = req.body;
  
  // Fetch customer
  const customer = await db.query.customers.findFirst({
    where: and(
      eq(customers.id, customerId),
      eq(customers.organizationId, req.organizationId)
    )
  });
  
  // Snapshot customer data
  const snapshotData = {
    billToName: customer.companyName,
    billToAddress1: customer.billingStreet1 || customer.billingAddress,
    billToCity: customer.billingCity,
    billToState: customer.billingState,
    billToPostalCode: customer.billingPostalCode,
    billToCountry: customer.billingCountry || 'US',
    billToPhone: customer.phone,
    billToEmail: customer.email,
    
    // Shipping defaults
    shippingMethod: shippingMethod || 'ship',
    shipToName: shippingMethod === 'pickup' ? customer.companyName : customer.companyName,
    shipToAddress1: shippingMethod === 'pickup' ? customer.billingStreet1 : customer.shippingStreet1,
    // ... etc
  };
  
  const newQuote = await db.insert(quotes).values({
    ...quoteData,
    ...snapshotData,
    customerId,
    contactId,
    organizationId: req.organizationId,
    status: 'pending'
  });
});
```

### 2. Order Creation/Update - Snapshot Population
**File**: `server/routes.ts` (orders endpoints)
**Task**: Same as quotes - snapshot customer/shipping data on create/update

### 3. Quote-to-Order Conversion Endpoint
**File**: `server/routes.ts`
**Route**: `POST /api/quotes/:id/convert-to-order`
**Logic**:
1. Fetch quote + line items
2. Generate new orderNumber from globalVariables
3. Copy all snapshot fields (billTo*, shipTo*, shippingMethod, etc.)
4. Clone quoteLineItems → orderLineItems
5. Link: `orders.quoteId = quote.id`, `quotes.convertedToOrderId = order.id`
6. Update quote status to "accepted"

**Example**:
```typescript
router.post('/api/quotes/:id/convert-to-order', isAuthenticated, tenantContext, async (req, res) => {
  const quote = await db.query.quotes.findFirst({
    where: and(eq(quotes.id, req.params.id), eq(quotes.organizationId, req.organizationId)),
    with: { lineItems: true }
  });
  
  if (quote.convertedToOrderId) {
    return res.status(400).json({ error: 'Quote already converted to order' });
  }
  
  // Generate order number
  const globalVar = await db.query.globalVariables.findFirst({
    where: eq(globalVariables.key, 'orderNumber')
  });
  const orderNumber = `ORD-${String(globalVar.value + 1).padStart(5, '0')}`;
  
  // Create order with snapshot data
  const [newOrder] = await db.insert(orders).values({
    orderNumber,
    quoteId: quote.id,
    customerId: quote.customerId,
    contactId: quote.contactId,
    organizationId: req.organizationId,
    
    // Copy financial data
    subtotal: quote.subtotal,
    taxRate: quote.taxRate,
    taxAmount: quote.taxAmount,
    taxableSubtotal: quote.taxableSubtotal,
    total: quote.totalPrice,
    discount: quote.discountAmount,
    
    // Copy snapshot fields
    billToName: quote.billToName,
    billToCompany: quote.billToCompany,
    // ... all billTo* fields
    
    shippingMethod: quote.shippingMethod,
    shippingMode: quote.shippingMode,
    shipToName: quote.shipToName,
    // ... all shipTo* fields
    
    requestedDueDate: quote.requestedDueDate,
    status: 'new',
    createdByUserId: getUserId(req.user)
  }).returning();
  
  // Clone line items
  for (const lineItem of quote.lineItems) {
    await db.insert(orderLineItems).values({
      orderId: newOrder.id,
      quoteLineItemId: lineItem.id,
      // ... copy all line item fields
    });
  }
  
  // Update quote with link
  await db.update(quotes)
    .set({ convertedToOrderId: newOrder.id })
    .where(eq(quotes.id, quote.id));
  
  // Increment order number
  await db.update(globalVariables)
    .set({ value: globalVar.value + 1 })
    .where(eq(globalVariables.key, 'orderNumber'));
  
  return res.json({ success: true, order: newOrder });
});
```

### 4. UI Updates (Minimal)
**Files**:
- `client/src/pages/QuoteDetail.tsx` - Display billTo/shipTo snapshots instead of live customer data
- `client/src/pages/OrderDetail.tsx` - Display billTo/shipTo snapshots
- Add "Convert to Order" button on quote detail page

**Pattern**:
```tsx
// Quote detail - billing section
<Card>
  <CardHeader><CardTitle>Bill To</CardTitle></CardHeader>
  <CardContent>
    {quote.billToName && (
      <>
        <p className="font-medium">{quote.billToName}</p>
        {quote.billToCompany && <p>{quote.billToCompany}</p>}
        <p>{quote.billToAddress1}</p>
        {quote.billToAddress2 && <p>{quote.billToAddress2}</p>}
        <p>{quote.billToCity}, {quote.billToState} {quote.billToPostalCode}</p>
      </>
    )}
  </CardContent>
</Card>

// Convert button
{quote.status !== 'canceled' && !quote.convertedToOrderId && (
  <Button onClick={handleConvertToOrder}>
    Convert to Order
  </Button>
)}
```

## Testing Checklist

- [ ] Create new quote → verify billTo/shipTo fields populated from customer
- [ ] Update quote customer → verify snapshots update
- [ ] Convert quote to order → verify all snapshot fields copied
- [ ] Check orderNumber auto-increment works
- [ ] Verify order status defaults to "new"
- [ ] Verify quote status can be set to "draft", "pending", "accepted"
- [ ] Test backward compatibility (existing quotes/orders still work)
- [ ] Verify multi-tenancy (organizationId filtering)

## Database State

All new columns are **nullable** for backward compatibility.
Existing quotes/orders will have NULL values in snapshot fields until updated.
New quotes/orders will populate snapshots automatically once backend logic is implemented.

## Files Modified

1. `shared/schema.ts` - Extended quotes and orders tables, updated Zod schemas
2. `server/db/migrations/0014_add_quote_order_snapshots.sql` - Migration file (for documentation)
3. Database schema applied via `npm run db:push`

## Migration Status

✅ Schema updated in codebase
✅ Database schema applied to Neon PostgreSQL
✅ All 54 new columns verified in database
⏳ Backend snapshot logic - PENDING
⏳ Conversion endpoint - PENDING
⏳ UI updates - PENDING
