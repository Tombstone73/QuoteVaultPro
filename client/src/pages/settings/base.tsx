import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings, Hash } from "lucide-react";
import type { GlobalVariable } from "@shared/schema";

export default function BaseSettings() {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [newStartNumber, setNewStartNumber] = useState<string>("");

  // Fetch all global variables (includes quote number)
  const { data: globalVariables, isLoading } = useQuery<GlobalVariable[]>({
    queryKey: ["/api/global-variables"],
  });

  // Update quote number mutation - patch by ID
  const updateQuoteNumberMutation = useMutation({
    mutationFn: async (newNumber: number) => {
      const quoteNumberVar = globalVariables?.find(v => v.name === 'next_quote_number');
      if (!quoteNumberVar) {
        throw new Error('Quote numbering system not initialized');
      }
      return apiRequest("PATCH", `/api/global-variables/${quoteNumberVar.id}`, {
        value: newNumber
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setIsEditing(false);
      setNewStartNumber("");
      toast({
        title: "Quote numbering updated",
        description: "The next quote number has been updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update quote numbering",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const quoteNumberVar = globalVariables?.find(v => v.name === 'next_quote_number');
  const currentNextNumber = quoteNumberVar ? Math.floor(Number(quoteNumberVar.value)) : null;

  const handleSave = () => {
    const num = parseInt(newStartNumber, 10);
    if (isNaN(num) || num < 1) {
      toast({
        title: "Invalid number",
        description: "Please enter a valid positive number",
        variant: "destructive",
      });
      return;
    }
    updateQuoteNumberMutation.mutate(num);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Base Settings
          </CardTitle>
          <CardDescription>
            Core system configuration and numbering sequences
          </CardDescription>
        </CardHeader>
      </Card>

      {isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle>Quote Numbering System</CardTitle>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="card-quote-number-settings">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hash className="w-5 h-5" />
              Quote Numbering System
            </CardTitle>
            <CardDescription>
              Configure the starting number for new quotes. Current quotes will keep their existing numbers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label htmlFor="next-quote-number" data-testid="label-next-quote-number">
                  Next Quote Number
                </Label>
                {isEditing ? (
                  <Input
                    id="next-quote-number"
                    type="number"
                    min="1"
                    value={newStartNumber}
                    onChange={(e) => setNewStartNumber(e.target.value)}
                    placeholder={currentNextNumber?.toString() || "1001"}
                    data-testid="input-next-quote-number"
                    className="mt-2"
                  />
                ) : (
                  <div className="text-2xl font-bold mt-2" data-testid="text-current-quote-number">
                    {currentNextNumber || "Not set"}
                  </div>
                )}
                <p className="text-sm text-muted-foreground mt-2">
                  The next quote created will be assigned number {currentNextNumber || "N/A"}
                </p>
              </div>
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsEditing(false);
                        setNewStartNumber("");
                      }}
                      data-testid="button-cancel-quote-number"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={updateQuoteNumberMutation.isPending}
                      data-testid="button-save-quote-number"
                    >
                      {updateQuoteNumberMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsEditing(true);
                      setNewStartNumber(currentNextNumber?.toString() || "1001");
                    }}
                    data-testid="button-edit-quote-number"
                  >
                    Change Starting Number
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
