# M7.3A maintenance ingress plan

## Disposition: BLOCKED for live proof

The smallest safe maintenance mechanism is a reversible two-part control:

1. The production-frontend owner aliases the canonical `www.printershero.com` host to an immutable static maintenance deployment with no forms, mutation scripts, API proxy, or service credentials.
2. Immediately after maintenance ingress is observed, the release commander stops the single PrintersHero Railway V1 service and records fresh zero-replica evidence.

The static shell is the customer/operator UX control. Railway zero replicas is the authoritative control for stale browser sessions and direct API traffic. A static shell alone is not a write barrier.

## Read-only topology evidence

- Runtime configuration identifies `www.printershero.com` as the browser origin and the production website resolves through Vercel.
- API and objects traffic resolves through the single PrintersHero Railway service.
- Authenticated Railway inventory shows one V1 service/replica and no Railway cron or separately deployed PrintersHero worker.
- The deployed V1 source has no maintenance-mode admission control. It accepts mutation verbs, and CORS is not an admission control for stale sessions or direct requests.
- Connected Vercel access exposes only the development project; it does not expose the project/team that owns the production `www` host.

## Required cutover proof

Before V1 is stopped, retain sanitized, timestamped evidence that the canonical host resolves to the intended immutable maintenance deployment and returns a static response with no customer/operator mutation surface. Immediately after, retain Railway evidence that the verified PrintersHero V1 service has zero replicas and an API probe showing no application process is available. The two records must be no more than five minutes apart.

The M7.3A evidence gate represents this as `maintenance-ingress` plus `railway-v1-runtime`; it fails closed unless both records are fresh and identify the approved target.

## Reversal

The frontend owner restores the previous Vercel alias/deployment only after V2 readiness and controlled writer release. If the cutover stops before V2 authority, keep the maintenance shell in place while V1 is restored, then verify V1 health before restoring normal ingress.

## Required authority before M8

An authenticated owner of the Vercel project/team controlling `www.printershero.com` must pre-provision and prove the static deployment and reversible alias operation. No Vercel routing, alias, deployment, or service state was changed in M7.3A.
