import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-store";

export const Route = createFileRoute("/_shell/assistant")({
  head: () => ({
    meta: [
      { title: "AI Assistant — PrintersHero V2" },
      { name: "description", content: "Ask about jobs, materials and customers, and let the assistant propose changes you approve before anything is written." },
      { property: "og:title", content: "AI Assistant — PrintersHero V2" },
      { property: "og:description", content: "Plan, review, then GO — the assistant never writes without approval." },
    ],
  }),
  component: AssistantPage,
});

const prompts = [
  "Which orders are at risk of missing Friday?",
  "Draft a quote for 200 coroplast signs 24x18 for Delta Faucet",
  "What material do I need to order for this week's jobs?",
  "Summarize open balances over 30 days",
];

function AssistantPage() {
  const { setAiOpen } = useApp();
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="AI Assistant" subtitle="Every mutation is proposed as a plan you approve." actions={<Button size="sm" className="h-8" onClick={() => setAiOpen(true)}>Open Assistant Panel</Button>} />
      <div className="grid gap-3 sm:grid-cols-2">
        {prompts.map((p) => (
          <button key={p} onClick={() => setAiOpen(true)} className="panel p-3 text-left text-[13px] hover:bg-accent/60">{p}</button>
        ))}
      </div>
      <Panel title="How it works">
        <ol className="space-y-1.5 text-[13px] text-muted-foreground">
          <li><span className="font-medium text-foreground">1. Plan</span> — the assistant describes exactly what it will change.</li>
          <li><span className="font-medium text-foreground">2. Review</span> — you see a field-level diff of the proposed change.</li>
          <li><span className="font-medium text-foreground">3. GO</span> — only then is the record written, and it lands in document history.</li>
        </ol>
      </Panel>
    </div>
  );
}
