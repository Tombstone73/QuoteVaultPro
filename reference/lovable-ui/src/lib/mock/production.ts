import { customers, type SalesDoc } from "@/lib/mock/data";

export const workCenters = [
  "Unassigned",
  "Océ Arizona",
  "Roland",
  "HP Latex",
  "Router",
  "Finishing",
] as const;

export type WorkCenter = (typeof workCenters)[number];

/** Machines only (Unassigned is a holding column, not a work center). */
export const machineCenters = workCenters.filter((w) => w !== "Unassigned") as Exclude<WorkCenter, "Unassigned">[];

export type Priority = "Rush" | "Standard" | "Low";

export interface ProdJob {
  id: string;
  orderNumber: string;
  orderId?: string | undefined;
  customer: string;
  item: string;
  qty: number;
  due: string;
  dueTone: "late" | "warn" | "neutral";
  priority: Priority;
  /** Business route stage — NOT changed by station assignment. */
  routeStep: string;
  status: string;
  station: WorkCenter;
  warning?: string | undefined;
  estHours: number;
  /** day index 0..4 within the mocked week, undefined = unscheduled */
  day?: number | undefined;
  startHour?: number | undefined;
  blocked?: string | undefined;
  completedAt?: string | undefined;
}

const STATION_MAP: Record<string, WorkCenter> = {
  "Océ Arizona": "Océ Arizona",
  Roland: "Roland",
  "HP Latex": "HP Latex",
  Router: "Router",
  "Finishing Bench": "Finishing",
  Finishing: "Finishing",
};

const priorityFor = (i: number): Priority => (i % 7 === 0 ? "Rush" : i % 5 === 0 ? "Low" : "Standard");

export function jobsFromDocs(docs: SalesDoc[]): ProdJob[] {
  const orders = docs.filter((d) => d.documentType === "Order");
  let i = 0;
  return orders.flatMap((d) =>
    d.lines.map((l) => {
      i += 1;
      const station = (l.station && STATION_MAP[l.station]) || "Unassigned";
      const warning =
        l.artworkStatus === "Proof Pending"
          ? "Proof pending"
          : l.artworkStatus === "Needs Artwork"
            ? "Artwork missing"
            : undefined;
      return {
        id: l.id,
        orderNumber: d.number,
        orderId: d.number,
        customer: customers.find((c) => c.id === d.customerId)?.name ?? "—",
        item: l.description,
        qty: l.qty,
        due: d.dueDate,
        dueTone: i % 6 === 0 ? "late" : i % 4 === 0 ? "warn" : "neutral",
        priority: priorityFor(i),
        routeStep: l.routeStep,
        status: l.routeStep,
        station,
        warning,
        estHours: Math.max(0.5, Math.round((l.qty / 60) * 2) / 2 + 0.5),
        day: station === "Unassigned" ? undefined : i % 5,
        startHour: station === "Unassigned" ? undefined : 8 + ((i * 3) % 8),
        blocked: warning ? warning : undefined,
      } satisfies ProdJob;
    }),
  );
}

/** Extra mocked shop-floor work so the board/calendar read realistically. */
const filler: Array<Omit<ProdJob, "dueTone">> = [
  { id: "pj1", orderNumber: "10412", customer: "Delta Faucet Company", item: '3mm ACM Sign — Lobby Wayfinding 24"×36"', qty: 12, due: "Aug 17, 2026", priority: "Rush", routeStep: "Production", status: "Printing", station: "Océ Arizona", estHours: 3, day: 0, startHour: 8, warning: "Rush — same-day" },
  { id: "pj2", orderNumber: "10415", customer: "Purdue Athletics", item: "13oz Banner — Gate C Entrance", qty: 4, due: "Aug 18, 2026", priority: "Standard", routeStep: "Production", status: "Queued", station: "Océ Arizona", estHours: 1.5, day: 0, startHour: 12 },
  { id: "pj3", orderNumber: "10417", customer: "Riverside Dental", item: "Window Perf — Storefront", qty: 2, due: "Aug 19, 2026", priority: "Standard", routeStep: "Production", status: "Queued", station: "HP Latex", estHours: 2, day: 1, startHour: 9 },
  { id: "pj4", orderNumber: "10419", customer: "Midwest Concrete", item: "Truck Door Decals — Fleet Set", qty: 18, due: "Aug 20, 2026", priority: "Standard", routeStep: "Production", status: "Queued", station: "Roland", estHours: 4, day: 1, startHour: 13 },
  { id: "pj5", orderNumber: "10421", customer: "Delta Faucet Company", item: "Dibond Panels — Trade Booth", qty: 8, due: "Aug 17, 2026", priority: "Rush", routeStep: "Production", status: "Blocked", station: "Router", estHours: 2.5, day: 2, startHour: 8, blocked: "Material short — 3mm Dibond on order", warning: "Material short" },
  { id: "pj6", orderNumber: "10423", customer: "Lafayette Schools", item: "Coroplast Yard Signs — Open House", qty: 250, due: "Aug 21, 2026", priority: "Low", routeStep: "Production", status: "Queued", station: "Océ Arizona", estHours: 5, day: 2, startHour: 11 },
  { id: "pj7", orderNumber: "10425", customer: "Purdue Athletics", item: "Mesh Banner — Fence Wrap 8ft", qty: 6, due: "Aug 22, 2026", priority: "Standard", routeStep: "Finishing", status: "Hemming", station: "Finishing", estHours: 2, day: 3, startHour: 9 },
  { id: "pj8", orderNumber: "10427", customer: "Riverside Dental", item: "Acrylic Standoff Sign", qty: 1, due: "Aug 19, 2026", priority: "Standard", routeStep: "Production", status: "Blocked", station: "Router", estHours: 1, blocked: "Awaiting customer proof approval", warning: "Proof pending" },
  { id: "pj9", orderNumber: "10429", customer: "Midwest Concrete", item: "Reflective Safety Decals", qty: 60, due: "Aug 23, 2026", priority: "Low", routeStep: "Production", status: "Queued", station: "Roland", estHours: 1.5, day: 4, startHour: 10 },
  { id: "pj10", orderNumber: "10431", customer: "Delta Faucet Company", item: "Retractable Banner Stands", qty: 5, due: "Aug 24, 2026", priority: "Standard", routeStep: "Production", status: "Unassigned", station: "Unassigned", estHours: 2 },
  { id: "pj11", orderNumber: "10433", customer: "Lafayette Schools", item: "Gym Wall Graphics — Panels", qty: 14, due: "Aug 25, 2026", priority: "Standard", routeStep: "Production", status: "Unassigned", station: "Unassigned", estHours: 6 },
  { id: "pj12", orderNumber: "10435", customer: "Purdue Athletics", item: "Locker Nameplates", qty: 96, due: "Aug 26, 2026", priority: "Low", routeStep: "Production", status: "Unassigned", station: "Unassigned", estHours: 3 },
  { id: "pj13", orderNumber: "10437", customer: "Midwest Concrete", item: "Jobsite A-Frame Inserts", qty: 20, due: "Aug 18, 2026", priority: "Rush", routeStep: "Production", status: "Laminating", station: "Finishing", estHours: 1.5, day: 3, startHour: 13, warning: "Due tomorrow" },
  { id: "pj14", orderNumber: "10439", customer: "Riverside Dental", item: "Vehicle Magnet Set", qty: 4, due: "Aug 20, 2026", priority: "Standard", routeStep: "Production", status: "Queued", station: "HP Latex", estHours: 1, day: 4, startHour: 14 },
];

export function fillerJobs(): ProdJob[] {
  return filler.map((j, i) => ({
    ...j,
    dueTone: j.priority === "Rush" ? "late" : i % 4 === 0 ? "warn" : "neutral",
  }));
}

export const completedToday: ProdJob[] = [
  { id: "cj1", orderNumber: "10390", customer: "Delta Faucet Company", item: "4mm Coroplast — Store Hours", qty: 75, due: "Aug 15, 2026", dueTone: "neutral", priority: "Standard", routeStep: "Finishing", status: "Complete", station: "Océ Arizona", estHours: 2, completedAt: "7:42 AM" },
  { id: "cj2", orderNumber: "10393", customer: "Purdue Athletics", item: "Rigid Sign — Practice Facility", qty: 6, due: "Aug 15, 2026", dueTone: "neutral", priority: "Standard", routeStep: "Fulfillment", status: "Complete", station: "Océ Arizona", estHours: 1.5, completedAt: "9:15 AM" },
  { id: "cj3", orderNumber: "10396", customer: "Lafayette Schools", item: "Foamcore Presentation Boards", qty: 30, due: "Aug 15, 2026", dueTone: "neutral", priority: "Low", routeStep: "Finishing", status: "Complete", station: "Océ Arizona", estHours: 2.5, completedAt: "11:03 AM" },
  { id: "cj4", orderNumber: "10399", customer: "Midwest Concrete", item: "Site Safety Panels", qty: 10, due: "Aug 15, 2026", dueTone: "neutral", priority: "Standard", routeStep: "Production", status: "Complete", station: "Océ Arizona", estHours: 1, completedAt: "1:20 PM" },
];

export const stationStatus: Record<string, { status: string; operator: string }> = {
  "Océ Arizona": { status: "Running", operator: "Marcus T." },
  Roland: { status: "Running", operator: "Angela P." },
  "HP Latex": { status: "Idle", operator: "Unassigned" },
  Router: { status: "Maintenance", operator: "Ben K." },
  Finishing: { status: "Running", operator: "Rosa M." },
};

export const weekDays = ["Mon Aug 17", "Tue Aug 18", "Wed Aug 19", "Thu Aug 20", "Fri Aug 21"];

/** Context-aware action label for a job's current route stage. */
export function nextActionLabel(routeStep: string): string {
  switch (routeStep) {
    case "Proofing": return "Send to Prepress";
    case "Prepress": return "Release to Production";
    case "Production": return "Mark Printed";
    case "Finishing": return "Finish & Stage";
    case "Fulfillment": return "Mark Ready";
    default: return "Advance";
  }
}

/* ------------------------------- ARTWORK -------------------------------- */

export type ArtKind = "line" | "production";

export interface ArtTile {
  /** "Front" / "Back" for flatbed rigid, "Side A" / "Side B" for roll media */
  side: string;
  file: string;
  ready: boolean;
}

const hash = (s: string) => s.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Roll (media) stations use Side A/B wording; flatbed/rigid use Front/Back. */
export function isRollStation(station: string): boolean {
  return station === "Roland" || station === "HP Latex";
}

/** Deterministic mocked sidedness for a job. */
export function jobSides(job: ProdJob): 1 | 2 {
  const h = hash(job.id + job.orderNumber);
  if (/double|two[- ]sided|2-sided/i.test(job.item)) return 2;
  // the job actively running at a station is mocked double-sided so operators
  // always see the two-image layout; queued jobs stay a mix of 1S / 2S
  if (!job.blocked && /print|run|lamin|hem/i.test(job.status)) return 2;
  // roll work is mostly single-sided, flatbed mixes more
  return h % (isRollStation(job.station) ? 5 : 3) === 0 ? 2 : 1;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 22);

export function jobArt(job: ProdJob, kind: ArtKind): ArtTile[] {
  const sides = jobSides(job);
  const roll = isRollStation(job.station);
  const labels = sides === 1 ? ["Single"] : roll ? ["Side A", "Side B"] : ["Front", "Back"];
  const base = `${job.orderNumber}-${slug(job.item)}`;
  return labels.map((side, i) => ({
    side,
    file:
      kind === "line"
        ? `${base}${sides === 2 ? `-${side.replace(/\s/g, "").toLowerCase()}` : ""}.pdf`
        : `PRD-${base}${sides === 2 ? `-${i === 0 ? "a" : "b"}` : ""}.tif`,
    ready: kind === "production" ? !job.blocked : !job.warning,
  }));
}

/* ---------------------------- JOB SPEC (mock) ---------------------------- */

const SIZES = ['24" × 36"', '48" × 96"', '18" × 24"', '36" × 120"', '12" × 18"'];
const MEDIA = ["3mm ACM", "13oz Scrim Vinyl", "4mm Coroplast", "6mm Dibond", "Cast Vinyl + Lam"];

export interface JobSpec {
  size: string;
  media: string;
  lamination: string;
  finishing: string;
  notes: string;
}

export function jobSpec(job: ProdJob): JobSpec {
  const h = hash(job.id + job.item);
  return {
    size: SIZES[h % SIZES.length]!,
    media: MEDIA[(h >> 3) % MEDIA.length]!,
    lamination: h % 3 === 0 ? "Matte lam" : "None",
    finishing: h % 4 === 0 ? "Grommets, 24\" o.c." : h % 4 === 1 ? "Hem all sides" : "Trim to size",
    notes: "Double-hit white, verify color bar before full run.",
  };
}
