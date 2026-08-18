/**
 * CRM mock layer (UI prototype only) — sales / account-management focus.
 * Account profile, relationship activity, follow-ups, quote pipeline and
 * account notes. Financial truth still lives with Invoices / Payments.
 */

export type ActivityKind = "call" | "email" | "meeting" | "quote" | "order" | "payment" | "note" | "visit";

export interface CrmActivity {
  id: string;
  kind: ActivityKind;
  body: string;
  who: string;
  when: string;
}

export interface CrmTask {
  id: string;
  title: string;
  due: string;
  owner: string;
  priority: "High" | "Normal" | "Low";
  done: boolean;
}

export type PipelineStage = "Quoting" | "Sent" | "Negotiating" | "Won" | "Lost";

export interface PipelineItem {
  id: string;
  label: string;
  stage: PipelineStage;
  value: number;
  updated: string;
  doc?: string;
}

export interface AccountNote {
  id: string;
  body: string;
  author: string;
  when: string;
  pinned?: boolean;
}

export interface AccountProfile {
  industry: string;
  since: string;
  source: string;
  website: string;
  billingEmail: string;
  preferredChannel: "Email" | "Phone" | "Text" | "In person";
  tags: string[];
  nextFollowUp?: string;
  healthNote?: string;
}

const defaultProfile: AccountProfile = {
  industry: "General Commercial",
  since: "2024",
  source: "Referral",
  website: "—",
  billingEmail: "—",
  preferredChannel: "Email",
  tags: [],
};

export const accountProfiles: Record<string, AccountProfile> = {
  c1: {
    industry: "Manufacturing / Retail Fixtures",
    since: "Mar 2019",
    source: "Trade show — ISA Sign Expo",
    website: "deltafaucet.com",
    billingEmail: "ap@deltafaucet.com",
    preferredChannel: "Email",
    tags: ["Key Account", "Brand Standards", "Rush Friendly"],
    nextFollowUp: "Aug 18 — confirm fall signage rollout",
    healthNote: "Strongest account. Marketing Ops reorders quarterly; keep brand kit current.",
  },
  c2: {
    industry: "Hardware Retail",
    since: "Nov 2021",
    source: "Walk-in",
    website: "acehardware.com",
    billingEmail: "bill@acelaf.com",
    preferredChannel: "Phone",
    tags: ["Seasonal", "Store Signage"],
    nextFollowUp: "Aug 20 — Labor Day sale banners",
  },
  c3: {
    industry: "Trade / Print Broker",
    since: "Jun 2018",
    source: "Trade referral",
    website: "metroareaprint.com",
    billingEmail: "ap@metroareaprint.com",
    preferredChannel: "Email",
    tags: ["Trade Pricing", "High Volume"],
    nextFollowUp: "Aug 17 — Q4 volume commitment",
    healthNote: "Price sensitive; margin is thin but volume is steady.",
  },
  c4: {
    industry: "Design Studio",
    since: "Feb 2023",
    source: "Instagram",
    website: "creativeink.co",
    billingEmail: "toby@creativeink.co",
    preferredChannel: "Text",
    tags: ["Small Runs"],
  },
  c5: {
    industry: "QSR Franchise Group",
    since: "Aug 2020",
    source: "Corporate vendor list",
    website: "mcdfg.com",
    billingEmail: "invoices@mcdfg.com",
    preferredChannel: "Email",
    tags: ["Multi-Location", "Corporate Approval"],
    nextFollowUp: "Aug 19 — 12-store window refresh",
    healthNote: "All artwork must clear corporate brand review before production.",
  },
  c6: {
    industry: "Collegiate Athletics",
    since: "Sep 2017",
    source: "Existing relationship",
    website: "purduesports.com",
    billingEmail: "ap@purdue.edu",
    preferredChannel: "In person",
    tags: ["Prepay", "Seasonal Peak"],
    nextFollowUp: "Aug 22 — resolve balance before football season",
    healthNote: "On hold until the $3,200 balance clears. Season order window is closing.",
  },
};

export const crmActivity: Record<string, CrmActivity[]> = {
  c1: [
    { id: "e1", kind: "call", body: "Susan called about adding 2 more lobby banners to order #10671.", who: "Dale", when: "Aug 15 · 2:10p" },
    { id: "e2", kind: "quote", body: "Quote #10452 Revision B sent — store hours package.", who: "Dale", when: "Aug 14 · 4:35p" },
    { id: "e3", kind: "order", body: "Order #10671 released to Production.", who: "System", when: "Aug 13 · 9:02a" },
    { id: "e4", kind: "email", body: "Sent updated brand-asset checklist after logo refresh.", who: "Dale", when: "Aug 12 · 11:20a" },
    { id: "e5", kind: "payment", body: "Payment of $500 applied to INV-10671.", who: "Angela", when: "Aug 11 · 3:40p" },
    { id: "e6", kind: "visit", body: "Site visit — measured entry monument for spring proposal.", who: "Dale", when: "Aug 04" },
  ],
  c2: [
    { id: "e7", kind: "call", body: "Bill asked for pricing on 6 A-frame inserts.", who: "Dale", when: "Aug 14 · 10:05a" },
    { id: "e8", kind: "order", body: "Order #10662 picked up in store.", who: "Front Counter", when: "Aug 13 · 4:15p" },
    { id: "e9", kind: "note", body: "Prefers a phone call over email — rarely checks inbox.", who: "Dale", when: "Jul 28" },
  ],
  c3: [
    { id: "e10", kind: "email", body: "Priya requested trade sheet for 2026 Q4.", who: "Angela", when: "Aug 15 · 8:45a" },
    { id: "e11", kind: "quote", body: "Quote #10460 sent — 2,500 yard signs.", who: "Angela", when: "Aug 14" },
    { id: "e12", kind: "note", body: "Watch turnaround — they resell with their own due dates.", who: "Angela", when: "Aug 02" },
  ],
  c4: [{ id: "e13", kind: "email", body: "Toby sent new brand files for the fall menu series.", who: "Angela", when: "Aug 10" }],
  c5: [
    { id: "e14", kind: "meeting", body: "Regional marketing call — 12-store window refresh scoped.", who: "Dale", when: "Aug 15 · 1:00p" },
    { id: "e15", kind: "quote", body: "Quote #10458 sent for store #4412 drive-thru signage.", who: "Dale", when: "Aug 12" },
    { id: "e16", kind: "note", body: "Corporate brand review adds ~3 days to every proof cycle.", who: "Dale", when: "Jul 19" },
  ],
  c6: [
    { id: "e17", kind: "call", body: "Left voicemail regarding the outstanding $3,200 balance.", who: "Angela", when: "Aug 14 · 9:30a" },
    { id: "e18", kind: "note", body: "Account placed on hold — prepay required until balance clears.", who: "Angela", when: "Aug 01" },
  ],
};

export const crmTasks: Record<string, CrmTask[]> = {
  c1: [
    { id: "t1", title: "Confirm fall signage rollout quantities with Susan", due: "Aug 18", owner: "Dale", priority: "High", done: false },
    { id: "t2", title: "Send refreshed brand-asset kit to Facilities", due: "Aug 21", owner: "Dale", priority: "Normal", done: false },
    { id: "t3", title: "Follow up on lobby banner proof", due: "Aug 15", owner: "Dale", priority: "Normal", done: true },
  ],
  c2: [{ id: "t4", title: "Quote Labor Day sale banners", due: "Aug 20", owner: "Dale", priority: "Normal", done: false }],
  c3: [
    { id: "t5", title: "Prepare Q4 volume commitment proposal", due: "Aug 17", owner: "Angela", priority: "High", done: false },
    { id: "t6", title: "Send 2026 trade price sheet", due: "Aug 16", owner: "Angela", priority: "Normal", done: false },
  ],
  c4: [],
  c5: [{ id: "t7", title: "Collect store list for 12-store window refresh", due: "Aug 19", owner: "Dale", priority: "High", done: false }],
  c6: [{ id: "t8", title: "Collect $3,200 balance before season order", due: "Aug 22", owner: "Angela", priority: "High", done: false }],
};

export const crmPipeline: Record<string, PipelineItem[]> = {
  c1: [
    { id: "p1", label: "Fall signage rollout — 14 locations", stage: "Negotiating", value: 18400, updated: "Aug 15", doc: "10452" },
    { id: "p2", label: "Lobby banner add-on", stage: "Sent", value: 1250, updated: "Aug 14" },
    { id: "p3", label: "Entry monument reface", stage: "Quoting", value: 9800, updated: "Aug 08" },
  ],
  c2: [{ id: "p4", label: "Labor Day sale package", stage: "Quoting", value: 1450, updated: "Aug 14" }],
  c3: [
    { id: "p5", label: "2,500 yard signs", stage: "Sent", value: 6250, updated: "Aug 14", doc: "10460" },
    { id: "p6", label: "Q4 volume commitment", stage: "Negotiating", value: 42000, updated: "Aug 15" },
  ],
  c4: [{ id: "p7", label: "Fall menu series", stage: "Quoting", value: 780, updated: "Aug 10" }],
  c5: [
    { id: "p8", label: "12-store window refresh", stage: "Negotiating", value: 27600, updated: "Aug 15" },
    { id: "p9", label: "Store #4412 drive-thru", stage: "Sent", value: 4300, updated: "Aug 12", doc: "10458" },
  ],
  c6: [{ id: "p10", label: "Football season banner set", stage: "Quoting", value: 11200, updated: "Aug 12" }],
};

export const accountNotes: Record<string, AccountNote[]> = {
  c1: [
    { id: "n1", body: "Navy must be PMS 289C — they will reject anything close-but-off.", author: "Dale", when: "Jul 30", pinned: true },
    { id: "n2", body: "Susan approves artwork; Marcus only handles install scheduling.", author: "Dale", when: "Jun 14" },
  ],
  c2: [{ id: "n3", body: "Bill pays by card at pickup — do not invoice on terms.", author: "Dale", when: "May 02", pinned: true }],
  c3: [{ id: "n4", body: "Trade pricing tier 2. Never share retail pricing sheets.", author: "Angela", when: "Apr 11", pinned: true }],
  c4: [],
  c5: [{ id: "n5", body: "Corporate brand review required before any proof goes out.", author: "Dale", when: "Jul 19", pinned: true }],
  c6: [{ id: "n6", body: "Prepay only while on hold. Athletic dept POs move slowly.", author: "Angela", when: "Aug 01", pinned: true }],
};

export const getProfile = (id: string): AccountProfile => accountProfiles[id] ?? defaultProfile;
export const getActivity = (id: string): CrmActivity[] => crmActivity[id] ?? [];
export const getTasks = (id: string): CrmTask[] => crmTasks[id] ?? [];
export const getPipeline = (id: string): PipelineItem[] => crmPipeline[id] ?? [];
export const getNotes = (id: string): AccountNote[] => accountNotes[id] ?? [];

export const pipelineValue = (items: PipelineItem[]) =>
  items.filter((i) => i.stage !== "Won" && i.stage !== "Lost").reduce((s, i) => s + i.value, 0);

export const openTaskCount = (id: string) => getTasks(id).filter((t) => !t.done).length;

export const lastTouch = (id: string) => getActivity(id)[0]?.when ?? "—";

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  quote: "Quote",
  order: "Order",
  payment: "Payment",
  note: "Note",
  visit: "Visit",
};
