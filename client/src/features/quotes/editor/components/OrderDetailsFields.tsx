import type { InputHTMLAttributes, ReactNode } from "react";
import { useWorkspaceFieldId } from "@/contexts/WorkspaceContext";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/queryClient';
import { dateOnlyDeadline, type OrderDeadline } from '@shared/orderDeadline';

type SharedFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  footer?: ReactNode;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "readOnly" | "type">;
};

export function OrderJobLabelField({ id, value, onChange, readOnly = false, footer }: SharedFieldProps) {
  const fieldId = useWorkspaceFieldId();
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={fieldId(id)} className="text-sm font-medium">Job Label</label>
    <Input id={fieldId(id)} value={value} onChange={event => onChange(event.target.value)} placeholder="Job name or reference" readOnly={readOnly} maxLength={255} className="h-9 min-w-0" />
    {footer}
  </div>;
}

export function OrderPoField({ id, value, onChange, readOnly = false, footer, inputProps, label = "PO #" }: SharedFieldProps & { label?: string }) {
  const fieldId = useWorkspaceFieldId();
  id = fieldId(id);
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <Input {...inputProps} id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Customer PO" readOnly={readOnly} className="h-9 min-w-0" />
    {footer}
  </div>;
}

export function OrderDueDateField({ id, value, onChange, readOnly = false, footer, inputProps, deadline, onDeadlineChange, label = "Due date" }: SharedFieldProps & {
  label?:string; deadline?:OrderDeadline|null; onDeadlineChange?:(value:OrderDeadline|null)=>void;
}) {
  const [timezone,setTimezone]=useState<string|null>(null);
  const kind=deadline?.kind ?? 'date_only';
  useEffect(()=>{
    if(kind==='date_only')return;
    const controller=new AbortController();
    void apiFetch('/api/orders/deadline-context',{signal:controller.signal}).then(response=>response.ok?response.json():null)
      .then(body=>{if(!controller.signal.aborted && typeof body?.timezone==='string')setTimezone(body.timezone);}).catch(()=>{});
    return ()=>controller.abort();
  },[kind]);
  const change=(date:string,nextKind=kind,localTime=deadline?.localTime??null)=>{
    onChange(date);
    onDeadlineChange?.(date ? {...dateOnlyDeadline(date),kind:nextKind,localTime:nextKind==='time'?localTime:null} : null);
  };
  const fieldId = useWorkspaceFieldId();
  id = fieldId(id);
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <div className="flex flex-wrap gap-2">
      <Input {...inputProps} id={id} type="date" value={value} onChange={(event) => change(event.target.value)} readOnly={readOnly} className="h-9 min-w-0 flex-1 [color-scheme:light] dark:[color-scheme:dark]" />
      {onDeadlineChange && <select aria-label="Deadline type" disabled={readOnly || !value} value={kind} onChange={event=>change(value,event.target.value as OrderDeadline['kind'],event.target.value==='time'?deadline?.localTime??'':null)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring">
        <option value="date_only">Date only</option><option value="eod">EOD</option><option value="time">Specific time</option>
      </select>}
      {kind==='time' && <Input type="time" aria-label="Deadline local time" value={deadline?.localTime??''} readOnly={readOnly} onChange={event=>change(value,'time',event.target.value)} className="h-9 w-32 [color-scheme:light] dark:[color-scheme:dark]" />}
    </div>
    {kind!=='date_only' && <p className="text-xs text-muted-foreground">{kind==='eod'?'End of Day':'Local time'} · {deadline?.timezone ?? timezone ?? 'organization timezone; verified on save'}</p>}
    {kind==='time' && !deadline?.localTime && <p role="alert" className="text-xs text-destructive">Enter a specific local time.</p>}
    {footer}
  </div>;
}

export function OrderPriorityField({ id, value, onChange, readOnly = false }: Omit<SharedFieldProps, "footer" | "inputProps">) {
  const fieldId = useWorkspaceFieldId();
  id = fieldId(id);
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">Priority</label>
    <select id={id} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={value || "normal"} onChange={(event) => onChange(event.target.value)} disabled={readOnly}>
      <option value="rush">Rush</option>
      <option value="normal">Normal</option>
      <option value="low">Low</option>
    </select>
  </div>;
}
