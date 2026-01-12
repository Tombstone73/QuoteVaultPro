import React from "react";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ProductOptionsPanelV2_Mvp({
  tree,
  selections,
  onSelectionsChange,
}: {
  tree: OptionTreeV2;
  selections: LineItemOptionSelectionsV2;
  onSelectionsChange: (next: LineItemOptionSelectionsV2) => void;
}) {
  const roots = Array.isArray(tree.rootNodeIds) ? tree.rootNodeIds : [];

  const setValue = (nodeId: string, value: unknown) => {
    const next: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {
        ...(selections.selected ?? {}),
        [nodeId]: { ...(selections.selected?.[nodeId] ?? {}), value },
      },
    };
    onSelectionsChange(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Options (Tree v2)</CardTitle>
        <CardDescription>Root questions only (MVP).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {roots.map((nodeId) => {
          const node = tree.nodes?.[nodeId];
          if (!node) return null;
          if (node.kind !== "question") return null;

          const inputType = node.input?.type;
          if (inputType !== "boolean" && inputType !== "select") return null;

          const value = selections.selected?.[nodeId]?.value;

          return (
            <div key={nodeId} className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-sm">{node.label}</Label>
                  {node.description ? <div className="text-xs text-muted-foreground">{node.description}</div> : null}
                </div>

                {inputType === "boolean" ? (
                  <Switch checked={value === true} onCheckedChange={(checked) => setValue(nodeId, checked)} />
                ) : (
                  <Select value={typeof value === "string" ? value : ""} onValueChange={(val) => setValue(nodeId, val)}>
                    <SelectTrigger className="h-8 w-[180px]">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {(node.choices ?? []).map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
