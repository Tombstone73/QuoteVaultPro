import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft, ChevronRight, Info, Mail, MapPin, MessageSquarePlus, Phone, Plus, Star,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app-store";
import { PageHeader, Panel, Status, td, th } from "@/components/app/primitives";
import { InlineSelect, InlineText, SaveButton, type SaveState } from "@/components/app/sales-editable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { customers, docGrand, invoices, money, type Contact, type Customer } from "@/lib/mock/data";
import {
  ACTIVITY_LABEL, getActivity, getNotes, getPipeline, getProfile, getTasks, pipelineValue,
  type AccountNote, type AccountProfile, type ActivityKind, type CrmActivity, type CrmTask,
  type PipelineItem,
} from "@/lib/mock/crm";

export const Route = createFileRoute("/_shell/customers/$id")({
  head: ({ params }) => ({
    meta: [
      { title: "Customer Account — PrintersHero V2" },
      { name: "description", content: "Account management workspace: contacts, relationship activity, follow-ups, quote pipeline, notes and order history." },
      { property: "og:title", content: `Customer ${params.id} — PrintersHero V2` },
      { property: "og:description", content: "Everything a rep needs about one print customer on a single screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CustomerDetail,
});

type Drill = "details" | "contacts" | "tasks" | "pipeline" | "activity" | "notes" | "docs" | null;

const CURRENT_USER = "Dale";

const STAGE_TONE: Record<PipelineItem["stage"], string> = {
  Quoting: "border-info/50 bg-info/15 text-info",
  Sent: "border-primary/50 bg-primary/15 text-primary",
  Negotiating: "border-warn/50 bg-warn/15 text-warn",
  Won: "border-ok/50 bg-ok/15 text-ok",
  Lost: "border-late/50 bg-late/15 text-late",
};

function StageChip({ stage }: { stage: PipelineItem["stage"] }) {
  return (
    <span className={cn("rounded border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", STAGE_TONE[stage])}>
      {stage}
    </span>
  );
}

function SummaryCard({
  title, hint, count, onOpen, children,
}: { title: string; hint?: string; count?: string; onOpen: () => void; children: React.ReactNode }) {
  return (
    <section className="section-panel flex min-w-0 flex-col">
      <header className="section-head flex items-center gap-2 px-0.5 py-1.5">
        <span className="section-label">{title}</span>
        {count && <span className="num shrink-0 text-[11px] text-muted-foreground">{count}</span>}
        <span className="section-rule" aria-hidden />
        <Button size="sm" variant="ghost" className="h-6 shrink-0 gap-0.5 px-1.5 text-[11px]" onClick={onOpen}>
          {hint ?? "View all"}<ChevronRight className="size-3.5" />
        </Button>
      </header>

      <div className="flex-1 px-0.5 pt-2.5">{children}</div>
    </section>
  );
}


function TaskRow({ t, onToggle }: { t: CrmTask; onToggle: () => void }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <Checkbox checked={t.done} onCheckedChange={onToggle} className="mt-0.5" aria-label={t.title} />
      <span className="min-w-0 flex-1">
        <span className={cn("block leading-snug", t.done && "text-muted-foreground line-through")}>{t.title}</span>
        <span className="block text-[11px] text-muted-foreground">
          Due {t.due} · {t.owner}
          {t.priority === "High" && !t.done && <span className="ml-1 font-semibold text-warn">High</span>}
        </span>
      </span>
    </li>
  );
}

function ActivityRow({ a }: { a: CrmActivity }) {
  return (
    <li className="flex gap-2 border-l-2 border-l-border pl-2 text-[13px]">
      <span className="min-w-0 flex-1">
        <span className="block leading-snug">{a.body}</span>
        <span className="block text-[11px] text-muted-foreground">
          {ACTIVITY_LABEL[a.kind]} · {a.who} · {a.when}
        </span>
      </span>
    </li>
  );
}

function CustomerDetail() {
  const { id } = Route.useParams();
  const { docs } = useApp();
  const base = customers.find((x) => x.id === id);

  const [drill, setDrill] = useState<Drill>(null);
  const [save, setSave] = useState<SaveState>("clean");
  const [account, setAccount] = useState<Customer | undefined>(base);
  const [profile, setProfile] = useState<AccountProfile>(() => ({ ...getProfile(id) }));
  const [contacts, setContacts] = useState<Contact[]>(() => (base ? [...base.contacts] : []));
  const [tasks, setTasks] = useState<CrmTask[]>(() => [...getTasks(id)]);
  const [activity, setActivity] = useState<CrmActivity[]>(() => [...getActivity(id)]);
  const [notes, setNotes] = useState<AccountNote[]>(() => [...getNotes(id)]);
  const pipeline = useMemo(() => getPipeline(id), [id]);

  const [contactDlg, setContactDlg] = useState(false);
  const [logDlg, setLogDlg] = useState(false);
  const [infoDlg, setInfoDlg] = useState(false);
  const [logKind, setLogKind] = useState<ActivityKind>("call");
  const [logBody, setLogBody] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [newContact, setNewContact] = useState({ name: "", title: "", email: "", phone: "" });

  if (!account) return <div className="p-8 text-sm text-muted-foreground">Customer not found.</div>;
  const c = account;

  const dirty = () => setSave("dirty");
  const patch = (p: Partial<Customer>) => { setAccount((a) => (a ? { ...a, ...p } : a)); dirty(); };
  const patchProfile = (p: Partial<AccountProfile>) => { setProfile((x) => ({ ...x, ...p })); dirty(); };
  const commit = () => {
    setSave("saving");
    window.setTimeout(() => { setSave("saved"); toast.success("Account saved"); }, 550);
  };

  const mine = docs.filter((d) => d.customerId === c.id);
  const myInvoices = invoices.filter((i) => i.customerId === c.id);
  const openTasks = tasks.filter((t) => !t.done);
  const openPipeline = pipelineValue(pipeline);
  const primary = contacts[0];

  const addContact = () => {
    if (!newContact.name.trim()) return;
    setContacts((l) => [...l, { id: `ct-${Date.now()}`, name: newContact.name.trim(), title: newContact.title.trim() || undefined, email: newContact.email.trim(), phone: newContact.phone.trim() }]);
    setNewContact({ name: "", title: "", email: "", phone: "" });
    setContactDlg(false);
    toast.success("Contact added");
  };
  const editContact = (cid: string, p: Partial<Contact>) => {
    setContacts((l) => l.map((x) => (x.id === cid ? { ...x, ...p } : x)));
    dirty();
  };
  const addTask = () => {
    if (!taskDraft.trim()) return;
    setTasks((l) => [{ id: `t-${Date.now()}`, title: taskDraft.trim(), due: "No date", owner: CURRENT_USER, priority: "Normal", done: false }, ...l]);
    setTaskDraft("");
    toast.success("Follow-up added");
  };
  const addNote = () => {
    if (!noteDraft.trim()) return;
    setNotes((l) => [{ id: `n-${Date.now()}`, body: noteDraft.trim(), author: CURRENT_USER, when: "just now" }, ...l]);
    setNoteDraft("");
    toast.success("Account note added");
  };
  const logActivity = () => {
    if (!logBody.trim()) return;
    setActivity((l) => [{ id: `e-${Date.now()}`, kind: logKind, body: logBody.trim(), who: CURRENT_USER, when: "just now" }, ...l]);
    setLogBody("");
    setLogDlg(false);
    toast.success(`${ACTIVITY_LABEL[logKind]} logged`);
  };

  /* ------------------------------------------------------------ drill-ins */

  const drillTitle: Record<Exclude<Drill, null>, string> = {
    details: "Account Details",
    contacts: "Contacts",
    tasks: "Follow-ups",
    pipeline: "Quote Pipeline",
    activity: "Relationship Activity",
    notes: "Account Notes",
    docs: "Quotes & Orders",
  };

  const detailFields = (
    <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      <InlineText label="Industry" value={profile.industry} onChange={(v) => patchProfile({ industry: v })} />
      <InlineText label="Customer Since" value={profile.since} onChange={(v) => patchProfile({ since: v })} />
      <InlineText label="Source" value={profile.source} onChange={(v) => patchProfile({ source: v })} />
      <InlineText label="Website" value={profile.website} onChange={(v) => patchProfile({ website: v })} />
      <InlineText label="Billing Email" value={profile.billingEmail} onChange={(v) => patchProfile({ billingEmail: v })} />
      <InlineSelect
        label="Preferred Channel"
        value={profile.preferredChannel}
        options={[
          { value: "Email", label: "Email" }, { value: "Phone", label: "Phone" },
          { value: "Text", label: "Text" }, { value: "In person", label: "In person" },
        ]}
        onChange={(v) => patchProfile({ preferredChannel: v })}
      />
      <InlineText label="Terms" value={c.terms} onChange={(v) => patch({ terms: v })} />
      <InlineSelect
        label="Sales Rep"
        value={c.rep}
        options={["Dale", "Angela", "Marta", "Unassigned"].map((r) => ({ value: r, label: r }))}
        onChange={(v) => patch({ rep: v })}
      />
      <InlineText label="Credit Limit" value={String(c.creditLimit)} numeric onChange={(v) => patch({ creditLimit: Number(v) || 0 })} />
      <InlineText label="Next Follow-up" value={profile.nextFollowUp ?? ""} onChange={(v) => patchProfile({ nextFollowUp: v })} />
      <div className="sm:col-span-2">
        <InlineText label="Address" value={c.address} onChange={(v) => patch({ address: v })} />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Account Summary</div>
        <Textarea
          value={profile.healthNote ?? ""}
          onChange={(e) => patchProfile({ healthNote: e.target.value })}
          placeholder="How this relationship works, who decides, what to watch…"
          className="mt-1 min-h-[64px] text-[13px]"
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tags</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {profile.tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => patchProfile({ tags: profile.tags.filter((x) => x !== t) })}
              className="rounded border border-border bg-surface-2/60 px-1.5 py-0.5 text-[11px] hover:border-late/60 hover:text-late"
              title="Remove tag"
            >
              {t} ×
            </button>
          ))}
          <Input
            placeholder="Add tag + Enter"
            className="h-7 w-40 text-[12px]"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const v = e.currentTarget.value.trim();
              if (!v) return;
              patchProfile({ tags: [...profile.tags, v] });
              e.currentTarget.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );

  const contactsTable = (
    <table className="w-full border-collapse">
      <thead><tr><th className={th}>Name</th><th className={th}>Title</th><th className={th}>Email</th><th className={th}>Phone</th><th className={th}>Portal</th></tr></thead>
      <tbody>
        {contacts.map((x) => (
          <tr key={x.id} className="row-h border-t border-border align-top">
            <td className={td}><InlineText label="" value={x.name} onChange={(v) => editContact(x.id, { name: v })} /></td>
            <td className={td}><InlineText label="" value={x.title ?? ""} onChange={(v) => editContact(x.id, { title: v })} /></td>
            <td className={td}><InlineText label="" value={x.email} onChange={(v) => editContact(x.id, { email: v })} /></td>
            <td className={td}><InlineText label="" value={x.phone} numeric onChange={(v) => editContact(x.id, { phone: v })} /></td>
            <td className={td + " text-muted-foreground"}>{x.portalAccess ?? "No access"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const docsTable = (
    <table className="w-full border-collapse">
      <thead><tr><th className={th}>Doc</th><th className={th}>PO</th><th className={th}>Due</th><th className={th}>Status</th><th className={th + " text-right"}>Total</th></tr></thead>
      <tbody>
        {mine.map((d) => (
          <tr key={d.id} className="row-h border-t border-border hover:bg-accent/60">
            <td className={td}><Link to="/sales/$id" params={{ id: d.number }} className="num text-primary hover:underline">{d.documentType} #{d.number}</Link></td>
            <td className={td + " num text-muted-foreground"}>{d.po || "—"}</td>
            <td className={td + " num"}>{d.dueDate}</td>
            <td className={td}><Status value={d.status} /></td>
            <td className={td + " num text-right"}>{money(docGrand(d))}</td>
          </tr>
        ))}
        {mine.length === 0 && <tr><td className={td + " text-muted-foreground"} colSpan={5}>No quotes or orders yet.</td></tr>}
      </tbody>
    </table>
  );

  const drillBody: Record<Exclude<Drill, null>, React.ReactNode> = {
    details: detailFields,
    contacts: (
      <div className="space-y-2">
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setContactDlg(true)}><Plus className="size-4" />Add Contact</Button>
        {contactsTable}
      </div>
    ),
    tasks: (
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} placeholder="New follow-up…" className="h-8 max-w-md text-[13px]" onKeyDown={(e) => e.key === "Enter" && addTask()} />
          <Button size="sm" className="h-8" onClick={addTask}>Add</Button>
        </div>
        <ul className="space-y-2">
          {tasks.map((t) => <TaskRow key={t.id} t={t} onToggle={() => setTasks((l) => l.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} />)}
          {tasks.length === 0 && <li className="text-[13px] text-muted-foreground">No follow-ups on this account.</li>}
        </ul>
      </div>
    ),
    pipeline: (
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>Opportunity</th><th className={th}>Stage</th><th className={th}>Doc</th><th className={th}>Updated</th><th className={th + " text-right"}>Value</th></tr></thead>
        <tbody>
          {pipeline.map((p) => (
            <tr key={p.id} className="row-h border-t border-border">
              <td className={td}>{p.label}</td>
              <td className={td}><StageChip stage={p.stage} /></td>
              <td className={td}>{p.doc ? <Link to="/sales/$id" params={{ id: p.doc }} className="num text-primary hover:underline">#{p.doc}</Link> : <span className="text-muted-foreground">—</span>}</td>
              <td className={td + " num text-muted-foreground"}>{p.updated}</td>
              <td className={td + " num text-right"}>{money(p.value)}</td>
            </tr>
          ))}
          {pipeline.length === 0 && <tr><td className={td + " text-muted-foreground"} colSpan={5}>No open opportunities.</td></tr>}
        </tbody>
      </table>
    ),
    activity: (
      <div className="space-y-3">
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setLogDlg(true)}><MessageSquarePlus className="size-4" />Log Activity</Button>
        <ul className="space-y-2.5">{activity.map((a) => <ActivityRow key={a.id} a={a} />)}</ul>
      </div>
    ),
    notes: (
      <div className="space-y-3">
        <div className="max-w-xl space-y-1.5">
          <Textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Account note…" className="min-h-[64px] text-[13px]" />
          <Button size="sm" variant="outline" className="h-8" onClick={addNote}>Add Note</Button>
        </div>
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className={cn("rounded border-l-2 pl-2 text-[13px]", n.pinned ? "border-l-warn" : "border-l-border")}>
              <p className="leading-snug">{n.pinned && <Star className="mr-1 inline size-3 text-warn" />}{n.body}</p>
              <p className="text-[11px] text-muted-foreground">{n.author} · {n.when}</p>
            </li>
          ))}
          {notes.length === 0 && <li className="text-[13px] text-muted-foreground">No account notes yet.</li>}
        </ul>
      </div>
    ),
    docs: docsTable,
  };

  /* ---------------------------------------------------------------- render */

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={<InlineText label="Account" value={c.name} onChange={(v) => patch({ name: v })} />}
        subtitle={primary ? `${primary.name}${primary.title ? ` · ${primary.title}` : ""} · ${primary.email} · ${primary.phone}` : "No contacts yet"}
        meta={
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <InlineSelect
              label=""
              value={c.status}
              options={[{ value: "Active" as const, label: "Active" }, { value: "On Hold" as const, label: "On Hold" }, { value: "Prospect" as const, label: "Prospect" }]}
              onChange={(v) => patch({ status: v })}
              render={(v) => <Status value={v} />}
              width="w-40"
            />
            <span className="text-[12px] text-muted-foreground">{c.terms} · Rep {c.rep} · {c.address}</span>
            {profile.tags.map((t) => (
              <span key={t} className="rounded border border-border bg-surface-2/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">{t}</span>
            ))}
          </div>
        }
        actions={<>
          <SaveButton state={save} onSave={commit} />
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setInfoDlg(true)}><Info className="size-4" />Customer Info</Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setLogDlg(true)}><MessageSquarePlus className="size-4" />Log Activity</Button>
          <Button size="sm" variant="outline" className="h-8">New Quote</Button>
          <Button size="sm" className="h-8">New Order</Button>
        </>}
      />

      <div className="metric-band grid grid-cols-2 lg:grid-cols-6">

        {([
          { label: "Open Pipeline", value: money(openPipeline), hint: `${pipeline.length} opportunit${pipeline.length === 1 ? "y" : "ies"}` },
          { label: "Open Orders", value: String(c.openOrders) },
          { label: "Outstanding", value: money(c.balance), tone: c.balance > 5000 ? "warn" : undefined },
          { label: "Available Credit", value: money(c.creditLimit - c.balance) },
          { label: "Open Follow-ups", value: String(openTasks.length), tone: openTasks.length > 0 ? "warn" : "ok", hint: openTasks[0]?.due ? `Next due ${openTasks[0].due}` : "All clear" },
          { label: "Last Touch", value: activity[0]?.when ?? "—", hint: `Total sales ${money(c.totalSales)}` },
        ] as { label: string; value: string; hint?: string; tone?: "warn" | "ok" }[]).map((m, i) => (
          <div key={m.label} className={cn("metric-cell", i % 2 !== 0 && "metric-cell-div", i !== 0 && "lg:metric-cell-div")}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{m.label}</div>
            <div className={cn("num mt-0.5 text-lg font-semibold leading-tight", m.tone === "warn" && "text-warn", m.tone === "ok" && "text-ok")}>{m.value}</div>
            {m.hint && <div className="text-[11px] text-muted-foreground">{m.hint}</div>}
          </div>
        ))}
      </div>

      {profile.healthNote && !drill && (
        <div className="border-l-2 border-l-primary bg-surface-2/40 px-3 py-2 text-[13px]">{profile.healthNote}</div>
      )}


      {drill ? (
        <Panel
          section
          title={drillTitle[drill]}
          action={<Button size="sm" variant="ghost" className="h-7 gap-1 text-[12px]" onClick={() => setDrill(null)}><ArrowLeft className="size-3.5" />Back to overview</Button>}
        >
          {drillBody[drill]}
        </Panel>
      ) : (
        <div className="grid gap-x-8 gap-y-8 lg:grid-cols-2 xl:grid-cols-3">
          <SummaryCard title="Account Details" hint="Edit all" onOpen={() => setDrill("details")}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <InlineText label="Industry" value={profile.industry} onChange={(v) => patchProfile({ industry: v })} />
              <InlineText label="Customer Since" value={profile.since} onChange={(v) => patchProfile({ since: v })} />
              <InlineSelect
                label="Sales Rep"
                value={c.rep}
                options={["Dale", "Angela", "Marta", "Unassigned"].map((r) => ({ value: r, label: r }))}
                onChange={(v) => patch({ rep: v })}
                width="w-40"
              />
              <InlineText label="Terms" value={c.terms} onChange={(v) => patch({ terms: v })} />
              <InlineSelect
                label="Preferred Channel"
                value={profile.preferredChannel}
                options={[
                  { value: "Email", label: "Email" }, { value: "Phone", label: "Phone" },
                  { value: "Text", label: "Text" }, { value: "In person", label: "In person" },
                ]}
                onChange={(v) => patchProfile({ preferredChannel: v })}
                width="w-40"
              />
              <InlineText label="Next Follow-up" value={profile.nextFollowUp ?? ""} onChange={(v) => patchProfile({ nextFollowUp: v })} />
            </div>
          </SummaryCard>

          <SummaryCard title="Contacts" count={`${contacts.length}`} onOpen={() => setDrill("contacts")}>
            <ul className="space-y-2">
              {contacts.slice(0, 3).map((x) => (
                <li key={x.id} className="flex items-start justify-between gap-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{x.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{x.title ?? "—"} · {x.email}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" className="size-7 p-0" aria-label={`Call ${x.name}`} onClick={() => toast.success(`Calling ${x.phone}`)}><Phone className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="size-7 p-0" aria-label={`Email ${x.name}`} onClick={() => toast.success(`Composing to ${x.email}`)}><Mail className="size-3.5" /></Button>
                  </span>
                </li>
              ))}
              {contacts.length === 0 && <li className="text-[13px] text-muted-foreground">No contacts yet.</li>}
            </ul>
            <Button size="sm" variant="outline" className="mt-2 h-7 w-full gap-1 text-[12px]" onClick={() => setContactDlg(true)}><Plus className="size-3.5" />Add Contact</Button>
          </SummaryCard>

          <SummaryCard title="Follow-ups" count={`${openTasks.length} open`} onOpen={() => setDrill("tasks")}>
            <ul className="space-y-2">
              {tasks.slice(0, 4).map((t) => <TaskRow key={t.id} t={t} onToggle={() => setTasks((l) => l.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} />)}
              {tasks.length === 0 && <li className="text-[13px] text-muted-foreground">No follow-ups scheduled.</li>}
            </ul>
            <div className="mt-2 flex gap-1.5">
              <Input value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} placeholder="New follow-up…" className="h-7 text-[12px]" onKeyDown={(e) => e.key === "Enter" && addTask()} />
              <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={addTask}>Add</Button>
            </div>
          </SummaryCard>

          <SummaryCard title="Quote Pipeline" count={money(openPipeline)} onOpen={() => setDrill("pipeline")}>
            <ul className="space-y-2">
              {pipeline.slice(0, 4).map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate">{p.label}</span>
                    <span className="mt-0.5 block"><StageChip stage={p.stage} /> <span className="text-[11px] text-muted-foreground">{p.updated}</span></span>
                  </span>
                  <span className="num shrink-0 font-medium">{money(p.value)}</span>
                </li>
              ))}
              {pipeline.length === 0 && <li className="text-[13px] text-muted-foreground">No open opportunities.</li>}
            </ul>
          </SummaryCard>

          <SummaryCard title="Relationship Activity" count={`${activity.length}`} onOpen={() => setDrill("activity")}>
            <ul className="space-y-2.5">
              {activity.slice(0, 5).map((a) => <ActivityRow key={a.id} a={a} />)}
              {activity.length === 0 && <li className="text-[13px] text-muted-foreground">Nothing logged yet.</li>}
            </ul>
            <Button size="sm" variant="outline" className="mt-2 h-7 w-full gap-1 text-[12px]" onClick={() => setLogDlg(true)}><MessageSquarePlus className="size-3.5" />Log Activity</Button>
          </SummaryCard>

          <SummaryCard title="Account Notes" count={`${notes.length}`} onOpen={() => setDrill("notes")}>
            <ul className="space-y-2">
              {notes.slice(0, 3).map((n) => (
                <li key={n.id} className={cn("rounded border-l-2 pl-2 text-[13px]", n.pinned ? "border-l-warn" : "border-l-border")}>
                  <p className="leading-snug">{n.pinned && <Star className="mr-1 inline size-3 text-warn" />}{n.body}</p>
                  <p className="text-[11px] text-muted-foreground">{n.author} · {n.when}</p>
                </li>
              ))}
              {notes.length === 0 && <li className="text-[13px] text-muted-foreground">No account notes yet.</li>}
            </ul>
          </SummaryCard>

          <SummaryCard title="Quotes & Orders" count={`${mine.length}`} onOpen={() => setDrill("docs")}>
            <ul className="space-y-1.5">
              {mine.slice(0, 5).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <Link to="/sales/$id" params={{ id: d.number }} className="num truncate text-primary hover:underline">{d.documentType} #{d.number}</Link>
                  <span className="flex shrink-0 items-center gap-2"><Status value={d.status} /><span className="num">{money(docGrand(d))}</span></span>
                </li>
              ))}
              {mine.length === 0 && <li className="text-[13px] text-muted-foreground">No quotes or orders yet.</li>}
            </ul>
          </SummaryCard>

          <SummaryCard title="Invoices" count={`${myInvoices.length}`} hint="Open AR" onOpen={() => setDrill("docs")}>
            <ul className="space-y-1.5">
              {myInvoices.slice(0, 5).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <Link to="/invoices/$id" params={{ id: i.id }} className="num truncate text-primary hover:underline">{i.id}</Link>
                  <span className="flex shrink-0 items-center gap-2"><Status value={i.status} /><span className="num text-muted-foreground">{i.issueDate ?? "—"}</span></span>
                </li>
              ))}
              {myInvoices.length === 0 && <li className="text-[13px] text-muted-foreground">No invoices.</li>}
            </ul>
          </SummaryCard>
        </div>
      )}

      {/* --------------------------------------------------------- dialogs */}

      <Dialog open={contactDlg} onOpenChange={setContactDlg}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader><DialogTitle className="text-[14px]">Add Contact</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {([["Name", "name"], ["Title", "title"], ["Email", "email"], ["Phone", "phone"]] as const).map(([label, key]) => (
              <div key={key}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
                <Input
                  value={newContact[key]}
                  onChange={(e) => setNewContact((n) => ({ ...n, [key]: e.target.value }))}
                  className="mt-1 h-8 text-[13px]"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setContactDlg(false)}>Cancel</Button>
            <Button size="sm" className="h-8" disabled={!newContact.name.trim()} onClick={addContact}>Add Contact</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logDlg} onOpenChange={setLogDlg}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader><DialogTitle className="text-[14px]">Log Activity</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {(["call", "email", "meeting", "visit", "note"] as ActivityKind[]).map((k) => (
                <Button key={k} size="sm" variant={logKind === k ? "default" : "outline"} className="h-7 text-[12px]" onClick={() => setLogKind(k)}>
                  {ACTIVITY_LABEL[k]}
                </Button>
              ))}
            </div>
            <Textarea value={logBody} onChange={(e) => setLogBody(e.target.value)} placeholder="What happened?" className="min-h-[80px] text-[13px]" />
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setLogDlg(false)}>Cancel</Button>
            <Button size="sm" className="h-8" disabled={!logBody.trim()} onClick={logActivity}>Log {ACTIVITY_LABEL[logKind]}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={infoDlg} onOpenChange={setInfoDlg}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[16px]">
              <Info className="size-5 text-primary" />
              Customer Information
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-1">
            <div className="space-y-1">
              <div className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Business Name</div>
              <div className="text-xl font-semibold leading-tight">{c.name}</div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                <MapPin className="size-3.5" /> Business Address
              </div>
              <div className="text-base leading-snug">{c.address}</div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Phone className="size-3.5" /> Phone Number
                </div>
                <div className="text-lg font-semibold">{primary?.phone ?? "—"}</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Mail className="size-3.5" /> Email Address
                </div>
                <div className="text-lg font-semibold">{primary?.email ?? "—"}</div>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Primary Contact</div>
                <div className="text-base font-semibold">{primary?.name ?? "—"}</div>
                <div className="text-[13px] text-muted-foreground">{primary?.title ?? "—"}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Billing Email</div>
                <div className="text-base font-semibold">{profile.billingEmail ?? "—"}</div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" className="h-8" onClick={() => setInfoDlg(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
