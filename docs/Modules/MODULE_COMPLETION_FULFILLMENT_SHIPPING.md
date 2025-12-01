# TITAN KERNEL Module Completion Document — Fulfillment & Shipping

## Module Purpose
- Manage shipments for orders, generate packing slips, send tracking notifications, and update order fulfillment status.
- Provide basic post-production logistics visibility.

## Data Model Summary
- **Tables:**
  - `shipments`: id, `orderId`, `carrier`, `trackingNumber`, `shippedAt`, `deliveredAt?`, `notes?`, sync fields, timestamps.
- **Relationships:**
  - `shipments.orderId -> orders.id` (CASCADE)
- **Order Fields:**
  - `orders.fulfillmentStatus` updated (`pending`, `packed`, `shipped`, `delivered`).

## Backend Summary
- **Schemas:** `shared/schema.ts` defines shipments and Zod insert/update schemas.
- **Storage/Services:** `server/storage.ts`
  - Shipments: `getShipmentsByOrder`, `getShipmentById`, `createShipment` (auto order status → shipped if first), `updateShipment` (auto → delivered when `deliveredAt` set), `deleteShipment`.
- **Fulfillment Service:** `server/fulfillmentService.ts`
  - `generatePackingSlipHTML(orderId)`: builds and stores HTML slip on order.
  - `sendShipmentEmail(orderId, shipmentId, subject?, customMessage?)`: composes and sends tracking email via `emailService`.
  - `updateOrderFulfillmentStatus(orderId, status)` manual override.
- **Business Rules:**
  - First shipment sets order `fulfillmentStatus` to `shipped`; delivered date update sets `delivered`.
  - Tracking link generator supports UPS/FedEx/USPS/DHL.

## API Summary
- **Routes:** `server/routes.ts`
  - GET `/api/orders/:id/shipments` list.
  - POST `/api/orders/:id/shipments` create; optional email notification.
  - PATCH `/api/shipments/:id` update; auto `delivered` when `deliveredAt` present.
  - DELETE `/api/shipments/:id` delete (admin/owner only).
  - POST `/api/orders/:id/packing-slip` generate slip HTML.
  - POST `/api/orders/:id/send-shipping-email` send tracking email.
  - PATCH `/api/orders/:id/fulfillment-status` manual override (manager+).
- **Validation:** Zod `insertShipmentSchema`, `updateShipmentSchema`.
- **Responses:** `{ success: true, data }` or `{ error: '...' }`.

## Frontend Summary
- **Pages/Interactions:**
  - Orders UI integrates shipment actions (create shipment, send email, view packing slip) via buttons and forms.
  - Status reflects shipped/delivered transitions.

## Workflows
- **Create Shipment:** Staff creates shipment; order status becomes `shipped` if first; optional email sent.
- **Update Shipment:** Set `deliveredAt`; order status becomes `delivered`.
- **Packing Slip:** Generate and store HTML; printable for warehouse.
- **Notification:** Send tracking email with provider link.

## RBAC Rules
- Auth required for all endpoints.
- Create/update shipment: staff (`owner|admin|manager|employee`).
- Delete shipment: `owner|admin`.
- Manual fulfillment status override: `owner|admin|manager`.

## Integration Points
- **Orders:** Fulfillment status updates and packing slip storage.
- **Email:** Customer shipment notifications.
- **Carriers:** Tracking link generation.

## Known Gaps / TODOs
- Carrier API integrations (label purchase, rate shopping).
- Webhooks for delivery confirmation.
- Packing slip templating and PDF export.
- Shipment batching and partial shipments per item.

## Test Plan
- Create shipment; verify status `shipped` and record appears.
- Update shipment with `deliveredAt`; verify status `delivered`.
- Generate packing slip; verify HTML saved to order and returned.
- Send shipping email; verify mail sent and link present when tracking provided.
- Delete shipment as admin; verify removal.

## Files Added/Modified
- `shared/schema.ts`: shipments schema.
- `server/storage.ts`: shipment CRUD and order status updates.
- `server/fulfillmentService.ts`: packing slip generation, email sending, status override.
- `server/routes.ts`: shipments & fulfillment endpoints.

## Next Suggested Kernel Phase
- Add carrier integrations (ShipEngine/EasyPost), automated labels, and shipment consolidation; implement PDF packing slips and customer-facing tracking page.
