## Vendor & Purchase Order Module (MVP)

### Backend Summary
- Added tables: `vendors`, `purchase_orders`, `purchase_order_line_items` with migration `0009_vendors_purchase_orders.sql`.
- Extended `materials` table with: `preferred_vendor_id`, `vendor_sku`, `vendor_cost_per_unit`.
- Implemented storage methods for vendor CRUD (soft delete if referenced) and purchase order lifecycle (create, update, send, receive, delete). Inventory receipt uses `purchase_receipt` adjustment type.
- API routes added under `/api/vendors` and `/api/purchase-orders` with RBAC (admin/owner) and audit logging.

### Frontend Summary
- Hooks: `useVendors.ts`, `usePurchaseOrders.ts` for list/detail + mutations (create/update/delete/send/receive).
- Components: `VendorForm`, `PurchaseOrderForm`, `ReceivePurchaseOrderItemsForm`.
- Pages: `vendors.tsx`, `vendor-detail.tsx`, `purchase-orders.tsx`, `purchase-order-detail.tsx`.
- Material form extended with vendor selection and vendor cost fields.
- Navigation: Added routes in `App.tsx` and quick link cards in `admin-dashboard.tsx`.

### Manual Testing Checklist
1. Vendors
  - Create vendor (required name, default terms) ➜ appears in list.
  - Edit vendor (change payment terms, deactivate) ➜ status updates.
  - Delete vendor with no POs ➜ vendor removed from list.
  - Delete vendor with existing PO ➜ vendor becomes inactive, remains referenced.
2. Materials
  - Open material create dialog ➜ vendor select shows active vendors.
  - Save material with preferred vendor, vendor SKU & cost ➜ detail view persists values.
3. Purchase Order Creation
  - Create PO with ≥1 line item ➜ PO number auto-generated; totals computed.
  - Line item unit cost * qty equals line total; grand total = subtotal (MVP no tax/shipping).
4. PO Update
  - Edit draft PO (change expected date, add/remove line items) ➜ totals recompute.
  - Attempt to edit received PO ➜ error displayed.
5. Send PO
  - Send draft PO ➜ status moves to `sent`; audit log entry created.
6. Receive Items
  - Receive subset of line items ➜ status becomes `partially_received`; inventory increases by received qty; material vendorCostPerUnit updates.
  - Receive remaining ➜ status becomes `received`; received date populated.
  - Attempt over-receive (qty > remaining) ➜ error.
7. Delete Draft PO
  - Delete draft with no received qty ➜ removed.
  - Attempt delete draft with any received qty ➜ error.
8. Filters
  - PO list filters by status/vendor/search working.
  - Vendor search filters list by name/email/phone.
9. Edge Cases
  - Create PO with material-less line item ➜ allowed.
  - Receive PO with no material IDs ➜ inventory unchanged.
10. RBAC
  - Non-admin user attempts vendor/PO mutation ➜ 403.
11. Audit Logs (if viewing audit log page as Owner)
  - Entries for CREATE / UPDATE / SEND / RECEIVE / DELETE actions show entity names.

### Suggested Future Enhancements
- Email/send integration for POs (PDF attachment).
- Tax/shipping calculation inputs.
- Vendor performance metrics (lead time variance, fill rate).
- Bulk receive with CSV import.
- Multi-vendor material sourcing analytics.

# Production Board Updates

## Changes Needed

### 1. Backend: Update getJobs() in server/storage.ts (line 2411)

Replace the enrichment logic to include customer and product details:

```typescript
const enriched = await Promise.all(records.map(async (j) => {
  const orderRecord = j.orderId ? await db.query.orders.findFirst({
    where: eq(orders.id, j.orderId),
    with: { customer: true },
  }) : undefined;
  const lineItemRecord = j.orderLineItemId ? await db.query.orderLineItems.findFirst({
    where: eq(orderLineItems.id, j.orderLineItemId),
    with: {
      product: true,
      productVariant: true,
    },
  }) : undefined;
  return {
    ...j,
    order: orderRecord || null,
    orderLineItem: lineItemRecord || null,
    customerName: orderRecord?.customer?.companyName || 'Unknown',
    orderNumber: orderRecord?.orderNumber || null,
    dueDate: orderRecord?.dueDate || null,
    quantity: lineItemRecord?.quantity || 0,
    mediaType: lineItemRecord?.productVariant?.name || lineItemRecord?.product?.name || 'Unknown',
  } as any;
}));
```

### 2. Frontend: Update Job Cards in client/src/pages/production.tsx (around line 88-114)

Replace the Card content to show proper information:

```tsx
<CardHeader className="p-3">
  <CardTitle className="text-sm flex flex-col gap-1">
    <div className="flex justify-between items-start">
      <span className="font-semibold truncate" title={job.customerName}>{job.customerName}</span>
      {job.priority === 'rush' && <Badge variant="destructive" className="text-[10px] px-1 py-0">RUSH</Badge>}
    </div>
    {job.orderNumber && (
      <span className="text-xs text-muted-foreground">{job.orderNumber}</span>
    )}
    <div className="text-xs font-medium">
      {job.mediaType}
      {job.quantity > 0 && <span className="text-muted-foreground"> × {job.quantity}</span>}
    </div>
    {job.dueDate && (
      <span className="text-xs text-muted-foreground">Due: {new Date(job.dueDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })}</span>
    )}
    {job.assignedToUserId && (
      <Badge variant="secondary" className="w-fit text-[10px]">Assigned</Badge>
    )}
  </CardTitle>
</CardHeader>
```

### 3. Add Production Button in client/src/pages/home.tsx

#### Step 1: Add Factory icon import (line 11)
```typescript
import { Calculator, FileText, LogOut, Settings, User, Eye, Users, Shield, Crown, Package, UserCircle, ShoppingCart, Factory } from "lucide-react";
```

#### Step 2: Add production handler (around line 67)
```typescript
} else if (value === "production") {
  navigate("/production");
} else {
```

#### Step 3: Add Production button in header (around line 115)
```tsx
<div className="flex items-center gap-4">
  {showAdminFeatures && (
    <Button 
      onClick={() => navigate("/production")}
      variant="default"
      size="sm"
      data-testid="button-production"
    >
      <Factory className="h-4 w-4 mr-2" />
      Production
    </Button>
  )}
  {isAdmin && (
    // ... existing view toggle code ...
```

## Testing

After making these changes:
1. Refresh the browser
2. Look for "Production" button in header (admin users only)
3. Click it to navigate to production board
4. Verify job cards show:
   - Customer name (bold at top)
   - Order number (e.g., "ORD-00006")
   - Media type + quantity (e.g., "24x36 Vinyl × 50")
   - Due date (e.g., "Due: 11/23/2025")
   - RUSH badge if applicable
