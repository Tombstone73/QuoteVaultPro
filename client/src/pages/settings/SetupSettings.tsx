import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TitanCard } from "@/components/titan";
import type { GlobalVariable } from "@shared/schema";

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
      if (!varEntry) throw new Error(`${label} numbering not initialized`);
      return apiRequest("PATCH", `/api/global-variables/${varEntry.id}`, { value: num });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setIsEditing(false);
      setNewValue("");
      toast({ title: `${label} numbering updated` });
    },
    onError: (error: Error) => {
      toast({ title: `Failed to update ${label.toLowerCase()} numbering`, description: error.message, variant: "destructive" });
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

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label} Numbering</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {isLoading ? (
          <Skeleton className="h-8 w-20" />
        ) : isEditing ? (
          <>
            <Input
              id={`next-${varName}`}
              type="number"
              min="1"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={currentNumber?.toString() ?? "1001"}
              className="h-8 text-sm w-full"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => { setIsEditing(false); setNewValue(""); }}>
                Cancel
              </Button>
              <Button size="sm" className="flex-1" onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-3xl font-bold text-titan-text-primary tabular-nums">
              {currentNumber ?? "—"}
            </span>
            <Button size="sm" variant="outline" onClick={() => { setIsEditing(true); setNewValue(currentNumber?.toString() ?? "1001"); }}>
              Change
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function SetupSettings() {
  return (
    <div className="space-y-4">
      <TitanCard className="p-4">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">System Setup</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Foundational settings configured at launch. Changes affect future records only —
            existing documents are never renumbered.
          </p>
        </div>
      </TitanCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <NumberSequenceCard varName="next_quote_number" label="Quote" />
        <NumberSequenceCard varName="next_order_number" label="Order" />
        <NumberSequenceCard varName="next_invoice_number" label="Invoice" />
      </div>
    </div>
  );
}
