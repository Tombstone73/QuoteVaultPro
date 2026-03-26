import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TitanCard } from "@/components/titan";
import type { GlobalVariable } from "@shared/schema";

function NumberSequenceCard({
  varName,
  label,
  description,
}: {
  varName: string;
  label: string;
  description: string;
}) {
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
      toast({
        title: `${label} numbering updated`,
        description: `The next ${label.toLowerCase()} will be assigned the new number.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: `Failed to update ${label.toLowerCase()} numbering`,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const num = parseInt(newValue);
    if (isNaN(num) || num < 1) {
      toast({
        title: "Invalid number",
        description: "Please enter a valid positive number.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate(num);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{label} Numbering</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label} Numbering</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor={`next-${varName}`}>Next {label} Number</Label>
            {isEditing ? (
              <Input
                id={`next-${varName}`}
                type="number"
                min="1"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={currentNumber?.toString() ?? "1001"}
                className="mt-2"
              />
            ) : (
              <div className="text-2xl font-bold mt-2">{currentNumber ?? "Not set"}</div>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              The next {label.toLowerCase()} created will be assigned this number.
              Existing records are not affected.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => { setIsEditing(false); setNewValue(""); }}
                >
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => { setIsEditing(true); setNewValue(currentNumber?.toString() ?? "1001"); }}
              >
                Change
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SetupSettings() {
  return (
    <div className="space-y-6">
      <TitanCard className="p-6">
        <div className="space-y-2">
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">System Setup</h2>
          <p className="text-titan-sm text-titan-text-secondary">
            These settings are typically configured at system launch and rarely changed afterward.
            Changes here affect future records only — existing quotes, orders, and invoices are
            never renumbered.
          </p>
        </div>
      </TitanCard>

      <NumberSequenceCard
        varName="next_quote_number"
        label="Quote"
        description="Configure the starting number for new quotes. Existing quotes keep their current numbers."
      />

      <NumberSequenceCard
        varName="next_order_number"
        label="Order"
        description="Configure the starting number for new orders. Existing orders keep their current numbers."
      />

      <NumberSequenceCard
        varName="next_invoice_number"
        label="Invoice"
        description="Configure the starting number for new invoices. Existing invoices keep their current numbers."
      />
    </div>
  );
}
