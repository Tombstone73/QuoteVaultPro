import { useQuery } from "@tanstack/react-query";
import React from "react";
import { actionCenterApi } from "./api";

/**
 * Staff landing context is a single server-owned action projection. It does
 * not derive operational counts from independently fetched React workspaces.
 */
export const CommandCenter = ({ organizationId, sessionScope }: Readonly<{ organizationId: string; sessionScope: string }>) => {
  const actions = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "action-center"],
    queryFn: () => actionCenterApi.summary(organizationId),
    enabled: Boolean(organizationId && sessionScope),
  });
  if (!organizationId) return <section className="v2-command-center"><p className="v2-proof-empty">Enter an authenticated organization to load its canonical action summary.</p></section>;
  return <section className="v2-command-center">
    <header><div><p>Workspace overview</p><h1>Command Center</h1><span>What needs staff attention now. Counts are bounded, tenant-scoped V2 domain projections.</span></div></header>
    {actions.isLoading && <p className="v2-proof-empty">Loading action summary…</p>}
    {actions.isError && <p className="v2-proof-empty">The action summary is unavailable. Open the permitted workspaces from navigation.</p>}
    {actions.data && <div className="v2-command-grid">
      {actions.data.items.map((item) => <article key={item.kind}>
        <header><h2>{item.label}</h2><a href={item.href}>Open workspace</a></header>
        <p><b>{item.count}</b><span>{item.count === 1 ? "item needs attention" : "items need attention"}</span></p>
      </article>)}
      {!actions.data.items.length && <p className="v2-proof-empty">No permitted operational action categories are available for this account.</p>}
    </div>}
  </section>;
};
