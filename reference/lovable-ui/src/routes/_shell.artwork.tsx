import { Link, createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Status, Thumb, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { artworkFiles, salesDocs } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/artwork")({
  validateSearch: (s: Record<string, unknown>): { order?: string; line?: string } => ({
    ...(typeof s["order"] === "string" ? { order: s["order"] as string } : {}),
    ...(typeof s["line"] === "string" ? { line: s["line"] as string } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Artwork — PrintersHero V2" },
      {
        name: "description",
        content:
          "Artwork intake and proof approvals with file versions, preflight flags and customer sign-off.",
      },
      { property: "og:title", content: "Artwork — PrintersHero V2" },
      { property: "og:description", content: "Files, proofs and approvals in one queue." },
    ],
  }),
  component: ArtworkPage,
});

function ArtworkPage() {
  // Context preserved from Sales: /artwork?order=…&line=… focuses that record.
  const { order: focusOrder, line: focusLine } = Route.useSearch();
  const rows = focusOrder ? artworkFiles.filter((a) => a.order === focusOrder) : artworkFiles;
  const list = rows.length ? rows : artworkFiles;

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title="Artwork"
        subtitle="Files attach to line items, not just orders."
        actions={
          <Button size="sm" className="h-8">
            Upload Files
          </Button>
        }
      />
      {focusOrder && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/8 px-3 py-1.5 text-[12px]">
          <span className="font-semibold">
            Focused on Order #{focusOrder}
            {focusLine ? ` · line ${focusLine}` : ""}
          </span>
          <span className="text-muted-foreground">
            Versions, relationships and derived files are managed here.
          </span>
          <Link
            to="/sales/$id"
            params={{ id: salesDocs.find((d) => d.number === focusOrder)?.id ?? focusOrder }}
            className="ml-auto text-primary hover:underline"
          >
            Back to Order #{focusOrder}
          </Link>
        </div>
      )}
      <Panel dense>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>File</th>
              <th className={th}>Order</th>
              <th className={th}>Type</th>
              <th className={th}>Size</th>
              <th className={th}>Derived file</th>
              <th className={th}>Status</th>
              <th className={th + " w-28"} />
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="row-h border-t border-border">
                <td className={td}>
                  <div className="flex items-center gap-2 py-1.5">
                    <Thumb label={a.name.slice(0, 2)} />
                    <span className="num">{a.name}</span>
                  </div>
                </td>
                <td className={td + " num text-muted-foreground"}>#{a.order}</td>
                <td className={td}>{a.kind}</td>
                <td className={td + " num text-muted-foreground"}>{a.size}</td>
                <td className={td + " num text-muted-foreground"}>{a.child || "—"}</td>
                <td className={td}>
                  <Status value={a.status} />
                </td>
                <td className={td + " text-right"}>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]">
                    Send Proof
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
