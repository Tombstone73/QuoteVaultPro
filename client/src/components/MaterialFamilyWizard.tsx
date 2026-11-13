import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MaterialFamily } from "@/hooks/useMaterials";
import { materialDimensionKey } from "@/lib/materialFamilyControls";

export function MaterialFamilyWizard({ onCreated, onCancel }: { onCreated: (family: MaterialFamily) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [familyName, setFamilyName] = useState("");
  const [dimensions, setDimensions] = useState("Color");
  const [creatingFamily, setCreatingFamily] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createFamily(event: FormEvent) {
    event.preventDefault();
    const configured = dimensions.split(",").map((name) => name.trim()).filter(Boolean)
      .map((displayName) => ({ key: materialDimensionKey(displayName), displayName }));
    if (!configured.length || new Set(configured.map(({ key }) => key)).size !== configured.length || configured.some(({ key }) => !/^[a-z][a-z0-9_]{0,63}$/.test(key))) {
      setError("Enter distinct dimension names that begin with a letter, such as Color or Pack Size.");
      return;
    }
    setError(null);
    setCreatingFamily(true);
    try {
      const response = await fetch("/api/material-families", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: familyName.trim(), dimensions: configured }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create the family. Try again.");
      queryClient.setQueryData(["/api/material-families", result.data.id], result.data);
      void queryClient.invalidateQueries({ queryKey: ["/api/material-families"], exact: true });
      onCreated(result.data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the family. Try again.");
    } finally {
      setCreatingFamily(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !creatingFamily) onCancel(); }}>
    <DialogContent className="w-[calc(100vw-2rem)]">
      <DialogHeader>
        <DialogTitle>New Material Family</DialogTitle>
        <DialogDescription>Set the family name and the dimensions that distinguish its variants.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={createFamily}>
        <label className="block space-y-1 text-sm"><span>Family name</span><Input required maxLength={255} value={familyName} onChange={(event) => setFamilyName(event.target.value)} /></label>
        <label className="block space-y-1 text-sm"><span>Variant dimensions (comma separated)</span><Input required value={dimensions} onChange={(event) => setDimensions(event.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={creatingFamily} onClick={onCancel}>Cancel</Button>
          <Button disabled={creatingFamily || !familyName.trim() || !dimensions.trim()}>Create Family</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
