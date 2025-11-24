# Customer Portal MVP - Testing Guide

## Pre-deployment Checklist

### 1. Database Migration
```bash
# Apply migration to add new tables
npm run db:push

# Or manually run migration file:
# server/db/migrations/0005_customer_portal_mvp.sql
```

### 2. Build & Start
```bash
npm run build
npm start
```

## Manual Testing Scenarios

### A. Customer Portal - Quote Browsing

**Test as Customer User (viewMode = "customer")**

1. **Navigate to Portal**
   - Login as customer user
   - Toggle view mode to "Customer" if needed
   - Click "My Quotes" tab in navigation
   - Should redirect to `/portal/my-quotes`

2. **View Quote List**
   - Should see all quotes where `customerId` matches logged-in user's linked customer
   - Each quote card displays:
     - Quote number
     - Total price
     - Status badge (Draft/Sent/Approved/Rejected)
     - Created date
     - "Proceed to Order" button (only if status = 'approved' or 'sent')

3. **Empty State**
   - If no quotes exist, should see "No quotes found" message

### B. Customer Portal - Quote Checkout

**Prerequisites:** At least one approved/sent quote exists

1. **Navigate to Checkout**
   - From My Quotes, click "Proceed to Order" on any approved quote
   - Should navigate to `/portal/quotes/:id/checkout`

2. **Quote Details Display**
   - Quote number, total, status shown correctly
   - Line items listed with descriptions and prices

3. **Order Form Fields**
   - **Priority**: Dropdown with Normal/Rush/Emergency
   - **Due Date**: Date picker (should default to reasonable future date)
   - **Customer Notes**: Textarea for special instructions
   - **File Upload**: Drag-drop zone for attachments

4. **File Upload Flow**
   - Drag file or click to browse
   - Should show upload progress
   - On success, file name appears in list
   - Can upload multiple files
   - Test with various file types (PDF, PNG, JPG, ZIP)

5. **Submit Order**
   - Click "Submit Order" button
   - Backend creates order record
   - Backend creates order audit log entry ("order_created")
   - Backend attaches uploaded files to order
   - Backend creates quote workflow state ("customer_approved")
   - Should redirect to `/portal/my-orders` on success
   - Toast notification confirms order creation

### C. Customer Portal - Order Browsing

1. **Navigate to My Orders**
   - Click "My Orders" tab
   - Should navigate to `/portal/my-orders`

2. **View Order List**
   - Should see all orders where linked customer matches
   - Each order card displays:
     - Order number
     - Quote reference (if applicable)
     - Status badge (New/Scheduled/In Production/Ready/Completed)
     - Priority badge
     - Due date
     - Total price

3. **Status Badges**
   - New: Blue
   - Scheduled: Purple
   - In Production: Yellow
   - Ready for Pickup: Green
   - Completed: Gray
   - Cancelled: Red

### D. Staff Quote Workflow (Admin/Manager)

**Test as Admin/Manager User**

1. **View Quote Workflow State**
   - GET `/api/quotes/:id/workflow`
   - Should return workflow state if exists
   - Should return 404 if no workflow exists

2. **Request Changes from Customer**
   - POST `/api/quotes/:id/request-changes`
   - Body: `{ note: "Please confirm quantities" }`
   - Creates audit log entry
   - Updates workflow state
   - Should send email to customer (if email configured)

3. **Approve Quote**
   - POST `/api/quotes/:id/approve`
   - Body: `{ note: "Approved for production" }`
   - Updates quote status to 'approved'
   - Creates audit log
   - Updates workflow state

4. **Reject Quote**
   - POST `/api/quotes/:id/reject`
   - Body: `{ reason: "Out of scope" }`
   - Updates quote status to 'rejected'
   - Creates audit log
   - Updates workflow state

### E. Order Audit Trail

1. **View Order Audit Log**
   - GET `/api/orders/:id/audit`
   - Should return all audit entries for order
   - Ordered by created_at DESC
   - Each entry has: action_type, user_name, note, timestamps

2. **View Order Files**
   - GET `/api/orders/:id/files`
   - Should return all attachments for order
   - Each file has: file_name, file_url, file_size, mime_type, uploaded_by_name

3. **Upload File to Order**
   - POST `/api/orders/:id/files`
   - Body: `{ fileName, fileUrl, fileSize, mimeType, description? }`
   - Creates new attachment record
   - Returns created attachment

### F. CustomerSelect Component Enhancements

**Already Implemented - Verify:**

1. **Search by Customer Name**
   - Type "Acme" in CustomerSelect
   - Should show all customers with "Acme" in companyName

2. **Search by Contact Name**
   - Type "John" in CustomerSelect
   - Should show customers that have contact with firstName="John"
   - Contact should appear indented under customer
   - Clicking contact selects both customer AND auto-populates contact

3. **Auto-populate Primary Contact**
   - Select a customer with multiple contacts
   - onChange callback receives customer object AND contactId
   - If customer has isPrimary=true contact, that ID should be returned
   - If no primary, first contact ID should be returned

4. **Edge Case - "bubu" Contact**
   - Create test contact with name "bubu"
   - Search for "bubu" in CustomerSelect
   - Should appear in results (verifies contact search working)

## API Endpoint Testing (via curl/Postman)

### Portal Endpoints

```bash
# Get my quotes (as customer)
curl -X GET http://localhost:5000/api/portal/my-quotes \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"

# Get my orders (as customer)
curl -X GET http://localhost:5000/api/portal/my-orders \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"

# Convert quote to order
curl -X POST http://localhost:5000/api/portal/convert-quote/QUOTE_ID \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -d '{
    "priority": "normal",
    "dueDate": "2024-03-01",
    "customerNotes": "Please use red ink"
  }'
```

### Quote Workflow Endpoints

```bash
# Get workflow state
curl -X GET http://localhost:5000/api/quotes/QUOTE_ID/workflow \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"

# Request changes
curl -X POST http://localhost:5000/api/quotes/QUOTE_ID/request-changes \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -d '{ "note": "Please confirm quantities" }'

# Approve quote
curl -X POST http://localhost:5000/api/quotes/QUOTE_ID/approve \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -d '{ "note": "Looks good!" }'

# Reject quote
curl -X POST http://localhost:5000/api/quotes/QUOTE_ID/reject \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -d '{ "reason": "Budget constraints" }'
```

### Order Audit & Files Endpoints

```bash
# Get order audit log
curl -X GET http://localhost:5000/api/orders/ORDER_ID/audit \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"

# Get order files
curl -X GET http://localhost:5000/api/orders/ORDER_ID/files \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"

# Upload file to order
curl -X POST http://localhost:5000/api/orders/ORDER_ID/files \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -d '{
    "fileName": "artwork.pdf",
    "fileUrl": "https://storage.googleapis.com/bucket/file.pdf",
    "fileSize": 102400,
    "mimeType": "application/pdf",
    "description": "Final artwork"
  }'
```

## Known Limitations & Future Enhancements

1. **Email Notifications**: Not implemented yet
   - Add email on quote status changes
   - Add email on order creation/updates

2. **Rate Limiting**: Not implemented yet
   - Consider adding rate limiting to portal endpoints
   - Suggested: express-rate-limit with 100 requests/15 minutes

3. **File Upload Validation**
   - Frontend validates file size (10MB max)
   - Backend should validate mime types
   - Consider virus scanning for production

4. **Real-time Updates**
   - Consider WebSocket for order status updates
   - Push notifications for quote approvals

5. **Permissions**
   - Portal endpoints check isAuthenticated only
   - Should verify user's customerId matches quote/order customerId
   - Add row-level security in future iterations

## Success Criteria

✅ Customer users can view their quotes via portal
✅ Customer users can convert approved quotes to orders
✅ Customer users can upload files during checkout
✅ Customer users can view their orders with status badges
✅ Staff can manage quote workflow (request changes/approve/reject)
✅ All order state changes are audit logged
✅ Files are attached to orders correctly
✅ CustomerSelect searches customers AND contacts
✅ CustomerSelect auto-populates primary contact
✅ Navigation shows portal links for customer view mode
✅ All routes protected by authentication
✅ No TypeScript/lint errors

## Rollback Plan

If issues arise in production:

```bash
# Revert database migration
# Manually drop tables:
DROP TABLE IF EXISTS quote_workflow_states;
DROP TABLE IF EXISTS order_attachments;
DROP TABLE IF EXISTS order_audit_log;

# Revert code changes
git revert HEAD
npm run build
npm start
```
