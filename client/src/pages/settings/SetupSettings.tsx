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
    <TitanCard className="flex items-center gap-2 px-3 py-0 h-10">
      {/* Label */}
      <span className="text-xs text-muted-foreground whitespace-nowrap w-28 shrink-0">{label}</span>

      {/* Value / Input */}
      {isLoading ? (
        <Skeleton className="h-4 w-10 shrink-0" />
      ) : isEditing ? (
        <Input
          type="number"
          min="1"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentNumber?.toString() ?? "1001"}
          className="h-6 w-20 text-xs px-2 shrink-0"
          autoFocus
        />
      ) : (
        <span className="text-xs font-semibold tabular-nums shrink-0">{currentNumber ?? "—"}</span>
      )}

      {/* Actions */}
      <div className="flex gap-1 ml-auto shrink-0">
        {isEditing ? (
          <>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setIsEditing(false); setNewValue(""); }}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 px-2 text-xs" onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => { setIsEditing(true); setNewValue(currentNumber?.toString() ?? "1001"); }}
          >
            Change
          </Button>
        )}
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

      <div className="grid grid-cols-3 gap-2 max-w-xl">
        {SEQUENCES.map(({ varName, label }) => (
          <NumberSequenceCard key={varName} varName={varName} label={label} />
        ))}
      </div>
    </div>
  );
}
