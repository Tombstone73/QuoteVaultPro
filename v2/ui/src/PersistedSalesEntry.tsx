import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { quoteApi, salesWorkspaceTransport } from "./api";
import { createSalesWorkspaceClient } from "./salesWorkspaceApi";
import { TransactionalSalesWorkspace } from "./TransactionalSalesWorkspace";
import { pushOrderLocation, pushQuoteLocation } from "./productRouting";

const client = createSalesWorkspaceClient(salesWorkspaceTransport);

/** Both old entry locations use neutral TEMP state; target is chosen at Save. */
export function PersistedSalesEntry({ organizationId, sessionScope, onBack }: Readonly<{
  organizationId: string; sessionScope: string; onBack: () => void;
}>) {
  const cache = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(() =>
    typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("workspaceId") || undefined);
  const bootstrap = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "ui-bootstrap"],
    queryFn: () => quoteApi.bootstrap(organizationId), enabled: Boolean(organizationId && sessionScope), retry: false,
  });
  if (bootstrap.isError) return <p className="notice error" role="alert">Sales workspace access could not be verified.</p>;
  if (!bootstrap.data) return <p role="status">Loading Sales workspace access...</p>;
  const session = bootstrap.data;
  if (!session.userId) return <p className="notice">A verified staff session is required.</p>;
  return <>
    {!workspaceId && <button className="button secondary" type="button" onClick={onBack}>Back to list</button>}
    <TransactionalSalesWorkspace
      organizationId={organizationId} sessionScope={session.sessionScope} userId={session.userId}
      client={client} capabilities={session.capabilities} csrfReady={Boolean(session.csrfToken)}
      workspaceId={workspaceId}
      onWorkspaceIdChange={id => {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set("workspaceId", id); else url.searchParams.delete("workspaceId");
        window.history.replaceState(window.history.state, "", url);
        setWorkspaceId(id);
      }}
      openCanonical={receipt => {
        void cache.invalidateQueries({ queryKey: ["v2", session.sessionScope, organizationId] });
        if (receipt.target === "quote") pushQuoteLocation(receipt.documentId);
        else pushOrderLocation(receipt.documentId);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    />
  </>;
}
