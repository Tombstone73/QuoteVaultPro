import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * PBV2LineItemOptions - Minimal component to render PBV2 option questions in line items
 *
 * Uses pbv2SnapshotJson from /calculate response:
 * - treeJson.nodes contains INPUT nodes with input.selectionKey and choices
 * - visibleNodeIds determines which nodes to show
 * - selections is Record<string, any> mapping selectionKey -> chosen value
 *
 * Supports type="select" (dropdown) and type="text" inputs.
 */

type PBV2Node = {
  id: string;
  kind?: string;
  type?: string;
  label?: string;
  input?: {
    selectionKey: string;
    type: string;
    required?: boolean;
    constraints?: {
      text?: { minLen?: number; maxLen?: number };
    };
  };
  choices?: Array<{ label: string; value: string }>;
};

type PBV2SnapshotJson = {
  treeJson: {
    nodes: Record<string, PBV2Node>;
  };
  visibleNodeIds: string[];
  selections: Record<string, any>;
};

type Props = {
  pbv2SnapshotJson: PBV2SnapshotJson | null;
  selections: Record<string, any>; // Current selections (controlled)
  onSelectionChange: (selectionKey: string, value: any) => void;
  className?: string;
};

export function PBV2LineItemOptions({ pbv2SnapshotJson, selections, onSelectionChange, className }: Props) {
  if (!pbv2SnapshotJson) return null;

  const { treeJson, visibleNodeIds } = pbv2SnapshotJson;
  if (!treeJson?.nodes || !visibleNodeIds) return null;

  // Filter to visible INPUT/question nodes with a renderable input type
  const inputNodes = visibleNodeIds
    .map((id) => treeJson.nodes[id])
    .filter((node): node is PBV2Node => {
      if (!node) return false;
      const isQuestion = node.kind === "question" || node.type === "INPUT";
      const inputType = node.input?.type;
      const hasSelectInput = inputType === "select" && Array.isArray(node.choices);
      const hasTextInput = inputType === "text";
      return isQuestion && (hasSelectInput || hasTextInput);
    });

  if (inputNodes.length === 0) return null;

  return (
    <div className={className}>
      <div className="space-y-3">
        {inputNodes.map((node) => {
          const selectionKey = node.input!.selectionKey;
          const currentValue = selections[selectionKey] ?? "";

          if (node.input!.type === "text") {
            const minLen = node.input?.constraints?.text?.minLen;
            return (
              <div key={node.id} className="space-y-1.5">
                <Label htmlFor={`pbv2-${node.id}`}>
                  {node.label || selectionKey}
                  {node.input?.required && <span className="text-destructive ml-1">*</span>}
                </Label>
                <Input
                  id={`pbv2-${node.id}`}
                  value={String(currentValue)}
                  onChange={(e) => onSelectionChange(selectionKey, e.target.value)}
                  placeholder={minLen ? `Min ${minLen} characters` : "Enter text..."}
                />
              </div>
            );
          }

          return (
            <div key={node.id} className="space-y-1.5">
              <Label htmlFor={`pbv2-${node.id}`}>
                {node.label || selectionKey}
                {node.input?.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              <Select
                value={String(currentValue)}
                onValueChange={(value) => onSelectionChange(selectionKey, value)}
              >
                <SelectTrigger id={`pbv2-${node.id}`}>
                  <SelectValue placeholder="Select an option..." />
                </SelectTrigger>
                <SelectContent>
                  {node.choices!.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
