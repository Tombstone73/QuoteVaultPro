import { Link } from "react-router-dom";
import {
  ArrowRight,
  Archive,
  CheckCircle2,
  Cloud,
  Database,
  FolderOpen,
  HardDrive,
  Lock,
  RefreshCcw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingHeader, marketingRequestAccessHref } from "@/components/marketing/MarketingHeader";
import { MarketingMeta } from "@/components/marketing/MarketingMeta";

const benefits = [
  {
    icon: ShieldCheck,
    title: "Full ownership of your files",
    description: "Customer artwork, proofs, and production assets stay under your control.",
  },
  {
    icon: Lock,
    title: "Reduced vendor lock-in",
    description: "Your workflow tool and storage strategy stay independent.",
  },
  {
    icon: WalletCards,
    title: "Better cost control",
    description: "Choose the storage tier and provider that fits your file volume.",
  },
  {
    icon: SlidersHorizontal,
    title: "Scales with your shop",
    description: "Start simple, then add capacity or storage locations as you grow.",
  },
  {
    icon: FolderOpen,
    title: "Built for large files",
    description: "Print-ready artwork can be massive. Store it where performance and cost make sense.",
  },
  {
    icon: RefreshCcw,
    title: "Future-proof architecture",
    description: "Storage providers change. Your workflow should not have to.",
  },
];

const workflowNeeds = [
  ["Massive artwork files", "High-res production files routinely hit hundreds of megabytes."],
  ["Multiple revisions & proofs", "Every job can generate several proof rounds and production-ready versions."],
  ["Long-term archive needs", "Customers expect you to keep artwork on file for reorders, sometimes for years."],
  ["Files move through stages", "Quoting, proofing, production, fulfillment, and archive all need clean routing."],
];

const storageOptions = [
  {
    icon: Cloud,
    badge: "Easiest",
    title: "Managed Platform Storage",
    description: "Use managed storage and let Printers Hero handle the file infrastructure.",
    bullets: ["No configuration needed", "Included with supported plans", "Ideal for getting started fast"],
  },
  {
    icon: Database,
    badge: "Most Flexible",
    title: "Bring Your Own Cloud Storage",
    description: "Connect your preferred object storage provider and keep files under your policies.",
    bullets: ["Use existing cloud accounts", "Control cost at your own scale", "Keep files under organization policy"],
  },
  {
    icon: Server,
    badge: "Maximum Control",
    title: "Company-Controlled Storage",
    description: "For shops that need files on their own servers, network storage, or controlled paths.",
    bullets: ["Files stay on your infrastructure", "Useful for high-security environments", "Supports data sovereignty needs"],
  },
];

const faqs = [
  {
    question: "What does BYOS mean?",
    answer:
      "BYOS stands for Bring Your Own Storage. It means you choose where files are stored: managed platform storage, your cloud provider, or company-controlled infrastructure.",
  },
  {
    question: "Do I have to set up my own storage?",
    answer:
      "No. Managed storage can be the simplest starting point. BYOS is for shops that want more control, lower storage risk, or a specific storage policy.",
  },
  {
    question: "Can I start with managed storage and change later?",
    answer:
      "Yes. The workflow should stay consistent even as storage strategy changes. The point is to separate operational data from where large file assets live.",
  },
  {
    question: "Is this useful if my shop handles large artwork files?",
    answer:
      "Yes. Large artwork, proof revisions, production files, and long-term archives are exactly why BYOS matters for print shops.",
  },
  {
    question: "Why is this better than storing everything inside one software vendor?",
    answer:
      "It reduces lock-in and gives you more control over cost, access, retention, migration, and future infrastructure choices.",
  },
  {
    question: "Will this help with long-term cost control?",
    answer:
      "It can. Storage pricing depends heavily on file volume and access patterns. BYOS lets your shop choose the storage model that fits your business.",
  },
];

export default function ByosPage() {
  return (
    <div className="min-h-screen bg-[#05080d] text-white">
      <MarketingMeta
        title="BYOS | Printers Hero"
        description="Bring Your Own Storage for print shops that manage large artwork files, proofs, production assets, and long-term customer archives."
      />
      <MarketingHeader activePage="byos" />

      <main>
        <section className="relative min-h-[72vh] overflow-hidden pt-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_20%,rgba(0,169,224,0.18),transparent_34%),radial-gradient(circle_at_70%_18%,rgba(255,45,149,0.13),transparent_30%),linear-gradient(180deg,#07101a_0%,#05080d_88%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:64px_64px]" />
          <div className="relative mx-auto flex min-h-[calc(72vh-4rem)] max-w-5xl flex-col items-center justify-center px-4 py-20 text-center sm:px-6 lg:px-8">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm text-slate-200 backdrop-blur">
              <HardDrive className="h-4 w-4 text-[#00a9e0]" />
              Bring Your Own Storage
            </div>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
              Your files.{" "}
              <span className="bg-gradient-to-r from-[#00a9e0] via-[#ff2d95] to-[#ffd400] bg-clip-text text-transparent">
                Your storage.
              </span>
              <br />
              Your rules.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-400">
              Print files are big, expensive to store, and critical to your business. With BYOS,
              Printers Hero manages the workflow while you decide where your files live.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button asChild size="lg" className="border-0 bg-[#ffd400] text-[#05080d] hover:bg-[#ffe45c]">
                <Link to={marketingRequestAccessHref}>
                  Book a Demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
                <a href="#storage-options">Explore Storage Options</a>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="mb-5 text-center text-sm font-semibold uppercase tracking-widest text-[#00a9e0]">
              Plain English
            </div>
            <h2 className="text-center text-3xl font-bold sm:text-4xl">What does BYOS actually mean?</h2>
            <div className="mt-10 rounded-xl border border-white/10 bg-white/[0.035] p-6 text-slate-300 sm:p-8">
              <p className="text-lg font-semibold text-white">
                BYOS stands for Bring Your Own Storage. It means you choose where your files are
                stored, not us.
              </p>
              <p className="mt-5 leading-7">
                Most software forces all your data into one vendor-controlled storage model. That
                works until storage costs spike, you need to switch tools, or you want more control
                over customer artwork and production files.
              </p>
              <p className="mt-5 leading-7">
                Printers Hero keeps the workflow engine separate from file storage. Use managed
                storage, connect your own cloud provider, or keep files on your own infrastructure.
              </p>
            </div>
          </div>
        </section>

        <section className="relative py-20">
          <div className="absolute inset-0 bg-gradient-to-b from-[#05080d] via-[#0b1018] to-[#05080d]" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <div className="mb-4 text-sm font-semibold uppercase tracking-widest text-[#ff2d95]">Why it matters</div>
              <h2 className="text-3xl font-bold sm:text-4xl">Why BYOS is a smart move</h2>
              <p className="mt-4 text-lg text-slate-400">
                More control, lower risk, better flexibility, without adding complexity.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {benefits.map((benefit, index) => {
                const colors = ["#00a9e0", "#ff2d95", "#ffd400"] as const;
                const color = colors[index % colors.length];
                return (
                  <div key={benefit.title} className="rounded-xl border border-white/10 bg-[#0b1018]/80 p-6">
                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}18`, color }}>
                      <benefit.icon className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 text-lg font-semibold">{benefit.title}</h3>
                    <p className="text-sm leading-6 text-slate-400">{benefit.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <div className="mb-4 text-sm font-semibold uppercase tracking-widest text-[#ffd400]">Print-specific</div>
              <h2 className="text-3xl font-bold sm:text-4xl">Built for real print-shop file workflows</h2>
              <p className="mt-5 text-lg leading-8 text-slate-400">
                Generic cloud storage was not designed for the realities of print production. Your
                storage strategy needs to handle file size, volume, revisions, and lifecycle.
              </p>
              <Button asChild className="mt-8 border-0 bg-[#ffd400] text-[#05080d] hover:bg-[#ffe45c]">
                <Link to={marketingRequestAccessHref}>Talk to us about your file workflow</Link>
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {workflowNeeds.map(([title, description], index) => {
                const icons = [FolderOpen, Archive, HardDrive, RefreshCcw];
                const Icon = icons[index] ?? FolderOpen;
                return (
                  <div key={title} className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
                    <Icon className="mb-4 h-6 w-6 text-[#00a9e0]" />
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="storage-options" className="py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <div className="mb-4 text-sm font-semibold uppercase tracking-widest text-[#00a9e0]">Your Options</div>
              <h2 className="text-3xl font-bold sm:text-4xl">Choose the storage setup that fits your shop</h2>
              <p className="mt-4 text-lg text-slate-400">
                Start with managed storage and evolve when ready, or bring your own from day one.
              </p>
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
              {storageOptions.map((option, index) => {
                const colors = ["#00a9e0", "#ff2d95", "#ffd400"] as const;
                const color = colors[index % colors.length];
                return (
                  <div key={option.title} className="rounded-xl border border-white/10 bg-[#0b1018] p-6">
                    <div className="mb-5 flex items-center justify-between">
                      <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}18`, color }}>
                        <option.icon className="h-6 w-6" />
                      </div>
                      <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-wide text-slate-400">
                        {option.badge}
                      </span>
                    </div>
                    <h3 className="text-xl font-semibold">{option.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{option.description}</p>
                    <div className="mt-6 space-y-3">
                      {option.bullets.map((bullet) => (
                        <div key={bullet} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                          <span>{bullet}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
            <div className="mb-4 text-sm font-semibold uppercase tracking-widest text-[#ff2d95]">No Lock-In</div>
            <h2 className="text-3xl font-bold sm:text-4xl">
              Your workflow stays valuable even if your storage strategy changes
            </h2>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-400">
              Printers Hero separates production workflow from where files are stored. Quotes,
              orders, job boards, customer history, and invoicing work the same no matter which
              storage option you use.
            </p>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-10 max-w-3xl text-center">
              <div className="mb-4 text-sm font-semibold uppercase tracking-widest text-[#ffd400]">FAQ</div>
              <h2 className="text-3xl font-bold sm:text-4xl">Common questions about BYOS</h2>
            </div>
            <Accordion type="single" collapsible className="space-y-3">
              {faqs.map((faq, index) => (
                <AccordionItem key={faq.question} value={`faq-${index}`} className="rounded-lg border border-white/10 bg-white/[0.035] px-5">
                  <AccordionTrigger className="text-left text-white hover:no-underline">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-400">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="relative overflow-hidden py-24">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,169,224,0.15),transparent_35%)]" />
          <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold sm:text-5xl">Ready to take control of your file storage?</h2>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-slate-400">
              See how BYOS works inside Printers Hero and find the storage setup that makes sense
              for your shop.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button asChild size="lg" className="border-0 bg-[#ffd400] text-[#05080d] hover:bg-[#ffe45c]">
                <Link to={marketingRequestAccessHref}>
                  Book a Demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10">
                <Link to={marketingRequestAccessHref}>Request Access</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
