import { useState } from "react";
import { Bot, Check, ChevronRight, Play, X } from "lucide-react";
import { useApp } from "@/lib/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "ai";
  text: string;
  plan?: { title: string; steps: string[] };
  executed?: boolean;
}

const SEED: Msg[] = [
  {
    role: "ai",
    text: "Morning Dale. Two things need you: Order #10671 has 35 signs still awaiting pickup, and Reflective Vinyl is below reorder level with a job scheduled Thursday.",
  },
];

const SUGGESTIONS = [
  "Which jobs are late this week?",
  "Draft a quote for Delta — 100 coroplast 24x18",
  "Summarize open A/R over 30 days",
  "What is holding up Order #10672?",
];

export function AiPanel() {
  const { aiOpen, setAiOpen } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(SEED);
  const [input, setInput] = useState("");

  if (!aiOpen) return null;

  const send = (text: string) => {
    if (!text.trim()) return;
    const isMutation = /quote|order|create|add|draft|schedule/i.test(text);
    setMsgs((m) => [
      ...m,
      { role: "user", text },
      isMutation
        ? {
            role: "ai",
            text: "Here's what I intend to do. Review before I run it.",
            plan: {
              title: "Create Quote — Delta Faucet Company",
              steps: [
                "Use customer Delta Faucet Company, contact Susan Johnson",
                "Add line: 4mm Coroplast Sign, 24\u2033 × 18\u2033, qty 100, single sided",
                "Price from Area Matrix → calculated $11.80/ea ($1,180.00)",
                "Set requested due date Aug 22, sales rep Dale",
                "Leave quote in Draft — do not send",
              ],
            },
          }
        : {
            role: "ai",
            text: "3 jobs are late: #10664 (Metro, 2 days), #10668 (Purdue, 1 day), #10670 (Ace, today). All three are stuck at Prepress waiting on customer-supplied artwork.",
          },
    ]);
    setInput("");
  };

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex h-12 items-center gap-2 border-b border-border px-3">
        <Bot className="size-4 text-primary" />
        <span className="text-[13px] font-semibold">AI Assistant</span>
        <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">Plan → Review → GO</span>
        <button type="button" onClick={() => setAiOpen(false)} className="ml-auto rounded p-1 hover:bg-accent" aria-label="Close AI panel">
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {msgs.map((m, i) => (
          <div key={i} className={cn("text-[13px]", m.role === "user" && "text-right")}>
            <div
              className={cn(
                "inline-block max-w-[92%] rounded-lg px-2.5 py-2 text-left",
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-surface-2 border border-border",
              )}
            >
              {m.text}
            </div>
            {m.plan && (
              <div className="mt-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
                <div className="text-[12px] font-semibold">{m.plan.title}</div>
                <ul className="mt-1.5 space-y-1">
                  {m.plan.steps.map((s) => (
                    <li key={s} className="flex gap-1.5 text-[12px] text-muted-foreground">
                      <ChevronRight className="mt-0.5 size-3 shrink-0" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
                {m.executed ? (
                  <div className="mt-2 flex items-center gap-1.5 text-[12px] text-ok">
                    <Check className="size-3.5" /> Executed — Quote #10461 created as Draft
                  </div>
                ) : (
                  <div className="mt-2 flex gap-1.5">
                    <Button
                      size="sm" className="h-7 gap-1"
                      onClick={() => setMsgs((prev) => prev.map((x, xi) => (xi === i ? { ...x, executed: true } : x)))}
                    >
                      <Play className="size-3" /> GO
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7">Edit plan</Button>
                    <Button size="sm" variant="ghost" className="h-7">Discard</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-border p-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s} type="button" onClick={() => send(s)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask or instruct…" className="h-8 text-[13px]" />
          <Button size="sm" className="h-8" type="submit">Send</Button>
        </form>
      </div>
    </aside>
  );
}
