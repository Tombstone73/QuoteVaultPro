# Prepress Workflow Implementation Guide

**Enterprise-Grade Routing Guard & Workflow Handoff**

This document outlines the implementation plan for enforcing prepress gates and explicit handoff actions between Prepress and Production boards.

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Prepress Gate Enforcement](#phase-1-prepress-gate-enforcement)
3. [Phase 2A: Send to Print Queue Action](#phase-2a-send-to-print-queue-action)
4. [Phase 2B: Kickback to Prepress](#phase-2b-kickback-to-prepress)
5. [Testing Checklist](#testing-checklist)
6. [Files to Modify](#files-to-modify)

---

## Overview

### Goals

1. **Prepress Gate**: Jobs requiring prepress must NOT appear on Flatbed/Roll boards until prepress is complete
2. **Explicit Handoff**: Completing prepress doesn't auto-push to print boards; requires explicit "Send to Print Queue" action
3. **Kickback Capability**: Production boards can send jobs back to prepress with a note

### Data Model

**Key Fields** (from `shared/schema.ts` - `orderLineItems` table):

- `requiresPrepress`: boolean (default: true)
- `status`: enum including:
  - `pending_prepress`
  - `in_prepress`
  - `prepress_complete`
  - `print_ready`
  - `printing`
  - `complete`

### Business Rules

```
PREPRESS GATE:
- IF requiresPrepress = false → eligible for print boards immediately
- IF requiresPrepress = true → eligible ONLY when status >= prepress_complete

PRINT READY TRANSITION:
- Completing prepress sets status = prepress_complete
- "Send to Print Queue" sets status = print_ready
- Print boards show items with status >= print_ready (after passing prepress gate)
```

---

## Phase 1: Prepress Gate Enforcement

### Objective

Enforce server-side filtering so jobs requiring prepress never leak to production boards until they complete prepress.

### Implementation Steps

#### 1.1 Locate Production Board Query Endpoints

**File**: `server/routes.ts`

Search for endpoints serving production board data:
- Likely near line ~9000-9500 (based on `/api/production/config` location)
- Look for routes like:
  - `GET /api/production/flatbed/queue`
  - `GET /api/production/roll/queue`
  - `GET /api/production/jobs` (if generic endpoint exists)

#### 1.2 Add Prepress Gate Filter

**Add this filter logic to all production board queries:**

```typescript
import { and, or, eq, inArray } from 'drizzle-orm';

// Inside each production board endpoint (flatbed, roll):
const prepressGateFilter = and(
  eq(orderLineItems.organizationId, organizationId),
  // Prepress gate: exclude items requiring prepress that haven't completed it
  or(
    // Case 1: Doesn't require prepress at all
    eq(orderLineItems.requiresPrepress, false),
    // Case 2: Requires prepress AND has completed it
    and(
      eq(orderLineItems.requiresPrepress, true),
      inArray(orderLineItems.status, [
        'prepress_complete', 
        'print_ready', 
        'printing', 
        'complete'
      ])
    )
  )
);

// Use in query:
const lineItems = await db.select()
  .from(orderLineItems)
  .where(prepressGateFilter)
  // ... other filters (printType, etc.)
```

#### 1.3 Add Development Logging

**Add conditional dev logging** (not for production):

```typescript
if (process.env.NODE_ENV === 'development') {
  const totalItems = await db.select({ count: sql<number>`count(*)` })
    .from(orderLineItems)
    .where(eq(orderLineItems.organizationId, organizationId));
    
  const gatedItems = await db.select({ count: sql<number>`count(*)` })
    .from(orderLineItems)
    .where(and(
      eq(orderLineItems.organizationId, organizationId),
      eq(orderLineItems.requiresPrepress, true),
      inArray(orderLineItems.status, ['pending_prepress', 'in_prepress'])
    ));
    
  console.log(`[Prepress Gate] Total: ${totalItems[0].count}, Gated: ${gatedItems[0].count}`);
}
```

#### 1.4 Update Production Overview/Counts

If there's a dashboard or overview showing counts:
- Apply the same filter to count queries
- Ensure badge numbers reflect gated items

**Example Count Query:**

```typescript
// GET /api/production/overview or similar
const printReadyCount = await db.select({ count: sql<number>`count(*)` })
  .from(orderLineItems)
  .where(and(
    prepressGateFilter, // Apply gate
    eq(orderLineItems.status, 'print_ready')
  ));
```

---

## Phase 2A: Send to Print Queue Action

### Objective

Add explicit "Send to Print Queue" button to Prepress page that transitions `prepress_complete` → `print_ready`.

### Backend Implementation

#### 2A.1 New Endpoint

**File**: `server/routes.ts` (add after existing prepress endpoints, around line ~12140)

```typescript
// POST /api/prepress/line-item/:lineItemId/send-to-print
// Transitions prepress_complete → print_ready
app.post("/api/prepress/line-item/:lineItemId/send-to-print", isAuthenticated, tenantContext, async (req: any, res) => {
  const organizationId = getRequestOrganizationId(req);
  const userId = getUserId(req.user);
  const { lineItemId } = req.params;

  try {
    // 1. Verify line item exists and belongs to org
    const [lineItem] = await db.select()
      .from(orderLineItems)
      .where(and(
        eq(orderLineItems.id, lineItemId),
        eq(orderLineItems.organizationId, organizationId)
      ))
      .limit(1);

    if (!lineItem) {
      return res.status(404).json({ error: "Line item not found" });
    }

    // 2. Verify prepress is complete
    if (lineItem.requiresPrepress && lineItem.status !== 'prepress_complete') {
      return res.status(400).json({ 
        error: "Line item must complete prepress first",
        currentStatus: lineItem.status
      });
    }

    // 3. Verify at least one FINAL file exists
    const finalFiles = await db.select()
      .from(prepressFiles)
      .where(and(
        eq(prepressFiles.lineItemId, lineItemId),
        eq(prepressFiles.role, 'final')
      ))
      .limit(1);

    if (finalFiles.length === 0) {
      return res.status(400).json({ error: "At least one final file is required before sending to print" });
    }

    // 4. Check if already at or past print_ready
    if (['print_ready', 'printing', 'complete'].includes(lineItem.status)) {
      return res.status(400).json({ 
        error: "Line item is already in production queue",
        currentStatus: lineItem.status
      });
    }

    // 5. Transition to PRINT_READY
    await db.update(orderLineItems)
      .set({
        status: 'print_ready',
        updatedAt: new Date()
      })
      .where(eq(orderLineItems.id, lineItemId));

    // 6. Create audit log
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      action: 'prepress.sent_to_print',
      entityType: 'order_line_item',
      entityId: lineItemId,
      metadata: { 
        lineItemId, 
        previousStatus: lineItem.status,
        finalFilesCount: finalFiles.length
      },
      createdAt: new Date()
    });

    console.log(`[Send to Print] Line item ${lineItemId} sent to print queue by user ${userId}`);

    res.json({ 
      success: true, 
      message: "Sent to print queue successfully",
      newStatus: 'print_ready'
    });

  } catch (error) {
    console.error("[Send to Print] Error:", error);
    res.status(500).json({ error: "Failed to send to print queue" });
  }
});
```

### Frontend Implementation

#### 2A.2 Add Mutation Hook

**File**: `client/src/pages/PrepressProductionPageV2.tsx`

Add after the `completeSessionMutation` (around line ~185):

```typescript
const sendToPrintMutation = useMutation({
  mutationFn: async (lineItemId: string) => {
    const res = await fetch(`/api/prepress/line-item/${lineItemId}/send-to-print`, {
      method: "POST",
      credentials: "include",
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to send to print");
    }
    
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
    setSelectedLineItemId(null); // Clear selection
    toast({ 
      title: "Sent to print queue", 
      description: "Job is now ready for production boards" 
    });
  },
  onError: (error: Error) => {
    toast({ 
      title: "Error", 
      description: error.message, 
      variant: "destructive" 
    });
  },
});
```

#### 2A.3 Add Handler

**Add after `handleComplete` handler (around line ~270):**

```typescript
const handleSendToPrint = () => {
  if (selectedLineItemId) {
    sendToPrintMutation.mutate(selectedLineItemId);
  }
};
```

#### 2A.4 Add Derived State

**Add to derived state section (around line ~225):**

```typescript
// Existing derived state...
const canComplete = hasFinalFiles && selectedItem?.sessionId && !selectedItem?.lockedBy;
const isLocked = selectedItem?.lockedBy && !selectedItem?.sessionId;

// NEW: Add canSendToPrint logic
const canSendToPrint = 
  selectedItem?.status === 'prepress_complete' && 
  hasFinalFiles && 
  !isLocked;
```

#### 2A.5 Add Button to Sticky Footer

**File**: `client/src/pages/PrepressProductionPageV2.tsx` (around line ~810, in sticky footer)

Replace the current button section with this expanded version:

```typescript
<div className="flex items-center gap-3">
  <Button
    onClick={handleStartPrepress}
    disabled={!selectedItem || !!selectedItem?.sessionId || isLocked || startSessionMutation.isPending}
    variant="outline"
    className="bg-transparent border-[#2d3748] text-slate-300 hover:bg-[#2d3748] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {startSessionMutation.isPending ? (
      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting...</>
    ) : (
      "Start Prepress"
    )}
  </Button>
  
  <Button
    onClick={handleComplete}
    disabled={!canComplete || completeSessionMutation.isPending}
    className={cn(
      "font-bold shadow-lg transition-all",
      canComplete
        ? "bg-[#1773cf] text-white hover:bg-[#1773cf]/90"
        : "bg-slate-700 text-slate-500 cursor-not-allowed"
    )}
  >
    {completeSessionMutation.isPending ? (
      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Completing...</>
    ) : (
      <>
        Mark Prepress Complete
        <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </>
    )}
  </Button>

  {/* NEW: Send to Print Queue Button */}
  <Button
    onClick={handleSendToPrint}
    disabled={!canSendToPrint || sendToPrintMutation.isPending}
    className={cn(
      "font-bold shadow-lg transition-all",
      canSendToPrint
        ? "bg-green-600 text-white hover:bg-green-700"
        : "bg-slate-700 text-slate-500 cursor-not-allowed"
    )}
  >
    {sendToPrintMutation.isPending ? (
      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
    ) : (
      <>
        Send to Print Queue
        <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </>
    )}
  </Button>
</div>
```

#### 2A.6 Update Footer Status Indicator

**Optional: Show different status for prepress_complete vs print_ready**

In the footer status area (around line ~800):

```typescript
<div className="flex items-center gap-4">
  {selectedItem?.status === 'print_ready' ? (
    <div className="flex items-center gap-2 text-green-500">
      <CheckCircle className="w-4 h-4" />
      <span className="text-xs font-medium">Ready for production</span>
    </div>
  ) : hasFinalFiles ? (
    <div className="flex items-center gap-2 text-green-500">
      <CheckCircle className="w-4 h-4" />
      <span className="text-xs font-medium">Final file detected</span>
    </div>
  ) : (
    <div className="flex items-center gap-2 text-amber-500">
      <AlertCircle className="w-4 h-4" />
      <span className="text-xs font-medium">No final files uploaded</span>
    </div>
  )}
  {/* ... rest of footer ... */}
</div>
```

---

## Phase 2B: Kickback to Prepress

### Objective

Allow production boards (Flatbed/Roll) to send jobs back to prepress with a note.

### Backend Implementation

#### 2B.1 New Endpoint

**File**: `server/routes.ts` (add near other production endpoints)

```typescript
// POST /api/production/line-item/:lineItemId/send-to-prepress
// Kickback from production to prepress with a note
app.post("/api/production/line-item/:lineItemId/send-to-prepress", isAuthenticated, tenantContext, async (req: any, res) => {
  const organizationId = getRequestOrganizationId(req);
  const userId = getUserId(req.user);
  const { lineItemId } = req.params;
  const { note, noPrintsCompletedYet } = req.body;

  try {
    // 1. Validate input
    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      return res.status(400).json({ error: "Note is required" });
    }

    // 2. Verify line item exists
    const [lineItem] = await db.select()
      .from(orderLineItems)
      .where(and(
        eq(orderLineItems.id, lineItemId),
        eq(orderLineItems.organizationId, organizationId)
      ))
      .limit(1);

    if (!lineItem) {
      return res.status(404).json({ error: "Line item not found" });
    }

    // 3. Create or update prepress session for edit request
    const sessionId = crypto.randomUUID();
    
    await db.insert(prepressSessions).values({
      id: sessionId,
      organizationId,
      lineItemId,
      startedByUserId: userId,
      status: 'in_progress',
      notes: `[EDIT REQUEST FROM PRODUCTION]\n${note}`,
      flaggedForQc: true,
      issueType: 'production_edit_request',
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    }).onConflictDoUpdate({
      target: prepressSessions.lineItemId,
      set: {
        notes: sql`${prepressSessions.notes} || '\n\n[EDIT REQUEST]\n' || ${note}`,
        flaggedForQc: true,
        issueType: 'production_edit_request',
        updatedAt: new Date()
      }
    });

    // 4. Update line item status back to in_prepress
    await db.update(orderLineItems)
      .set({
        status: 'in_prepress',
        updatedAt: new Date()
      })
      .where(eq(orderLineItems.id, lineItemId));

    // 5. Create audit log
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      action: 'production.sent_to_prepress',
      entityType: 'order_line_item',
      entityId: lineItemId,
      metadata: { 
        lineItemId,
        previousStatus: lineItem.status,
        note,
        noPrintsCompletedYet: noPrintsCompletedYet || false
      },
      createdAt: new Date()
    });

    console.log(`[Kickback] Line item ${lineItemId} sent back to prepress by user ${userId}`);

    res.json({ 
      success: true, 
      message: "Sent to prepress for editing",
      sessionId
    });

  } catch (error) {
    console.error("[Kickback to Prepress] Error:", error);
    res.status(500).json({ error: "Failed to send to prepress" });
  }
});
```

### Frontend Implementation

#### 2B.2 Create SendToPrepressModal Component

**File**: `client/src/components/production/SendToPrepressModal.tsx` (NEW FILE)

```tsx
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface SendToPrepressModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineItemId: string | null;
  jobNumber?: string;
}

export function SendToPrepressModal({
  open,
  onOpenChange,
  lineItemId,
  jobNumber,
}: SendToPrepressModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [noPrintsCompleted, setNoPrintsCompleted] = useState(false);

  const sendToPrepressMutation = useMutation({
    mutationFn: async (data: { lineItemId: string; note: string; noPrintsCompletedYet: boolean }) => {
      const res = await fetch(`/api/production/line-item/${data.lineItemId}/send-to-prepress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          note: data.note,
          noPrintsCompletedYet: data.noPrintsCompletedYet,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to send to prepress");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production"] });
      toast({
        title: "Sent to prepress",
        description: "Job has been sent back to prepress for editing",
      });
      setNote("");
      setNoPrintsCompleted(false);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!lineItemId) return;
    if (!note.trim()) {
      toast({
        title: "Note required",
        description: "Please provide a reason for sending to prepress",
        variant: "destructive",
      });
      return;
    }

    sendToPrepressMutation.mutate({
      lineItemId,
      note: note.trim(),
      noPrintsCompletedYet: noPrintsCompleted,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Send to Prepress</DialogTitle>
          <DialogDescription>
            Request prepress edit for {jobNumber || "this job"}. This will remove the job from production
            boards until prepress completes the changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="prepress-note">Edit Request Note *</Label>
            <Textarea
              id="prepress-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe what needs to be changed in prepress..."
              className="min-h-[120px] resize-none"
              disabled={sendToPrepressMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              This note will be visible to the prepress team
            </p>
          </div>

          <div className="flex items-start space-x-3 rounded-md border p-4">
            <Checkbox
              id="no-prints"
              checked={noPrintsCompleted}
              onCheckedChange={(checked) => setNoPrintsCompleted(checked as boolean)}
              disabled={sendToPrepressMutation.isPending}
            />
            <div className="space-y-1 leading-none">
              <Label
                htmlFor="no-prints"
                className="text-sm font-medium cursor-pointer"
              >
                No prints completed yet
              </Label>
              <p className="text-xs text-muted-foreground">
                Check if no physical prints have been made (helps with waste tracking)
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 p-3">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              This job will be removed from production boards and sent back to the prepress queue
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sendToPrepressMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!note.trim() || sendToPrepressMutation.isPending}
          >
            {sendToPrepressMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              "Send to Prepress"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

#### 2B.3 Add to Flatbed/Roll Production Views

**Files**: 
- `client/src/features/production/views/FlatbedProductionView.tsx`
- `client/src/features/production/views/RollProductionView.tsx`

**Add state for modal:**

```typescript
const [sendToPrepressModalOpen, setSendToPrepressModalOpen] = useState(false);
const [selectedLineItemForPrepress, setSelectedLineItemForPrepress] = useState<{
  id: string;
  jobNumber: string;
} | null>(null);
```

**Add action button** (in line item actions menu or detail panel):

```tsx
<Button
  variant="outline"
  onClick={() => {
    setSelectedLineItemForPrepress({
      id: selectedItem.id,
      jobNumber: selectedItem.jobNumber,
    });
    setSendToPrepressModalOpen(true);
  }}
  className="w-full"
>
  <Edit className="w-4 h-4 mr-2" />
  Send to Prepress
</Button>
```

**Add modal to render:**

```tsx
import { SendToPrepressModal } from "@/components/production/SendToPrepressModal";

// In component JSX:
<SendToPrepressModal
  open={sendToPrepressModalOpen}
  onOpenChange={setSendToPrepressModalOpen}
  lineItemId={selectedLineItemForPrepress?.id || null}
  jobNumber={selectedLineItemForPrepress?.jobNumber}
/>
```

---

## Testing Checklist

### Phase 1: Prepress Gate

- [ ] Create line item with `requiresPrepress = true`, status = `pending_prepress`
  - [ ] Verify it appears in Prepress queue
  - [ ] Verify it does NOT appear on Flatbed board
  - [ ] Verify it does NOT appear on Roll board
  - [ ] Check production overview counts exclude it

- [ ] Start prepress (status = `in_prepress`)
  - [ ] Still not visible on Flatbed/Roll
  - [ ] Still visible in Prepress queue

- [ ] Complete prepress (status = `prepress_complete`)
  - [ ] Still not visible on Flatbed/Roll (needs explicit send to print)
  - [ ] Visible in Prepress queue with complete status

- [ ] Create line item with `requiresPrepress = false`
  - [ ] Immediately visible on appropriate print board (Flatbed or Roll based on printType)
  - [ ] Does NOT appear in Prepress queue

### Phase 2A: Send to Print Queue

- [ ] Complete prepress on a job (status = `prepress_complete`)
  - [ ] "Send to Print Queue" button is enabled
  - [ ] Click button
  - [ ] Status transitions to `print_ready`
  - [ ] Job appears on appropriate production board
  - [ ] Job removed from prepress queue (or marked as sent)
  - [ ] Audit log created

- [ ] Try to send without final files
  - [ ] Button disabled or shows error message

- [ ] Try to send when already `print_ready`
  - [ ] Button disabled or shows appropriate state

### Phase 2B: Kickback to Prepress

- [ ] On Flatbed board, select a line item
  - [ ] Click "Send to Prepress"
  - [ ] Modal opens

- [ ] Fill out kickback form
  - [ ] Enter note (required)
  - [ ] Optionally check "No prints completed"
  - [ ] Submit

- [ ] Verify kickback effects
  - [ ] Job removed from production board
  - [ ] Job appears in Prepress queue
  - [ ] Note visible in prepress session notes
  - [ ] Status = `in_prepress`
  - [ ] Audit log created

- [ ] Test validation
  - [ ] Try submitting without note (should fail)
  - [ ] Cancel modal (should not affect job)

### Integration Testing

- [ ] Complete workflow: Prepress → Print → Kickback → Prepress → Print
  - [ ] Create job requiring prepress
  - [ ] Complete prepress
  - [ ] Send to print
  - [ ] Start printing
  - [ ] Send back to prepress with note
  - [ ] Edit files in prepress
  - [ ] Complete prepress again
  - [ ] Send to print again
  - [ ] Verify all status transitions correct
  - [ ] Verify all audit logs created

- [ ] Multi-tenant isolation
  - [ ] Jobs from Org A don't appear in Org B's boards
  - [ ] Kickback from Org A doesn't affect Org B

---

## Files to Modify

### Backend

- **`server/routes.ts`**
  - Add prepress gate filter to production board queries (Phase 1)
  - Add `POST /api/prepress/line-item/:lineItemId/send-to-print` endpoint (Phase 2A)
  - Add `POST /api/production/line-item/:lineItemId/send-to-prepress` endpoint (Phase 2B)

### Frontend

- **`client/src/pages/PrepressProductionPageV2.tsx`**
  - Add `sendToPrintMutation` (Phase 2A)
  - Add `handleSendToPrint` handler (Phase 2A)
  - Add `canSendToPrint` derived state (Phase 2A)
  - Add "Send to Print Queue" button to sticky footer (Phase 2A)
  - Update footer status indicator (Phase 2A)

- **`client/src/components/production/SendToPrepressModal.tsx`** (NEW FILE)
  - Create kickback modal component (Phase 2B)

- **`client/src/features/production/views/FlatbedProductionView.tsx`**
  - Add modal state (Phase 2B)
  - Add "Send to Prepress" action button (Phase 2B)
  - Render SendToPrepressModal (Phase 2B)

- **`client/src/features/production/views/RollProductionView.tsx`**
  - Add modal state (Phase 2B)
  - Add "Send to Prepress" action button (Phase 2B)
  - Render SendToPrepressModal (Phase 2B)

### Schema (if needed)

- **`shared/schema.ts`**
  - Verify `requiresPrepress` field exists on `orderLineItems` ✓ (exists)
  - Verify status enum includes all required values ✓ (verify)
  - Add `prepressSessions` table if doesn't exist (for kickback notes)

---

## Notes

### Development Priority

1. **Start with Phase 1** - Get the gate working server-side first
2. **Then Phase 2A** - Add explicit handoff button
3. **Finally Phase 2B** - Add kickback capability

### Audit Trail

All three phases create audit logs:
- Phase 1: Implicit (filtered queries, could add optional log)
- Phase 2A: `prepress.sent_to_print` action
- Phase 2B: `production.sent_to_prepress` action

### Performance Considerations

- Prepress gate filter adds WHERE clause - ensure indexes exist:
  - `order_line_items_requires_prepress_idx` ✓ (exists)
  - `order_line_items_status_idx` ✓ (exists)
  - Composite index on `(requiresPrepress, status)` - recommended

### Error Handling

All endpoints should:
- Validate tenant isolation
- Return clear error messages
- Log errors server-side
- Return appropriate HTTP status codes
- Handle edge cases (missing files, invalid state transitions)

---

## Implementation Checklist

### Backend

- [ ] Phase 1: Add prepress gate to production queries
  - [ ] Find Flatbed query endpoint
  - [ ] Find Roll query endpoint
  - [ ] Add filter logic
  - [ ] Add dev logging
  - [ ] Update count queries

- [ ] Phase 2A: Send to Print endpoint
  - [ ] Create endpoint
  - [ ] Add validation
  - [ ] Add state transition logic
  - [ ] Add audit logging
  - [ ] Test endpoint

- [ ] Phase 2B: Kickback endpoint
  - [ ] Create endpoint
  - [ ] Add validation
  - [ ] Create/update session logic
  - [ ] Add audit logging
  - [ ] Test endpoint

### Frontend

- [ ] Phase 2A: Send to Print UI
  - [ ] Add mutation
  - [ ] Add handler
  - [ ] Add derived state
  - [ ] Add button
  - [ ] Update status indicator
  - [ ] Test UI flow

- [ ] Phase 2B: Kickback UI
  - [ ] Create modal component
  - [ ] Add to Flatbed view
  - [ ] Add to Roll view
  - [ ] Add action buttons
  - [ ] Test modal flow
  - [ ] Test end-to-end kickback

### Testing

- [ ] Unit tests for gate filter logic
- [ ] Integration tests for workflow
- [ ] Manual QA of all three phases
- [ ] Multi-tenant testing
- [ ] Performance testing with large datasets

---

**End of Implementation Guide**
