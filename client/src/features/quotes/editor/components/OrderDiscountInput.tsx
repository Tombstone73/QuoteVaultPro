import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

export function OrderDiscountInput({ mode, percent, amount, maxAmount, disabled = false, onModeChange, onPercentChange, onAmountChange }: {
    mode: "amount" | "percent";
    percent: number;
    amount: number;
    maxAmount: number;
    disabled?: boolean;
    onModeChange: (next: "amount" | "percent") => void;
    onPercentChange: (next: number) => void;
    onAmountChange: (next: number) => void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    useEffect(() => setDraft(null), [mode]);
    const displayedValue = mode === "percent" ? (percent === 0 ? "" : String(percent)) : (amount === 0 ? "" : String(amount));
    return <div className="flex items-center gap-2">
        <select
            aria-label="Discount mode"
            value={mode}
            disabled={disabled}
            onChange={(event) => onModeChange(event.target.value as "amount" | "percent")}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
            <option value="amount">$</option>
            <option value="percent">%</option>
        </select>
        <Input
            aria-label="Order discount"
            type="text"
            disabled={disabled}
            value={draft ?? displayedValue}
            onChange={(event) => {
                const raw = event.target.value;
                if (!/^\d*(?:\.\d*)?$/.test(raw)) return;
                const value = raw === "" || raw === "." ? 0 : Number(raw);
                const bounded = Math.min(value, mode === "percent" ? 100 : Math.max(0, maxAmount));
                setDraft(value > bounded ? String(bounded) : raw);
                if (mode === "percent") onPercentChange(bounded);
                else onAmountChange(bounded);
            }}
            onBlur={() => setDraft(null)}
            placeholder={mode === "percent" ? "0%" : "0.00"}
            className="h-8 w-28 text-right font-mono" inputMode="decimal"
        />
    </div>;
}
