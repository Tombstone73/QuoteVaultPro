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
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  // Stored settings include per-column state plus a special `_columnOrder` list.
  // Keep runtime shape identical, but widen the index signature so `_columnOrder` doesn't violate it.
  [key: string]: ColumnState | string[] | undefined;
  _columnOrder?: string[]; // Special key to store column order
}

interface ColumnConfigProps {
  columns: ColumnDefinition[];
  storageKey: string;
  settings: ColumnSettings;
  onSettingsChange: (settings: ColumnSettings) => void;
  footerActions?: React.ReactNode;
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
          const missingKeys = allKeys.filter((key: string) => !savedOrder.includes(key));
          merged._columnOrder = [...savedOrder.filter((key: string) => allKeys.includes(key)), ...missingKeys];
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

// Sortable column item component
interface SortableColumnItemProps {
  col: ColumnDefinition;
  colSettings: ColumnState;
  onVisibilityChange: (key: string, visible: boolean) => void;
  onWidthChange: (key: string, width: number) => void;
  isActionsColumn: boolean;
}

function SortableColumnItem({
  col,
  colSettings,
  onVisibilityChange,
  onWidthChange,
  isActionsColumn,
}: SortableColumnItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: col.key, disabled: isActionsColumn });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "space-y-2 p-2 rounded-md border transition-all",
        isDragging && "opacity-50 border-titan-accent z-50",
        !isDragging && "border-transparent hover:border-border/50 hover:bg-muted/30",
        isActionsColumn && "opacity-60 cursor-not-allowed"
      )}
    >
      <div className="flex items-center gap-2">
        <div
          {...attributes}
          {...listeners}
          className={cn(
            "shrink-0",
            isActionsColumn ? "cursor-not-allowed" : "cursor-move"
          )}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <Checkbox
          id={`col-${col.key}`}
          checked={colSettings.visible}
          disabled={isActionsColumn}
          onCheckedChange={(checked) =>
            onVisibilityChange(col.key, checked === true)
          }
          onClick={(e) => e.stopPropagation()}
        />
        <Label
          htmlFor={`col-${col.key}`}
          className={cn(
            "text-sm font-medium flex-1",
            !isActionsColumn && "cursor-pointer"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {col.label}
          {isActionsColumn && (
            <span className="ml-2 text-xs text-muted-foreground">(always visible)</span>
          )}
        </Label>
      </div>
      {colSettings.visible && !isActionsColumn && (
        <div className="pl-9 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Width</span>
            <span>{colSettings.width}px</span>
          </div>
          <Slider
            value={[colSettings.width]}
            onValueChange={([value]) => onWidthChange(col.key, value)}
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
}

export function ColumnConfig({
  columns,
  storageKey,
  settings,
  onSettingsChange,
  footerActions,
}: ColumnConfigProps) {
  const [open, setOpen] = useState(false);

  // Setup @dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts (prevents accidental drags)
      },
    })
  );

  // Get ordered columns based on settings
  const orderedColumns = React.useMemo(() => {
    const order = settings._columnOrder || columns.map(col => col.key);
    return order
      .map(key => columns.find(col => col.key === key))
      .filter(Boolean) as ColumnDefinition[];
  }, [columns, settings._columnOrder]);

  const getColumnState = (key: string, fallback?: ColumnDefinition): ColumnState => {
    const raw = settings[key];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as ColumnState;
    }
    return {
      visible: fallback?.defaultVisible !== false,
      width: fallback?.defaultWidth || 150,
    };
  };

  const handleVisibilityChange = (key: string, visible: boolean) => {
    onSettingsChange({
      ...settings,
      [key]: { ...getColumnState(key, columns.find(c => c.key === key)), visible },
    });
  };

  const handleWidthChange = (key: string, width: number) => {
    onSettingsChange({
      ...settings,
      [key]: { ...getColumnState(key, columns.find(c => c.key === key)), width },
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    // Don't allow reordering if dragging or dropping on Actions column
    if (active.id === 'actions' || over.id === 'actions') {
      return;
    }

    const oldIndex = orderedColumns.findIndex(col => col.key === active.id);
    const newIndex = orderedColumns.findIndex(col => col.key === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const newOrder = arrayMove(orderedColumns, oldIndex, newIndex);

    // Ensure Actions column stays last
    const actionsIndex = newOrder.findIndex(col => col.key === 'actions');
    if (actionsIndex !== -1 && actionsIndex !== newOrder.length - 1) {
      const [actionsCol] = newOrder.splice(actionsIndex, 1);
      newOrder.push(actionsCol);
    }

    onSettingsChange({
      ...settings,
      _columnOrder: newOrder.map(col => col.key),
    } as ColumnSettings);
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
            Drag to reorder columns (Actions column always stays last)
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedColumns.map(col => col.key)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1 max-h-[400px] overflow-y-auto pr-2">
                {orderedColumns.map((col) => {
                  const colSettings = getColumnState(col.key, col);
                  const isActionsColumn = col.key === 'actions';
                  
                  return (
                    <SortableColumnItem
                      key={col.key}
                      col={col}
                      colSettings={colSettings}
                      onVisibilityChange={handleVisibilityChange}
                      onWidthChange={handleWidthChange}
                      isActionsColumn={isActionsColumn}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          {footerActions ? (
            <div className="pt-2 border-t border-border/40">
              {footerActions}
            </div>
          ) : null}
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
  const raw = settings[key];
  const colSettings =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ColumnState) : undefined;
  if (!colSettings?.visible) return { display: "none" };
  return {
    width: colSettings.width || defaultWidth,
    minWidth: colSettings.width || defaultWidth,
    maxWidth: colSettings.width || defaultWidth,
  };
}

export function isColumnVisible(settings: ColumnSettings, key: string): boolean {
  const raw = settings[key];
  const colSettings =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ColumnState) : undefined;
  return colSettings?.visible !== false;
}

export function getColumnOrder(
  columns: ColumnDefinition[],
  settings: ColumnSettings
): ColumnDefinition[] {
  const order = settings._columnOrder || columns.map(col => col.key);
  const orderedCols = order
    .map(key => columns.find(col => col.key === key))
    .filter(Boolean) as ColumnDefinition[];
  
  // Enforce: Actions column always last
  const actionsIndex = orderedCols.findIndex(col => col.key === 'actions');
  if (actionsIndex !== -1 && actionsIndex !== orderedCols.length - 1) {
    const [actionsCol] = orderedCols.splice(actionsIndex, 1);
    orderedCols.push(actionsCol);
  }
  
  return orderedCols;
}
