import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CartLine, ProofStatus } from "./types";

/**
 * Client-side presentation state for the portal prototype: the in-progress
 * order draft plus locally recorded proof / payment outcomes so the journeys
 * can be walked end to end. No business logic lives here.
 */

interface PortalState {
  cart: CartLine[];
  addLine: (line: CartLine) => void;
  removeLine: (id: string) => void;
  clearCart: () => void;
  po: string;
  setPo: (v: string) => void;
  orderNotes: string;
  setOrderNotes: (v: string) => void;
  method: "Ship" | "Pickup";
  setMethod: (v: "Ship" | "Pickup") => void;
  proofOverrides: Record<string, ProofStatus>;
  setProofStatus: (id: string, status: ProofStatus) => void;
  selectedForPayment: string[];
  setSelectedForPayment: (ids: string[]) => void;
  paidInvoices: Record<string, number>;
  recordPayment: (allocations: { invoiceId: string; amount: number }[]) => void;
  lastOrderNumber: string | null;
  setLastOrderNumber: (v: string) => void;
}

const Ctx = createContext<PortalState | null>(null);

export function PortalStoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [po, setPo] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [method, setMethod] = useState<"Ship" | "Pickup">("Ship");
  const [proofOverrides, setProofOverrides] = useState<Record<string, ProofStatus>>({});
  const [selectedForPayment, setSelectedForPayment] = useState<string[]>([]);
  const [paidInvoices, setPaidInvoices] = useState<Record<string, number>>({});
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);

  const addLine = useCallback((line: CartLine) => setCart((c) => [...c, line]), []);
  const removeLine = useCallback((id: string) => setCart((c) => c.filter((l) => l.id !== id)), []);
  const clearCart = useCallback(() => setCart([]), []);
  const setProofStatus = useCallback(
    (id: string, status: ProofStatus) => setProofOverrides((p) => ({ ...p, [id]: status })),
    [],
  );
  const recordPayment = useCallback((allocations: { invoiceId: string; amount: number }[]) => {
    setPaidInvoices((prev) => {
      const next = { ...prev };
      for (const a of allocations) next[a.invoiceId] = (next[a.invoiceId] ?? 0) + a.amount;
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      cart, addLine, removeLine, clearCart,
      po, setPo, orderNotes, setOrderNotes, method, setMethod,
      proofOverrides, setProofStatus,
      selectedForPayment, setSelectedForPayment,
      paidInvoices, recordPayment,
      lastOrderNumber, setLastOrderNumber,
    }),
    [cart, addLine, removeLine, clearCart, po, orderNotes, method, proofOverrides, setProofStatus, selectedForPayment, paidInvoices, recordPayment, lastOrderNumber],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePortalStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePortalStore must be used inside PortalStoreProvider");
  return ctx;
}
