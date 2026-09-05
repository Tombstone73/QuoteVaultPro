# M7.3B Vercel control-plane proof

## Disposition: BLOCKED by authenticated access scope

Authenticated Vercel read-only access exposes exactly one accessible hobby team and one development project, `printershero-development`. Its domains are development-only and do not include `www.printershero.com`. Its latest ready deployment reflects the development branch/source baseline and is not production evidence.

Public DNS and HTTPS headers do establish that `www.printershero.com` is served through Vercel. They cannot establish the owning Vercel team, project, deployment, source revision, backend target, alias, or permission to switch it. The production Vercel project and deployment therefore remain unknown rather than inferred from the development project.

## Intended future maintenance action

After the owning team is authenticated and inspected, the smallest reversible action is to prepare an immutable static maintenance deployment, record its deployment identity, then use that production project's documented alias/promotion mechanism to place `www.printershero.com` on the maintenance deployment. The release record must include the prior production deployment identity and an explicit rollback action that restores the prior deployment or approved V2 deployment.

The Vercel control-plane proof required by `m7.3b-cutover-evidence-v1` is a sanitized record containing hashed project/team/current-production-deployment identities, canonical domain `www.printershero.com`, maintenance-switch reference, rollback reference, timestamp, and Vercel read-only evidence. The separate Railway zero-replica proof remains mandatory: a frontend switch alone cannot block stale browser sessions or direct API traffic.

## Minimum unblock

Grant authenticated read-only Vercel access to the account/team that owns `www.printershero.com`, sufficient to inspect the domain, project, production deployment, aliases, project configuration, and the available switch/rollback permissions. No production Vercel deployment, alias, domain, DNS, Railway, or environment setting was changed in M7.3B.
