# Order Line Item Artwork Upload Implementation

## Overview
Added complete artwork upload functionality for order line items, matching the existing quote line item upload pattern. Orders now have parity with quotes for per-line-item artwork uploads with thumbnail generation.

## Changes Made

### Backend (server/routes.ts)

#### 1. GET /api/orders/:orderId/line-items/:lineItemId/files
- **Location**: Lines 7636-7686
- **Purpose**: Retrieve all files attached to a specific order line item
- **Features**:
  - Validates order belongs to organization (multi-tenant isolation)
  - Validates line item belongs to order
  - Returns legacy attachments with signed URLs
  - Returns linked assets from asset pipeline
  - Includes enriched thumbnail/preview URLs

#### 2. POST /api/orders/:orderId/line-items/:lineItemId/files
- **Location**: Lines 7693-7912
- **Purpose**: Upload files to order line items
- **Features**:
  - Creates orderAttachment record with orderLineItemId
  - Creates asset + asset_link with parent_type='order_line_item'
  - Supports Supabase, local, and GCS storage providers
  - Fire-and-forget thumbnail generation for images
  - Fire-and-forget PDF processing for PDFs/AI files
  - Fail-soft asset creation (errors logged but don't block response)
  - Multi-tenant isolation via order validation

### Frontend

#### 3. useOrderFiles.ts Hook Updates
- **File**: client/src/hooks/useOrderFiles.ts
- **New Hooks**:
  - `useOrderLineItemFiles(orderId, lineItemId)` - Fetch line item files
  - `useAttachFileToOrderLineItem(orderId, lineItemId)` - Upload to line item
  - `useDetachOrderLineItemFile(orderId, lineItemId)` - Delete from line item
- **Query Key Pattern**: `['/api/orders', orderId, 'line-items', lineItemId, 'files']`

#### 4. OrderLineItemsSection.tsx Updates
- **File**: client/src/components/orders/OrderLineItemsSection.tsx
- **Changes**:
  - Updated imports to include new hooks
  - Modified `OrderLineItemArtworkPanel` to use line-item-specific hooks
  - Changed from `useAttachFileToOrder` → `useAttachFileToOrderLineItem`
  - Changed from `useDetachOrderFile` → `useDetachOrderLineItemFile`
  - Upload button now calls correct endpoint per line item
  - Thumbnails render using existing `getThumbSrc` helper

#### 5. Order Attachments UI Verification
- **File**: client/src/pages/order-detail.tsx
- **Status**: Already set to `locked={false}` (line 2245)
- **Result**: Order-level attachments UI is NOT greyed out

## Database Schema
- **Table**: orderAttachments (already existed)
- **Key Column**: orderLineItemId (nullable foreign key to orderLineItems)
- **Asset Links**: parent_type='order_line_item', parent_id=lineItemId

## Multi-Tenant Isolation
✅ Order ownership validated via `tenantContext` middleware  
✅ Organization ID checked before querying order  
✅ Order → line item → attachment chain validated  
✅ Asset links scoped by organizationId

## TypeScript Validation
✅ All types compile cleanly  
✅ No TypeScript errors (npx tsc --noEmit passed)

## Testing Checklist

### Manual Tests (Ready)
- [ ] Upload PNG to order line item → verify asset created → wait for thumbnail worker → verify thumbnail displays
- [ ] Upload PDF to order line item → verify PDF processing → verify page-1 thumbnail
- [ ] Upload to order-level attachments → verify working (not greyed out)
- [ ] Delete line item file → verify removed from UI
- [ ] Multi-tenant: Create order in org A, attempt to access line item files from org B → verify 404

### Acceptance Criteria
✅ Backend endpoints created and compile  
✅ Frontend hooks created and wired  
✅ UI component updated to use new hooks  
✅ Thumbnails render using existing getThumbSrc helper  
✅ TypeScript compiles cleanly  
⏳ Manual upload test (ready for user)

## Files Modified
1. server/routes.ts (added 2 endpoints)
2. client/src/hooks/useOrderFiles.ts (added 3 hooks)
3. client/src/components/orders/OrderLineItemsSection.tsx (updated component to use new hooks)

## Implementation Pattern
Mirrored quote line item upload pattern:
- Quote: `/api/quotes/:quoteId/line-items/:lineItemId/files`
- Order: `/api/orders/:orderId/line-items/:lineItemId/files`
- Same asset pipeline, same thumbnail workers, same fail-soft pattern

## Next Steps
1. Start dev server: `npm run dev`
2. Navigate to an order with line items
3. Expand a line item
4. Click "Upload" button in Artwork section
5. Upload PNG/PDF
6. Wait ~10 seconds for thumbnail worker
7. Verify thumbnail appears
