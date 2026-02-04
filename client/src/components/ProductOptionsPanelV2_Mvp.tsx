import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ArrowDown, ArrowUp, Plus, Trash2, Edit2, GripVertical, MoreVertical, Layers, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ConfirmationModal } from "@/components/pbv2/builder-v2/ConfirmationModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  pbv2TreeToEditorModel,
  createAddGroupPatch,
  createUpdateGroupPatch,
  createDeleteGroupPatch,
  createAddOptionPatch,
  createUpdateOptionPatch,
  createDeleteOptionPatch,
  applyPatchToTree,
  type EditorModel,
  type EditorOptionGroup,
  type EditorOption,
} from "@/lib/pbv2/pbv2ViewModel";
import { coerceOrMigrateToPBV2 } from "@shared/optionTreeV2Initializer";

type Props = {
  productId: string;
  optionTreeJson: string | null;
  onChangeOptionTreeJson: (nextJson: string) => void;
  onPbv2StateChange?: (state: { treeJson: unknown; hasChanges: boolean; draftId: string | null }) => void;
};

/**
 * Parse and auto-migrate to PBV2 tree
 * Always returns a valid PBV2 tree (never shows legacy UI)
 */
function parseAndMigrateTree(jsonString: string | null): any {
  if (!jsonString || !jsonString.trim()) {
    // Empty/null → auto-initialize
    return coerceOrMigrateToPBV2(null);
  }
  
  try {
    const parsed = JSON.parse(jsonString);
    // Auto-migrate to PBV2 (handles array, legacy, null, invalid)
    return coerceOrMigrateToPBV2(parsed);
  } catch {
    // Parse error → return empty tree
    console.warn('[ProductOptionsPanelV2_Mvp] JSON parse error, using empty tree');
    return coerceOrMigrateToPBV2(null);
  }
}

export default function ProductOptionsPanelV2_Mvp({
  productId,
  optionTreeJson,
  onChangeOptionTreeJson,
  onPbv2StateChange,
}: Props) {
  const { toast } = useToast();

  // Auto-migrate tree (always returns valid PBV2)
  const tree = React.useMemo(() => {
    const result = parseAndMigrateTree(optionTreeJson);
    
    // DEV-ONLY: Log what we parsed
    if (import.meta.env.DEV) {
      const nodeCount = Object.keys(result?.nodes || {}).length;
      const rootCount = Array.isArray(result?.rootNodeIds) ? result.rootNodeIds.length : 0;
      const edgeCount = Array.isArray(result?.edges) ? result.edges.length : 0;
      console.log('[ProductOptionsPanelV2_Mvp] Parsed tree:', {
        source: 'optionTreeJson prop from ProductForm',
        nodeCount,
        rootCount,
        edgeCount,
        schemaVersion: result?.schemaVersion,
      });
    }
    
    return result;
  }, [optionTreeJson]);
  
  // Build editor model from valid PBV2 tree
  const editorModel = React.useMemo(() => {
    try {
      return pbv2TreeToEditorModel(tree);
    } catch (e) {
      console.error('Failed to parse PBV2 tree:', e);
      return null;
    }
  }, [tree]);

  // Selection state
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = React.useState<string | null>(null);

  // Auto-select first group when model loads
  React.useEffect(() => {
    if (!editorModel) return;
    if (!selectedGroupId && editorModel.groups.length > 0) {
      setSelectedGroupId(editorModel.groups[0].id);
    }
  }, [editorModel, selectedGroupId]);

  // Get selected entities
  const selectedGroup = React.useMemo(() => {
    if (!editorModel || !selectedGroupId) return null;
    return editorModel.groups.find(g => g.id === selectedGroupId) ?? null;
  }, [editorModel, selectedGroupId]);

  const selectedOption = React.useMemo(() => {
    if (!editorModel || !selectedOptionId) return null;
    return editorModel.options[selectedOptionId] ?? null;
  }, [editorModel, selectedOptionId]);

  // Confirmation modals
  const [deleteGroupConfirm, setDeleteGroupConfirm] = React.useState<{ groupId: string; groupName: string } | null>(null);
  const [deleteOptionConfirm, setDeleteOptionConfirm] = React.useState<{ optionId: string; optionName: string } | null>(null);

  // Dev drawer
  const [devDrawerOpen, setDevDrawerOpen] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setDevDrawerOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /**
   * Apply a patch and commit to parent
   */
  const commitPatch = React.useCallback((patch: { nodes?: any[]; edges?: any[] }) => {
    const updated = applyPatchToTree(tree, patch);
    const updatedJson = JSON.stringify(updated, null, 2);
    onChangeOptionTreeJson(updatedJson);
    
    // Notify parent of PBV2 state change
    if (onPbv2StateChange) {
      onPbv2StateChange({
        treeJson: updated,
        hasChanges: true,
        draftId: `draft-${productId}`,
      });
      
      // DEV-ONLY: Log callback invocation
      if (import.meta.env.DEV) {
        console.log('[ProductOptionsPanelV2_Mvp] Called onPbv2StateChange after patch:', {
          nodeCount: Object.keys(updated?.nodes || {}).length,
          rootCount: Array.isArray(updated?.rootNodeIds) ? updated.rootNodeIds.length : 0,
          hasChanges: true,
          draftId: `draft-${productId}`,
        });
      }
    }
  }, [tree, onChangeOptionTreeJson, onPbv2StateChange, productId]);

  /**
   * Initialize empty tree (no longer needed - auto-migrates, but keep for backwards compat)
   */
  const initTree = React.useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const newTree = coerceOrMigrateToPBV2(null);
    onChangeOptionTreeJson(JSON.stringify(newTree, null, 2));
    toast({
      title: "Tree initialized",
      description: "PBV2 tree has been initialized. Add your first group to begin.",
    });
  }, [onChangeOptionTreeJson, toast]);

  /**
   * Add a new group
   */
  const addGroup = React.useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const { patch, newGroupId } = createAddGroupPatch(tree);
    commitPatch(patch);
    setSelectedGroupId(newGroupId);
    setSelectedOptionId(null);
    toast({
      title: "Group added",
      description: "New group created. Update its name and settings.",
    });
  }, [tree, commitPatch, toast]);

  /**
   * Update group
   */
  const updateGroup = React.useCallback((groupId: string, updates: Partial<EditorOptionGroup>) => {
    const { patch } = createUpdateGroupPatch(tree, groupId, updates);
    commitPatch(patch);
  }, [tree, commitPatch]);

  /**
   * Delete group (cascade deletes all options)
   */
  const deleteGroup = React.useCallback((groupId: string) => {
    const { patch } = createDeleteGroupPatch(tree, groupId);
    commitPatch(patch);
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
      setSelectedOptionId(null);
    }
    toast({
      title: "Group deleted",
      description: "Group and all its options have been removed.",
    });
  }, [tree, commitPatch, selectedGroupId, toast]);

  /**
   * Add option to selected group
   */
  const addOption = React.useCallback((groupId: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const { patch, newOptionId } = createAddOptionPatch(tree, groupId);
    commitPatch(patch);
    setSelectedGroupId(groupId);
    setSelectedOptionId(newOptionId);
    toast({
      title: "Option added",
      description: "New option created. Configure its settings.",
    });
  }, [tree, commitPatch, toast]);

  /**
   * Update option
   */
  const updateOption = React.useCallback((optionId: string, updates: Partial<EditorOption>) => {
    const { patch } = createUpdateOptionPatch(tree, optionId, updates);
    commitPatch(patch);
  }, [tree, commitPatch]);

  /**
   * Delete option
   */
  const deleteOption = React.useCallback((optionId: string) => {
    const { patch } = createDeleteOptionPatch(tree, optionId);
    commitPatch(patch);
    if (selectedOptionId === optionId) {
      setSelectedOptionId(null);
    }
    toast({
      title: "Option deleted",
      description: "Option has been removed.",
    });
  }, [tree, commitPatch, selectedOptionId, toast]);

  /**
   * Move group up/down in list
   */
  const moveGroup = React.useCallback((groupId: string, direction: 'up' | 'down') => {
    if (!editorModel) return;
    const index = editorModel.groups.findIndex(g => g.id === groupId);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === editorModel.groups.length - 1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const reordered = [...editorModel.groups];
    const [removed] = reordered.splice(index, 1);
    reordered.splice(newIndex, 0, removed);

    // Update sortOrder in tree nodes
    const { patch } = createUpdateGroupPatch(tree, groupId, {});
    commitPatch(patch);
  }, [editorModel, tree, commitPatch]);

  /**
   * Move option up/down in group
   */
  const moveOption = React.useCallback((optionId: string, direction: 'up' | 'down') => {
    if (!selectedGroup) return;
    const index = selectedGroup.optionIds.indexOf(optionId);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === selectedGroup.optionIds.length - 1) return;

    // Reorder is handled by edge priority in pbv2ViewModel
    // For now, just update the option
    const { patch } = createUpdateOptionPatch(tree, optionId, {});
    commitPatch(patch);
  }, [selectedGroup, tree, commitPatch]);

  // No legacy UI - auto-migration handles all cases
  // Render main builder UI immediately

  if (!editorModel) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0e1a]">
        <div className="text-center text-red-400">
          <p className="font-semibold">Failed to parse PBV2 tree</p>
          <p className="text-sm mt-2">Check console for errors</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full overflow-hidden bg-[#0a0e1a]">
      {/* LEFT: Option Groups Sidebar */}
      <aside className="w-72 border-r border-[#334155] bg-[#0f172a] flex flex-col">
        <div className="border-b border-[#334155] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-slate-400" />
              <h2 className="font-semibold text-slate-200">Option Groups</h2>
            </div>
            <Badge variant="outline" className="text-xs bg-slate-800 text-slate-300 border-slate-600">
              {editorModel.groups.length}
            </Badge>
          </div>
          <Button type="button" onClick={addGroup} className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm" size="sm">
            <Plus className="h-4 w-4" />
            Add Group
          </Button>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-2">
            {editorModel.groups.map((group, index) => {
              const isActive = group.id === selectedGroupId;
              const optionCount = group.optionIds.length;

              return (
                <div key={group.id}>
                  {index > 0 && (
                    <div className="h-px bg-slate-700/50 my-2 mx-3" />
                  )}
                  <div
                    className={`
                      rounded-md transition-colors relative
                      ${isActive
                        ? 'bg-blue-500/10 border border-blue-500/30'
                        : 'hover:bg-slate-800/50 border border-transparent'
                      }
                    `}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGroupId(group.id);
                        setSelectedOptionId(null);
                      }}
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
                              {optionCount} option{optionCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap ml-6">
                        {group.isRequired && (
                          <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">Required</Badge>
                        )}
                        {group.isMultiSelect && (
                          <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">Multi</Badge>
                        )}
                      </div>
                    </button>

                    <div className="absolute top-3 right-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center justify-center h-6 w-6 p-0 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition-colors"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedGroupId(group.id);
                              setSelectedOptionId(null);
                            }}
                          >
                            <Edit2 className="h-4 w-4 mr-2" />
                            Edit group
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              moveGroup(group.id, 'up');
                            }}
                            disabled={index === 0}
                          >
                            <ArrowUp className="h-4 w-4 mr-2" />
                            Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              moveGroup(group.id, 'down');
                            }}
                            disabled={index === editorModel.groups.length - 1}
                          >
                            <ArrowDown className="h-4 w-4 mr-2" />
                            Move down
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteGroupConfirm({ groupId: group.id, groupName: group.name });
                            }}
                            className="text-destructive"
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

            {editorModel.groups.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-8">
                No groups yet. Add your first group to begin.
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-[#334155] p-3 text-xs text-slate-400">
          Advanced editors open as drawers. Dev drawer: Ctrl+Shift+D.
        </div>
      </aside>

      {/* CENTER: Option Editor */}
      <main className="flex-1 overflow-y-auto border-r border-[#334155]">
        {!selectedGroup && (
          <div className="flex items-center justify-center h-full text-slate-400 bg-[#0a0e1a]">
            <div className="text-center">
              <Settings2 className="h-12 w-12 mx-auto mb-3 text-slate-600" />
              <p>Select an option group to begin editing</p>
            </div>
          </div>
        )}

        {selectedGroup && (
          <div className="h-full flex flex-col bg-[#0a0e1a]">
            {/* Group Header */}
            <div className="border-b border-[#334155] bg-[#1e293b] p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <Input
                    value={selectedGroup.name}
                    onChange={(e) => updateGroup(selectedGroup.id, { name: e.target.value })}
                    className="text-lg font-semibold mb-2 border-transparent hover:border-slate-600 focus:border-blue-500 px-2 -ml-2 bg-transparent text-slate-100"
                  />
                  <Textarea
                    value={selectedGroup.description}
                    onChange={(e) => updateGroup(selectedGroup.id, { description: e.target.value })}
                    placeholder="Group description..."
                    className="text-sm text-slate-300 min-h-[50px] border-transparent hover:border-slate-600 focus:border-blue-500 bg-transparent resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 ml-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="required" className="font-medium cursor-pointer text-sm text-slate-300">
                    Required Group
                  </Label>
                  <Button
                    type="button"
                    id="required"
                    variant={selectedGroup.isRequired ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateGroup(selectedGroup.id, { isRequired: !selectedGroup.isRequired })}
                    className="h-7 text-xs"
                  >
                    {selectedGroup.isRequired ? 'Yes' : 'No'}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="multiselect" className="font-medium cursor-pointer text-sm text-slate-300">
                    Multi-select
                  </Label>
                  <Button
                    type="button"
                    id="multiselect"
                    variant={selectedGroup.isMultiSelect ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateGroup(selectedGroup.id, { isMultiSelect: !selectedGroup.isMultiSelect })}
                    className="h-7 text-xs"
                  >
                    {selectedGroup.isMultiSelect ? 'Yes' : 'No'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Options List */}
            <ScrollArea className="flex-1 bg-[#0a0e1a]">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-200">Options</h3>
                  <Button
                    type="button"
                    onClick={(e) => addOption(selectedGroup.id, e)}
                    size="sm"
                    className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus className="h-4 w-4" />
                    Add Option
                  </Button>
                </div>

                <div className="space-y-2">
                  {selectedGroup.optionIds.map((optionId, index) => {
                    const option = editorModel.options[optionId];
                    if (!option) return null;

                    const isActive = optionId === selectedOptionId;

                    return (
                      <div
                        key={optionId}
                        className={`
                          rounded-md border transition-colors cursor-pointer
                          ${isActive
                            ? 'bg-blue-500/10 border-blue-500/30'
                            : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                          }
                        `}
                        onClick={() => setSelectedOptionId(optionId)}
                      >
                        <div className="p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <GripVertical className="h-4 w-4 text-slate-500 flex-shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-slate-200 mb-0.5 truncate">{option.name}</div>
                                <div className="text-xs text-slate-400">{option.type}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {option.isRequired && (
                                <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">Required</Badge>
                              )}
                              {option.isDefault && (
                                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Default</Badge>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center justify-center h-6 w-6 p-0 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition-colors"
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedOptionId(optionId);
                                    }}
                                  >
                                    <Edit2 className="h-4 w-4 mr-2" />
                                    Edit option
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      moveOption(optionId, 'up');
                                    }}
                                    disabled={index === 0}
                                  >
                                    <ArrowUp className="h-4 w-4 mr-2" />
                                    Move up
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      moveOption(optionId, 'down');
                                    }}
                                    disabled={index === selectedGroup.optionIds.length - 1}
                                  >
                                    <ArrowDown className="h-4 w-4 mr-2" />
                                    Move down
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteOptionConfirm({ optionId, optionName: option.name });
                                    }}
                                    className="text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete option
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>

                          {/* Option Details - Expanded */}
                          {isActive && (
                            <div className="mt-4 pt-4 border-t border-border space-y-4">
                              <div className="space-y-2">
                                <Label className="text-xs">Option Name</Label>
                                <Input
                                  value={option.name}
                                  onChange={(e) => updateOption(option.id, { name: e.target.value })}
                                  placeholder="e.g., Glossy Finish"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-xs">Description</Label>
                                <Textarea
                                  value={option.description}
                                  onChange={(e) => updateOption(option.id, { description: e.target.value })}
                                  placeholder="Describe this option..."
                                  className="min-h-[60px] resize-none"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-xs">Type</Label>
                                <div className="flex gap-2 flex-wrap">
                                  {(['radio', 'checkbox', 'dropdown', 'numeric'] as const).map((type) => (
                                    <Button
                                      key={type}
                                      type="button"
                                      variant={option.type === type ? "default" : "outline"}
                                      size="sm"
                                      onClick={() => updateOption(option.id, { type })}
                                      className="text-xs"
                                    >
                                      {type}
                                    </Button>
                                  ))}
                                </div>
                              </div>

                              <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs">Required</Label>
                                  <Button
                                    type="button"
                                    variant={option.isRequired ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => updateOption(option.id, { isRequired: !option.isRequired })}
                                    className="h-7 text-xs"
                                  >
                                    {option.isRequired ? 'Yes' : 'No'}
                                  </Button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs">Default</Label>
                                  <Button
                                    type="button"
                                    variant={option.isDefault ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => updateOption(option.id, { isDefault: !option.isDefault })}
                                    className="h-7 text-xs"
                                  >
                                    {option.isDefault ? 'Yes' : 'No'}
                                  </Button>
                                </div>
                              </div>

                              {(option.hasPricing || option.hasProductionFlags || option.hasConditionals) && (
                                <div className="flex gap-2 flex-wrap">
                                  {option.hasPricing && <Badge variant="secondary" className="text-xs">Has Pricing</Badge>}
                                  {option.hasProductionFlags && <Badge variant="secondary" className="text-xs">Has Production Flags</Badge>}
                                  {option.hasConditionals && <Badge variant="secondary" className="text-xs">Has Conditionals</Badge>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {selectedGroup.optionIds.length === 0 && (
                    <div className="text-center text-sm text-slate-400 py-8 border border-dashed border-slate-700 rounded-md">
                      No options yet. Add your first option above.
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </main>

      {/* RIGHT: Preview & Validation Panel */}
      <aside className="w-96 bg-[#0f172a] border-l border-[#334155] flex flex-col">
        <div className="border-b border-[#334155] p-4">
          <h2 className="font-semibold text-slate-200">Preview & Validation</h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-3 text-slate-200">Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Groups:</span>
                  <span className="font-medium text-slate-200">{editorModel.groups.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Options:</span>
                  <span className="font-medium text-slate-200">{Object.keys(editorModel.options).length}</span>
                </div>
              </div>
            </div>

            <Separator className="bg-[#334155]" />

            <div>
              <h3 className="text-sm font-semibold mb-3 text-slate-200">Validation</h3>
              <div className="rounded-md border border-slate-700 bg-slate-800/30 p-3 text-sm text-slate-400">
                Validation checks will appear here
              </div>
            </div>

            <Separator className="bg-[#334155]" />

            <div>
              <h3 className="text-sm font-semibold mb-3 text-slate-200">Preview</h3>
              <div className="rounded-md border border-slate-700 bg-slate-800/30 p-3 text-sm text-slate-400">
                Customer preview will render here
              </div>
            </div>
          </div>
        </ScrollArea>
      </aside>
      </div>

      {/* Confirmation Modals */}
      <ConfirmationModal
        open={deleteGroupConfirm !== null}
        onOpenChange={(open) => !open && setDeleteGroupConfirm(null)}
        title="Delete Group?"
        description={`Are you sure you want to delete "${deleteGroupConfirm?.groupName}"?\n\nThis will also delete all ${selectedGroup?.optionIds.length || 0} options in this group. This action cannot be undone.`}
        confirmLabel="Delete Group"
        onConfirm={() => {
          if (deleteGroupConfirm) {
            deleteGroup(deleteGroupConfirm.groupId);
            setDeleteGroupConfirm(null);
          }
        }}
        variant="danger"
      />

      <ConfirmationModal
        open={deleteOptionConfirm !== null}
        onOpenChange={(open) => !open && setDeleteOptionConfirm(null)}
        title="Delete Option?"
        description={`Are you sure you want to delete "${deleteOptionConfirm?.optionName}"?\n\nThis action cannot be undone.`}
        confirmLabel="Delete Option"
        onConfirm={() => {
          if (deleteOptionConfirm) {
            deleteOption(deleteOptionConfirm.optionId);
            setDeleteOptionConfirm(null);
          }
        }}
        variant="danger"
      />

      {/* Dev Drawer */}
      {devDrawerOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setDevDrawerOpen(false)}>
          <div className="bg-background border border-border rounded-lg p-6 max-w-4xl max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Developer Drawer</h2>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDevDrawerOpen(false)}>Close</Button>
              </div>
              
              <div className="space-y-2">
                <div className="text-sm font-medium">Current Tree JSON</div>
                <Textarea
                  value={JSON.stringify(tree, null, 2)}
                  readOnly
                  className="font-mono text-xs min-h-[400px]"
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Editor Model</div>
                <Textarea
                  value={JSON.stringify(editorModel, null, 2)}
                  readOnly
                  className="font-mono text-xs min-h-[400px]"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
