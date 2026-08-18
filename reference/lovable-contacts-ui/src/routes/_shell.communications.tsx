import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Status, td, th } from "@/components/app/primitives";
import { communications } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/communications")({
  head: () => ({
    meta: [
      { title: "Communications — PrintersHero V2" },
      { name: "description", content: "Every quote, proof, invoice and shipping notification sent to customers, with delivery state." },
      { property: "og:title", content: "Communications — PrintersHero V2" },
      { property: "og:description", content: "A full outbound message log per customer." },
    ],
  }),
  component: CommsPage,
});

function CommsPage() {
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Communications" subtitle="Delivery state is tracked so nothing silently disappears." />
      <Panel dense>
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Type</th><th className={th}>Subject</th><th className={th}>Recipient</th><th className={th}>Sent</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {communications.map((c) => (
              <tr key={c.id} className="row-h border-t border-border">
                <td className={td}>{c.type}</td>
                <td className={td}>{c.subject}</td>
                <td className={td + " num text-muted-foreground"}>{c.to}</td>
                <td className={td + " num text-muted-foreground"}>{c.at}</td>
                <td className={td}><Status value={c.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
