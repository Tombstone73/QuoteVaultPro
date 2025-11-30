import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Settings2, RotateCcw } from "lucide-react";
import { Label } from "@/components/ui/label";

export interface ColumnDefinition {
  key: string;
  label: string;
  defaultVisible?: boolean;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  sortable?: boolean;
  align?: "left" | "center" | "right";
}

export interface ColumnState {
  visible: boolean;
  width: number;
}

export interface ColumnSettings {
  [key: string]: ColumnState;
}

interface ColumnConfigProps {
  columns: ColumnDefinition[];
  storageKey: string;
  settings: ColumnSettings;
  onSettingsChange: (settings: ColumnSettings) => void;
}

export function useColumnSettings(
  columns: ColumnDefinition[],
  storageKey: string
): [ColumnSettings, React.Dispatch<React.SetStateAction<ColumnSettings>>] {
  const getDefaultSettings = (): ColumnSettings => {
    const defaults: ColumnSettings = {};
    columns.forEach((col) => {
      defaults[col.key] = {
        visible: col.defaultVisible !== false,
        width: col.defaultWidth || 150,
      };
    });
    return defaults;
  };

  const [settings, setSettings] = useState<ColumnSettings>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to handle new columns
        const defaults = getDefaultSettings();
        return { ...defaults, ...parsed };
      }
    } catch (e) {
      console.error("Failed to load column settings:", e);
    }
    return getDefaultSettings();
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch (e) {
      console.error("Failed to save column settings:", e);
    }
  }, [settings, storageKey]);

  return [settings, setSettings];
}

export function ColumnConfig({
  columns,
  storageKey,
  settings,
  onSettingsChange,
}: ColumnConfigProps) {
  const [open, setOpen] = useState(false);

  const handleVisibilityChange = (key: string, visible: boolean) => {
    onSettingsChange({
      ...settings,
      [key]: { ...settings[key], visible },
    });
  };

  const handleWidthChange = (key: string, width: number) => {
    onSettingsChange({
      ...settings,
      [key]: { ...settings[key], width },
    });
  };

  const handleReset = () => {
    const defaults: ColumnSettings = {};
    columns.forEach((col) => {
      defaults[col.key] = {
        visible: col.defaultVisible !== false,
        width: col.defaultWidth || 150,
      };
    });
    onSettingsChange(defaults);
  };

  const visibleCount = Object.values(settings).filter((s) => s.visible).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Configure columns"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-sm">Column Settings</h4>
              <p className="text-xs text-muted-foreground">
                {visibleCount} of {columns.length} columns visible
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-8 px-2"
              title="Reset to defaults"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          </div>

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {columns.map((col) => {
              const colSettings = settings[col.key] || {
                visible: true,
                width: col.defaultWidth || 150,
              };
              return (
                <div
                  key={col.key}
                  className="space-y-2 pb-3 border-b border-border/50 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`col-${col.key}`}
                      checked={colSettings.visible}
                      onCheckedChange={(checked) =>
                        handleVisibilityChange(col.key, checked === true)
                      }
                    />
                    <Label
                      htmlFor={`col-${col.key}`}
                      className="text-sm font-medium cursor-pointer flex-1"
                    >
                      {col.label}
                    </Label>
                  </div>
                  {colSettings.visible && (
                    <div className="pl-6 space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Width</span>
                        <span>{colSettings.width}px</span>
                      </div>
                      <Slider
                        value={[colSettings.width]}
                        onValueChange={([value]) =>
                          handleWidthChange(col.key, value)
                        }
                        min={col.minWidth || 60}
                        max={col.maxWidth || 300}
                        step={10}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function getColumnStyle(
  settings: ColumnSettings,
  key: string,
  defaultWidth: number = 150
): React.CSSProperties {
  const colSettings = settings[key];
  if (!colSettings?.visible) return { display: "none" };
  return {
    width: colSettings.width || defaultWidth,
    minWidth: colSettings.width || defaultWidth,
    maxWidth: colSettings.width || defaultWidth,
  };
}

export function isColumnVisible(settings: ColumnSettings, key: string): boolean {
  return settings[key]?.visible !== false;
}
