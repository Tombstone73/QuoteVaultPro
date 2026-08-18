/**
 * Design workstation mock data (UI prototype only).
 * Design creates/revises CUSTOMER-FACING artwork. It is not Prepress:
 * no production art, sheet layout, RIP or material planning lives here.
 * File truth still belongs to the Artwork module — this is a workflow view.
 */

export type DesignSides = 1 | 2;
export type DesignSide = "Front" | "Back" | "Single";

export type DesignStatus =
  | "Needs Design"
  | "In Design"
  | "Revision Requested"
  | "Waiting on Customer"
  | "Ready for Proof"
  | "Design Complete"
  | "Blocked";

export interface DesignFile {
  id: string;
  name: string;
  kind: "Source" | "Version";
  type: string;
  size: string;
  meta: string;
  /** version label for working files, e.g. "v3" */
  version?: string;
  side?: DesignSide;
}

export interface DesignNote {
  id: string;
  body: string;
  author: string;
  when: string;
  tone: "normal" | "progress" | "blocker";
}

export interface DesignActivity {
  id: string;
  label: string;
  when: string;
}

export interface RevisionRequest {
  id: string;
  body: string;
  source: string;
  when: string;
}

export interface DesignBrief {
  customerRequest: string;
  salesInstructions?: string;
  requiredCopy?: string[];
  brandNotes?: string;
  objective?: string;
  layoutNotes?: string;
  referenceNotes?: string;
  priorityNotes?: string;
}

/** Per-user unread seeds (prototype): counts of items the given user has not viewed. */
export interface DesignUnread {
  feedback?: number;
  versions?: number;
  notes?: number;
  activity?: number;
}

export interface TimeCorrection {
  id: string;
  deltaMinutes: number;
  reason: string;
  author: string;
  when: string;
}

export interface DesignJob {
  id: string;
  order: string;
  customer: string;
  item: string;
  size?: string;
  qty: number;
  media?: string;
  finishing?: string;
  sides: DesignSides;
  due: string;
  priority: "Rush" | "Standard" | "Low";
  status: DesignStatus;
  designer: string;
  proofRequired: boolean;
  proofStatus?: string;
  /** line item notes authored in the shared Sales workspace (single source) */
  lineItemNotes?: string;
  brief: DesignBrief;
  sources: DesignFile[];
  versions: DesignFile[];
  /** current version id (must be one of versions) */
  currentVersionId?: string;
  revisions: RevisionRequest[];
  notes: DesignNote[];
  activity: DesignActivity[];
  blocker?: string;
  /** unread state keyed by user name — conceptually per-user, not global */
  unread?: Record<string, DesignUnread>;
  corrections?: TimeCorrection[];
  timer: { runningSeconds: number; running: boolean; trackedMinutes: number; sessions: number };
  cost: { trackedMinutes: number; rate: number; sold: number };
}


const src = (id: string, name: string, type: string, size: string, meta: string): DesignFile => ({
  id, name, kind: "Source", type, size, meta,
});
const ver = (
  id: string, version: string, name: string, meta: string, side: DesignSide = "Single",
): DesignFile => ({ id, name, kind: "Version", type: "PDF", size: "—", meta, version, side });

export const designJobs: DesignJob[] = [
  {
    id: "d1",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "Store Hours Sign",
    size: '24" × 36"',
    qty: 4,
    media: "4mm Coroplast",
    finishing: 'Grommets, 24" o.c.',
    sides: 2,
    due: "Aug 19",
    priority: "Rush",
    status: "In Design",
    designer: "Dale Hensley",
    proofRequired: true,
    proofStatus: "Proof v2 sent Aug 14 — revision requested",
    lineItemNotes: 'Match previous blue. Leave 1/2 inch unprinted margin on left edge.',
    brief: {
      customerRequest: "Update the store-hours sign using the new Delta logo.",
      salesInstructions: "Match the previous blue signage and preserve the existing overall layout.",
      requiredCopy: ["Monday–Friday 8am–5pm", "Saturday 9am–2pm", "Closed Sunday"],
      brandNotes: "Use supplied Delta brand assets. Navy PMS 289C, no gradients.",
      objective: "Readable from 20 ft in a parking-lot entry.",
      layoutNotes: "Logo top-center, hours block centered, phone number along the bottom rule.",
      referenceNotes: "previous-sign.pdf shows the 2023 layout the customer wants preserved.",
      priorityNotes: "Rush — install crew is scheduled Aug 20.",
    },
    sources: [
      src("s1", "delta-logo.ai", "AI", "3.1 MB", "Customer · Aug 12"),
      src("s2", "previous-sign.pdf", "PDF", "8.4 MB", "Reference · Aug 12"),
      src("s3", "storefront-photo.jpg", "JPG", "2.2 MB", "Customer · Aug 12"),
    ],
    versions: [
      ver("v3", "v3", "store-hours-v3.pdf", "Aug 15 · Dale", "Front"),
      ver("v3b", "v3", "store-hours-v3-back.pdf", "Aug 15 · Dale", "Back"),
      ver("v2", "v2", "store-hours-v2.pdf", "Aug 14 · Dale", "Front"),
      ver("v1", "v1", "initial-draft.pdf", "Aug 13 · Dale", "Front"),
    ],
    currentVersionId: "v3",
    revisions: [
      { id: "r1", body: "Increase phone number size and move the logo 1 inch higher.", source: "Proof feedback · Delta Faucet", when: "Aug 15" },
      { id: "r0", body: "Headline should read “Store Hours”, not “Hours of Operation”.", source: "Proof feedback · Delta Faucet", when: "Aug 14" },
    ],
    notes: [
      { id: "n1", body: "Centered logo on letterhead and adjusted navy to match supplied brand manual.", author: "Dale", when: "Aug 15", tone: "progress" },
      { id: "n2", body: "Back side reads bottom-up per install crew — kept copy block identical.", author: "Dale", when: "Aug 14", tone: "normal" },
    ],
    activity: [
      { id: "a1", label: "v3 uploaded", when: "Aug 15 · 9:12a" },
      { id: "a2", label: "Revision requested", when: "Aug 15 · 8:40a" },
      { id: "a3", label: "Proof sent", when: "Aug 14 · 4:02p" },
      { id: "a4", label: "v2 uploaded", when: "Aug 14 · 3:50p" },
      { id: "a5", label: "Design started", when: "Aug 13 · 10:05a" },
    ],
    unread: { Dale: { feedback: 1, versions: 1, activity: 3 }, Marta: { feedback: 2, versions: 2, notes: 2, activity: 5 } },
    timer: { runningSeconds: 2538, running: true, trackedMinutes: 214, sessions: 4 },
    cost: { trackedMinutes: 214, rate: 65, sold: 275 },
  },

  {
    id: "d2",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "13oz Banner — Lobby",
    size: '36" × 120"',
    qty: 2,
    media: "13oz Scrim Vinyl",
    finishing: "Hem + grommets",
    sides: 1,
    due: "Aug 19",
    priority: "Rush",
    status: "Revision Requested",
    designer: "Dale Hensley",
    proofRequired: true,
    proofStatus: "Proof v1 sent Aug 14 — revision requested",
    lineItemNotes: "Banner hangs above the reception desk — keep copy above the bottom 8 inches.",
    brief: {
      customerRequest: "Lobby welcome banner using the same refreshed brand look as the store-hours sign.",
      salesInstructions: "Keep the tagline exactly as supplied.",
      requiredCopy: ["Welcome to Delta Faucet", "Innovation since 1954"],
      brandNotes: "Navy PMS 289C on white, logo left-aligned.",
      objective: "Reinforce the refreshed brand at the visitor entrance.",
    },
    sources: [src("s4", "delta-logo.ai", "AI", "3.1 MB", "Customer · Aug 12")],
    versions: [ver("v1b", "v1", "lobby-banner-v1.pdf", "Aug 14 · Dale")],
    currentVersionId: "v1b",
    revisions: [
      { id: "r2", body: "Move the logo higher, replace the phone number, and make the headline larger.", source: "Proof feedback · Delta Faucet", when: "Aug 15" },
    ],
    notes: [],
    activity: [
      { id: "a6", label: "Revision requested", when: "Aug 15 · 8:44a" },
      { id: "a7", label: "Proof sent", when: "Aug 14 · 4:10p" },
      { id: "a8", label: "v1 uploaded", when: "Aug 14 · 3:58p" },
    ],
    unread: { Dale: { feedback: 1, activity: 1 }, Marta: { feedback: 1, versions: 1, activity: 3 } },
    timer: { runningSeconds: 0, running: false, trackedMinutes: 96, sessions: 2 },
    cost: { trackedMinutes: 96, rate: 65, sold: 150 },
  },

  {
    id: "d3",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "Adhesive Decal Set",
    qty: 50,
    media: "Adhesive Vinyl",
    sides: 1,
    due: "Aug 19",
    priority: "Rush",
    status: "Design Complete",
    designer: "Marta Reyes",
    proofRequired: false,
    lineItemNotes: "Kiss cut, supplied artwork only needed color correction.",
    brief: {
      customerRequest: "Reprint the existing door decal set with the new logo.",
      salesInstructions: "No layout change — logo swap only.",
    },
    sources: [src("s5", "decal-set-2023.pdf", "PDF", "4.8 MB", "Customer · Aug 12")],
    versions: [ver("v1c", "v1", "decal-set-v1.pdf", "Aug 13 · Marta")],
    currentVersionId: "v1c",
    revisions: [],
    notes: [{ id: "n3", body: "Logo swapped, color-matched to brand navy.", author: "Marta", when: "Aug 13", tone: "progress" }],
    activity: [
      { id: "a9", label: "Design completed", when: "Aug 13 · 2:20p" },
      { id: "a10", label: "v1 uploaded", when: "Aug 13 · 2:05p" },
    ],
    timer: { runningSeconds: 0, running: false, trackedMinutes: 42, sessions: 1 },
    cost: { trackedMinutes: 42, rate: 65, sold: 75 },
  },

  {
    id: "d4",
    order: "10684",
    customer: "Riverbend Brewing",
    item: "Taproom A-Frame Insert",
    size: '24" × 36"',
    qty: 2,
    media: "3mm ACM",
    sides: 2,
    due: "Aug 21",
    priority: "Standard",
    status: "Waiting on Customer",
    designer: "Dale Hensley",
    proofRequired: true,
    proofStatus: "Proof v2 sent Aug 15 — awaiting customer response",
    lineItemNotes: "Seasonal beer list changes monthly — build as an editable template.",
    brief: {
      customerRequest: "Seasonal beer list insert for the sidewalk A-frame.",
      salesInstructions: "Customer still owes the final fall beer list.",
      brandNotes: "Chalkboard texture background, cream type.",
      priorityNotes: "Cannot finish until the copy arrives.",
    },
    sources: [src("s6", "riverbend-logo.eps", "EPS", "1.4 MB", "Customer · Aug 10")],
    versions: [ver("v2r", "v2", "aframe-v2.pdf", "Aug 15 · Dale", "Front")],
    currentVersionId: "v2r",
    revisions: [],
    notes: [],
    activity: [
      { id: "a11", label: "Proof sent", when: "Aug 15 · 11:30a" },
      { id: "a12", label: "v2 uploaded", when: "Aug 15 · 11:20a" },
    ],
    unread: { Dale: { activity: 1 } },
    timer: { runningSeconds: 0, running: false, trackedMinutes: 78, sessions: 2 },
    cost: { trackedMinutes: 78, rate: 65, sold: 120 },
  },

  {
    id: "d5",
    order: "10684",
    customer: "Riverbend Brewing",
    item: "Growler Label",
    size: '4" × 6"',
    qty: 500,
    media: "White BOPP",
    sides: 1,
    due: "Aug 21",
    priority: "Standard",
    status: "Blocked",
    designer: "Unassigned",
    proofRequired: true,
    blocker: "High-resolution vector logo required before final design can be completed.",
    brief: {
      customerRequest: "New growler label matching the taproom branding.",
      salesInstructions: "Requested vector logo from the customer on Aug 13.",
    },
    sources: [src("s7", "logo-lowres.png", "PNG", "220 KB", "Customer · Aug 13")],
    versions: [],
    revisions: [],
    notes: [{ id: "n4", body: "Supplied PNG is 96 dpi — unusable at label size.", author: "Dale", when: "Aug 13", tone: "blocker" }],
    activity: [{ id: "a13", label: "Issue reported", when: "Aug 13 · 9:15a" }],
    timer: { runningSeconds: 0, running: false, trackedMinutes: 12, sessions: 1 },
    cost: { trackedMinutes: 12, rate: 65, sold: 90 },
  },

  {
    id: "d6",
    order: "10690",
    customer: "Northgate Dental",
    item: "Window Graphics",
    size: '48" × 30"',
    qty: 3,
    media: "Perforated Vinyl",
    sides: 1,
    due: "Aug 24",
    priority: "Standard",
    status: "Needs Design",
    designer: "Unassigned",
    proofRequired: false,
    lineItemNotes: "Customer approved concept verbally — no proof required.",
    brief: {
      customerRequest: "Frosted-look window graphics with the practice name and hours.",
      salesInstructions: "Customer waived proofing — design straight to production.",
      requiredCopy: ["Northgate Dental", "New Patients Welcome"],
    },
    sources: [src("s8", "northgate-brandkit.zip", "ZIP", "18 MB", "Customer · Aug 14")],
    versions: [],
    revisions: [],
    notes: [],
    activity: [{ id: "a14", label: "Assigned to Design", when: "Aug 14 · 4:40p" }],
    timer: { runningSeconds: 0, running: false, trackedMinutes: 0, sessions: 0 },
    cost: { trackedMinutes: 0, rate: 65, sold: 60 },
  },

  {
    id: "d7",
    order: "10690",
    customer: "Northgate Dental",
    item: "Appointment Cards",
    size: '3.5" × 2"',
    qty: 1000,
    media: "16pt Gloss Cover",
    sides: 2,
    due: "Aug 24",
    priority: "Standard",
    status: "Ready for Proof",
    designer: "Marta Reyes",
    proofRequired: true,
    lineItemNotes: "Back side is the appointment grid — keep write-in lines at 0.5pt.",
    brief: {
      customerRequest: "Double-sided appointment cards using the new logo.",
      salesInstructions: "Send a proof before printing.",
      requiredCopy: ["Northgate Dental", "(555) 204-8890"],
    },
    sources: [src("s9", "northgate-logo.ai", "AI", "2.6 MB", "Customer · Aug 14")],
    versions: [
      ver("v1n", "v1", "appt-card-v1-front.pdf", "Aug 15 · Marta", "Front"),
      ver("v1nb", "v1", "appt-card-v1-back.pdf", "Aug 15 · Marta", "Back"),
    ],
    currentVersionId: "v1n",
    revisions: [],
    notes: [],
    activity: [{ id: "a15", label: "v1 uploaded", when: "Aug 15 · 1:05p" }],
    unread: { Dale: { versions: 2, notes: 0 } },
    timer: { runningSeconds: 0, running: false, trackedMinutes: 55, sessions: 1 },
    cost: { trackedMinutes: 55, rate: 65, sold: 110 },
  },
];

export const designSidesOf = (job: DesignJob): DesignSide[] =>
  job.sides === 2 ? ["Front", "Back"] : ["Single"];

export const isDesignDone = (s: DesignStatus) => s === "Design Complete";

/** Route-aware next action — the route decides, the UI only displays it. */
export function nextAction(job: DesignJob): { label: string; cta: string; tone: "primary" | "muted"; disabled?: boolean } {
  if (job.status === "Blocked") return { label: "Resolve Blocker", cta: "Report Issue", tone: "muted" };
  if (job.status === "Waiting on Customer") return { label: "Waiting on Customer", cta: "Send Reminder", tone: "muted" };
  if (job.status === "Design Complete") return { label: "Design Complete", cta: "Reopen Design", tone: "muted" };
  if (job.status === "Revision Requested") return { label: "Continue Revision", cta: "Continue Design", tone: "primary" };
  if (job.status === "Needs Design") return { label: "Begin Design", cta: "Start Design", tone: "primary" };
  if (job.proofRequired) return { label: "Send to Proofing", cta: "Send to Proofing", tone: "primary" };
  return { label: "Complete Design", cta: "Complete Design", tone: "primary" };
}

export interface DesignOrderGroup {
  order: string;
  customer: string;
  due: string;
  rush: boolean;
  jobs: DesignJob[];
  pieces: number;
  counts: { needsDesign: number; inDesign: number; revision: number; waiting: number; proof: number; complete: number; blocked: number };
  alert?: string;
}

export function groupDesignByOrder(jobs: DesignJob[]): DesignOrderGroup[] {
  const map = new Map<string, DesignJob[]>();
  for (const j of jobs) map.set(j.order, [...(map.get(j.order) ?? []), j]);

  return [...map.entries()].map(([order, list]) => {
    const by = (s: DesignStatus) => list.filter((j) => j.status === s).length;
    const blocked = list.filter((j) => j.status === "Blocked");
    const revision = list.filter((j) => j.status === "Revision Requested");
    const alert = blocked.length
      ? (blocked[0]!.blocker ?? "Design blocked")
      : revision.length
        ? `${revision.length} revision request${revision.length === 1 ? "" : "s"} open`
        : undefined;

    return {
      order,
      customer: list[0]!.customer,
      due: list[0]!.due,
      rush: list.some((j) => j.priority === "Rush"),
      jobs: list,
      pieces: list.reduce((n, j) => n + j.qty, 0),
      counts: {
        needsDesign: by("Needs Design"),
        inDesign: by("In Design"),
        revision: by("Revision Requested"),
        waiting: by("Waiting on Customer"),
        proof: by("Ready for Proof"),
        complete: by("Design Complete"),
        blocked: by("Blocked"),
      },
      ...(alert ? { alert } : {}),
    };
  });
}

export const fmtClock = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
};

export const fmtMinutes = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;
