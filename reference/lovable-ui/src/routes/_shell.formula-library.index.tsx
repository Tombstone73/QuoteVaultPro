import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Archive, Copy, Globe2, Library, MoreHorizontal, Pencil, Plus, Search, Sparkles, Users,
} from "lucide-react";
import { PageHeader, Panel, EmptyState, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Chip, Picker, Segmented } from "@/components/app/product-editor/fields";
import { FormulaChips, StatusChip } from "@/components/app/formula/badges";
import { DuplicateFormulaDialog } from "@/components/app/formula/dialogs";
import {
  FORMULA_PURPOSES, myFormulas, revisionNumber, sharedFormulas, type Formula,
} from "@/lib/mock/formulas";

export const Route = createFileRoute("/_shell/formula-library/")({
  head: () => ({
    meta: [
      { title: "Formula Library — PrintersHero V2" },
      { name: "description", content: "Reusable pricing formulas for your products: sheet yield, roll nesting, area pricing and finishing, with immutable revisions, declared inputs and usage." },
      { property: "og:title", content: "Formula Library — PrintersHero V2" },
      { property: "og:description", content: "Reusable pricing formulas with immutable revisions, declared product inputs and a formula tester." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FormulaLibraryPage,
});

const STATUS_FILTERS = ["All statuses", "Active", "Inactive", "Archived"] as const;
const PURPOSE_FILTERS = ["All purposes", ...FORMULA_PURPOSES] as const;

function FormulaLibraryPage() {
  const [tab, setTab] = useState<"mine" | "shared">("mine");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("All statuses");
  const [purpose, setPurpose] = useState<(typeof PURPOSE_FILTERS)[number]>("All purposes");
  const [dupTarget, setDupTarget] = useState<Formula | null>(null);

  const rows = useMemo(() => {
    const source = tab === "mine" ? myFormulas : sharedFormulas;
    const needle = q.trim().toLowerCase();
    return source.filter((f) => {
      if (needle && !`${f.name} ${f.description} ${f.purpose}`.toLowerCase().includes(needle)) return false;
      if (status !== "All statuses" && f.status !== status) return false;
      if (purpose !== "All purposes" && f.purpose !== purpose) return false;
      return true;
    });
  }, [tab, q, status, purpose]);

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title="Formula Library"
        subtitle="Reusable pricing formulas for your products."
        actions={
          <Button size="sm" className="h-8 gap-1.5" asChild>
            <Link to="/formula-library/$id" params={{ id: "new" }}><Plus className="size-4" />New Formula</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={tab}
          onChange={setTab}
          items={[
            { id: "mine" as const, label: `My formulas (${myFormulas.length})` },
            { id: "shared" as const, label: `Shared formulas (${sharedFormulas.length})` },
          ]}
        />
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-7 text-[13px]" placeholder="Search formulas" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {tab === "mine" && <Picker className="w-[150px]" value={status} items={STATUS_FILTERS} onChange={setStatus} />}
        <Picker className="w-[170px]" value={purpose} items={PURPOSE_FILTERS} onChange={setPurpose} />
      </div>

      {tab === "shared" && <SharedComingSoonNotice />}

      {rows.length === 0 ? (
        <Panel><EmptyState title="No formulas match these filters" hint="Clear the search or filters, or create a new formula." /></Panel>
      ) : tab === "mine" ? (
        <MyFormulasTable rows={rows} onDuplicate={setDupTarget} />
      ) : (
        <SharedFormulaGrid rows={rows} />
      )}

      <DuplicateFormulaDialog
        formula={dupTarget}
        open={dupTarget !== null}
        onOpenChange={(o) => { if (!o) setDupTarget(null); }}
        onConfirm={(name) => toast.success(`${name} created`)}
      />
    </div>
  );
}

function SharedComingSoonNotice() {
  return (
    <Panel className="flex flex-wrap items-start gap-3 p-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary/12 text-primary">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[13px] font-semibold">Shared formulas</h2>
          <Chip tone="accent">Coming soon</Chip>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Organizations will be able to share reusable pricing formulas, and other shops will be able to copy an
          independent version into their own Formula Library. Copies stay independent — the original owner can stop
          sharing later without changing anyone else&apos;s pricing.
        </p>
        <p className="text-[11px] text-muted-foreground">
          The formulas below are reference examples that show the intended experience. They are not live data from other
          organizations, and copying is not available yet.
        </p>
      </div>
    </Panel>
  );
}

function MyFormulasTable({
  rows, onDuplicate,
}: { rows: Formula[]; onDuplicate: (f: Formula) => void }) {
  return (
    <Panel dense>
      {/* desktop: dense table */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Formula</th>
              <th className={th}>Purpose</th>
              <th className={th}>Status</th>
              <th className={th + " text-right"}>Revision</th>
              <th className={th + " text-right"}>Inputs</th>
              <th className={th + " text-right"}>Products</th>
              <th className={th}>Updated</th>
              <th className={th + " text-right"}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-t border-border align-top hover:bg-accent/60">
                <td className={td + " max-w-[420px] py-2"}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link to="/formula-library/$id" params={{ id: f.id }} className="font-medium text-primary hover:underline">{f.name}</Link>
                    <FormulaChips formula={f} />
                  </div>
                  <p className="line-clamp-1 text-[12px] text-muted-foreground">
                    {f.visibility === "Product-scoped" && f.scopeProduct ? `${f.scopeProduct} · ` : ""}{f.description}
                  </p>
                </td>
                <td className={td + " py-2 text-muted-foreground"}>{f.purpose}</td>
                <td className={td + " py-2"}><StatusChip status={f.status} /></td>
                <td className={td + " num py-2 text-right"}>{revisionNumber(f)}</td>
                <td className={td + " num py-2 text-right"}>{f.inputs.length}</td>
                <td className={td + " num py-2 text-right"}>{f.usage.length}</td>
                <td className={td + " num py-2 text-muted-foreground"}>{f.updated}</td>
                <td className={td + " py-2 text-right"}><RowActions f={f} onDuplicate={onDuplicate} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* narrow: compact cards */}
      <div className="divide-y divide-border lg:hidden">
        {rows.map((f) => (
          <div key={f.id} className="space-y-1 p-3">
            <div className="flex items-start gap-2">
              <Link to="/formula-library/$id" params={{ id: f.id }} className="min-w-0 flex-1 text-[13px] font-medium text-primary hover:underline">{f.name}</Link>
              <RowActions f={f} onDuplicate={onDuplicate} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5"><FormulaChips formula={f} /></div>
            <p className="text-[12px] text-muted-foreground">{f.description}</p>
            <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              <span>{f.purpose}</span>
              <span>Rev {revisionNumber(f)}</span>
              <span>{f.inputs.length} inputs</span>
              <span>{f.usage.length} products</span>
              <span>Updated {f.updated}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RowActions({ f, onDuplicate }: { f: Formula; onDuplicate: (f: Formula) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Actions for ${f.name}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link to="/formula-library/$id" params={{ id: f.id }} className="text-[13px]"><Pencil className="mr-2 size-3.5" />Edit formula</Link>
        </DropdownMenuItem>
        <DropdownMenuItem className="text-[13px]" onSelect={() => onDuplicate(f)}><Copy className="mr-2 size-3.5" />Duplicate</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/formula-library/$id" params={{ id: f.id }} hash="usage" className="text-[13px]"><Users className="mr-2 size-3.5" />View usage ({f.usage.length})</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {f.visibility === "Product-scoped" && (
          <DropdownMenuItem
            className="text-[13px]"
            onSelect={() => toast.success(`${f.name} is now available to every product in your organization`)}
          >
            <Library className="mr-2 size-3.5" />Add to Library
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled className="text-[13px]">
          <Globe2 className="mr-2 size-3.5" />Share with other shops
          <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">Soon</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-[13px]"
          onSelect={() =>
            toast.success(
              f.status === "Active" ? `${f.name} deactivated — products keep their current revision` : `${f.name} archived`,
            )
          }
        >
          <Archive className="mr-2 size-3.5" />{f.status === "Active" ? "Deactivate" : "Archive"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SharedFormulaGrid({ rows }: { rows: Formula[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {rows.map((f) => (
        <Panel key={f.id} className="flex flex-col gap-2 p-3">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 text-[13px] font-semibold">{f.name}</h2>
            <span className="num shrink-0 text-[11px] text-muted-foreground">Rev {revisionNumber(f)}</span>
          </div>
          <p className="text-[12px] text-muted-foreground">{f.description}</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            <dt className="text-muted-foreground">Shared by</dt><dd className="truncate">{f.sharedBy}</dd>
            <dt className="text-muted-foreground">Purpose</dt><dd className="truncate">{f.purpose}</dd>
            <dt className="text-muted-foreground">Declared inputs</dt><dd className="num">{f.inputs.length}</dd>
            <dt className="text-muted-foreground">Copies</dt><dd className="num">{f.copies ?? 0}</dd>
            <dt className="text-muted-foreground">Updated</dt><dd className="num">{f.updated}</dd>
          </dl>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 text-[12px]" asChild>
              <Link to="/formula-library/$id" params={{ id: f.id }}>View</Link>
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[12px]" asChild>
              <Link to="/formula-library/$id" params={{ id: f.id }} hash="tester">Test</Link>
            </Button>
            <Button size="sm" className="h-7 gap-1.5 text-[12px]" disabled title="Copying shared formulas is coming soon">
              <Copy className="size-3.5" />Copy to my library
            </Button>
            <Chip tone="accent">Coming soon</Chip>
          </div>
        </Panel>
      ))}
    </div>
  );
}
