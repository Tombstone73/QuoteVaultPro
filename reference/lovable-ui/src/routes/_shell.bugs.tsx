import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Status, td, th } from "@/components/app/primitives";
import { bugReports } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/bugs")({
  head: () => ({
    meta: [
      { title: "Bug Reports — PrintersHero V2" },
      { name: "description", content: "In-app problem reports captured with the page, user and context they happened on." },
      { property: "og:title", content: "Bug Reports — PrintersHero V2" },
      { property: "og:description", content: "Staff-reported issues with full page context." },
    ],
  }),
  component: BugsPage,
});

function BugsPage() {
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Bug Reports" subtitle="Reports include the exact screen and record the user was on." />
      <Panel dense>
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Title</th><th className={th}>Page</th><th className={th}>Category</th><th className={th}>Severity</th><th className={th}>Reported by</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {bugReports.map((b) => (
              <tr key={b.id} className="row-h border-t border-border">
                <td className={td}>{b.title}</td>
                <td className={td + " num text-muted-foreground"}>{b.page}</td>
                <td className={td}>{b.category}</td>
                <td className={td}><Status value={b.severity} /></td>
                <td className={td + " text-muted-foreground"}>{b.by} · {b.at}</td>
                <td className={td}><Status value={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
