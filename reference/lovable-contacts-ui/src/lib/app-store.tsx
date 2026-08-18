import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  customers as seedCustomers,
  invoices as seedInvoices,
  salesDocs as seedDocs,
  defaultGranted,
  type Invoice,
  type LineItem,
  type SalesDoc,
} from "./mock/data";

export type ThemeName = "light" | "dark" | "command" | "contrast" | "lowglare" | "warm";
export type Density = "comfortable" | "compact";
export type Accent = "blue" | "teal" | "amber" | "violet" | "red";
export type FontFamilyId = "inter" | "segoe" | "arial" | "roboto" | "roboto-condensed" | "atkinson";
export type ColorVision = "standard" | "protan" | "deutan" | "tritan";

export interface Appearance {
  theme: ThemeName;
  density: Density;
  accent: Accent;
  corners: "rounded" | "sharp";
  font: FontFamilyId;
  fontScale: number;
  sidebar: "expanded" | "collapsed";
  colorVision: ColorVision;
  statusBoost: boolean;
}

const defaultAppearance: Appearance = {
  theme: "light",
  density: "comfortable",
  accent: "blue",
  corners: "rounded",
  font: "inter",
  fontScale: 1,
  sidebar: "expanded",
  colorVision: "standard",
  statusBoost: false,
};


interface Store {
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
  docs: SalesDoc[];
  invoices: Invoice[];
  getDoc: (numberOrId: string) => SalesDoc | undefined;
  getInvoice: (id: string) => Invoice | undefined;
  updateLine: (docId: string, lineId: string, patch: Partial<LineItem>) => void;
  addLine: (docId: string, line: LineItem) => void;
  removeLine: (docId: string, lineId: string) => void;
  patchDoc: (docId: string, patch: Partial<SalesDoc>) => void;
  logHistory: (docId: string, what: string, kind?: "revision" | "convert" | "edit" | "status") => void;
  convertToOrder: (docId: string) => string | undefined;
  advanceLine: (docId: string, lineId: string) => void;
  recordPayment: (invoiceId: string, amount: number, method: string, ref?: string) => void;
  recordRefund: (invoiceId: string, paymentId: string, amount: number, ref?: string) => void;
  issueInvoice: (invoiceId: string) => void;
  grants: Record<string, string[]>;
  toggleGrant: (setId: string, item: string) => void;
  aiOpen: boolean;
  setAiOpen: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  bugOpen: boolean;
  setBugOpen: (v: boolean) => void;
  customers: typeof seedCustomers;
}

const Ctx = createContext<Store | null>(null);

let seq = 10674;

const nowLabel = () =>
  new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(defaultAppearance);
  const [docs, setDocs] = useState<SalesDoc[]>(() => structuredClone(seedDocs));
  const [invoices, setInvoices] = useState<Invoice[]>(() => structuredClone(seedInvoices));
  const [grants, setGrants] = useState<Record<string, string[]>>(() => structuredClone(defaultGranted));
  const [aiOpen, setAiOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem("ph-appearance");
    if (raw) {
      try {
        setAppearanceState({ ...defaultAppearance, ...JSON.parse(raw) });
        return;
      } catch {
        /* ignore */
      }
    }
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setAppearanceState((a) => ({ ...a, theme: "dark" }));
    }
  }, []);


  useEffect(() => {
    const el = document.documentElement;
    el.dataset["theme"] = appearance.theme;
    el.dataset["density"] = appearance.density;
    el.dataset["accent"] = appearance.accent;
    el.dataset["corners"] = appearance.corners;
    el.dataset["font"] = appearance.font;
    el.dataset["cvd"] = appearance.colorVision;
    el.dataset["statusBoost"] = appearance.statusBoost ? "on" : "off";
    el.style.setProperty("--font-scale", String(appearance.fontScale));

    window.localStorage.setItem("ph-appearance", JSON.stringify(appearance));
  }, [appearance]);

  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    setAppearanceState((a) => ({ ...a, ...patch }));
  }, []);

  const getDoc = useCallback(
    (key: string) => docs.find((d) => d.id === key || d.number === key),
    [docs],
  );
  const getInvoice = useCallback(
    (key: string) => invoices.find((i) => i.id === key || i.number === key),
    [invoices],
  );

  const logHistory: Store["logHistory"] = useCallback((docId, what, kind = "edit") => {
    setDocs((ds) =>
      ds.map((d) =>
        d.id === docId
          ? { ...d, history: [...d.history, { at: `Today, ${nowLabel()}`, who: "Dale", what, kind }] }
          : d,
      ),
    );
  }, []);

  const updateLine: Store["updateLine"] = useCallback((docId, lineId, patch) => {
    setDocs((ds) =>
      ds.map((d) =>
        d.id === docId
          ? { ...d, lines: d.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }
          : d,
      ),
    );
  }, []);

  const addLine: Store["addLine"] = useCallback((docId, line) => {
    setDocs((ds) => ds.map((d) => (d.id === docId ? { ...d, lines: [...d.lines, line] } : d)));
  }, []);

  const removeLine: Store["removeLine"] = useCallback((docId, lineId) => {
    setDocs((ds) =>
      ds.map((d) => (d.id === docId ? { ...d, lines: d.lines.filter((l) => l.id !== lineId) } : d)),
    );
  }, []);

  const patchDoc: Store["patchDoc"] = useCallback((docId, patch) => {
    setDocs((ds) => ds.map((d) => (d.id === docId ? { ...d, ...patch } : d)));
  }, []);

  const convertToOrder: Store["convertToOrder"] = useCallback((docId) => {
    let newNumber: string | undefined;
    setDocs((ds) => {
      const quote = ds.find((d) => d.id === docId);
      if (!quote) return ds;
      newNumber = String(seq++);
      const orderId = `d-${newNumber}`;
      const invId = `i-${newNumber}`;
      const order: SalesDoc = {
        ...structuredClone(quote),
        id: orderId,
        number: newNumber,
        documentType: "Order",
        status: "Open",
        invoiceId: invId,
        convertedFrom: quote.number,
        createdAt: "Today",
        history: [
          { at: `Today, ${nowLabel()}`, who: "Dale", what: `Converted from Quote #${quote.number}`, kind: "convert" },
          { at: `Today, ${nowLabel()}`, who: "System", what: `Draft Invoice INV-${newNumber} created automatically`, kind: "status" },
        ],
      };
      setInvoices((inv) => [
        ...inv,
        { id: invId, number: `INV-${newNumber}`, orderId, customerId: quote.customerId, status: "Draft", terms: "Net 30", payments: [], refunds: [] },
      ]);
      return [
        ...ds.map((d) =>
          d.id === docId
            ? {
                ...d,
                status: "Converted" as const,
                convertedTo: newNumber,
                history: [...d.history, { at: `Today, ${nowLabel()}`, who: "Dale", what: `Converted to Order #${newNumber}`, kind: "convert" as const }],
              }
            : d,
        ),
        order,
      ];
    });
    return newNumber;
  }, []);

  const advanceLine: Store["advanceLine"] = useCallback((docId, lineId) => {
    const order: LineItem["routeStep"][] = ["Proofing", "Prepress", "Production", "Finishing", "Fulfillment"];
    setDocs((ds) =>
      ds.map((d) =>
        d.id === docId
          ? {
              ...d,
              lines: d.lines.map((l) => {
                if (l.id !== lineId) return l;
                const idx = order.indexOf(l.routeStep);
                const next = order[Math.min(idx + 1, order.length - 1)] ?? l.routeStep;
                return { ...l, routeStep: next };
              }),
            }
          : d,
      ),
    );
  }, []);

  const recordPayment: Store["recordPayment"] = useCallback((invoiceId, amount, method, ref) => {
    setInvoices((inv) =>
      inv.map((i) =>
        i.id === invoiceId
          ? {
              ...i,
              payments: [
                ...i.payments,
                { id: `pay-${Date.now()}`, date: "Today", method, ref: ref || `REF-${Math.floor(Math.random() * 90000 + 10000)}`, amount, by: "Dale" },
              ],
            }
          : i,
      ),
    );
  }, []);

  const recordRefund: Store["recordRefund"] = useCallback((invoiceId, paymentId, amount, ref) => {
    setInvoices((inv) =>
      inv.map((i) => {
        if (i.id !== invoiceId) return i;
        const src = i.payments.find((p) => p.id === paymentId);
        return {
          ...i,
          refunds: [
            ...i.refunds,
            {
              id: `ref-${Date.now()}`,
              paymentId,
              date: "Today",
              method: src?.method ?? "Card / Electronic",
              ref: ref || `re_${Math.floor(Math.random() * 900000 + 100000)}`,
              amount,
              by: "Dale",
            },
          ],
        };
      }),
    );
  }, []);

  const issueInvoice: Store["issueInvoice"] = useCallback((invoiceId) => {
    setInvoices((inv) =>
      inv.map((i) =>
        i.id === invoiceId
          ? { ...i, status: "Issued", issueDate: "Today", dueDate: "In 30 days" }
          : i,
      ),
    );
  }, []);

  const toggleGrant: Store["toggleGrant"] = useCallback((setId, item) => {
    setGrants((g) => {
      const cur = g[setId] ?? [];
      return { ...g, [setId]: cur.includes(item) ? cur.filter((i) => i !== item) : [...cur, item] };
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<Store>(
    () => ({
      appearance, setAppearance, docs, invoices, getDoc, getInvoice, updateLine, addLine,
      removeLine, patchDoc, logHistory, convertToOrder, advanceLine, recordPayment, recordRefund, issueInvoice,
      grants, toggleGrant, aiOpen, setAiOpen, paletteOpen, setPaletteOpen, bugOpen, setBugOpen,
      customers: seedCustomers,
    }),
    [appearance, setAppearance, docs, invoices, getDoc, getInvoice, updateLine, addLine, removeLine,
      patchDoc, logHistory, convertToOrder, advanceLine, recordPayment, recordRefund, issueInvoice, grants,
      toggleGrant, aiOpen, paletteOpen, bugOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside AppStoreProvider");
  return ctx;
}

export function useCustomer(id: string) {
  return seedCustomers.find((c) => c.id === id);
}
