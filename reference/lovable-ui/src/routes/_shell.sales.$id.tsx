import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Copy, GitCommitVertical, MoreHorizontal, Plus, Send } from "lucide-react";
import { useApp } from "@/lib/app-store";
import { Panel, Status, Thumb, td, th } from "@/components/app/primitives";
import {
  InlineDate,
  InlineSelect,
  InlineText,
  LifecycleStrip,
  SaveButton,
  type SaveState,
} from "@/components/app/sales-editable";
import { LineEditor } from "@/components/app/line-editor";
import { LineArtCell, makeLineArt } from "@/components/app/line-art";
import { OrderContextBand } from "@/components/app/order-context";
import { OrderNotesStrip } from "@/components/app/order-notes";
import { SplitWorkspace, useSplitPreference } from "@/components/app/split-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import {
  customers,
  docGrand,
  docTax,
  docTotal,
  invoicePaid,
  lineTotal,
  money,
  products,
  type LineArt,
  type LineItem,
  type SalesDoc,
} from "@/lib/mock/data";
import { lineSides } from "@/lib/mock/order-context";
import { optionDefsFor, requiresDimensions } from "@/lib/mock/product-config";

export const Route = createFileRoute("/_shell/sales/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Sales Workspace #${params.id} — PrintersHero V2` },
      {
        name: "description",
        content:
          "One shared editable workspace for quotes and orders: line items, artwork, notes, billing, fulfillment and history.",
      },
      { property: "og:title", content: `Sales Workspace #${params.id}` },
      {
        property: "og:description",
        content: "Quotes and orders share the same editable workspace in PrintersHero V2.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalesWorkspace,
});

const ROUTE_STEPS = ["Proofing", "Prepress", "Production", "Finishing", "Fulfillment"] as const;
const REPS = ["Dale", "Angela", "Marco"];
const TERMS = ["Net 15", "Net 30", "Net 45", "Prepay", "Credit Card on File"];
const FULFILLMENT = ["Customer Pickup", "UPS Ground", "Local Delivery", "Freight"];

interface HeaderDraft {
  customerId: string;
  contactId: string;
  po: string;
  dueDate: string;
  rep: string;
  terms: string;
  shipMethod: string;
  jobName: string;
}

function SalesWorkspace() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const {
    getDoc,
    updateLine,
    removeLine,
    addLine,
    convertToOrder,
    invoices,
    patchDoc,
    logHistory,
  } = useApp();
  const doc = getDoc(id);

  if (!doc) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No quote or order #{id}.{" "}
        <Link to="/orders" className="text-primary hover:underline">
          Back to Orders
        </Link>
      </div>
    );
  }
  return (
    <Workspace
      key={doc.id}
      doc={doc}
      {...{
        navigate,
        updateLine,
        removeLine,
        addLine,
        convertToOrder,
        invoices,
        patchDoc,
        logHistory,
      }}
    />
  );
}

type Actions = {
  navigate: ReturnType<typeof useNavigate>;
  updateLine: ReturnType<typeof useApp>["updateLine"];
  removeLine: ReturnType<typeof useApp>["removeLine"];
  addLine: ReturnType<typeof useApp>["addLine"];
  convertToOrder: ReturnType<typeof useApp>["convertToOrder"];
  invoices: ReturnType<typeof useApp>["invoices"];
  patchDoc: ReturnType<typeof useApp>["patchDoc"];
  logHistory: ReturnType<typeof useApp>["logHistory"];
};

function Workspace({
  doc,
  navigate,
  updateLine,
  removeLine,
  addLine,
  convertToOrder,
  invoices,
  patchDoc,
  logHistory,
}: { doc: SalesDoc } & Actions) {
  const isQuote = doc.documentType === "Quote";
  const invoice = invoices.find((i) => i.id === doc.invoiceId);

  const [selected, setSelected] = useState<string | null>(null);
  const [splitPct, setSplitPct] = useSplitPreference();
  const [newLine, setNewLine] = useState<LineItem | null>(null);

  const baseline = useMemo<HeaderDraft>(
    () => ({
      customerId: doc.customerId,
      contactId: doc.contactId,
      po: doc.po,
      dueDate: doc.dueDate,
      rep: doc.rep,
      terms: customers.find((c) => c.id === doc.customerId)?.terms ?? "Net 30",
      shipMethod: doc.shipMethod ?? "Customer Pickup",
      jobName: doc.jobName ?? "",
    }),
    [doc],
  );

  const [draft, setDraft] = useState<HeaderDraft>(baseline);
  const [state, setState] = useState<SaveState>("clean");
  useEffect(() => {
    setDraft(baseline);
  }, [baseline]);

  const dirtyKeys = (Object.keys(baseline) as (keyof HeaderDraft)[]).filter(
    (k) => draft[k] !== baseline[k],
  );
  const set = (p: Partial<HeaderDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setState("dirty");
  };

  const customer = customers.find((c) => c.id === draft.customerId);
  const contact = customer?.contacts.find((c) => c.id === draft.contactId) ?? customer?.contacts[0];

  const saveHeader = () => {
    setState("saving");
    window.setTimeout(() => {
      patchDoc(doc.id, {
        customerId: draft.customerId,
        contactId: draft.contactId,
        po: draft.po,
        dueDate: draft.dueDate,
        rep: draft.rep,
        shipMethod: draft.shipMethod,
        jobName: draft.jobName,
      });
      dirtyKeys.forEach((k) => logHistory(doc.id, `${LABELS[k]} updated to "${draft[k]}"`, "edit"));
      setState("saved");
      window.setTimeout(() => setState((s) => (s === "saved" ? "clean" : s)), 1600);
    }, 500);
  };

  const tabs = isQuote
    ? ["Items", "Artwork", "Notes", "History"]
    : ["Items", "Artwork", "Notes", "Billing", "Fulfillment", "History"];

  const editing = newLine ?? doc.lines.find((l) => l.id === selected) ?? null;

  /** Attach Line Item Art without leaving the Order. Artwork still owns versions/relationships. */
  const attachArt = (line: LineItem, names: string[]) => {
    const sides = lineSides(line);
    const existing = line.art ?? [];
    const added: LineArt[] = names.map((n, i) => {
      const side =
        sides.find(
          (sd) =>
            !existing.some((a) => a.kind === "line" && a.side === sd) && sides.indexOf(sd) >= i,
        ) ?? sides[Math.min(i, sides.length - 1)]!;
      return makeLineArt(n, side);
    });
    updateLine(doc.id, line.id, {
      art: [...existing, ...added],
      ...(line.artworkStatus === "Needs Artwork"
        ? { artworkStatus: "Proof Pending" as const }
        : {}),
    });
    logHistory(doc.id, `Artwork attached to line — ${names.join(", ")}`, "edit");
    toast.success(names.length > 1 ? `${names.length} files attached` : `${names[0]} attached`, {
      description: "Attached to this line item. Versions are managed in Artwork.",
    });
  };

  const startNewLine = () => {
    const p = products[1];
    if (!p) return;
    setSelected(null);
    setNewLine({
      id: `l-${Date.now()}`,
      productId: p.id,
      description: `${p.name} — new line`,
      size: requiresDimensions(p) ? '24" × 18"' : undefined,
      qty: 25,
      options: optionDefsFor(p.id).map((d) => ({ label: d.label, value: d.default })),
      calcUnit: 12.6,
      sellUnit: 12.6,
      artworkStatus: "Needs Artwork",
      routeStep: "Proofing",
    });
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* ---------- Header (identical structure for Quote and Order) ---------- */}
      <div className="border-b border-border bg-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="num text-base font-semibold">
            {doc.documentType} #{doc.number}
          </h1>
          <Status value={doc.status} />
          {doc.convertedTo && (
            <Link
              to="/sales/$id"
              params={{ id: doc.convertedTo }}
              className="flex items-center gap-1 text-[12px] text-primary hover:underline"
            >
              Order #{doc.convertedTo} <ArrowRight className="size-3" />
            </Link>
          )}
          {doc.convertedFrom && (
            <span className="text-[12px] text-muted-foreground">
              from Quote #{doc.convertedFrom}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <SaveButton state={state} onSave={saveHeader} />
            {isQuote ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => {
                    logHistory(doc.id, `Quote sent to ${contact?.email}`, "revision");
                    toast.success("Quote sent", {
                      description: `Revision preserved for ${contact?.email}`,
                    });
                  }}
                >
                  <Send className="size-3.5" /> Send Quote
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    const num = convertToOrder(doc.id);
                    if (num) {
                      toast.success(`Order #${num} created`, {
                        description: `Draft Invoice INV-${num} created automatically.`,
                      });
                      void navigate({ to: "/sales/$id", params: { id: num } });
                    }
                  }}
                >
                  Convert to Order
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => toast.success("Order duplicated")}
              >
                <Copy className="size-3.5" /> Duplicate
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem>Print / PDF</DropdownMenuItem>
                <DropdownMenuItem>Email to contact</DropdownMenuItem>
                <DropdownMenuItem>Add alternative option</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">
                  {isQuote ? "Mark Declined" : "Cancel Order"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Customer identity + editable metadata */}
        <div className="mt-2.5 flex flex-wrap items-start gap-x-6 gap-y-2">
          <div className="min-w-[220px]">
            <div className="flex items-center gap-1.5">
              <Link
                to="/customers/$id"
                params={{ id: draft.customerId }}
                className="text-[15px] font-semibold hover:text-primary hover:underline"
              >
                {customer?.name}
              </Link>
              <InlineSelect
                label=""
                value={draft.customerId}
                options={customers.map((c) => ({
                  value: c.id,
                  label: c.name,
                  hint: `${c.terms} · ${c.rep}`,
                }))}
                onChange={(v) => {
                  const next = customers.find((c) => c.id === v);
                  set({
                    customerId: v,
                    contactId: next?.primaryContactId ?? "",
                    terms: next?.terms ?? draft.terms,
                  });
                }}
                render={() => <span className="text-[11px] text-muted-foreground">Change</span>}
                dirty={draft.customerId !== baseline.customerId}
                width="w-64"
              />
            </div>
            <div className="mt-0.5">
              <InlineSelect
                label="Contact"
                value={draft.contactId}
                options={(customer?.contacts ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                  hint: `${c.email} · ${c.phone}`,
                }))}
                onChange={(v) => set({ contactId: v })}
                dirty={draft.contactId !== baseline.contactId}
                render={() => (
                  <span>
                    <span className="text-[13px] font-medium">{contact?.name}</span>
                    <span className="num block text-[12px] text-muted-foreground">
                      {contact?.email} · {contact?.phone}
                    </span>
                  </span>
                )}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-x-6 gap-y-1.5">
            <InlineText
              label="PO #"
              value={draft.po}
              numeric
              dirty={draft.po !== baseline.po}
              onChange={(v) => set({ po: v })}
            />
            <InlineDate
              label="Requested Due"
              value={draft.dueDate}
              dirty={draft.dueDate !== baseline.dueDate}
              onChange={(v) => set({ dueDate: v })}
            />
            <InlineSelect
              label="Sales Rep"
              value={draft.rep}
              options={REPS.map((r) => ({ value: r, label: r }))}
              dirty={draft.rep !== baseline.rep}
              onChange={(v) => set({ rep: v })}
              width="w-40"
            />
            <InlineSelect
              label="Terms"
              value={draft.terms}
              options={TERMS.map((t) => ({ value: t, label: t }))}
              dirty={draft.terms !== baseline.terms}
              onChange={(v) => set({ terms: v })}
              width="w-48"
            />
            <InlineSelect
              label="Fulfillment"
              value={draft.shipMethod}
              options={FULFILLMENT.map((f) => ({ value: f, label: f }))}
              dirty={draft.shipMethod !== baseline.shipMethod}
              onChange={(v) => set({ shipMethod: v })}
              width="w-48"
            />
            <InlineText
              label="Job Name"
              value={draft.jobName}
              placeholder="Add internal job name"
              dirty={draft.jobName !== baseline.jobName}
              onChange={(v) => set({ jobName: v })}
            />
          </div>
        </div>

        {!isQuote && (
          <div className="mt-2">
            <LifecycleStrip stages={lifecycle(doc, invoice?.status)} />
          </div>
        )}
      </div>

      {/* ---------- Body ---------- */}
      <Tabs defaultValue="Items" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="h-9 justify-start rounded-none border-b border-border bg-transparent px-4">
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t} className="text-[13px] data-[state=active]:bg-accent">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="Items" className="m-0 min-h-0 flex-1">
          <SplitWorkspace
            pct={splitPct}
            onChange={setSplitPct}
            left={
              <div className="h-full min-w-0 overflow-y-auto p-4">
                {!isQuote && <OrderContextBand doc={doc} invoice={invoice} />}
                <OrderNotesStrip doc={doc} onSave={(patch) => patchDoc(doc.id, patch)} />
                <div className="panel overflow-hidden">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={th + " w-[150px]"}>Art</th>
                        <th className={th}>Product</th>
                        <th className={th}>Configuration</th>
                        <th className={th + " text-right"}>Qty</th>
                        <th className={th + " text-right"}>Unit</th>
                        <th className={th + " text-right"}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map((l) => {
                        const product = products.find((p) => p.id === l.productId);
                        const overridden = Math.abs(l.sellUnit - l.calcUnit) > 0.001;
                        return (
                          <tr
                            key={l.id}
                            onClick={() => {
                              setNewLine(null);
                              setSelected(l.id === selected ? null : l.id);
                            }}
                            className={cn(
                              "row-h cursor-pointer border-t border-border hover:bg-accent/60",
                              selected === l.id && "bg-primary/8",
                            )}
                          >
                            <td className={td}>
                              <LineArtCell
                                line={l}
                                orderNumber={doc.number}
                                onUpload={(names) => attachArt(l, names)}
                              />
                            </td>
                            <td className={td}>
                              <span className="flex items-center gap-2">
                                <Thumb label={product?.name ?? l.description} />
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">
                                    {product?.name}
                                  </span>
                                  <span className="num block text-[11px] text-muted-foreground">
                                    {product?.sku}
                                    {l.size ? ` · ${l.size}` : ""}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td className={td + " text-muted-foreground"}>
                              <span className="block max-w-[280px] truncate">{l.description}</span>
                              <span className="block max-w-[280px] truncate text-[11px]">
                                {l.options.map((o) => `${o.label}: ${o.value}`).join(" · ") ||
                                  "No options"}
                              </span>
                            </td>
                            <td className={td + " num text-right"}>{l.qty}</td>
                            <td className={td + " text-right"}>
                              <span className="num">{money(l.sellUnit)}</span>
                              {overridden && (
                                <HoverCard>
                                  <HoverCardTrigger asChild>
                                    <span className="ml-1.5 cursor-help rounded border border-border px-1 text-[10px] text-muted-foreground">
                                      Manual
                                    </span>
                                  </HoverCardTrigger>
                                  <HoverCardContent className="w-64 text-[12px]">
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">Calculated</span>
                                      <span className="num">{money(l.calcUnit)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">Selling</span>
                                      <span className="num">{money(l.sellUnit)}</span>
                                    </div>
                                    <div className="mt-1.5 border-t border-border pt-1.5 text-muted-foreground">
                                      {l.overrideReason} — {l.overrideBy}
                                    </div>
                                  </HoverCardContent>
                                </HoverCard>
                              )}
                            </td>
                            <td className={td + " num text-right font-medium"}>
                              {money(lineTotal(l))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-border px-3 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-[12px]"
                      onClick={startNewLine}
                    >
                      <Plus className="size-3.5" /> Add line item
                    </Button>
                    <div className="w-56 space-y-1 text-[13px]">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Subtotal</span>
                        <span className="num">{money(docTotal(doc))}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Tax (7%)</span>
                        <span className="num">{money(docTax(doc))}</span>
                      </div>
                      <div className="flex justify-between border-t border-border pt-1 text-[15px] font-semibold">
                        <span>Total</span>
                        <span className="num">{money(docGrand(doc))}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {isQuote && (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Alternative options (10452-B, 10452-C) can be added from the overflow menu —
                    each becomes its own priced set of lines under this quote.
                  </p>
                )}
              </div>
            }
            right={
              editing ? (
                <LineEditor
                  docNumber={doc.number}
                  mode={newLine ? "new" : "edit"}
                  line={editing}
                  onAttachArt={(names: string[]) => {
                    if (!newLine) attachArt(editing, names);
                  }}
                  onClose={() => {
                    setNewLine(null);
                    setSelected(null);
                  }}
                  onCommit={(l) => {
                    if (newLine) {
                      addLine(doc.id, l);
                      logHistory(
                        doc.id,
                        `Line added — ${products.find((p) => p.id === l.productId)?.name} × ${l.qty}`,
                        "edit",
                      );
                      setNewLine(null);
                      setSelected(l.id);
                      toast.success("Line item added");
                    } else {
                      updateLine(doc.id, l.id, l);
                      logHistory(
                        doc.id,
                        `Line updated — ${products.find((p) => p.id === l.productId)?.name} × ${l.qty}`,
                        "edit",
                      );
                      toast.success("Line item saved");
                    }
                  }}
                  onDuplicate={() => {
                    addLine(doc.id, { ...editing, id: `l-${Date.now()}` });
                    logHistory(doc.id, "Line duplicated", "edit");
                    toast.success("Line duplicated");
                  }}
                  onDelete={() => {
                    removeLine(doc.id, editing.id);
                    logHistory(
                      doc.id,
                      `Line deleted — ${products.find((p) => p.id === editing.productId)?.name}`,
                      "edit",
                    );
                    setSelected(null);
                    toast.success("Line deleted");
                  }}
                />
              ) : null
            }
          />
        </TabsContent>

        <TabsContent value="Artwork" className="m-0 p-4">
          <Panel title="Artwork chain" dense>
            <ul className="divide-y divide-border">
              {doc.lines.map((l) => {
                const doubleSided = l.options.some(
                  (o) => o.label === "Sides" && o.value === "Double",
                );
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <Thumb label={l.description} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{l.description}</span>
                    <span className="num flex items-center gap-2 text-[12px] text-muted-foreground">
                      <span>customer-art.pdf</span>
                      <ArrowRight className="size-3" />
                      <span>print-ready{doubleSided ? "-front" : ""}.pdf</span>
                      {doubleSided && (
                        <>
                          <ArrowRight className="size-3" />
                          <span>print-ready-back.pdf</span>
                        </>
                      )}
                    </span>
                    <Status value={l.artworkStatus} />
                    <Button size="sm" variant="outline" className="h-7 text-[12px]" asChild>
                      <Link to="/artwork">Open</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </TabsContent>

        <TabsContent value="Notes" className="m-0 p-4">
          <div className="grid max-w-4xl gap-4 md:grid-cols-2">
            <Panel title="Internal notes (staff only)">
              <Textarea
                defaultValue={doc.notes}
                rows={5}
                className="text-[13px]"
                onBlur={(e) => patchDoc(doc.id, { notes: e.target.value })}
                placeholder="Notes visible to staff only."
              />
            </Panel>
            <Panel title="Customer-facing notes">
              <Textarea
                defaultValue={doc.customerNotes ?? ""}
                rows={5}
                className="text-[13px]"
                onBlur={(e) => patchDoc(doc.id, { customerNotes: e.target.value })}
                placeholder="Appears on the printed document and customer portal."
              />
            </Panel>
          </div>
        </TabsContent>

        {!isQuote && (
          <TabsContent value="Billing" className="m-0 p-4">
            <div className="panel max-w-md p-3">
              <div className="flex items-center justify-between">
                <h2 className="num text-[15px] font-semibold">{invoice?.number}</h2>
                <Status value={invoice?.status ?? "Draft"} />
              </div>
              <dl className="mt-3 space-y-1 text-[13px]">
                <Row label="Total" value={money(docGrand(doc))} />
                <Row label="Paid" value={money(invoice ? invoicePaid(invoice) : 0)} />
                <div className="flex justify-between border-t border-border pt-1 font-semibold">
                  <dt>Balance</dt>
                  <dd className="num">
                    {money(docGrand(doc) - (invoice ? invoicePaid(invoice) : 0))}
                  </dd>
                </div>
              </dl>
              {invoice && (
                <Button size="sm" className="mt-3 h-8" asChild>
                  <Link to="/invoices/$id" params={{ id: invoice.id }}>
                    Open Invoice
                  </Link>
                </Button>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Payments are recorded on the invoice.
              </p>
            </div>
          </TabsContent>
        )}

        {!isQuote && (
          <TabsContent value="Fulfillment" className="m-0 p-4">
            <FulfillmentTab doc={doc} />
          </TabsContent>
        )}

        <TabsContent value="History" className="m-0 p-4">
          <Panel title="History" dense>
            <ol className="divide-y divide-border">
              {doc.history.map((h, i) => (
                <li key={i} className="flex gap-3 px-3 py-2">
                  <GitCommitVertical
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      h.kind === "revision"
                        ? "text-primary"
                        : h.kind === "convert"
                          ? "text-ok"
                          : "text-muted-foreground",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-[13px]">{h.what}</div>
                    <div className="num text-[11px] text-muted-foreground">
                      {h.at} · {h.who}
                    </div>
                  </div>
                  {h.kind === "revision" && (
                    <Button size="sm" variant="outline" className="ml-auto h-7 text-[11px]">
                      View sent revision
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const LABELS: Record<keyof HeaderDraft, string> = {
  customerId: "Customer",
  contactId: "Contact",
  po: "PO number",
  dueDate: "Requested due date",
  rep: "Sales rep",
  terms: "Terms",
  shipMethod: "Fulfillment method",
  jobName: "Job name",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

/** Informational only, and tolerant of line items sitting at different steps. */
function lifecycle(doc: SalesDoc, invoiceStatus?: string) {
  const idxs = doc.lines.map((l) => ROUTE_STEPS.indexOf(l.routeStep));
  const min = Math.min(...idxs),
    max = Math.max(...idxs);
  const stage = (i: number, name: string) => {
    const state = max < i ? "todo" : min > i ? "done" : min === max ? "active" : "mixed";
    const at = idxs.filter((x) => x === i).length;
    return {
      name,
      state,
      ...(state === "mixed" && at ? { detail: `${at}/${doc.lines.length}` } : {}),
    } as { name: string; state: "done" | "active" | "mixed" | "todo"; detail?: string };
  };
  return [
    { name: "Order", state: "done" as const },
    stage(0, "Artwork"),
    stage(1, "Prepress"),
    stage(2, "Production"),
    stage(4, "Fulfillment"),
    {
      name: "Invoice",
      state: (invoiceStatus === "Paid" ? "done" : invoiceStatus === "Draft" ? "todo" : "active") as
        "done" | "todo" | "active",
      detail: invoiceStatus,
    },
  ];
}

function FulfillmentTab({ doc }: { doc: SalesDoc }) {
  const { updateLine } = useApp();
  const [pick, setPick] = useState<Record<string, number>>({});
  return (
    <div className="space-y-4">
      <Panel
        title="Pickup / Handoff"
        action={
          <Button size="sm" variant="outline" className="h-7 text-[11px]" asChild>
            <Link to="/fulfillment">Open Fulfillment workstation</Link>
          </Button>
        }
        dense
      >
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Product</th>
              <th className={th + " text-right"}>Ordered</th>
              <th className={th + " text-right"}>Picked Up</th>
              <th className={th + " text-right"}>Remaining</th>
              <th className={th + " w-40 text-right"}>Pickup Now</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => {
              const done = l.pickedUp ?? 0;
              const remaining = l.qty - done;
              return (
                <tr key={l.id} className="row-h border-t border-border">
                  <td className={td}>{l.description}</td>
                  <td className={td + " num text-right"}>{l.qty}</td>
                  <td className={td + " num text-right"}>{done}</td>
                  <td className={td + " num text-right"}>{remaining}</td>
                  <td className={td + " text-right"}>
                    <div className="flex items-center justify-end gap-1.5 py-1">
                      <Input
                        type="number"
                        className="num h-7 w-20 text-right"
                        value={pick[l.id] ?? 0}
                        onChange={(e) =>
                          setPick((p) => ({ ...p, [l.id]: Number(e.target.value) || 0 }))
                        }
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setPick((p) => ({ ...p, [l.id]: remaining }))}
                      >
                        All
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex justify-end gap-2 border-t border-border p-2">
          <Button
            size="sm"
            className="h-8"
            onClick={() => {
              doc.lines.forEach((l) => {
                const n = pick[l.id] ?? 0;
                if (n > 0) updateLine(doc.id, l.id, { pickedUp: (l.pickedUp ?? 0) + n });
              });
              setPick({});
              toast.success("Pickup recorded", {
                description: "Handoff added to immutable pickup history.",
              });
            }}
          >
            Complete Pickup
          </Button>
        </div>
      </Panel>

      <Panel title="Pickup History" dense>
        <ul className="divide-y divide-border text-[13px]">
          <li className="flex justify-between px-3 py-2">
            <span>Aug 14, 1:15 PM · Susan Johnson</span>
            <span className="num text-muted-foreground">40 × 4mm Coroplast Sign</span>
          </li>
          <li className="flex justify-between px-3 py-2">
            <span>Aug 13, 9:40 AM · Marcus Webb</span>
            <span className="num text-muted-foreground">Sample proof set</span>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
