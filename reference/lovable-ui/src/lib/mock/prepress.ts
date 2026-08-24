/**
 * Prepress workspace mock data (UI prototype only).
 * Artwork owns customer + production art; Prepress selects/prepares production art.
 */

export type Sides = 1 | 2;
export type Side = "Front" | "Back" | "Single";

export const prepressDestinations = ["Océ Arizona", "Roland", "HP Latex", "Router", "Finishing"] as const;
export type Destination = (typeof prepressDestinations)[number];

export type PrepressStatus =
  | "Ready for Prepress"
  | "Needs Production Art"
  | "Waiting on Proof"
  | "Artwork Issue";

export interface ArtFile {
  id: string;
  name: string;
  size: string;
  uploaded: string;
  kind: "Customer" | "Production";
}

export interface PrepressJob {
  id: string;
  order: string;
  customer: string;
  item: string;
  size: string;
  qty: number;
  due: string;
  priority: "Rush" | "Standard" | "Low";
  status: PrepressStatus;
  sides: Sides;
  media: string;
  lamination: string;
  finishing: string;
  proofStatus: string;
  notes: string;
  destination: Destination | null;
  /** customer / line item art keyed by side */
  lineArt: Partial<Record<Side, ArtFile>>;
  /** production art assignments keyed by side */
  prodArt: Partial<Record<Side, ArtFile>>;
  /** extra files available for assignment */
  files: ArtFile[];
  blocked?: string;
  /**
   * Per production-art page/role release state. A line item is only "prepress
   * complete" when every required role has been released — roles progress
   * independently.
   */
  releasedRoles?: Partial<Record<Side, boolean>>;
}


const f = (id: string, name: string, size: string, uploaded: string, kind: ArtFile["kind"]): ArtFile => ({
  id, name, size, uploaded, kind,
});

export const prepressJobs: PrepressJob[] = [
  /* ---- #10671 Delta Faucet — rush, 4 items: 3 ready, 1 waiting on proof ---- */
  {
    id: "pp1",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "4mm Coroplast Sign",
    size: '24" × 36"',
    qty: 75,
    due: "Aug 18, 2026",
    priority: "Rush",
    status: "Ready for Prepress",
    sides: 2,
    media: "4mm Coroplast",
    lamination: "None",
    finishing: 'Grommets, 24" o.c.',
    proofStatus: "Approved Aug 14",
    notes: "Back side reads bottom-up — verify orientation before RIP.",
    destination: "Océ Arizona",
    lineArt: {
      Front: f("l1", "10671_DeltaSign_FRONT.pdf", "12.4 MB", "2 days ago", "Customer"),
      Back: f("l2", "10671_DeltaSign_BACK.pdf", "11.8 MB", "2 days ago", "Customer"),
    },
    prodArt: {
      Front: f("p1", "PRD-10671-front.tif", "88 MB", "yesterday", "Production"),
      Back: f("p2", "PRD-10671-back.tif", "84 MB", "yesterday", "Production"),
    },
    files: [f("x1", "10671_logo_vector.ai", "3.1 MB", "3 days ago", "Customer")],
    releasedRoles: { Front: true },
  },

  {
    id: "pp1b",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "13oz Banner — Lobby",
    size: '36" × 120"',
    qty: 6,
    due: "Aug 18, 2026",
    priority: "Rush",
    status: "Ready for Prepress",
    sides: 1,
    media: "13oz Scrim Vinyl",
    lamination: "None",
    finishing: "Hem + grommets",
    proofStatus: "Approved Aug 14",
    notes: "",
    destination: "HP Latex",
    lineArt: { Single: f("l1b", "10671_Lobby_Banner.pdf", "19.7 MB", "2 days ago", "Customer") },
    prodArt: { Single: f("p1b", "PRD-10671-banner.tif", "112 MB", "yesterday", "Production") },
    files: [],
    releasedRoles: { Single: true },
  },
  {
    id: "pp1c",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "Adhesive Vinyl Decal Set",
    size: '12" × 12"',
    qty: 40,
    due: "Aug 18, 2026",
    priority: "Rush",
    status: "Ready for Prepress",
    sides: 1,
    media: "Adhesive Vinyl",
    lamination: "Gloss lam",
    finishing: "Kiss cut",
    proofStatus: "Approved Aug 14",
    notes: "",
    destination: "Roland",
    lineArt: { Single: f("l1c", "10671_Decals.pdf", "4.8 MB", "2 days ago", "Customer") },
    prodArt: { Single: f("p1c", "PRD-10671-decals.tif", "26 MB", "today", "Production") },
    files: [],
  },
  {
    id: "pp1d",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "Contour Cut Stickers — Logo 3in",
    size: '3" × 3"',
    qty: 500,
    due: "Aug 18, 2026",
    priority: "Rush",
    status: "Waiting on Proof",
    sides: 1,
    media: "Adhesive Vinyl",
    lamination: "Matte lam",
    finishing: "Contour cut",
    proofStatus: "Sent Aug 15 — awaiting customer",
    notes: "Hold until proof returns.",
    destination: "Roland",
    lineArt: { Single: f("l1d", "10671_Logo_Stickers.pdf", "2.4 MB", "2 days ago", "Customer") },
    prodArt: {},
    files: [],
    blocked: "Proof approval required",
  },

  /* ---- #10668 Purdue Athletics — 2 items, one needs production art ---- */
  {
    id: "pp2",
    order: "10668",
    customer: "Purdue Athletics",
    item: "13oz Banner — Gate C",
    size: '36" × 120"',
    qty: 4,
    due: "Aug 19, 2026",
    priority: "Standard",
    status: "Needs Production Art",
    sides: 1,
    media: "13oz Scrim Vinyl",
    lamination: "None",
    finishing: "Hem all sides",
    proofStatus: "Approved Aug 13",
    notes: "Match PMS 465 from last run.",
    destination: "Roland",
    lineArt: { Single: f("l3", "10668_GateC_Banner.pdf", "22.6 MB", "4 days ago", "Customer") },
    prodArt: {},
    files: [],
    blocked: "Production artwork missing",
  },
  {
    id: "pp2b",
    order: "10668",
    customer: "Purdue Athletics",
    item: "Mesh Fence Banner — Gate D",
    size: '48" × 144"',
    qty: 2,
    due: "Aug 19, 2026",
    priority: "Standard",
    status: "Ready for Prepress",
    sides: 1,
    media: "Mesh Banner",
    lamination: "None",
    finishing: "Hem + grommets 18in",
    proofStatus: "Approved Aug 13",
    notes: "",
    destination: "HP Latex",
    lineArt: { Single: f("l3b", "10668_GateD_Mesh.pdf", "26.1 MB", "4 days ago", "Customer") },
    prodArt: { Single: f("p3b", "PRD-10668-gated.tif", "141 MB", "today", "Production") },
    files: [],
  },

  /* ---- #10664 Midwest Concrete — 3 items, all ready ---- */
  {
    id: "pp3",
    order: "10664",
    customer: "Midwest Concrete",
    item: "A-Frame Insert",
    size: '24" × 36"',
    qty: 20,
    due: "Aug 20, 2026",
    priority: "Standard",
    status: "Ready for Prepress",
    sides: 2,
    media: "3mm ACM",
    lamination: "Matte lam",
    finishing: "Trim to size",
    proofStatus: "Approved Aug 12",
    notes: "Same artwork both sides.",
    destination: "Océ Arizona",
    lineArt: {
      Front: f("l4", "10664_AFrame.pdf", "9.2 MB", "5 days ago", "Customer"),
      Back: f("l5", "10664_AFrame.pdf", "9.2 MB", "5 days ago", "Customer"),
    },
    prodArt: {
      Front: f("p3", "PRD-10664-both.tif", "54 MB", "today", "Production"),
      Back: f("p4", "PRD-10664-both.tif", "54 MB", "today", "Production"),
    },
    files: [],
  },
  {
    id: "pp3b",
    order: "10664",
    customer: "Midwest Concrete",
    item: "Job Site Sign",
    size: '48" × 96"',
    qty: 3,
    due: "Aug 20, 2026",
    priority: "Standard",
    status: "Ready for Prepress",
    sides: 1,
    media: "3mm ACM",
    lamination: "None",
    finishing: "Predrilled",
    proofStatus: "Approved Aug 12",
    notes: "",
    destination: "Océ Arizona",
    lineArt: { Single: f("l4b", "10664_JobSite.pdf", "14.5 MB", "5 days ago", "Customer") },
    prodArt: { Single: f("p3c", "PRD-10664-jobsite.tif", "96 MB", "today", "Production") },
    files: [],
  },
  {
    id: "pp3c",
    order: "10664",
    customer: "Midwest Concrete",
    item: "Truck Door Decals",
    size: '18" × 18"',
    qty: 12,
    due: "Aug 20, 2026",
    priority: "Standard",
    status: "Ready for Prepress",
    sides: 1,
    media: "Adhesive Vinyl",
    lamination: "Gloss lam",
    finishing: "Contour cut",
    proofStatus: "Approved Aug 12",
    notes: "",
    destination: "Roland",
    lineArt: { Single: f("l4c", "10664_TruckDecal.pdf", "5.5 MB", "5 days ago", "Customer") },
    prodArt: { Single: f("p3d", "PRD-10664-truck.tif", "31 MB", "today", "Production") },
    files: [],
  },

  /* ---- #10659 Lafayette Schools — mixed sidedness, one needs prod art ---- */
  {
    id: "pp4",
    order: "10659",
    customer: "Lafayette Schools",
    item: "Coroplast Yard Sign",
    size: '18" × 24"',
    qty: 250,
    due: "Aug 21, 2026",
    priority: "Low",
    status: "Needs Production Art",
    sides: 2,
    media: "4mm Coroplast",
    lamination: "None",
    finishing: "H-stakes included",
    proofStatus: "Approved Aug 11",
    notes: "",
    destination: null,
    lineArt: {
      Front: f("l6", "10659_OpenHouse_A.pdf", "6.4 MB", "6 days ago", "Customer"),
      Back: f("l7", "10659_OpenHouse_B.pdf", "6.1 MB", "6 days ago", "Customer"),
    },
    prodArt: {},
    files: [f("x2", "10659_school_seal.png", "1.2 MB", "6 days ago", "Customer")],
    blocked: "Production artwork missing",
  },
  {
    id: "pp4b",
    order: "10659",
    customer: "Lafayette Schools",
    item: "Hallway Banner",
    size: '30" × 96"',
    qty: 5,
    due: "Aug 21, 2026",
    priority: "Low",
    status: "Ready for Prepress",
    sides: 1,
    media: "13oz Scrim Vinyl",
    lamination: "None",
    finishing: "Pole pockets",
    proofStatus: "Approved Aug 11",
    notes: "",
    destination: "HP Latex",
    lineArt: { Single: f("l6b", "10659_Hallway.pdf", "12.9 MB", "6 days ago", "Customer") },
    prodArt: { Single: f("p4b", "PRD-10659-hallway.tif", "76 MB", "today", "Production") },
    files: [],
  },

  /* ---- #10655 Riverside Dental — waiting on proof ---- */
  {
    id: "pp5",
    order: "10655",
    customer: "Riverside Dental",
    item: "Window Perf — Storefront",
    size: '48" × 96"',
    qty: 2,
    due: "Aug 22, 2026",
    priority: "Standard",
    status: "Waiting on Proof",
    sides: 1,
    media: "Perf Vinyl + Lam",
    lamination: "Optically clear lam",
    finishing: "Trim to size",
    proofStatus: "Sent Aug 15 — awaiting customer",
    notes: "Hold until proof approval returns.",
    destination: "HP Latex",
    lineArt: { Single: f("l8", "10655_WindowPerf.pdf", "17.9 MB", "yesterday", "Customer") },
    prodArt: {},
    files: [],
    blocked: "Proof approval required",
  },

  /* ---- #10650 Delta Faucet — artwork issue ---- */
  {
    id: "pp6",
    order: "10650",
    customer: "Delta Faucet Company",
    item: "Dibond Panel — Trade Booth",
    size: '48" × 96"',
    qty: 8,
    due: "Aug 23, 2026",
    priority: "Standard",
    status: "Artwork Issue",
    sides: 1,
    media: "6mm Dibond",
    lamination: "None",
    finishing: "Trim to size",
    proofStatus: "Approved Aug 10",
    notes: "Customer file is 96 effective PPI at final size.",
    destination: "Router",
    lineArt: { Single: f("l9", "10650_Booth_Panel.pdf", "31.2 MB", "3 days ago", "Customer") },
    prodArt: {},
    files: [],
    blocked: "Low resolution — replacement art requested",
  },
];

/* ------------------------- order-level aggregation ------------------------ */

export interface PrepressOrderGroup {
  order: string;
  customer: string;
  due: string;
  rush: boolean;
  jobs: PrepressJob[];
  /** total pieces across the order's line items */
  pieces: number;
  /** counts of child LINE ITEMS by their rolled-up state */
  counts: { inProduction: number; ready: number; needsArt: number; proof: number; issue: number };
  /** every required art page across the order has been released */
  allReleased: boolean;
  /** short blocker sentence to surface even when collapsed */
  alert?: string;
}

export const sidesOf = (job: PrepressJob): Side[] => (job.sides === 2 ? ["Front", "Back"] : ["Single"]);

export const isRoleReleased = (job: PrepressJob, side: Side) => !!job.releasedRoles?.[side];

export type RoleState =
  | "In Production"
  | "Ready to Release"
  | "Needs Production Art"
  | "Waiting on Proof"
  | "Artwork Issue"
  | "Needs Destination";

/**
 * Requirements for ONE production-art page/role. A role is never gated by a
 * sibling role or by another line item on the same order.
 */
export function roleBlockers(job: PrepressJob, side: Side): string[] {
  const out: string[] = [];
  if (!job.prodArt[side]) out.push(`${side === "Single" ? "Artwork" : side} production art not assigned`);
  if (job.status === "Waiting on Proof") out.push("Proof approval required");
  if (job.status === "Artwork Issue") out.push(job.blocked ?? "Artwork issue reported");
  if (!job.destination) out.push("Production destination required");
  return out;
}

export function roleState(job: PrepressJob, side: Side): RoleState {
  if (isRoleReleased(job, side)) return "In Production";
  if (job.status === "Artwork Issue") return "Artwork Issue";
  if (job.status === "Waiting on Proof") return "Waiting on Proof";
  if (!job.prodArt[side]) return "Needs Production Art";
  if (!job.destination) return "Needs Destination";
  return "Ready to Release";
}

export interface LineItemSummary {
  roles: { side: Side; state: RoleState }[];
  total: number;
  released: number;
  /** every required art page released — prepress is complete for this line item */
  complete: boolean;
  /** "1 of 2 art pages ready" / "Front in Production · Back in Prepress" */
  label: string;
}

export function lineItemSummary(job: PrepressJob): LineItemSummary {
  const roles = sidesOf(job).map((side) => ({ side, state: roleState(job, side) }));
  const released = roles.filter((r) => r.state === "In Production").length;
  const readyNotReleased = roles.filter((r) => r.state === "Ready to Release").length;
  const total = roles.length;
  const complete = released === total;

  let label: string;
  if (complete) label = total === 1 ? "In Production" : "All art pages in production";
  else if (released > 0) label = roles.map((r) => `${r.side === "Single" ? "Art" : r.side} ${r.state === "In Production" ? "in Production" : "in Prepress"}`).join(" · ");
  else if (readyNotReleased === total) label = total === 1 ? "Ready to release" : "All art pages ready";
  else label = `${readyNotReleased} of ${total} art page${total === 1 ? "" : "s"} ready`;

  return { roles, total, released, complete, label };
}

/** Parent presentation only — child roles remain the source of truth. */
export function groupPrepressByOrder(jobs: PrepressJob[]): PrepressOrderGroup[] {
  const map = new Map<string, PrepressJob[]>();
  for (const j of jobs) map.set(j.order, [...(map.get(j.order) ?? []), j]);

  const groups = [...map.entries()].map(([order, list]) => {
    const sums = list.map((j) => ({ job: j, s: lineItemSummary(j) }));
    const counts = {
      inProduction: sums.filter((x) => x.s.complete).length,
      ready: sums.filter((x) => !x.s.complete && x.s.roles.some((r) => r.state === "Ready to Release")).length,
      needsArt: sums.filter((x) => x.s.roles.some((r) => r.state === "Needs Production Art" || r.state === "Needs Destination")).length,
      proof: sums.filter((x) => x.s.roles.some((r) => r.state === "Waiting on Proof")).length,
      issue: sums.filter((x) => x.s.roles.some((r) => r.state === "Artwork Issue")).length,
    };
    const blockedPages = sums.reduce(
      (n, x) => n + x.s.roles.filter((r) => r.state !== "In Production" && r.state !== "Ready to Release").length,
      0,
    );
    const group: PrepressOrderGroup = {
      order,
      customer: list[0]!.customer,
      due: list[0]!.due,
      rush: list.some((j) => j.priority === "Rush"),
      jobs: list,
      pieces: list.reduce((n, j) => n + j.qty, 0),
      counts,
      allReleased: sums.every((x) => x.s.complete),
      ...(blockedPages ? { alert: `${blockedPages} art page${blockedPages === 1 ? " needs" : "s need"} prepress work` } : {}),
    };
    return group;
  });

  return groups;
}

/** Aggregate of all remaining role blockers on a line item (queue display only). */
export function jobBlockers(job: PrepressJob): string[] {
  const out = new Set<string>();
  for (const s of sidesOf(job)) {
    if (isRoleReleased(job, s)) continue;
    for (const b of roleBlockers(job, s)) out.add(b);
  }
  return [...out];
}

