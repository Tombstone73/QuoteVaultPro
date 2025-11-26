import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GripVertical } from "lucide-react";

interface Column {
  id: string;
  label: string;
  enabled: boolean;
}

interface ColumnConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  onSave: (columns: Column[]) => void;
  title?: string;
}

export default function ColumnConfigModal({ 
  open, 
  onOpenChange, 
  columns, 
  onSave,
  title = "Configure Columns"
}: ColumnConfigModalProps) {
  const [localColumns, setLocalColumns] = useState<Column[]>(columns);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleToggle = (id: string) => {
    setLocalColumns(prev => 
      prev.map(col => col.id === id ? { ...col, enabled: !col.enabled } : col)
    );
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newColumns = [...localColumns];
    const draggedItem = newColumns[draggedIndex];
    newColumns.splice(draggedIndex, 1);
    newColumns.splice(index, 0, draggedItem);

    setLocalColumns(newColumns);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleSave = () => {
    onSave(localColumns);
    onOpenChange(false);
  };

  const handleReset = () => {
    setLocalColumns(columns);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Toggle columns on/off and drag to reorder. Changes are saved automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 max-h-[400px] overflow-y-auto">
          <div className="space-y-2">
            {localColumns.map((column, index) => (
              <div
                key={column.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 p-3 border rounded-lg cursor-move hover:bg-accent transition-colors ${
                  draggedIndex === index ? 'opacity-50' : ''
                }`}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <Checkbox
                  id={column.id}
                  checked={column.enabled}
                  onCheckedChange={() => handleToggle(column.id)}
                />
                <label
                  htmlFor={column.id}
                  className="text-sm flex-1 cursor-pointer select-none"
                >
                  {column.label}
                </label>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleReset}>
            Reset
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
