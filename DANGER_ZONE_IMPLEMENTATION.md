# Danger Zone Implementation - Settings Admin Tools Page

## Overview
Extended the Settings → Admin Tools page with a fully functional "Danger Zone" section containing three destructive organization management actions with comprehensive confirmation flows.

## Implementation Details

### 1. Reusable Confirmation Modal Component
**File**: `client/src/components/DestructiveActionModal.tsx`

**Features**:
- Dual verification system:
  - User must type exact organization slug
  - User must check "I understand this action cannot be undone" checkbox
- Confirm button disabled until both verifications complete
- Loading state during submission
- Red destructive styling with warning icon
- Graceful close with state reset

**Props**:
- `open`, `onOpenChange`: Dialog state management
- `title`, `description`: Modal content
- `confirmationSlug`: Organization slug for verification
- `confirmButtonText`: Customizable confirm button text
- `onConfirm`: Async callback for action execution

### 2. Admin Tools Page Updates
**File**: `client/src/pages/settings/admin-tools.tsx`

**New Imports**:
- `useState` for modal state management
- `useQuery`, `useMutation`, `useQueryClient` for API calls
- `AlertTriangle`, `Trash2`, `Ban` icons from lucide-react
- `DestructiveActionModal` component
- `useToast` hook for notifications

**New State**:
- `organization` query: Fetches current org details (id, slug, name)
- `resetModalOpen`, `disableModalOpen`, `deleteModalOpen`: Modal visibility states
- Three mutations: `resetMutation`, `disableMutation`, `deleteMutation`

**Danger Zone Section Structure**:
```
┌─ Danger Zone (red-themed card) ─────────────────────────┐
│ AlertTriangle icon + "Danger Zone" heading (red)        │
│ "Irreversible administrative actions. Proceed..."        │
├──────────────────────────────────────────────────────────┤
│ ┌─ Reset Organization Data ────────────────────┐        │
│ │ Description + "Reset Data" button             │        │
│ └───────────────────────────────────────────────┘        │
│ ┌─ Disable Organization ───────────────────────┐        │
│ │ Description + "Disable" button (Ban icon)     │        │
│ └───────────────────────────────────────────────┘        │
│ ┌─ Delete Organization (stronger red styling) ┐        │
│ │ Description + "Delete" button (Trash2 icon)   │        │
│ └───────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

**Action Behaviors**:

1. **Reset Organization Data**:
   - POST `/api/admin/org/reset`
   - Toast: "Organization reset initiated"
   - Invalidates all queries to refresh data
   - Error handling with destructive toast

2. **Disable Organization**:
   - POST `/api/admin/org/disable`
   - Toast: "Organization disabled"
   - Invalidates all queries
   - Error handling with destructive toast

3. **Delete Organization**:
   - DELETE `/api/admin/org`
   - Toast: "Organization deleted"
   - Redirects to `/login` after 2 seconds
   - Error handling with destructive toast

**Button States**:
- All action buttons disabled when organization is loading or not available
- Buttons show loading state during mutation execution

### 3. Backend Route Stubs
**File**: `server/routes.ts`

**Added Three Routes** (after product import/export section):

#### POST /api/admin/org/reset
- Middleware: `isAuthenticated`, `tenantContext`, `requireOrgOwnerAdmin`
- Audit log: `org.reset.requested`
- Returns: `501 Not Implemented` with clear message

#### POST /api/admin/org/disable
- Middleware: `isAuthenticated`, `tenantContext`, `requireOrgOwnerAdmin`
- Audit log: `org.disable.requested`
- Returns: `501 Not Implemented` with clear message

#### DELETE /api/admin/org
- Middleware: `isAuthenticated`, `tenantContext`, `requireOrgOwnerAdmin`
- Audit log: `org.delete.requested`
- Returns: `501 Not Implemented` with clear message

**Audit Logging**:
All three routes log to `auditLogs` table before returning 501:
```typescript
await db.insert(auditLogs).values({
  organizationId,
  userId,
  actionType: "org.{reset|disable|delete}.requested",
  entityType: "organization",
  entityId: organizationId,
  description: "...",
  newValues: {},
});
```

**Error Handling**:
- 401 if user ID not found
- 500 for unexpected errors
- 501 for not-yet-implemented functionality

## Security & Access Control
- All routes require authentication (`isAuthenticated`)
- All routes require org context (`tenantContext`)
- All routes require owner or admin role (`requireOrgOwnerAdmin`)
- Confirmation modal requires exact slug match + checkbox confirmation
- All actions logged to audit trail before execution

## User Experience
1. **Discovery**: Danger Zone prominently styled with red accents at bottom of Admin Tools page
2. **Initiation**: User clicks destructive action button
3. **Verification**: Modal opens requiring slug entry + checkbox
4. **Confirmation**: User types slug exactly and checks confirmation
5. **Execution**: User clicks confirm button (with loading state)
6. **Feedback**: Toast notification shows success or error
7. **Cleanup**: Modal closes automatically on success

## TypeScript Compilation
✅ **No errors** in new code
- Pre-existing errors in `server/routes/platform.ts` (unrelated)
- All new components compile cleanly

## Testing Checklist
- [ ] Navigate to `/settings/admin-tools` and verify Danger Zone section renders
- [ ] Verify red destructive styling on Danger Zone card and heading
- [ ] Click "Reset Data" → verify modal opens with org slug requirement
- [ ] Try confirming without typing slug → verify button disabled
- [ ] Try confirming without checking checkbox → verify button disabled
- [ ] Type wrong slug → verify button disabled
- [ ] Type correct slug + check checkbox → verify button enabled
- [ ] Click confirm → verify loading state, API call, toast notification
- [ ] Verify 501 response shows appropriate error message in toast
- [ ] Repeat for Disable and Delete actions
- [ ] Verify Delete action has stronger red styling than others
- [ ] Verify buttons disabled when org data is loading
- [ ] Verify audit logs created in database for each action attempt
- [ ] Verify only owner/admin users can access the page (inherited from SettingsLayout Guard)

## Future Implementation Notes
When implementing the actual functionality:

1. **Reset Organization**:
   - Delete from: orders, order_line_items, quotes, quote_line_items, jobs, job_files, invoices, shipments
   - Preserve: organizations, users, customers, products, materials, settings
   - Use transaction for atomicity
   - Consider background job for large datasets

2. **Disable Organization**:
   - Update `organizations.status = 'suspended'`
   - Modify auth middleware to block non-admin access to suspended orgs
   - Consider grace period before full lockout

3. **Delete Organization**:
   - CASCADE deletes via FK constraints should handle most cleanup
   - Explicitly delete from GCS: `uploads/org_<orgId>/*`, `thumbs/org_<orgId>/*`
   - Use transaction
   - Consider soft-delete pattern with `deleted_at` timestamp instead
   - Send confirmation email to org owner

## Files Changed
1. ✅ `client/src/components/DestructiveActionModal.tsx` (new)
2. ✅ `client/src/pages/settings/admin-tools.tsx` (extended)
3. ✅ `server/routes.ts` (added 3 stub routes with audit logging)

## Conclusion
The Danger Zone section provides a secure, user-friendly interface for critical organization management actions. The dual-verification modal prevents accidental executions, while audit logging ensures full traceability. Backend stubs are ready for future implementation with proper error handling and access control already in place.
