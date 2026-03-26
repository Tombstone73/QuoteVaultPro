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

function NumberSequenceRow({ varName, label }: { varName: string; label: string }) {
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
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-b-0">
      {/* Label */}
      <span className="w-40 shrink-0 text-sm text-muted-foreground">{label}</span>

      {/* Value / Input */}
      <div className="flex-1">
        {isLoading ? (
          <Skeleton className="h-5 w-16" />
        ) : isEditing ? (
          <Input
            type="number"
            min="1"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={currentNumber?.toString() ?? "1001"}
            className="h-7 w-28 text-sm"
            autoFocus
          />
        ) : (
          <span className="text-sm font-semibold tabular-nums">{currentNumber ?? "—"}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 shrink-0">
        {isEditing ? (
          <>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setIsEditing(false); setNewValue(""); }}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 px-3 text-xs" onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
            onClick={() => { setIsEditing(true); setNewValue(currentNumber?.toString() ?? "1001"); }}
          >
            Change
          </Button>
        )}
      </div>
    </div>
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

      <TitanCard className="overflow-hidden p-0">
        <div className="px-4 py-2 border-b border-border">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Document Numbering</span>
        </div>
        {SEQUENCES.map(({ varName, label }) => (
          <NumberSequenceRow key={varName} varName={varName} label={label} />
        ))}
      </TitanCard>
    </div>
  );
}
