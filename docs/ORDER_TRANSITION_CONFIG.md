# Configurable Order Transition Validation

## Overview

Order transition validation requirements (specifically `new` → `in_production`) are now configurable at the organization level. This allows flexibility for different workflows while maintaining safe defaults.

## Organization Preferences

Settings are stored in `organizations.settings.preferences.orders` JSONB field:

```typescript
{
  orders: {
    requireDueDateForProduction: boolean;        // Default: true
    requireBillingAddressForProduction: boolean;  // Default: true
    requireShippingAddressForProduction: boolean; // Default: false
  }
}
```

### Default Behavior (Strict)

With default settings (`true`/`true`/`false`), transitioning from `new` → `in_production` requires:

✅ **ALWAYS Required** (cannot be disabled):
- At least 1 line item

✅ **Required by Default** (configurable):
- Due date set
- Billing address (name or company)

❌ **Not Required by Default** (configurable):
- Shipping address (name or company)

### Relaxed Configuration

Organizations can disable specific requirements:

```json
{
  "orders": {
    "requireDueDateForProduction": false,
    "requireBillingAddressForProduction": false
  }
}
```

With this configuration:
- Orders can move to production without due date
- Orders can move to production without billing info
- Line items still required (safety constraint)

## API Usage

### Frontend Hook

```typescript
import { useOrgPreferences } from "@/hooks/useOrgPreferences";

const { preferences, updatePreferences, isLoading } = useOrgPreferences();

// Read current settings
const requireDueDate = preferences?.orders?.requireDueDateForProduction ?? true;

// Update settings (owner/admin only)
await updatePreferences({
  ...preferences,
  orders: {
    requireDueDateForProduction: false,
    requireBillingAddressForProduction: true,
    requireShippingAddressForProduction: false,
  },
});
```

### Backend Endpoint

**GET /api/organization/preferences**
- Returns current org preferences
- Requires: owner or admin role

**PUT /api/organization/preferences**
- Updates org preferences
- Requires: owner or admin role
- Body: Full preferences object

## Validation Service

### Function Signature

```typescript
validateOrderTransition(
  fromStatus: string,
  toStatus: string,
  ctx: TransitionContext
): TransitionResult
```

### Context Interface

```typescript
interface TransitionContext {
  order: Order;
  lineItemsCount: number;
  attachmentsCount?: number;
  fulfillmentStatus?: string;
  jobsCount?: number;
  hasShippedAt?: boolean;
  orgPreferences?: OrgPreferences; // NEW: Optional org preferences
}
```

### Error Codes

- `NO_LINE_ITEMS` - Always enforced, cannot be disabled
- `NO_DUE_DATE` - Enforced when `requireDueDateForProduction = true`
- `NO_BILLING_INFO` - Enforced when `requireBillingAddressForProduction = true`
- `NO_SHIPPING_INFO` - Enforced when `requireShippingAddressForProduction = true`

## Error Messages

All error messages include "by organization policy" when preference-driven:

```
"Cannot start production: Due date is required by organization policy."
"Cannot start production: Billing information (name or company) is required by organization policy."
"Cannot start production: Shipping information (name or company) is required by organization policy."
```

Line item requirement message (always enforced):
```
"Cannot start production: Order must have at least one line item."
```

## Test Coverage

See `server/tests/orderTransition.test.ts`:

- ✅ Default strict behavior (all requirements enforced)
- ✅ Due date requirement can be disabled
- ✅ Billing requirement can be disabled
- ✅ Both can be disabled simultaneously
- ✅ Shipping requirement can be enabled
- ✅ Line items ALWAYS required (fail-safe)

## Multi-Tenant Safety

- Preferences are scoped to `organizationId`
- Every order transition loads org-specific preferences via `getOrgPreferences(organizationId)`
- No global state or user-level overrides
- Defaults are strict (safe for new tenants)

## Migration Path

No schema changes required:
- Uses existing `organizations.settings` JSONB field
- Uses existing `/api/organization/preferences` endpoints
- Backward compatible: missing preferences default to strict validation

## UI Implementation (Future)

Settings UI can be added to organization settings page:

```tsx
<FormField>
  <Checkbox 
    checked={preferences?.orders?.requireDueDateForProduction ?? true}
    onCheckedChange={(checked) => updatePreferences({
      ...preferences,
      orders: {
        ...preferences?.orders,
        requireDueDateForProduction: checked,
      },
    })}
  />
  <Label>Require due date before starting production</Label>
</FormField>

<FormField>
  <Checkbox 
    checked={preferences?.orders?.requireBillingAddressForProduction ?? true}
    onCheckedChange={(checked) => updatePreferences({
      ...preferences,
      orders: {
        ...preferences?.orders,
        requireBillingAddressForProduction: checked,
      },
    })}
  />
  <Label>Require billing address before starting production</Label>
</FormField>

<FormField>
  <Checkbox 
    checked={preferences?.orders?.requireShippingAddressForProduction ?? false}
    onCheckedChange={(checked) => updatePreferences({
      ...preferences,
      orders: {
        ...preferences?.orders,
        requireShippingAddressForProduction: checked,
      },
    })}
  />
  <Label>Require shipping address before starting production</Label>
</FormField>
```

## Files Modified

### Backend
- `server/services/orderTransition.ts` - Added `OrgPreferences` interface, updated validation logic
- `server/routes.ts` - Load and pass org preferences to validation service

### Frontend
- `client/src/hooks/useOrgPreferences.ts` - Added `orders` preferences to interface

### Tests
- `server/tests/orderTransition.test.ts` - Added 6 new test cases for configurable validation

## Deployment Notes

1. **No database migration required** - uses existing JSONB field
2. **Backward compatible** - defaults preserve strict behavior
3. **Safe rollback** - removing preferences reverts to defaults
4. **Type-safe** - TypeScript enforces preference structure
5. **Multi-tenant safe** - org-scoped, no cross-tenant leakage
