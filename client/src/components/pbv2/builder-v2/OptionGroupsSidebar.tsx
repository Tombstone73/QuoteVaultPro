import React from 'react';
import {
  ChevronRight,
  Plus,
  GripVertical,
  DollarSign,
  AlertTriangle,
  Settings,
  Layers,
  Library,
  MoreVertical,
  Save,
  Trash2,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { EditorOptionGroup, EditorOption } from '@/lib/pbv2/pbv2ViewModel';

interface OptionGroupsSidebarProps {
  optionGroups: EditorOptionGroup[];
  options: Record<string, EditorOption>;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  onAddGroup: () => void;
  onImportTemplate: () => void;
  onSaveGroupAsTemplate: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onReorderGroup: (fromIndex: number, toIndex: number) => void;
}

interface SortableGroupItemProps {
  group: EditorOptionGroup;
  index: number;
  options: Record<string, EditorOption>;
  isSelected: boolean;
  onSelectGroup: (groupId: string) => void;
  onSaveGroupAsTemplate: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
}

function SortableGroupItem({
  group,
  index,
  options,
  isSelected,
  onSelectGroup,
  onSaveGroupAsTemplate,
  onDeleteGroup,
}: SortableGroupItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : undefined,
  };

  const groupOptions = group.optionIds.map(id => options[id]).filter(Boolean);
  const hasPricing = groupOptions.some(opt => opt?.hasPricing);
  const hasProductionFlags = groupOptions.some(opt => opt?.hasProductionFlags);
  const hasConditionals =
    groupOptions.some(opt => opt?.hasConditionals) ||
    (Array.isArray(group.visibilityRules) && group.visibilityRules.length > 0);

  return (
    <div ref={setNodeRef} style={style}>
      {index > 0 && <div className="h-px bg-slate-700/30 my-2" />}
      <div
        className={`
          rounded-lg transition-all duration-150 relative
          ${isSelected
            ? 'bg-blue-500/10 border border-blue-500/50 shadow-sm'
            : 'hover:bg-slate-800/30 border border-slate-700/50 hover:border-slate-600'
          }
        `}
      >
        <button
          type="button"
          onClick={() => onSelectGroup(group.id)}
          className="w-full text-left p-3 pr-9"
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-start gap-2.5 flex-1 min-w-0">
              {/* GripVertical as drag handle */}
              <span
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing text-slate-500 mt-0.5 flex-shrink-0 touch-none"
                onClick={(e) => e.stopPropagation()}
                title="Drag to reorder"
              >
                <GripVertical className="h-4 w-4 opacity-60" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-100 mb-1 truncate text-sm">
                  {group.name}
                </div>
                <div className="text-xs text-slate-400">
                  {groupOptions.length} option{groupOptions.length !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
            <ChevronRight
              className={`h-4 w-4 flex-shrink-0 transition-all duration-150 ${
                isSelected ? 'text-blue-400 rotate-90' : 'text-slate-500'
              }`}
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap ml-6">
            {group.isRequired && (
              <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/40 px-1.5 py-0 h-5">
                Required
              </Badge>
            )}
            {group.isMultiSelect && (
              <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/40 px-1.5 py-0 h-5">
                Multi
              </Badge>
            )}
            {hasPricing && (
              <div className="flex items-center gap-0.5 text-xs text-emerald-400" title="Has pricing">
                <DollarSign className="h-3.5 w-3.5" />
              </div>
            )}
            {hasProductionFlags && (
              <div className="flex items-center gap-0.5 text-xs text-cyan-400" title="Has production flags">
                <Settings className="h-3.5 w-3.5" />
              </div>
            )}
            {hasConditionals && (
              <div className="flex items-center gap-0.5 text-xs text-amber-400" title="Has conditional logic">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        </button>

        <div className="absolute top-3 right-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center justify-center h-6 w-6 p-0 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onSaveGroupAsTemplate(group.id);
                }}
              >
                <Save className="h-4 w-4 mr-2" />
                Save as template
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-400"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteGroup(group.id);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export function OptionGroupsSidebar({
  optionGroups,
  options,
  selectedGroupId,
  onSelectGroup,
  onAddGroup,
  onImportTemplate,
  onSaveGroupAsTemplate,
  onDeleteGroup,
  onReorderGroup,
}: OptionGroupsSidebarProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = optionGroups.findIndex(g => g.id === active.id);
    const toIndex = optionGroups.findIndex(g => g.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      onReorderGroup(fromIndex, toIndex);
    }
  };

  return (
    <aside className="w-full bg-[#1e293b]">
      <div className="border-b border-[#334155] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-200">Option Groups</h2>
          </div>
          <Badge variant="outline" className="text-xs bg-slate-800/50 text-slate-300 border-slate-600 px-2 py-0.5">
            {optionGroups.length}
          </Badge>
        </div>
        <Button
          type="button"
          onClick={onAddGroup}
          className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          Add Group
        </Button>
        <Button
          type="button"
          onClick={onImportTemplate}
          variant="outline"
          className="w-full gap-2 border-slate-600 bg-slate-900/60 text-slate-100 hover:bg-slate-800"
          size="sm"
        >
          <Library className="h-4 w-4" />
          Import Template
        </Button>
      </div>

      <div className="p-2.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={optionGroups.map(g => g.id)}
              strategy={verticalListSortingStrategy}
            >
              {optionGroups.map((group, index) => (
                <SortableGroupItem
                  key={group.id}
                  group={group}
                  index={index}
                  options={options}
                  isSelected={selectedGroupId === group.id}
                  onSelectGroup={onSelectGroup}
                  onSaveGroupAsTemplate={onSaveGroupAsTemplate}
                  onDeleteGroup={onDeleteGroup}
                />
              ))}
            </SortableContext>
          </DndContext>
      </div>

      <div className="border-t border-[#334155] p-3 text-xs text-slate-400">
        Drag groups to reorder. Dev drawer: Ctrl+Shift+D.
      </div>
    </aside>
  );
}
