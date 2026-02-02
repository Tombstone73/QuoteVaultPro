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

type Props = {
  productId: string;
  optionTreeJson: string | null;
  onChangeOptionTreeJson: (nextJson: string) => void;
};

/**
 * Detect the shape of parsed tree data
 */
type TreeShape = 
  | { ok: true; tree: any }
  | { ok: false; detectedShape: 'array' | 'null' | 'graph' | 'unknown' };

function detectTreeShape(parsed: any): TreeShape {
  if (parsed == null) {
    return { ok: false, detectedShape: 'null' };
  }
  
  // Legacy array format (old options structure)
  if (Array.isArray(parsed)) {
    return { ok: false, detectedShape: 'array' };
  }
  
  // Not an object at all
  if (typeof parsed !== 'object') {
    return { ok: false, detectedShape: 'unknown' };
  }
  
  // Legacy graph format (has nodes/edges but not PBV2 structure)
  if ((parsed.nodes || parsed.edges) && !parsed.schemaVersion) {
    return { ok: false, detectedShape: 'graph' };
  }
  
  // Valid PBV2 format (object with proper structure)
  // Don't enforce strict validation here - just check it's an object
  // that looks like PBV2 (has nodes/edges or is empty starter tree)
  return { ok: true, tree: parsed };
}

/**
 * Parse and normalize PBV2 tree JSON
 */
function parseTreeJson(jsonString: string | null): TreeShape {
  if (!jsonString || !jsonString.trim()) {
    return { ok: false, detectedShape: 'null' };
  }
  
  try {
    const parsed = JSON.parse(jsonString);
    return detectTreeShape(parsed);
  } catch {
    return { ok: false, detectedShape: 'unknown' };
  }
}

/**
 * Initialize a minimal valid PBV2 tree
 */
function initializeTree(): any {
  return {
    status: 'ENABLED',
    rootNodeIds: [],
    nodes: [],
    edges: [],
  };
}

export default function ProductOptionsPanelV2_Mvp({
  productId,
  optionTreeJson,
  onChangeOptionTreeJson,
}: Props) {
  const { toast } = useToast();

  // Parse tree with safe legacy detection
  const parseResult = React.useMemo(() => parseTreeJson(optionTreeJson), [optionTreeJson]);
  
  // Only attempt to build editor model if we have valid PBV2 shape
  const editorModel = React.useMemo(() => {
    if (!parseResult.ok) return null;
    try {
      return pbv2TreeToEditorModel(parseResult.tree);
    } catch (e) {
      console.error('Failed to parse PBV2 tree:', e);
      return null;
    }
  }, [parseResult]);

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
    if (!parseResult.ok) return;
    const updated = applyPatchToTree(parseResult.tree, patch);
    onChangeOptionTreeJson(JSON.stringify(updated, null, 2));
  }, [parseResult, onChangeOptionTreeJson]);

  /**
   * Initialize empty tree
   */
  const initTree = React.useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const newTree = initializeTree();
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
    if (!parseResult.ok) return;
    const { patch, newGroupId } = createAddGroupPatch(parseResult.tree);
    commitPatch(patch);
    setSelectedGroupId(newGroupId);
    setSelectedOptionId(null);
    toast({
      title: "Group added",
      description: "New group created. Update its name and settings.",
    });
  }, [parseResult, commitPatch, toast]);

  /**
   * Update group
   */
  const updateGroup = React.useCallback((groupId: string, updates: Partial<EditorOptionGroup>) => {
    if (!parseResult.ok) return;
    const { patch } = createUpdateGroupPatch(parseResult.tree, groupId, updates);
    commitPatch(patch);
  }, [parseResult, commitPatch]);

  /**
   * Delete group (cascade deletes all options)
   */
  const deleteGroup = React.useCallback((groupId: string) => {
    if (!parseResult.ok) return;
    const { patch } = createDeleteGroupPatch(parseResult.tree, groupId);
    commitPatch(patch);
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
      setSelectedOptionId(null);
    }
    toast({
      title: "Group deleted",
      description: "Group and all its options have been removed.",
    });
  }, [parseResult, commitPatch, selectedGroupId, toast]);

  /**
   * Add option to selected group
   */
  const addOption = React.useCallback((groupId: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!parseResult.ok) return;
    const { patch, newOptionId } = createAddOptionPatch(parseResult.tree, groupId);
    commitPatch(patch);
    setSelectedGroupId(groupId);
    setSelectedOptionId(newOptionId);
    toast({
      title: "Option added",
      description: "New option created. Configure its settings.",
    });
  }, [parseResult, commitPatch, toast]);

  /**
   * Update option
   */
  const updateOption = React.useCallback((optionId: string, updates: Partial<EditorOption>) => {
    if (!parseResult.ok) return;
    const { patch } = createUpdateOptionPatch(parseResult.tree, optionId, updates);
    commitPatch(patch);
  }, [parseResult, commitPatch]);

  /**
   * Delete option
   */
  const deleteOption = React.useCallback((optionId: string) => {
    if (!parseResult.ok) return;
    const { patch } = createDeleteOptionPatch(parseResult.tree, optionId);
    commitPatch(patch);
    if (selectedOptionId === optionId) {
      setSelectedOptionId(null);
    }
    toast({
      title: "Option deleted",
      description: "Option has been removed.",
    });
  }, [parseResult, commitPatch, selectedOptionId, toast]);

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
    if (!parseResult.ok) return;
    const { patch } = createUpdateGroupPatch(parseResult.tree, groupId, {});
    commitPatch(patch);
  }, [editorModel, parseResult, commitPatch]);

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
    if (!parseResult.ok) return;
    const { patch } = createUpdateOptionPatch(parseResult.tree, optionId, {});
    commitPatch(patch);
  }, [selectedGroup, parseResult, commitPatch]);

  // If legacy format detected, show banner with init option
  if (!parseResult.ok) {
    return (
      <div className="flex h-full overflow-hidden bg-background relative">
        {/* TEMPORARY: Visual marker to confirm this component renders */}
        <div className="fixed bottom-2 right-2 z-50 rounded-md bg-green-500 px-3 py-1 text-xs font-bold text-white shadow-lg">
          PBV2_FIGMA_LAYOUT
        </div>
        <aside className="w-72 border-r border-border bg-card flex flex-col">
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-foreground">Option Groups</h2>
              </div>
              <Badge variant="outline" className="text-xs">0</Badge>
            </div>
            <Button type="button" onClick={initTree} className="w-full gap-2" size="sm">
              <Plus className="h-4 w-4" />
              Initialize Tree
            </Button>
          </div>
          <div className="flex-1 p-4 flex items-center justify-center">
            <div className="text-center text-sm text-muted-foreground">
              Initialize PBV2 tree to begin building options.
            </div>
          </div>
          <div className="border-t border-border p-3 text-xs text-muted-foreground">
            Advanced editors open as drawers. Dev drawer: Ctrl+Shift+D.
          </div>
        </aside>
        
        <main className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-center h-full bg-background">
            <div className="text-center space-y-4 max-w-md p-6">
              <div className="flex justify-center">
                <div className="rounded-full bg-yellow-500/10 p-4">
                  <Layers className="h-8 w-8 text-yellow-600" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Legacy Format Detected</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Tree v2 requires PBV2 format. Current data is <strong className="text-foreground">{parseResult.detectedShape}</strong> format.
                </p>
                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-left">
                  <div className="font-medium mb-1">What will happen:</div>
                  <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                    <li>Current {parseResult.detectedShape} data will be replaced</li>
                    <li>A new empty PBV2 tree will be created</li>
                    <li>You can then add groups and options</li>
                  </ul>
                </div>
              </div>
              <Button type="button" onClick={initTree} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Initialize Tree v2
              </Button>
            </div>
          </div>
        </main>
        
        <aside className="w-80 border-l border-border bg-card p-4">
          <div className="text-sm text-muted-foreground">Preview & validation will appear here</div>
        </aside>
      </div>
    );
  }

  if (!editorModel) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-center text-destructive">
          <p className="font-semibold">Failed to parse PBV2 tree</p>
          <p className="text-sm mt-2">Check console for errors</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* TEMPORARY: Visual marker to confirm this component renders */}
      <div className="fixed bottom-2 right-2 z-50 rounded-md bg-green-500 px-3 py-1 text-xs font-bold text-white shadow-lg">
        PBV2_FIGMA_LAYOUT
      </div>
      
      <div className="flex h-full overflow-hidden bg-background">
      {/* LEFT: Option Groups Sidebar */}
      <aside className="w-72 border-r border-border bg-card flex flex-col">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-foreground">Option Groups</h2>
            </div>
            <Badge variant="outline" className="text-xs">
              {editorModel.groups.length}
            </Badge>
          </div>
          <Button type="button" onClick={addGroup} className="w-full gap-2" size="sm">
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
                    <div className="h-px bg-border/50 my-2 mx-3" />
                  )}
                  <div
                    className={`
                      rounded-md transition-colors relative
                      ${isActive
                        ? 'bg-accent/50 border border-accent'
                        : 'hover:bg-accent/30 border border-transparent'
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
                      <div className="flex items-start gap-2 mb-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate text-foreground">
                            {group.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {optionCount} option{optionCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap ml-6">
                        {group.isRequired && (
                          <Badge variant="outline" className="text-xs">Required</Badge>
                        )}
                        {group.isMultiSelect && (
                          <Badge variant="outline" className="text-xs">Multi</Badge>
                        )}
                      </div>
                    </button>

                    <div className="absolute top-3 right-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
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
              <div className="text-center text-sm text-muted-foreground py-8">
                No groups yet. Add your first group to begin.
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          Advanced editors open as drawers. Dev drawer: Ctrl+Shift+D.
        </div>
      </aside>

      {/* CENTER: Option Editor */}
      <main className="flex-1 overflow-y-auto">
        {!selectedGroup && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Settings2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Select an option group to begin editing</p>
            </div>
          </div>
        )}

        {selectedGroup && (
          <div className="h-full flex flex-col">
            {/* Group Header */}
            <div className="border-b border-border bg-card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <Input
                    value={selectedGroup.name}
                    onChange={(e) => updateGroup(selectedGroup.id, { name: e.target.value })}
                    className="text-lg font-semibold mb-2 border-transparent hover:border-border focus:border-primary px-2 -ml-2 bg-transparent"
                  />
                  <Textarea
                    value={selectedGroup.description}
                    onChange={(e) => updateGroup(selectedGroup.id, { description: e.target.value })}
                    placeholder="Group description..."
                    className="text-sm min-h-[50px] border-transparent hover:border-border focus:border-primary bg-transparent resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 ml-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="required" className="font-medium cursor-pointer text-sm">
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
                  <Label htmlFor="multiselect" className="font-medium cursor-pointer text-sm">
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
            <ScrollArea className="flex-1">
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Options</h3>
                    <Badge variant="secondary" className="text-xs">
                      {selectedGroup.optionIds.length}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    onClick={(e) => addOption(selectedGroup.id, e)}
                    size="sm"
                    variant="outline"
                    className="gap-2"
                  >
                    <Plus className="h-3 w-3" />
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
                            ? 'bg-accent/50 border-accent'
                            : 'bg-card border-border hover:bg-accent/30'
                          }
                        `}
                        onClick={() => setSelectedOptionId(optionId)}
                      >
                        <div className="p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{option.name}</div>
                                <div className="text-xs text-muted-foreground">{option.type}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {option.isRequired && (
                                <Badge variant="outline" className="text-xs">Required</Badge>
                              )}
                              {option.isDefault && (
                                <Badge variant="outline" className="text-xs">Default</Badge>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
                                  >
                                    <MoreVertical className="h-3 w-3" />
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
                    <div className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-md">
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
      <aside className="w-80 border-l border-border bg-card overflow-y-auto">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-3">Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Groups:</span>
                  <span className="font-medium">{editorModel.groups.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Options:</span>
                  <span className="font-medium">{Object.keys(editorModel.options).length}</span>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3">Validation</h3>
              <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                Validation checks will appear here
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3">Preview</h3>
              <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
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
                  value={parseResult.ok ? JSON.stringify(parseResult.tree, null, 2) : 'Legacy format - not parseable'}
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
