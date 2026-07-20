import { Checkbox } from "@/components/ui/checkbox";
import {
  getOrderLineItemSelectAllState,
  toggleAllOrderLineItemSelections,
} from "./orderLineItemEditorUi";

export function OrderLineItemSelectAllControl(props: {
  selectedIds: ReadonlySet<string>;
  selectableIds: readonly string[];
  onSelectedIdsChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const checked = getOrderLineItemSelectAllState(props.selectedIds, props.selectableIds);
  const disabled = props.disabled === true || props.selectableIds.length === 0;

  return (
    <label className="inline-flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
      <Checkbox
        checked={checked}
        disabled={disabled}
        aria-label="Select all line items"
        onCheckedChange={() => {
          if (disabled) return;
          props.onSelectedIdsChange(toggleAllOrderLineItemSelections(props.selectedIds, props.selectableIds));
        }}
      />
      Select all
    </label>
  );
}
