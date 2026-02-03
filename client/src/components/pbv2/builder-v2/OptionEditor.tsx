import React from 'react';
import { Plus, Settings, GripVertical, Trash2, ChevronDown, ChevronRight, GitBranch, ChevronUp, AlertCircle, Copy, MoveVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EditorOptionGroup, EditorOption } from '@/lib/pbv2/pbv2ViewModel';
import { OptionDetailsEditor } from './OptionDetailsEditor';

interface OptionEditorProps {
  selectedGroup: EditorOptionGroup | undefined;
  options: Record<string, EditorOption>;
  allGroups: EditorOptionGroup[];
  selectedOptionId: string | null;
  onSelectOption: (optionId: string | null) => void;
  onAddOption: (groupId: string) => void;
  onDuplicateOption: (groupId: string, optionId: string) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
  onReorderOption: (groupId: string, fromIndex: number, toIndex: number) => void;
  onMoveOption: (fromGroupId: string, toGroupId: string, optionId: string) => void;
  onUpdateGroup: (groupId: string, updates: Partial<EditorOptionGroup>) => void;
  onUpdateOption: (optionId: string, updates: any) => void;
  onAddChoice: (optionId: string) => void;
  onUpdateChoice: (optionId: string, choiceValue: string, updates: any) => void;
  onDeleteChoice: (optionId: string, choiceValue: string) => void;
  onReorderChoice: (optionId: string, fromIndex: number, toIndex: number) => void;
  treeJson: any;
}

export function OptionEditor({
  selectedGroup,
  options,
  allGroups,
  selectedOptionId,
  onSelectOption,
  onAddOption,
  onDuplicateOption,
  onDeleteOption,
  onReorderOption,
  onMoveOption,
  onUpdateGroup,
  onUpdateOption,
  onAddChoice,
  onUpdateChoice,
  onDeleteChoice,
  onReorderChoice,
  treeJson
}: OptionEditorProps) {
  const [expandedOptions, setExpandedOptions] = React.useState<Set<string>>(new Set());
  const [editingChoiceValue, setEditingChoiceValue] = React.useState<{ optionId: string; value: string } | null>(null);
  const [moveDropdownOpen, setMoveDropdownOpen] = React.useState<string | null>(null);

  // Close move dropdown on click outside
  React.useEffect(() => {
    if (!moveDropdownOpen) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-move-dropdown]')) {
        setMoveDropdownOpen(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moveDropdownOpen]);

  const toggleOption = (optionId: string) => {
    const newExpanded = new Set(expandedOptions);
    if (newExpanded.has(optionId)) {
      newExpanded.delete(optionId);
      onSelectOption(null);
    } else {
      newExpanded.add(optionId);
      onSelectOption(optionId);
    }
    setExpandedOptions(newExpanded);
  };

  if (!selectedGroup) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 bg-[#0a0e1a]">
        <div className="text-center">
          <Settings className="h-12 w-12 mx-auto mb-3 text-slate-600" />
          <p>Select an option group to begin editing</p>
        </div>
      </div>
    );
  }

  const groupOptions = selectedGroup.optionIds.map(id => options[id]).filter(Boolean);

  return (
    <div className="h-full w-full flex flex-col bg-[#0a0e1a] overflow-hidden">
      <div className="border-b border-[#334155] bg-[#1e293b] p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <Input
              value={selectedGroup.name}
              onChange={(e) => onUpdateGroup(selectedGroup.id, { name: e.target.value })}
              onBlur={(e) => {
                // Apply fallback only if field is empty/whitespace when user leaves
                const trimmed = e.target.value.trim();
                if (!trimmed) {
                  onUpdateGroup(selectedGroup.id, { name: 'Options' });
                }
              }}
              placeholder="Group name..."
              className="text-lg font-semibold mb-2 border-transparent hover:border-slate-600 focus:border-blue-500 px-2 -ml-2 bg-transparent text-slate-100"
            />
            <Textarea
              value={selectedGroup.description}
              onChange={(e) => onUpdateGroup(selectedGroup.id, { description: e.target.value })}
              placeholder="Group description..."
              className="text-sm text-slate-300 min-h-[50px] border-transparent hover:border-slate-600 focus:border-blue-500 bg-transparent"
            />
          </div>
        </div>

        <div className="flex items-center gap-6 ml-2">
          <div className="flex items-center gap-2">
            <Switch
              id="required"
              checked={selectedGroup.isRequired}
              onCheckedChange={(checked) => 
                onUpdateGroup(selectedGroup.id, { isRequired: checked })
              }
            />
            <Label htmlFor="required" className="font-medium cursor-pointer text-slate-300">
              Required Group
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="multiselect"
              checked={selectedGroup.isMultiSelect}
              onCheckedChange={(checked) => 
                onUpdateGroup(selectedGroup.id, { isMultiSelect: checked })
              }
            />
            <Label htmlFor="multiselect" className="font-medium cursor-pointer text-slate-300">
              Multi-select
            </Label>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 bg-[#0a0e1a]">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-200">Options</h3>
            <Button
              type="button"
              onClick={() => onAddOption(selectedGroup.id)}
              size="sm"
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="h-4 w-4" />
              Add Option
            </Button>
          </div>

          <div className="space-y-2">
            {groupOptions.map((option) => {
              if (!option) return null;
              
              const isExpanded = expandedOptions.has(option.id);
              const hasPricing = option.hasPricing;
              const hasFlags = option.hasProductionFlags;
              const hasConditions = option.hasConditionals;
              const hasWeight = option.hasWeight;

              return (
                <div
                  key={option.id}
                  className="bg-[#1e293b] border border-[#334155] rounded-lg overflow-hidden"
                >
                  <div className="flex items-center p-4 hover:bg-slate-800/30 transition-colors">
                    <GripVertical className="h-4 w-4 text-slate-500 mr-2 flex-shrink-0" />
                    
                    <button
                      type="button"
                      onClick={() => toggleOption(option.id)}
                      className="flex items-center flex-1 gap-3 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-slate-200">
                            {option.name}
                          </span>
                          {hasConditions && !isExpanded && (
                            <GitBranch className="h-3.5 w-3.5 text-amber-400/60" />
                          )}
                        </div>
                        {option.description && (
                          <div className="text-xs text-slate-400 truncate">
                            {option.description}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge variant="outline" className="text-xs bg-slate-700/50 text-slate-300 border-slate-600">
                            {option.type}
                          </Badge>
                          {option.isDefault && (
                            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                              Default
                            </Badge>
                          )}
                          {option.isRequired && (
                            <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">
                              Required
                            </Badge>
                          )}
                          {hasPricing && (
                            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                              Pricing
                            </Badge>
                          )}
                          {hasFlags && (
                            <Badge variant="outline" className="text-xs bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                              Production
                            </Badge>
                          )}
                          {hasConditions && (
                            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
                              Conditional
                            </Badge>
                          )}
                          {hasWeight && (
                            <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
                              Weight
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1 ml-2">
                      {/* Reorder buttons */}
                      <div className="flex flex-col">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const currentIndex = groupOptions.findIndex(o => o?.id === option.id);
                            if (currentIndex > 0) {
                              onReorderOption(selectedGroup.id, currentIndex, currentIndex - 1);
                            }
                          }}
                          disabled={groupOptions.findIndex(o => o?.id === option.id) === 0}
                          className="h-5 w-7 p-0 text-slate-400 hover:text-slate-200 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const currentIndex = groupOptions.findIndex(o => o?.id === option.id);
                            if (currentIndex < groupOptions.length - 1) {
                              onReorderOption(selectedGroup.id, currentIndex, currentIndex + 1);
                            }
                          }}
                          disabled={groupOptions.findIndex(o => o?.id === option.id) === groupOptions.length - 1}
                          className="h-5 w-7 p-0 text-slate-400 hover:text-slate-200 disabled:opacity-30"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>

                      {/* Duplicate button */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDuplicateOption(selectedGroup.id, option.id)}
                        className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                        title="Duplicate option"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>

                      {/* Move to group dropdown */}
                      <div className="relative" data-move-dropdown>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setMoveDropdownOpen(moveDropdownOpen === option.id ? null : option.id)}
                          className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                          title="Move to group"
                        >
                          <MoveVertical className="h-4 w-4" />
                        </Button>
                        {moveDropdownOpen === option.id && (
                          <div className="absolute right-0 top-full mt-1 z-50 bg-[#1e293b] border border-[#334155] rounded-md shadow-lg min-w-[180px]">
                            <div className="py-1">
                              {allGroups
                                .filter(g => g.id !== selectedGroup.id)
                                .map(group => (
                                  <button
                                    type="button"
                                    key={group.id}
                                    onClick={() => {
                                      onMoveOption(selectedGroup.id, group.id, option.id);
                                      setMoveDropdownOpen(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700/50 transition-colors"
                                  >
                                    {group.name}
                                  </button>
                                ))}
                              {allGroups.filter(g => g.id !== selectedGroup.id).length === 0 && (
                                <div className="px-3 py-2 text-sm text-slate-400">No other groups</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Delete button */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteOption(selectedGroup.id, option.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        title="Delete option"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <>
                      <Separator className="bg-[#334155]" />
                      <div className="p-4 bg-[#0f172a] space-y-4">
                        <OptionDetailsEditor
                          option={option}
                          treeJson={treeJson}
                          onUpdateOption={onUpdateOption}
                          onAddChoice={onAddChoice}
                          onUpdateChoice={onUpdateChoice}
                          onDeleteChoice={onDeleteChoice}
                          onReorderChoice={onReorderChoice}
                          editingChoiceValue={editingChoiceValue}
                          setEditingChoiceValue={setEditingChoiceValue}
                        />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}


