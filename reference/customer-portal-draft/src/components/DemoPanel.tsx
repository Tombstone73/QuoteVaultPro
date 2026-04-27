import { useState } from "react";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import { isDemoPanelVisible } from "@/lib/runtime-config";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Settings2, X } from "lucide-react";

export function DemoPanel() {
  const { dataMode, setDataMode, isMockMode } = useRuntimeConfig();
  const [open, setOpen] = useState(false);

  if (!isDemoPanelVisible()) return null;

  if (!open) {
    return (
      <Button
        size="icon"
        variant="outline"
        className="fixed bottom-4 right-4 z-50 h-9 w-9 rounded-full shadow-lg border-border bg-background"
        onClick={() => setOpen(true)}
        title="Runtime settings"
      >
        <Settings2 className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-64 rounded-lg border border-border bg-background p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Runtime Settings</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpen(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="data-mode-toggle" className="text-xs text-muted-foreground">
          {isMockMode ? "Mock Demo Data" : "Live API"}
        </Label>
        <Switch
          id="data-mode-toggle"
          checked={isMockMode}
          onCheckedChange={(checked) => setDataMode(checked ? "mock_demo" : "live_api")}
        />
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground/70">
        {dataMode === "mock_demo"
          ? "Using sample data. Mutations are simulated."
          : "Connected to live backend API."}
      </p>
    </div>
  );
}
