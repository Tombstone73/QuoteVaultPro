import { useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SubjectVariableInputProps {
  value: string;
  onChange: (value: string) => void;
  variables: Array<{ token: string; label: string }>;
  placeholder?: string;
  maxLength?: number;
}

export function SubjectVariableInput({
  value,
  onChange,
  variables,
  placeholder = "Enter subject...",
  maxLength,
}: SubjectVariableInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const insertVariable = (token: string) => {
    if (!inputRef.current) return;

    const input = inputRef.current;
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;

    // Insert variable at cursor position
    const before = value.substring(0, start);
    const after = value.substring(end);
    const newValue = `${before}{{${token}}}${after}`;
    
    onChange(newValue);

    // Restore focus and cursor position after state update
    setTimeout(() => {
      input.focus();
      const newCursorPos = start + `{{${token}}}`.length;
      input.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  return (
    <div className="flex gap-2">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="flex-1"
      />
      <Select onValueChange={insertVariable}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Insert Variable" />
        </SelectTrigger>
        <SelectContent>
          {variables.map(({ token, label }) => (
            <SelectItem key={token} value={token}>
              <div className="flex flex-col">
                <code className="text-xs font-mono">{`{{${token}}}`}</code>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
