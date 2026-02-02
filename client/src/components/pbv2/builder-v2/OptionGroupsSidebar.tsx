import React from 'react';
import { 
  ChevronRight, 
  Plus, 
  GripVertical, 
  DollarSign, 
  AlertTriangle,
  Settings,
  Layers,
  MoreVertical,
  Trash2,
  Edit
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  onDeleteGroup: (groupId: string) => void;
}

export function OptionGroupsSidebar({
  optionGroups,
  options,
  selectedGroupId,
  onSelectGroup,
  onAddGroup,
  onDeleteGroup
}: OptionGroupsSidebarProps) {
  return (
    <aside className="h-full w-full border-r border-[#334155] bg-[#0f172a] flex flex-col overflow-hidden">
      <div className="border-b border-[#334155] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-slate-200">Option Groups</h2>
          </div>
          <Badge variant="outline" className="text-xs bg-slate-800 text-slate-300 border-slate-600">
            {optionGroups.length}
          </Badge>
        </div>
        <Button
          onClick={onAddGroup}
          className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          Add Group
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {optionGroups.map((group, index) => {
            const groupOptions = group.optionIds.map(id => options[id]).filter(Boolean);
            const hasPricing = groupOptions.some(opt => opt?.hasPricing);
            const hasProductionFlags = groupOptions.some(opt => opt?.hasProductionFlags);
            const hasConditionals = groupOptions.some(opt => opt?.hasConditionals);

            return (
              <div key={group.id}>
                {index > 0 && (
                  <div className="h-px bg-slate-700/50 my-2 mx-3" />
                )}
                <div
                  className={`
                    rounded-md transition-colors relative
                    ${selectedGroupId === group.id
                      ? 'bg-blue-500/10 border border-blue-500/30'
                      : 'hover:bg-slate-800/50 border border-transparent'
                    }
                  `}
                >
                  <button
                    type="button"
                    onClick={() => onSelectGroup(group.id)}
                    className="w-full text-left p-3 pr-8"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <GripVertical className="h-4 w-4 text-slate-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-200 mb-0.5 truncate">
                            {group.name}
                          </div>
                          <div className="text-xs text-slate-400">
                            {groupOptions.length} option{groupOptions.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      <ChevronRight 
                        className={`h-4 w-4 flex-shrink-0 transition-transform ${
                          selectedGroupId === group.id ? 'text-blue-400' : 'text-slate-500'
                        }`}
                      />
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap ml-6">
                      {group.isRequired && (
                        <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">
                          Required
                        </Badge>
                      )}
                      {group.isMultiSelect && (
                        <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
                          Multi
                        </Badge>
                      )}
                      {hasPricing && (
                        <div className="flex items-center gap-0.5 text-xs text-emerald-400">
                          <DollarSign className="h-3 w-3" />
                        </div>
                      )}
                      {hasProductionFlags && (
                        <div className="flex items-center gap-0.5 text-xs text-cyan-400">
                          <Settings className="h-3 w-3" />
                        </div>
                      )}
                      {hasConditionals && (
                        <div className="flex items-center gap-0.5 text-xs text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
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
          })}
        </div>
      </ScrollArea>

      <div className="border-t border-[#334155] p-3 text-xs text-slate-400">
        Advanced editors open as drawers. Dev drawer: Ctrl+Shift+D.
      </div>
    </aside>
  );
}
