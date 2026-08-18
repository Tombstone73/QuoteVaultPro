/**
 * Proofing workstation mock data (UI prototype only).
 *
 * Proofing sits between Design and Prepress:
 *   Design → Proofing → Prepress → Production
 *
 * Proofing owns the PROOF LIFECYCLE and APPROVAL STATE only.
 * It does not own artwork files (Artwork module) and it never prepares
 * production art, sheet layout or RIP settings (Prepress).
 */

export type ProofSide = "Front" | "Back" | "Single";

export type ProofStatus =
  | "Draft"
  | "Ready to Send"
  | "Sent"
  | "Viewed"
  | "Awaiting Customer"
  | "Approved"
  | "Revision Requested"
  | "Superseded"
  | "Revoked";

export interface ProofRecipient {
  id: string;
  name: string;
  email: string;
  role?: string;
  lastViewed?: string;
}

export interface ProofFeedback {
  id: string;
  version: string;
  body: string;
  author: string;
  when: string;
  kind: "Revision Requested" | "Approved" | "Comment" | "Sent";
}

export interface ProofPage {
  id: string;
  side: ProofSide;
  name: string;
}

export interface ProofVersion {
  id: string;
  label: string;
  file: string;
  /** state of this specific version — never inherited by later versions */
  state: "Current" | "Superseded" | "Revoked";
  outcome: ProofStatus;
  sentAt?: string;
  viewedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  revisionAt?: string;
  pages: ProofPage[];
  note?: string;
}

export interface ProofActivity {
  id: string;
  label: string;
  when: string;
}

/** per-user unread seeds (prototype) */
export interface ProofUnread {
  feedback?: number;
  versions?: number;
  history?: number;
  activity?: number;
}

export interface ProofJob {
  id: string;
  order: string;
  customer: string;
  item: string;
  size?: string;
  qty: number;
  sides: 1 | 2;
  due: string;
  priority: "Rush" | "Standard" | "Low";
  status: ProofStatus;
  owner: string;
  /** design source the proof was generated from — relationship, not a copy */
  sourceArt: { name: string; version: string; designer: string };
  versions: ProofVersion[];
  currentVersionId: string;
  recipients: ProofRecipient[];
  feedback: ProofFeedback[];
  activity: ProofActivity[];
  unread?: Record<string, ProofUnread>;
}

const page = (id: string, side: ProofSide, name: string): ProofPage => ({ id, side, name });

export const proofJobs: ProofJob[] = [
  /* ---------------------------------------- #10671 Delta Faucet Company */
  {
    id: "pf-1",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "Lobby Banner",
    size: '36" × 120"',
    qty: 1,
    sides: 1,
    due: "Aug 19",
    priority: "Rush",
    status: "Revision Requested",
    owner: "Dale",
    sourceArt: { name: "lobby-banner-design-v4.ai", version: "Design v4", designer: "Maya R." },
    currentVersionId: "pf1-v3",
    versions: [
      {
        id: "pf1-v3",
        label: "v3",
        file: "lobby-banner-proof-v3.pdf",
        state: "Current",
        outcome: "Revision Requested",
        sentAt: "Aug 15, 9:12 AM",
        viewedAt: "Aug 15, 2:58 PM",
        revisionAt: "Aug 15, 3:05 PM",
        pages: [page("pf1-v3-a", "Single", "lobby-banner-proof-v3.pdf")],
        note: "Sent to Susan Johnson",
      },
      {
        id: "pf1-v2",
        label: "v2",
        file: "lobby-banner-proof-v2.pdf",
        state: "Superseded",
        outcome: "Revision Requested",
        sentAt: "Aug 13, 4:40 PM",
        viewedAt: "Aug 14, 8:02 AM",
        revisionAt: "Aug 14, 8:15 AM",
        pages: [page("pf1-v2-a", "Single", "lobby-banner-proof-v2.pdf")],
      },
      {
        id: "pf1-v1",
        label: "v1",
        file: "lobby-banner-proof-v1.pdf",
        state: "Superseded",
        outcome: "Superseded",
        sentAt: "Aug 12, 10:05 AM",
        viewedAt: "Aug 12, 11:31 AM",
        pages: [page("pf1-v1-a", "Single", "lobby-banner-proof-v1.pdf")],
      },
    ],
    recipients: [
      { id: "r1", name: "Susan Johnson", email: "susan@deltafaucet.com", role: "Facilities Manager", lastViewed: "Aug 15, 2:58 PM" },
      { id: "r2", name: "Marcus Webb", email: "marcus@deltafaucet.com", role: "Marketing" },
    ],
    feedback: [
      {
        id: "fb1",
        version: "v3",
        body: "Increase the phone number size and move the logo 1 inch higher.",
        author: "Susan Johnson",
        when: "Aug 15, 3:05 PM",
        kind: "Revision Requested",
      },
      {
        id: "fb2",
        version: "v2",
        body: "Headline should read Store Hours, not Hours of Operation.",
        author: "Susan Johnson",
        when: "Aug 14, 8:15 AM",
        kind: "Revision Requested",
      },
      { id: "fb3", version: "v1", body: "Initial proof sent.", author: "Dale", when: "Aug 12, 10:05 AM", kind: "Sent" },
    ],
    activity: [
      { id: "a1", label: "Revision requested by Susan Johnson", when: "Aug 15, 3:05 PM" },
      { id: "a2", label: "Proof v3 viewed", when: "Aug 15, 2:58 PM" },
      { id: "a3", label: "Proof v3 sent", when: "Aug 15, 9:12 AM" },
      { id: "a4", label: "Proof v3 created from Design v4", when: "Aug 15, 8:47 AM" },
      { id: "a5", label: "Revision requested on v2", when: "Aug 14, 8:15 AM" },
    ],
    unread: { Dale: { feedback: 1, versions: 1 } },
  },
  {
    id: "pf-2",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "Store Hours Sign",
    size: '24" × 36"',
    qty: 2,
    sides: 1,
    due: "Aug 19",
    priority: "Rush",
    status: "Approved",
    owner: "Dale",
    sourceArt: { name: "store-hours-design-v2.ai", version: "Design v2", designer: "Maya R." },
    currentVersionId: "pf2-v2",
    versions: [
      {
        id: "pf2-v2",
        label: "v2",
        file: "store-hours-proof-v2.pdf",
        state: "Current",
        outcome: "Approved",
        sentAt: "Aug 15, 10:20 AM",
        viewedAt: "Aug 15, 3:38 PM",
        approvedAt: "Aug 15, 3:42 PM",
        approvedBy: "Susan Johnson",
        pages: [page("pf2-v2-a", "Single", "store-hours-proof-v2.pdf")],
      },
      {
        id: "pf2-v1",
        label: "v1",
        file: "store-hours-proof-v1.pdf",
        state: "Superseded",
        outcome: "Revision Requested",
        sentAt: "Aug 13, 1:15 PM",
        viewedAt: "Aug 13, 4:02 PM",
        revisionAt: "Aug 13, 4:10 PM",
        pages: [page("pf2-v1-a", "Single", "store-hours-proof-v1.pdf")],
      },
    ],
    recipients: [{ id: "r1", name: "Susan Johnson", email: "susan@deltafaucet.com", role: "Facilities Manager", lastViewed: "Aug 15, 3:38 PM" }],
    feedback: [
      { id: "fb1", version: "v2", body: "Looks great — approved.", author: "Susan Johnson", when: "Aug 15, 3:42 PM", kind: "Approved" },
      { id: "fb2", version: "v1", body: "Hours for Sunday are wrong, should be 10–4.", author: "Susan Johnson", when: "Aug 13, 4:10 PM", kind: "Revision Requested" },
    ],
    activity: [
      { id: "a1", label: "Customer approved proof v2", when: "Aug 15, 3:42 PM" },
      { id: "a2", label: "Proof v2 viewed", when: "Aug 15, 3:38 PM" },
      { id: "a3", label: "Proof v2 sent", when: "Aug 15, 10:20 AM" },
    ],
    unread: { Dale: { feedback: 1 } },
  },
  {
    id: "pf-3",
    order: "10671",
    customer: "Delta Faucet Company",
    item: "Decal Set",
    qty: 50,
    sides: 1,
    due: "Aug 19",
    priority: "Rush",
    status: "Awaiting Customer",
    owner: "Dale",
    sourceArt: { name: "decal-set-design-v1.ai", version: "Design v1", designer: "Ken T." },
    currentVersionId: "pf3-v1",
    versions: [
      {
        id: "pf3-v1",
        label: "v1",
        file: "decal-set-proof-v1.pdf",
        state: "Current",
        outcome: "Awaiting Customer",
        sentAt: "Aug 15, 4:05 PM",
        pages: [page("pf3-v1-a", "Single", "decal-set-proof-v1.pdf")],
      },
    ],
    recipients: [{ id: "r1", name: "Marcus Webb", email: "marcus@deltafaucet.com", role: "Marketing" }],
    feedback: [{ id: "fb1", version: "v1", body: "Initial proof sent.", author: "Dale", when: "Aug 15, 4:05 PM", kind: "Sent" }],
    activity: [
      { id: "a1", label: "Proof v1 sent", when: "Aug 15, 4:05 PM" },
      { id: "a2", label: "Proof v1 created from Design v1", when: "Aug 15, 3:50 PM" },
    ],
  },

  /* ------------------------------------------- #10684 Northside Church */
  {
    id: "pf-4",
    order: "10684",
    customer: "Northside Church",
    item: "Event Yard Signs",
    size: '18" × 24"',
    qty: 25,
    sides: 2,
    due: "Aug 21",
    priority: "Standard",
    status: "Viewed",
    owner: "Dale",
    sourceArt: { name: "yard-sign-design-v2.ai", version: "Design v2", designer: "Maya R." },
    currentVersionId: "pf4-v2",
    versions: [
      {
        id: "pf4-v2",
        label: "v2",
        file: "yard-sign-proof-v2.pdf",
        state: "Current",
        outcome: "Viewed",
        sentAt: "Aug 15, 11:02 AM",
        viewedAt: "Aug 15, 5:26 PM",
        pages: [page("pf4-v2-f", "Front", "yard-sign-proof-v2-front.pdf"), page("pf4-v2-b", "Back", "yard-sign-proof-v2-back.pdf")],
        note: "Double-sided — front and back both require approval.",
      },
      {
        id: "pf4-v1",
        label: "v1",
        file: "yard-sign-proof-v1.pdf",
        state: "Revoked",
        outcome: "Revoked",
        sentAt: "Aug 14, 9:00 AM",
        pages: [page("pf4-v1-f", "Front", "yard-sign-proof-v1-front.pdf"), page("pf4-v1-b", "Back", "yard-sign-proof-v1-back.pdf")],
        note: "Revoked — wrong event date on the back side.",
      },
    ],
    recipients: [{ id: "r1", name: "Pastor Ellis", email: "ellis@northside.org", role: "Ministry Lead", lastViewed: "Aug 15, 5:26 PM" }],
    feedback: [{ id: "fb1", version: "v1", body: "Proof revoked internally before customer response.", author: "Dale", when: "Aug 14, 10:12 AM", kind: "Comment" }],
    activity: [
      { id: "a1", label: "Proof v2 viewed by Pastor Ellis", when: "Aug 15, 5:26 PM" },
      { id: "a2", label: "Proof v2 sent", when: "Aug 15, 11:02 AM" },
      { id: "a3", label: "Proof v1 revoked", when: "Aug 14, 10:12 AM" },
    ],
    unread: { Dale: { activity: 1 } },
  },
  {
    id: "pf-5",
    order: "10684",
    customer: "Northside Church",
    item: "Foyer Poster",
    size: '24" × 36"',
    qty: 3,
    sides: 1,
    due: "Aug 21",
    priority: "Standard",
    status: "Ready to Send",
    owner: "Dale",
    sourceArt: { name: "foyer-poster-design-v1.ai", version: "Design v1", designer: "Ken T." },
    currentVersionId: "pf5-v1",
    versions: [
      {
        id: "pf5-v1",
        label: "v1",
        file: "foyer-poster-proof-v1.pdf",
        state: "Current",
        outcome: "Ready to Send",
        pages: [page("pf5-v1-a", "Single", "foyer-poster-proof-v1.pdf")],
        note: "Proof built, not yet sent to the customer.",
      },
    ],
    recipients: [{ id: "r1", name: "Pastor Ellis", email: "ellis@northside.org", role: "Ministry Lead" }],
    feedback: [],
    activity: [{ id: "a1", label: "Proof v1 created from Design v1", when: "Aug 15, 6:10 PM" }],
  },

  /* ------------------------------------------------ #10692 Vail Storage */
  {
    id: "pf-6",
    order: "10692",
    customer: "Vail Storage Group",
    item: "Gate Regulations Panel",
    size: '48" × 96"',
    qty: 1,
    sides: 1,
    due: "Aug 18",
    priority: "Standard",
    status: "Approved",
    owner: "Dale",
    sourceArt: { name: "gate-panel-design-v3.ai", version: "Design v3", designer: "Maya R." },
    currentVersionId: "pf6-v1",
    versions: [
      {
        id: "pf6-v1",
        label: "v1",
        file: "gate-panel-proof-v1.pdf",
        state: "Current",
        outcome: "Approved",
        sentAt: "Aug 14, 8:30 AM",
        viewedAt: "Aug 14, 9:11 AM",
        approvedAt: "Aug 14, 9:14 AM",
        approvedBy: "Rita Chen",
        pages: [page("pf6-v1-a", "Single", "gate-panel-proof-v1.pdf")],
        note: "Approved — ready to release to Prepress.",
      },
    ],
    recipients: [{ id: "r1", name: "Rita Chen", email: "rita@vailstorage.com", role: "Operations", lastViewed: "Aug 14, 9:11 AM" }],
    feedback: [{ id: "fb1", version: "v1", body: "Approved as-is, please produce.", author: "Rita Chen", when: "Aug 14, 9:14 AM", kind: "Approved" }],
    activity: [
      { id: "a1", label: "Customer approved proof v1", when: "Aug 14, 9:14 AM" },
      { id: "a2", label: "Proof v1 viewed", when: "Aug 14, 9:11 AM" },
      { id: "a3", label: "Proof v1 sent", when: "Aug 14, 8:30 AM" },
    ],
  },
  {
    id: "pf-7",
    order: "10692",
    customer: "Vail Storage Group",
    item: "Unit Number Decals",
    qty: 120,
    sides: 1,
    due: "Aug 18",
    priority: "Standard",
    status: "Draft",
    owner: "Dale",
    sourceArt: { name: "unit-decals-design-v1.ai", version: "Design v1", designer: "Ken T." },
    currentVersionId: "pf7-v1",
    versions: [
      {
        id: "pf7-v1",
        label: "v1",
        file: "unit-decals-proof-draft.pdf",
        state: "Current",
        outcome: "Draft",
        pages: [page("pf7-v1-a", "Single", "unit-decals-proof-draft.pdf")],
        note: "Draft proof — recipients not confirmed.",
      },
    ],
    recipients: [],
    feedback: [],
    activity: [{ id: "a1", label: "Draft proof created", when: "Aug 15, 7:02 PM" }],
  },
];

/* --------------------------------------------------------------- helpers */

export interface ProofGroup {
  order: string;
  customer: string;
  due: string;
  rush: boolean;
  jobs: ProofJob[];
  counts: {
    approved: number;
    revision: number;
    awaiting: number;
    viewed: number;
    notSent: number;
  };
  alert?: string;
}

export function groupProofsByOrder(jobs: ProofJob[]): ProofGroup[] {
  const map = new Map<string, ProofGroup>();
  for (const j of jobs) {
    let g = map.get(j.order);
    if (!g) {
      g = {
        order: j.order,
        customer: j.customer,
        due: j.due,
        rush: false,
        jobs: [],
        counts: { approved: 0, revision: 0, awaiting: 0, viewed: 0, notSent: 0 },
      };
      map.set(j.order, g);
    }
    g.jobs.push(j);
    if (j.priority === "Rush") g.rush = true;
    if (j.status === "Approved") g.counts.approved++;
    else if (j.status === "Revision Requested") g.counts.revision++;
    else if (j.status === "Awaiting Customer" || j.status === "Sent") g.counts.awaiting++;
    else if (j.status === "Viewed") g.counts.viewed++;
    else g.counts.notSent++;
  }
  for (const g of map.values()) {
    if (g.counts.revision > 0) g.alert = `${g.counts.revision} revision requested`;
    else if (g.counts.notSent > 0) g.alert = `${g.counts.notSent} not sent yet`;
  }
  return [...map.values()];
}

export function proofSidesOf(job: ProofJob, versionId: string): ProofSide[] {
  const v = job.versions.find((x) => x.id === versionId) ?? job.versions[0];
  return v ? v.pages.map((p) => p.side) : ["Single"];
}

export interface ProofNextAction {
  label: string;
  cta: string;
  tone: "primary" | "secondary";
  /** secondary actions valid in this state */
  extras: string[];
}

/** Route/state aware — never hard-coded to one action. */
export function proofNextAction(job: ProofJob): ProofNextAction {
  switch (job.status) {
    case "Draft":
      return { label: "Finish Proof", cta: "Mark Ready to Send", tone: "secondary", extras: ["Add Recipient", "Download Proof"] };
    case "Ready to Send":
      return { label: "Send Proof", cta: "Send Proof", tone: "primary", extras: ["Add Recipient", "Download Proof"] };
    case "Sent":
    case "Awaiting Customer":
      return { label: "Awaiting Customer", cta: "Resend Proof", tone: "secondary", extras: ["Add Recipient", "Revoke Proof", "Download Proof"] };
    case "Viewed":
      return { label: "Viewed — Awaiting Response", cta: "Resend Proof", tone: "secondary", extras: ["Add Recipient", "Revoke Proof"] };
    case "Revision Requested":
      return { label: "Return to Design", cta: "Return to Design", tone: "primary", extras: ["Download Proof"] };
    case "Approved":
      return { label: "Release to Prepress", cta: "Release to Prepress", tone: "primary", extras: ["Download Proof"] };
    case "Revoked":
      return { label: "Rebuild Proof", cta: "Return to Design", tone: "secondary", extras: [] };
    default:
      return { label: "Superseded", cta: "Open Current Proof", tone: "secondary", extras: [] };
  }
}
