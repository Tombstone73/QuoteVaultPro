import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { type ApiError, newBusinessRequestId, routingApi, type RoutingWorkspaceRead } from "./api";

const steps = (values: readonly Readonly<{ position: number; kind: string }>[], current?: string, ids?: readonly Readonly<{ routeInstanceStepId: string }>[]) => <ol className="v2-routing-steps">{values.map((step, index) => <li key={ids?.[index]?.routeInstanceStepId ?? `${step.position}:${step.kind}`} className={current && ids?.[index]?.routeInstanceStepId === current ? "current" : ""}><b>{step.position}</b>{step.kind}</li>)}</ol>;
type TemplateStep = "proofing" | "prepress" | "production" | "fulfillment";
type Template = Readonly<{ routeTemplateId: string; name: string; active: boolean; revision: string; steps: readonly Readonly<{ position: number; kind: string }>[] }>;
type RouteInstance = RoutingWorkspaceRead["instances"][number];
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/** Explicitly requests the one server-derived frozen-route transition. */
export const RouteProgressionAction = ({ organizationId, instance, canAdvance, onRefresh }: Readonly<{ organizationId: string; instance: RouteInstance; canAdvance: boolean; onRefresh: () => Promise<unknown> }>) => {
  const [notice, setNotice] = useState("");
  const current = instance.steps.find((step) => step.routeInstanceStepId === instance.currentStepId);
  const next = current ? instance.steps.find((step) => step.position > current.position) : undefined;
  const complete = useMutation({
    mutationFn: () => routingApi.completeCurrent(organizationId, instance.routeInstanceId, newBusinessRequestId(), instance.revision),
    onSuccess: async () => { setNotice("Route step completed. The authoritative Route was refreshed."); await onRefresh(); },
    onError: async (error) => {
      const apiError = error as unknown as ApiError;
      setNotice(apiError.message || "Routing could not be advanced.");
      if (apiError.code === "CONFLICT" || apiError.code === "STALE_STATE") await onRefresh();
    },
  });
  if (!current) return <span className="v2-proof-empty">{instance.state === "completed" ? "Route complete" : "No current Route step"}</span>;
  const prerequisite = instance.currentPrerequisite;
  const blocked = !prerequisite?.satisfied;
  return <div className="v2-routing-action">
    <p><b>{label(current.kind)}</b> prerequisite: {prerequisite ? prerequisite.satisfied ? "Complete" : "Incomplete" : "Refreshing…"}</p>
    {blocked && prerequisite?.reason && <small>{prerequisite.reason}</small>}
    {!canAdvance ? <small>You do not have permission to advance Routing.</small> : <button type="button" disabled={blocked || complete.isPending} onClick={() => complete.mutate()}>{complete.isPending ? "Advancing…" : next ? `Advance to ${label(next.kind)}` : "Complete Route"}</button>}
    {notice && <p className="v2-product-version-message" role="status">{notice}</p>}
  </div>;
};

const RouteTemplateEditor = ({ organizationId, template, onSaved }: Readonly<{ organizationId: string; template: Template; onSaved: () => void }>) => {
  const [editing, setEditing] = useState(false), [name, setName] = useState(template.name), [active, setActive] = useState(template.active), [stepKinds, setStepKinds] = useState<readonly TemplateStep[]>(template.steps.map((step) => step.kind as TemplateStep));
  const update = useMutation({ mutationFn: () => routingApi.updateTemplate(organizationId, template.routeTemplateId, newBusinessRequestId(), { expectedRevision: template.revision, name, active, steps: stepKinds.map((kind, position) => ({ position, kind })) }), onSuccess: () => { setEditing(false); onSaved(); } });
  if (!editing) return <button type="button" onClick={() => { setName(template.name); setActive(template.active); setStepKinds(template.steps.map((step) => step.kind as TemplateStep)); setEditing(true); }}>Edit</button>;
  return <form className="v2-product-form" onSubmit={(event) => { event.preventDefault(); update.mutate(); }}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} /></label><label><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active</label><label>Steps<select multiple value={stepKinds as string[]} onChange={(event) => setStepKinds(Array.from(event.currentTarget.selectedOptions).map((option) => option.value as TemplateStep))}><option value="proofing">Proofing</option><option value="prepress">Prepress</option><option value="production">Production</option><option value="fulfillment">Fulfillment</option></select></label><button type="submit" disabled={!name.trim() || !stepKinds.length || update.isPending}>{update.isPending ? "Saving…" : "Save template"}</button><button type="button" onClick={() => setEditing(false)}>Cancel</button>{update.isError && <p className="v2-product-version-message">{(update.error as Error).message}</p>}</form>;
};

/** Read-first adapter over Routing-owned templates and frozen instances. */
export const RoutingWorkspace = ({ organizationId, sessionScope, canView, canAdvance, openOrder }: Readonly<{ organizationId: string; sessionScope: string; canView: boolean; canAdvance: boolean; openOrder: (id: string) => void }>) => {
  const workspace = useQuery({ queryKey: ["v2", sessionScope, organizationId, "routing", "workspace"], queryFn: () => routingApi.workspace(organizationId), enabled: Boolean(organizationId && sessionScope && canView) });
  const client = useQueryClient(), [name, setName] = useState(""), [stepKinds, setStepKinds] = useState<readonly TemplateStep[]>(["prepress","production","fulfillment"]);
  const create = useMutation({ mutationFn: () => routingApi.createTemplate(organizationId, newBusinessRequestId(), { name, steps: stepKinds.map((kind, position) => ({ position, kind })) }), onSuccess: () => { setName(""); client.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "routing", "workspace"] }); } });
  if (!organizationId) return <section className="v2-routing"><p className="v2-proof-empty">Enter an authenticated organization before opening Routing.</p></section>;
  if (!canView) return <section className="v2-routing"><p className="v2-proof-empty">You do not have permission to view Routing.</p></section>;
  return <section className="v2-routing"><header className="v2-routing-heading"><div><p>Operations / Routing</p><h1>Routing</h1><span>Canonical templates and frozen Order-line routes.</span></div></header>
    <section className="v2-routing-note"><b>Routing owns internal position and template definitions.</b> Products select a definition but never edit route steps.</section>
    <form className="v2-product-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><h2>New Route Template</h2><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} /></label><label>Steps<select multiple value={stepKinds as string[]} onChange={(event) => setStepKinds(Array.from(event.currentTarget.selectedOptions).map((option) => option.value as "proofing"|"prepress"|"production"|"fulfillment"))}><option value="proofing">Proofing</option><option value="prepress">Prepress</option><option value="production">Production</option><option value="fulfillment">Fulfillment</option></select></label><button type="submit" disabled={!name.trim() || !stepKinds.length || create.isPending}>{create.isPending ? "Creating…" : "Create Route Template"}</button>{create.isError && <p className="v2-product-version-message">{(create.error as Error).message}</p>}</form>
    <section><h2>Route templates</h2><div className="v2-routing-templates">{workspace.data?.templates.map((template) => <article key={template.routeTemplateId}><header><b>{template.name}</b><span>{template.active ? "Active" : "Inactive"}</span></header>{steps(template.steps)}<small>Revision {template.revision} · {template.routeTemplateId}</small><RouteTemplateEditor organizationId={organizationId} template={template} onSaved={() => client.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "routing", "workspace"] })} /></article>)}{workspace.isSuccess && !workspace.data.templates.length && <p className="v2-proof-empty">No canonical Route Templates are available.</p>}</div></section>
    <section className="v2-routing-instances"><header><h2>Route instances</h2><p>Each instance freezes its template identity and ordered steps when Sales creates the Order-line work.</p></header><div className="v2-routing-table-wrap"><table><thead><tr><th>Order / line</th><th>Current position</th><th>State</th><th>Frozen route</th><th>Progression</th></tr></thead><tbody>{workspace.data?.instances.map((instance) => <tr key={instance.routeInstanceId}><td><button onClick={() => openOrder(instance.orderId)}>Order {instance.orderNumber}</button><small>{instance.lineDescription}</small></td><td>{steps(instance.steps, instance.currentStepId, instance.steps)}</td><td>{instance.state}</td><td><small>{instance.sourceTemplate.routeTemplateId} · revision {instance.sourceTemplate.revision}<br />Route revision {instance.revision}</small></td><td><RouteProgressionAction organizationId={organizationId} instance={instance} canAdvance={canAdvance} onRefresh={() => client.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "routing", "workspace"] })} /></td></tr>)}{workspace.isSuccess && !workspace.data.instances.length && <tr><td colSpan={5}>No canonical Route Instances are available.</td></tr>}</tbody></table></div></section>
  </section>;
};
