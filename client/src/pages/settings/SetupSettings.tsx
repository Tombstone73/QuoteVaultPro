import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TitanCard } from "@/components/titan";
import type { GlobalVariable } from "@shared/schema";

const SEQUENCES = [
  { varName: "next_quote_number",   label: "Quote Number"   },
  { varName: "next_order_number",   label: "Order Number"   },
  { varName: "next_invoice_number", label: "Invoice Number" },
] as const;

function NumberSequenceCard({ varName, label }: { varName: string; label: string }) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [newValue, setNewValue] = useState("");

  const { data: globalVariables, isLoading } = useQuery<GlobalVariable[]>({
    queryKey: ["/api/global-variables"],
  });

  const varEntry = globalVariables?.find((v) => v.name === varName);
  const currentNumber = varEntry ? Math.floor(Number(varEntry.value)) : null;

  const updateMutation = useMutation({
    mutationFn: async (num: number) => {
      if (!varEntry) throw new Error(`${label} not initialized`);
      return apiRequest("PATCH", `/api/global-variables/${varEntry.id}`, { value: num });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setIsEditing(false);
      setNewValue("");
      toast({ title: `${label} updated` });
    },
    onError: (error: Error) => {
      toast({ title: `Failed to update ${label.toLowerCase()}`, description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const num = parseInt(newValue);
    if (isNaN(num) || num < 1) {
      toast({ title: "Invalid number", description: "Please enter a valid positive number.", variant: "destructive" });
      return;
    }
    updateMutation.mutate(num);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") { setIsEditing(false); setNewValue(""); }
  };

  return (
    // noPadding: we own all padding inside the grid so nothing fights us
    <TitanCard noPadding>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 56px 84px",
          alignItems: "center",
          height: "56px",
          padding: "0 12px",
          gap: "8px",
        }}
      >
        {/* Col 1: Label — truncates, never pushes */}
        <span
          style={{
            fontSize: "12px",
            color: "var(--muted-foreground, #888)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>

        {/* Col 2: Value — fixed 56px, centered */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isLoading ? (
            <Skeleton className="h-4 w-10" />
          ) : isEditing ? (
            <Input
              type="number"
              min="1"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={currentNumber?.toString() ?? "1001"}
              className="h-7 text-xs text-center px-1"
              style={{ width: "104px" }}
              autoFocus
            />
          ) : (
            <span style={{ fontSize: "13px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {currentNumber ?? "—"}
            </span>
          )}
        </div>

        {/* Col 3: Action — fixed 84px, right-aligned */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
          {isEditing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                style={{ padding: "0 6px", minWidth: 0 }}
                onClick={() => { setIsEditing(false); setNewValue(""); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                style={{ padding: "0 8px", minWidth: 0 }}
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "…" : "Save"}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              style={{ width: "80px" }}
              onClick={() => { setIsEditing(true); setNewValue(currentNumber?.toString() ?? "1001"); }}
            >
              Change
            </Button>
          )}
        </div>
      </div>
    </TitanCard>
  );
}

export default function SetupSettings() {
  return (
    <div className="space-y-4">
      <TitanCard className="p-4">
        <h2 className="text-titan-lg font-semibold text-titan-text-primary">System Setup</h2>
        <p className="text-titan-sm text-titan-text-secondary mt-1">
          Foundational settings configured at launch. Changes affect future records only —
          existing documents are never renumbered.
        </p>
      </TitanCard>

      <div className="grid grid-cols-4 gap-3">
        {/* Label card */}
        <TitanCard noPadding>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: "56px",
              padding: "0 12px",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--muted-foreground, #888)", lineHeight: "1.4" }}>
              Quote/Order/Invoice starting numbers
            </span>
          </div>
        </TitanCard>

        {SEQUENCES.map(({ varName, label }) => (
          <NumberSequenceCard key={varName} varName={varName} label={label} />
        ))}
      </div>
    </div>
  );
}
