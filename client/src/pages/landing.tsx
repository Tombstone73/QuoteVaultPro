import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Calculator,
  CheckCircle2,
  Clock,
  FileText,
  HelpCircle,
  LayoutGrid,
  Mail,
  RotateCcw,
  Search,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintersHeroSplashVideo } from "@/components/branding/PrintersHeroSplashVideo";
import { MarketingDashboardMockup } from "@/components/marketing/MarketingDashboardMockup";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingHeader, marketingRequestAccessHref } from "@/components/marketing/MarketingHeader";
import { MarketingMeta } from "@/components/marketing/MarketingMeta";
import { SHIELD_LOGO_SRC, SPLASH_STATIC_SRC } from "@/lib/branding";

const problems = [
  {
    icon: Mail,
    title: "Quotes stuck in email",
    description: "Customer requests scattered across inboxes. Follow-ups get missed. Revenue gets stale.",
  },
  {
    icon: Search,
    title: "Orders falling through cracks",
    description: "No single source of truth for what is approved, in production, ready, or billed.",
  },
  {
    icon: HelpCircle,
    title: "Production status unclear",
    description: '"Where is my job?" should be answered by the system, not another hallway check.',
  },
  {
    icon: FileText,
    title: "Invoices disconnected",
    description: "Jobs finish, but billing waits because production and accounting are not connected.",
  },
];

const workflowSteps = [
  { label: "Quoting", description: "Build quotes with reusable product logic and pricing templates." },
  { label: "Orders", description: "Convert approved quotes into permanent order snapshots." },
  { label: "Proofing", description: "Track approvals, customer communication, and required revisions." },
  { label: "Production", description: "Move jobs through prepress, roll, flatbed, finishing, and pickup." },
  { label: "Fulfillment", description: "Preserve pickup, delivery, and shipping details through completion." },
  { label: "Invoicing", description: "Bill from valid completed work without duplicate data entry." },
];

const features = [
  {
    icon: FileText,
    title: "Quote & Invoice Management",
    description: "Professional quotes that convert into orders. Invoices generated from valid completed work.",
  },
  {
    icon: LayoutGrid,
    title: "Production Boards",
    description: "Operational views for proofing, prepress, flatbed, roll, finishing, and pickup.",
  },
  {
    icon: Users,
    title: "Customer & Order History",
    description: "Complete customer context, repeat order history, and source quote traceability.",
  },
  {
    icon: Mail,
    title: "Email & PDF Automation",
    description: "Send quotes, proofs, confirmations, and invoices with fewer manual handoffs.",
  },
  {
    icon: Calculator,
    title: "PBV2 Product Builder",
    description: "Reusable product logic, pricing templates, option groups, and production-aware pricing tools.",
  },
  {
    icon: Bot,
    title: "Practical AI Assistance",
    description: "AI-assisted setup, workflow recommendations, production warnings, and guided automation.",
  },
  {
    icon: Wrench,
    title: "Built for Print Shops",
    description: "Not a generic CRM. Product logic and workflow states match print production reality.",
  },
  {
    icon: Clock,
    title: "Due Date Tracking",
    description: "Visual alerts for approaching deadlines, proof delays, and production bottlenecks.",
  },
  {
    icon: Truck,
    title: "Delivery Management",
    description: "Schedule pickups and deliveries while keeping fulfillment tied to the order snapshot.",
  },
];

const differentiators = [
  "Production stages designed for print: proofing, prepress, flatbed, roll, finishing, pickup",
  "Reusable product templates with option groups, pricing logic, and workflow metadata",
  "Customer communication that preserves quote, proof, and order context",
  "Job tracking that prevents work from outrunning the order state",
  "Reporting built for shop-floor visibility, not generic CRM dashboards",
];

export default function Landing() {
  const splashVideoRef = useRef<HTMLVideoElement>(null);
  const [videoEnded, setVideoEnded] = useState(false);

  const replayIntro = () => {
    const video = splashVideoRef.current;
    if (!video) return;

    setVideoEnded(false);
    video.currentTime = 0;
    void video.play().catch(() => {
      setVideoEnded(true);
    });
  };

  return (
    <div className="min-h-screen bg-[#05080d] text-white">
      <MarketingMeta />
      <MarketingHeader activePage="home" />

      <main>
        <section className="relative min-h-screen overflow-hidden pt-16">
          <img
            src={SPLASH_STATIC_SRC}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <PrintersHeroSplashVideo
            ref={splashVideoRef}
            fadeOut={videoEnded}
            onEnded={() => setVideoEnded(true)}
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-[#05080d]/70" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_25%,rgba(0,169,224,0.22),transparent_34%),radial-gradient(circle_at_70%_20%,rgba(255,45,149,0.14),transparent_28%),linear-gradient(180deg,transparent_0%,#05080d_88%)]" />

          <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col justify-center px-4 pb-20 pt-16 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-4xl text-center">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm text-slate-200 backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-[#00a9e0]" />
                Built for print production
              </div>

              <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
                The operating system
                <br />
                <span className="bg-gradient-to-r from-[#00a9e0] via-[#ff2d95] to-[#ffd400] bg-clip-text text-transparent">
                  for print shops
                </span>
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Replace the spreadsheets, scattered emails, and production chaos. Manage quotes,
                orders, proofing, production, fulfillment, and invoicing in one system built for
                how print shops actually work.
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="border-0 bg-[#ffd400] text-[#05080d] shadow-[0_0_35px_rgba(255,212,0,0.2)] hover:bg-[#ffe45c]"
                >
                  <Link to="/login">
                    Sign In
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
                  <Link to={marketingRequestAccessHref}>Request Access</Link>
                </Button>
              </div>
            </div>

            <div className="relative mx-auto mt-16 w-full max-w-6xl">
              <div className="absolute inset-0 rounded-full bg-[#00a9e0]/15 blur-[110px]" />
              <MarketingDashboardMockup />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={replayIntro}
            className="absolute bottom-5 right-5 z-20 border-white/20 bg-white/10 text-white shadow-lg backdrop-blur transition hover:bg-white/20 sm:bottom-8 sm:right-8"
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Replay Intro
          </Button>
        </section>

        <section className="relative py-24">
          <div className="absolute inset-0 bg-gradient-to-b from-[#05080d] via-[#0b1018] to-[#05080d]" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-14 max-w-3xl text-center">
              <h2 className="text-3xl font-bold sm:text-4xl">Sound familiar?</h2>
              <p className="mt-4 text-lg text-slate-400">
                Every print shop knows these problems. Most just accept them.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {problems.map((problem) => (
                <div key={problem.title} className="rounded-xl border border-white/10 bg-white/[0.035] p-6 transition hover:border-[#ff2d95]/40 hover:bg-white/[0.055]">
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[#ff2d95]/10 text-[#ff2d95]">
                    <problem.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold">{problem.title}</h3>
                  <p className="text-sm leading-6 text-slate-400">{problem.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="solution" className="py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-14 max-w-3xl text-center">
              <h2 className="text-3xl font-bold sm:text-4xl">One connected workflow</h2>
              <p className="mt-4 text-lg text-slate-400">
                From first contact to final invoice. No gaps. No hidden handoffs.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
              {workflowSteps.map((step, index) => (
                <div key={step.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-[#00a9e0]/40 bg-[#00a9e0]/10 text-xl font-bold text-[#00a9e0]">
                    {index + 1}
                  </div>
                  <h3 className="font-semibold">{step.label}</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="relative py-24">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:60px_60px]" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-14 max-w-3xl text-center">
              <h2 className="text-3xl font-bold sm:text-4xl">Everything you need to run your shop</h2>
              <p className="mt-4 text-lg text-slate-400">
                Purpose-built tools for print production. No bloat. No compromises.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => {
                const colors = ["#00a9e0", "#ff2d95", "#ffd400"] as const;
                const color = colors[index % colors.length];
                return (
                  <div key={feature.title} className="rounded-xl border border-white/10 bg-[#0b1018]/80 p-6 transition hover:border-white/20 hover:bg-[#101722]">
                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}18`, color }}>
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                    <p className="text-sm leading-6 text-slate-400">{feature.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="about" className="relative overflow-hidden py-24">
          <div className="absolute right-0 top-1/2 h-[520px] w-[520px] -translate-y-1/2 rounded-full bg-[#ff2d95]/10 blur-[150px]" />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#ffd400]/30 bg-[#ffd400]/10 px-4 py-1.5 text-sm text-[#ffd400]">
                Industry-specific
              </div>
              <h2 className="text-3xl font-bold sm:text-4xl">
                Built for print shops.
                <br />
                <span className="text-slate-400">Not adapted from something else.</span>
              </h2>
              <p className="mt-6 text-lg leading-8 text-slate-400">
                Generic ERPs and CRMs force you to adapt your workflow to their structure.
                Printers Hero is designed from the ground up for print production by people who
                understand that a vehicle wrap and a business card are different jobs.
              </p>

              <div className="mt-8 space-y-4">
                {differentiators.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#00a9e0]" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#0b1018]/90 p-8 shadow-2xl">
              <div className="mb-6 flex items-center gap-3">
                <span className="h-3 w-3 rounded-full bg-[#00a9e0]" />
                <span className="font-mono text-sm text-slate-400">PRODUCTION_STATUS</span>
              </div>
              <div className="space-y-4">
                {[
                  ["Proofs Waiting", "8", "bg-[#ff2d95]"],
                  ["Prepress Queue", "6", "bg-[#00a9e0]"],
                  ["In Production", "15", "bg-[#ffd400]"],
                  ["Ready for Pickup", "3", "bg-emerald-400"],
                  ["Invoices Ready", "5", "bg-white"],
                ].map(([label, count, dot]) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                      <span>{label}</span>
                    </div>
                    <span className="font-mono text-sm text-slate-400">{count}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 border-t border-white/10 pt-4 text-sm text-slate-400">
                Live workflow status without another spreadsheet.
              </div>
            </div>
          </div>
        </section>

        <section className="py-24">
          <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
            <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-[#00a9e0]/10">
              <img src={SHIELD_LOGO_SRC} alt="" className="h-9 w-9" aria-hidden="true" />
            </div>
            <h2 className="text-3xl font-bold sm:text-4xl">
              Built by a print shop.
              <br />
              For print shops.
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-400">
              Printers Hero was born from real production floors, daily workflow gaps, and the need
              for a system that understands the print business from quote to invoice.
            </p>
            <div className="mx-auto mt-12 grid max-w-3xl gap-8 sm:grid-cols-3">
              <div>
                <div className="mb-2 text-4xl font-bold text-[#ffd400]">10+</div>
                <div className="text-sm text-slate-400">Years in print production</div>
              </div>
              <div>
                <div className="mb-2 text-4xl font-bold text-[#00a9e0]">1000s</div>
                <div className="text-sm text-slate-400">Jobs managed internally</div>
              </div>
              <div>
                <div className="mb-2 text-4xl font-bold text-[#ff2d95]">Real</div>
                <div className="text-sm text-slate-400">Shop-floor tested</div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden py-24">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,212,0,0.12),transparent_34%)]" />
          <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ffd400]">
              <img src={SHIELD_LOGO_SRC} alt="" className="h-10 w-10" aria-hidden="true" />
            </div>
            <h2 className="text-3xl font-bold sm:text-5xl">Ready to take control of your shop?</h2>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-slate-400">
              Stop fighting your tools and start running your shop. Printers Hero gives you the
              visibility and workflow discipline you have been missing.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button asChild size="lg" className="border-0 bg-[#ffd400] text-[#05080d] hover:bg-[#ffe45c]">
                <Link to="/login">
                  Sign In
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10">
                <Link to={marketingRequestAccessHref}>Request Access</Link>
              </Button>
            </div>
            <p className="mt-7 text-sm text-slate-500">Currently in private beta. Request access to join early.</p>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
