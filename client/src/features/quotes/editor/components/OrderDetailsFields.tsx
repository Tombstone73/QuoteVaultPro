import type { InputHTMLAttributes, ReactNode } from "react";
import { Input } from "@/components/ui/input";

type SharedFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  footer?: ReactNode;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "readOnly" | "type">;
};

export function OrderPoField({ id, value, onChange, readOnly = false, footer, inputProps, label = "PO #" }: SharedFieldProps & { label?: string }) {
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <Input {...inputProps} id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Customer PO" readOnly={readOnly} className="h-9 min-w-0" />
    {footer}
  </div>;
}

export function OrderDueDateField({ id, value, onChange, readOnly = false, footer, inputProps }: SharedFieldProps) {
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">Due date</label>
    <Input {...inputProps} id={id} type="date" value={value} onChange={(event) => onChange(event.target.value)} readOnly={readOnly} className="h-9 min-w-0" />
    {footer}
  </div>;
}

export function OrderPriorityField({ id, value, onChange, readOnly = false }: Omit<SharedFieldProps, "footer" | "inputProps">) {
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">Priority</label>
    <select id={id} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={value || "normal"} onChange={(event) => onChange(event.target.value)} disabled={readOnly}>
      <option value="rush">Rush</option>
      <option value="normal">Normal</option>
      <option value="low">Low</option>
    </select>
  </div>;
}
