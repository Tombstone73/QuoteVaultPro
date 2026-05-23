import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Package,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const stats = [
  { icon: FileText, label: "Quotes pending approval", value: "12", trend: "+3 today", color: "text-[#00a9e0]" },
  { icon: Package, label: "Jobs in prepress", value: "28", trend: "5 due today", color: "text-[#ff2d95]" },
  { icon: ShieldCheck, label: "Proofs waiting on customer", value: "8", trend: "2 urgent", color: "text-[#ffd400]" },
  { icon: Receipt, label: "Invoices ready to send", value: "15", trend: "$9.8k ready", color: "text-emerald-400" },
];

type MockupCard = {
  customer: string;
  job: string;
  value: string;
  priority?: boolean;
  status?: string;
};

type MockupColumn = {
  title: string;
  count: number;
  color: string;
  cards: MockupCard[];
};

const columns: MockupColumn[] = [
  {
    title: "Pending Approval",
    count: 4,
    color: "bg-[#ffd400]/20 text-[#ffd400]",
    cards: [
      { customer: "Metro Signs Co.", job: "Vehicle Wraps x3", value: "$2,450", priority: true },
      { customer: "Downtown Cafe", job: "Menu Boards", value: "$680" },
    ],
  },
  {
    title: "Prepress",
    count: 6,
    color: "bg-[#00a9e0]/20 text-[#00a9e0]",
    cards: [
      { customer: "City Events", job: "Banner Package", value: "$1,200", status: "Proof check" },
      { customer: "Tech Startup Inc", job: "Wall Graphics", value: "$3,100", status: "Roll printing" },
    ],
  },
  {
    title: "Production",
    count: 3,
    color: "bg-[#ff2d95]/20 text-[#ff2d95]",
    cards: [
      { customer: "Retail Corp", job: "POP Displays", value: "$890", status: "Laminating" },
    ],
  },
  {
    title: "Ready",
    count: 2,
    color: "bg-emerald-500/20 text-emerald-400",
    cards: [
      { customer: "Johnson Real Estate", job: "Yard Signs x50", value: "$750", status: "Pickup" },
    ],
  },
];

export function MarketingDashboardMockup() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0b1018]/90 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full bg-[#ff2d95]/70" />
          <div className="h-3 w-3 rounded-full bg-[#ffd400]/75" />
          <div className="h-3 w-3 rounded-full bg-[#00a9e0]/75" />
        </div>
        <div className="flex flex-1 justify-center">
          <div className="flex items-center gap-2 rounded-md bg-white/[0.04] px-4 py-1 text-xs text-slate-400">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            app.printershero.com
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-b from-[#101722] to-[#05080d] p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-2 flex items-center gap-2">
                <stat.icon className={cn("h-4 w-4", stat.color)} />
                <span className="text-xs text-slate-400">{stat.label}</span>
              </div>
              <div className="mb-1 text-2xl font-bold text-white">{stat.value}</div>
              <div className="text-xs text-slate-500">{stat.trend}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          {columns.map((column) => (
            <div key={column.title} className="rounded-lg bg-white/[0.025] p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-white">{column.title}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs", column.color)}>{column.count}</span>
              </div>
              <div className="space-y-2">
                {column.cards.map((card) => (
                  <div key={`${column.title}-${card.job}`} className="rounded-md border border-white/10 bg-[#0b1018] p-3">
                    <div className="mb-1 flex items-start justify-between">
                      <span className="text-xs text-slate-500">{card.customer}</span>
                      {card.priority && <AlertCircle className="h-3 w-3 text-[#ff2d95]" />}
                    </div>
                    <div className="mb-2 text-sm font-semibold text-white">{card.job}</div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-[#ffd400]">{card.value}</span>
                      {card.status && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Clock className="h-3 w-3" />
                          {card.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          Product logic, proofs, production status, fulfillment, and billing stay connected.
        </div>
      </div>
    </div>
  );
}
