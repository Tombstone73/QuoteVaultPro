# Production Routing Diagnostics Contract

## Endpoints affected
- `POST /api/orders/:orderId/production/schedule`
- `GET /api/production/jobs`
- `GET /api/production/jobs/:jobId`

## Schedule request (minimal)
```json
{
  "lineItemIds": ["line_item_123"]
}
```

## Schedule response (minimal)
```json
{
  "success": true,
  "data": {
    "createdJobCount": 1,
    "existingJobCount": 0,
    "skippedNonProductionCount": 0,
    "affectedLineItemIds": ["line_item_123"],
    "lineItemDiagnostics": {
      "line_item_123": {
        "stationKey": "prepress",
        "stepKey": "prepress",
        "routingReason": "org_default_prepress_required",
        "routingSource": "org",
        "idempotencyNote": "Production job already existed before scheduling request"
      }
    }
  },
  "message": "Created 1 production job(s)"
}
```

## Jobs DTO routing metadata (minimal)
- `GET /api/production/jobs` and `GET /api/production/jobs/:jobId` may include:
```json
{
  "routingReason": "org_default_prepress_required",
  "routingSource": "bulk_schedule",
  "idempotencyNote": null
}
```

## Field definitions
- `stationKey`: resolved production station for the line item/job.
- `stepKey`: resolved initial step within the station.
- `routingReason`: human-readable resolver/event reason for route selection.
- `routingSource?`: optional route origin hint (resolver bucket/event source/trigger).
- `idempotencyNote?`: optional note when existing jobs are reused.

## Notes
- Diagnostics may be absent for legacy jobs without `intake`/`routing_override` events.
- `routingReason` is derived from resolver output at schedule time, or from production events for jobs list/detail.
- Tenant scoping is enforced by `tenantContext`; query params do not override organization context.
- No schema change: `production_jobs` is not modified to persist `routingReason`.