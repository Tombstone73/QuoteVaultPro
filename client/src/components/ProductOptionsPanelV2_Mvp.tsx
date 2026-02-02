import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ArrowDown, ArrowUp, Plus, Trash2, Edit2, GripVertical, MoreVertical, Layers } from "lucide-react";
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
 * Parse and normalize PBV2 tree JSON
 */
function parseTreeJson(jsonString: string | null): any | null {
  if (!jsonString || !jsonString.trim()) return null;
  try {
    return JSON.parse(jsonString);
  } catch {
    return null;
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

  // Parse tree and derive editor model
  const treeData = React.useMemo(() => parseTreeJson(optionTreeJson), [optionTreeJson]);
  const editorModel = React.useMemo(() => {
    if (!treeData) return null;
    try {
      return pbv2TreeToEditorModel(treeData);
    } catch (e) {
      console.error('Failed to parse PBV2 tree:', e);
      return null;
    }
  }, [treeData]);

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
    if (!treeData) return;
    const updated = applyPatchToTree(treeData, patch);
    onChangeOptionTreeJson(JSON.stringify(updated, null, 2));
  }, [treeData, onChangeOptionTreeJson]);

  /**
   * Initialize empty tree
   */
  const initTree = React.useCallback(() => {
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
  const addGroup = React.useCallback(() => {
    if (!treeData) return;
    const { patch, newGroupId } = createAddGroupPatch(treeData);
    commitPatch(patch);
    setSelectedGroupId(newGroupId);
    setSelectedOptionId(null);
    toast({
      title: "Group added",
      description: "New group created. Update its name and settings.",
    });
  }, [treeData, commitPatch, toast]);

  /**
   * Update group
   */
  const updateGroup = React.useCallback((groupId: string, updates: Partial<EditorOptionGroup>) => {
    if (!treeData) return;
    const { patch } = createUpdateGroupPatch(treeData, groupId, updates);
    commitPatch(patch);
  }, [treeData, commitPatch]);

  /**
   * Delete group (cascade deletes all options)
   */
  const deleteGroup = React.useCallback((groupId: string) => {
    if (!treeData) return;
    const { patch } = createDeleteGroupPatch(treeData, groupId);
    commitPatch(patch);
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
      setSelectedOptionId(null);
    }
    toast({
      title: "Group deleted",
      description: "Group and all its options have been removed.",
    });
  }, [treeData, commitPatch, selectedGroupId, toast]);

  /**
   * Add option to selected group
   */
  const addOption = React.useCallback((groupId: string) => {
    if (!treeData) return;
    const { patch, newOptionId } = createAddOptionPatch(treeData, groupId);
    commitPatch(patch);
    setSelectedGroupId(groupId);
    setSelectedOptionId(newOptionId);
    toast({
      title: "Option added",
      description: "New option created. Configure its settings.",
    });
  }, [treeData, commitPatch, toast]);

  /**
   * Update option
   */
  const updateOption = React.useCallback((optionId: string, updates: Partial<EditorOption>) => {
    if (!treeData) return;
    const { patch } = createUpdateOptionPatch(treeData, optionId, updates);
    commitPatch(patch);
  }, [treeData, commitPatch]);

  /**
   * Delete option
   */
  const deleteOption = React.useCallback((optionId: string) => {
    if (!treeData) return;
    const { patch } = createDeleteOptionPatch(treeData, optionId);
    commitPatch(patch);
    if (selectedOptionId === optionId) {
      setSelectedOptionId(null);
    }
    toast({
      title: "Option deleted",
      description: "Option has been removed.",
    });
  }, [treeData, commitPatch, selectedOptionId, toast]);

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
    const { patch } = createUpdateGroupPatch(treeData, groupId, {});
    commitPatch(patch);
  }, [editorModel, treeData, commitPatch]);

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
    const { patch } = createUpdateOptionPatch(treeData, optionId, {});
    commitPatch(patch);
  }, [selectedGroup, treeData, commitPatch]);

  // If no tree, show init UI
  if (!treeData) {
    return (
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-3">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base">Product Options</CardTitle>
              <CardDescription>Initialize PBV2 tree to begin.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border p-4 space-y-3">
                <div className="text-sm font-medium">No PBV2 data</div>
                <div className="text-xs text-muted-foreground">
                  Initialize the PBV2 tree to start building product options.
                </div>
                <Button onClick={initTree} className="w-full">
                  Initialize Tree
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="col-span-12 lg:col-span-9">
          <Card className="h-full">
            <CardContent className="pt-6">
              <div className="text-center text-muted-foreground">
                Initialize the tree to begin editing.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!editorModel) {
    return (
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center text-destructive">
                Failed to parse PBV2 tree. Check console for errors.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* LEFT: Option Groups Sidebar */}
      <div className="col-span-12 lg:col-span-3">
        <Card className="h-full flex flex-col">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Option Groups</CardTitle>
              </div>
              <Badge variant="outline" className="text-xs">
                {editorModel.groups.length}
              </Badge>
            </div>
            <CardDescription>Organize options into groups.</CardDescription>
          </CardHeader>
          
          <CardContent className="flex-1 flex flex-col space-y-3 overflow-hidden">
            <Button onClick={addGroup} size="sm" className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Group
            </Button>

            <ScrollArea className="flex-1 rounded-md border border-border">
              <div className="p-2 space-y-2">
                {editorModel.groups.map((group, index) => {
                  const isActive = group.id === selectedGroupId;
                  const optionCount = group.optionIds.length;

                  return (
                    <div
                      key={group.id}
                      className={`
                        relative rounded-md border transition-colors
                        ${isActive
                          ? 'bg-muted border-primary'
                          : 'bg-background border-border hover:bg-muted/50'
                        }
                      `}
                    >
                      <button
                        onClick={() => {
                          setSelectedGroupId(group.id);
                          setSelectedOptionId(null);
                        }}
                        className="w-full text-left p-3 pr-10"
                      >
                        <div className="flex items-start gap-2 mb-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{group.name}</div>
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
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
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
                  );
                })}

                {editorModel.groups.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    No groups yet. Add your first group to begin.
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Options list for selected group */}
            {selectedGroup && (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Options</div>
                  <Button
                    onClick={() => addOption(selectedGroup.id)}
                    size="sm"
                    variant="outline"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>

                <ScrollArea className="max-h-[200px] rounded-md border border-border">
                  <div className="p-2 space-y-1">
                    {selectedGroup.optionIds.map((optionId, index) => {
                      const option = editorModel.options[optionId];
                      if (!option) return null;

                      const isActive = optionId === selectedOptionId;

                      return (
                        <div
                          key={optionId}
                          className={`
                            relative rounded-md border transition-colors
                            ${isActive
                              ? 'bg-muted border-primary'
                              : 'bg-background border-border hover:bg-muted/50'
                            }
                          `}
                        >
                          <button
                            onClick={() => setSelectedOptionId(optionId)}
                            className="w-full text-left p-2 pr-10"
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{option.name}</div>
                                <div className="text-xs text-muted-foreground truncate">{option.type}</div>
                              </div>
                            </div>
                          </button>

                          <div className="absolute top-2 right-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center justify-center h-5 w-5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
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
                      );
                    })}

                    {selectedGroup.optionIds.length === 0 && (
                      <div className="text-center text-xs text-muted-foreground py-4">
                        No options yet. Add one to begin.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="text-xs text-muted-foreground border-t border-border pt-3">
              Advanced editors open as drawers. Dev drawer: Ctrl+Shift+D.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CENTER: Group/Option Editor */}
      <div className="col-span-12 lg:col-span-6">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-base">
              {selectedOption ? 'Option Editor' : selectedGroup ? 'Group Editor' : 'Editor'}
            </CardTitle>
            <CardDescription>
              {selectedOption
                ? `Editing option: ${selectedOption.name}`
                : selectedGroup
                ? `Editing group: ${selectedGroup.name}`
                : 'Select a group or option to edit'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {!selectedGroup && !selectedOption && (
              <div className="text-center text-muted-foreground py-12">
                Select a group or option from the left sidebar to begin editing.
              </div>
            )}

            {selectedGroup && !selectedOption && (
              <>
                <div className="space-y-3">
                  <div className="text-sm font-semibold">Group Settings</div>
                  
                  <div className="space-y-1">
                    <Label>Group Name</Label>
                    <Input
                      value={selectedGroup.name}
                      onChange={(e) => updateGroup(selectedGroup.id, { name: e.target.value })}
                      placeholder="e.g., Material Options"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>Description</Label>
                    <Textarea
                      value={selectedGroup.description}
                      onChange={(e) => updateGroup(selectedGroup.id, { description: e.target.value })}
                      placeholder="Describe this group..."
                      className="min-h-[80px]"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <div className="text-sm font-medium">Required Group</div>
                      <div className="text-xs text-muted-foreground">
                        Customer must select an option from this group.
                      </div>
                    </div>
                    <Button
                      variant={selectedGroup.isRequired ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateGroup(selectedGroup.id, { isRequired: !selectedGroup.isRequired })}
                    >
                      {selectedGroup.isRequired ? 'Yes' : 'No'}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <div className="text-sm font-medium">Multi-Select</div>
                      <div className="text-xs text-muted-foreground">
                        Allow selecting multiple options from this group.
                      </div>
                    </div>
                    <Button
                      variant={selectedGroup.isMultiSelect ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateGroup(selectedGroup.id, { isMultiSelect: !selectedGroup.isMultiSelect })}
                    >
                      {selectedGroup.isMultiSelect ? 'Yes' : 'No'}
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Group Information</div>
                  <div className="rounded-md border border-border p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Options:</span>
                      <span className="font-medium">{selectedGroup.optionIds.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sort Order:</span>
                      <span className="font-medium">{selectedGroup.sortOrder}</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {selectedOption && (
              <>
                <div className="space-y-3">
                  <div className="text-sm font-semibold">Option Identity</div>
                  
                  <div className="space-y-1">
                    <Label>Option Name</Label>
                    <Input
                      value={selectedOption.name}
                      onChange={(e) => updateOption(selectedOption.id, { name: e.target.value })}
                      placeholder="e.g., Glossy Finish"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>Description</Label>
                    <Textarea
                      value={selectedOption.description}
                      onChange={(e) => updateOption(selectedOption.id, { description: e.target.value })}
                      placeholder="Describe this option..."
                      className="min-h-[80px]"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>Selection Key</Label>
                    <Input
                      value={selectedOption.selectionKey}
                      disabled
                      className="bg-muted"
                    />
                    <div className="text-xs text-muted-foreground">
                      Internal identifier used in formulas and integrations.
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="text-sm font-semibold">Option Type</div>
                  
                  <div className="flex gap-2 flex-wrap">
                    {(['radio', 'checkbox', 'dropdown', 'numeric'] as const).map((type) => (
                      <Button
                        key={type}
                        variant={selectedOption.type === type ? "default" : "outline"}
                        size="sm"
                        onClick={() => updateOption(selectedOption.id, { type })}
                      >
                        {type}
                      </Button>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="text-sm font-semibold">Option Flags</div>

                  <div className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <div className="text-sm font-medium">Required</div>
                      <div className="text-xs text-muted-foreground">
                        This option must be filled.
                      </div>
                    </div>
                    <Button
                      variant={selectedOption.isRequired ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateOption(selectedOption.id, { isRequired: !selectedOption.isRequired })}
                    >
                      {selectedOption.isRequired ? 'Yes' : 'No'}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <div className="text-sm font-medium">Default Selection</div>
                      <div className="text-xs text-muted-foreground">
                        Pre-select this option by default.
                      </div>
                    </div>
                    <Button
                      variant={selectedOption.isDefault ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateOption(selectedOption.id, { isDefault: !selectedOption.isDefault })}
                    >
                      {selectedOption.isDefault ? 'Yes' : 'No'}
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Indicators</div>
                  <div className="flex gap-2 flex-wrap">
                    {selectedOption.hasPricing && <Badge>Has Pricing</Badge>}
                    {selectedOption.hasProductionFlags && <Badge>Has Production Flags</Badge>}
                    {selectedOption.hasConditionals && <Badge>Has Conditionals</Badge>}
                    {!selectedOption.hasPricing && !selectedOption.hasProductionFlags && !selectedOption.hasConditionals && (
                      <span className="text-sm text-muted-foreground">No special indicators</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RIGHT: Preview/Validation Panel */}
      <div className="col-span-12 lg:col-span-3">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-base">Preview & Validation</CardTitle>
            <CardDescription>Live preview and validation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Status</div>
              <div className="text-sm">
                {editorModel.groups.length} group{editorModel.groups.length !== 1 ? 's' : ''}
                <br />
                {Object.keys(editorModel.options).length} option{Object.keys(editorModel.options).length !== 1 ? 's' : ''}
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Validation</div>
              <div className="text-sm text-muted-foreground">
                Validation logic will appear here.
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Customer Preview</div>
              <div className="text-sm text-muted-foreground">
                Customer-facing preview will render here.
              </div>
            </div>
          </CardContent>
        </Card>
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
                <Button variant="ghost" size="sm" onClick={() => setDevDrawerOpen(false)}>Close</Button>
              </div>
              
              <div className="space-y-2">
                <div className="text-sm font-medium">Current Tree JSON</div>
                <Textarea
                  value={JSON.stringify(treeData, null, 2)}
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
    </div>
  );
}
