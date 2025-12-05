import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Settings2, RotateCcw, GripVertical } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
  _columnOrder?: string[]; // Special key to store column order
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
    // Initialize default column order
    defaults._columnOrder = columns.map(col => col.key);
    return defaults;
  };

  const [settings, setSettings] = useState<ColumnSettings>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to handle new columns
        const defaults = getDefaultSettings();
        const merged = { ...defaults, ...parsed };
        // Ensure _columnOrder exists and includes all columns
        if (!merged._columnOrder || !Array.isArray(merged._columnOrder)) {
          merged._columnOrder = defaults._columnOrder;
        } else {
          // Add any new columns not in the saved order
          const savedOrder = merged._columnOrder;
          const allKeys = columns.map(col => col.key);
          const missingKeys = allKeys.filter(key => !savedOrder.includes(key));
          merged._columnOrder = [...savedOrder.filter(key => allKeys.includes(key)), ...missingKeys];
        }
        return merged;
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Get ordered columns based on settings
  const orderedColumns = React.useMemo(() => {
    const order = settings._columnOrder || columns.map(col => col.key);
    return order
      .map(key => columns.find(col => col.key === key))
      .filter(Boolean) as ColumnDefinition[];
  }, [columns, settings._columnOrder]);

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
    defaults._columnOrder = columns.map(col => col.key);
    onSettingsChange(defaults);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newOrder = [...orderedColumns];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, draggedItem);

    onSettingsChange({
      ...settings,
      _columnOrder: newOrder.map(col => col.key),
    });

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const visibleCount = Object.values(settings).filter((s) => s && typeof s === 'object' && 'visible' in s && s.visible).length;

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

          <div className="text-xs text-muted-foreground px-1">
            Drag to reorder columns
          </div>

          <div className="space-y-1 max-h-[400px] overflow-y-auto pr-2">
            {orderedColumns.map((col, index) => {
              const colSettings = settings[col.key] || {
                visible: true,
                width: col.defaultWidth || 150,
              };
              const isDragging = draggedIndex === index;
              const isDragOver = dragOverIndex === index && draggedIndex !== index;
              
              return (
                <div
                  key={col.key}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "space-y-2 p-2 rounded-md border transition-all cursor-move",
                    isDragging && "opacity-50 border-titan-accent",
                    isDragOver && "border-titan-accent bg-titan-accent/10",
                    !isDragging && !isDragOver && "border-transparent hover:border-border/50 hover:bg-muted/30"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Checkbox
                      id={`col-${col.key}`}
                      checked={colSettings.visible}
                      onCheckedChange={(checked) =>
                        handleVisibilityChange(col.key, checked === true)
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Label
                      htmlFor={`col-${col.key}`}
                      className="text-sm font-medium cursor-pointer flex-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {col.label}
                    </Label>
                  </div>
                  {colSettings.visible && (
                    <div className="pl-9 space-y-1">
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
                        onClick={(e) => e.stopPropagation()}
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

export function getColumnOrder(
  columns: ColumnDefinition[],
  settings: ColumnSettings
): ColumnDefinition[] {
  const order = settings._columnOrder || columns.map(col => col.key);
  return order
    .map(key => columns.find(col => col.key === key))
    .filter(Boolean) as ColumnDefinition[];
}
