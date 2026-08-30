import { useMemo, useState } from "react";
import { ArrowUp, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InputGroup } from "@/components/ui/input-group";
import type { StructuredInputRequest } from "@/lib/agent/types";

export function StructuredInputForm({
  request,
  onSubmit,
  onSwitchToText,
}: {
  request: StructuredInputRequest;
  onSubmit: (values: Record<string, unknown>) => void;
  onSwitchToText: () => void;
}) {
  const defaults = useMemo(() => {
    const d: Record<string, string | number | boolean> = {};
    for (const f of request.fields) {
      if (f.default !== undefined) d[f.name] = f.default;
      else if (f.type === "checkbox") d[f.name] = false;
      else d[f.name] = "";
    }
    return d;
  }, [request]);

  const [values, setValues] = useState<Record<string, string | number | boolean>>(defaults);

  const set = (name: string, value: string | number | boolean) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const missingRequired = request.fields.some(
    (f) =>
      f.required &&
      (values[f.name] === undefined ||
        values[f.name] === "" ||
        values[f.name] === false),
  );

  const submit = () => {
    if (missingRequired) return;
    const out: Record<string, unknown> = {};
    for (const f of request.fields) {
      const v = values[f.name];
      if (v !== undefined && v !== "") out[f.name] = v;
    }
    onSubmit(out);
  };

  return (
    <InputGroup className="h-auto max-h-[50vh] flex-col items-stretch gap-2 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{request.title}</span>
          {request.description && (
            <span className="truncate text-xs text-muted-foreground">
              {request.description}
            </span>
          )}
        </div>
        <button
          onClick={onSwitchToText}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Switch back to regular text input"
        >
          <SquarePen className="size-3.5" />
          Back to text
        </button>
      </div>

      <div className="grid gap-2.5">
        {request.fields.map((field) => (
          <div key={field.name} className="grid gap-1">
            <Label className="text-xs">
              {field.label}
              {field.required && <span className="ml-0.5 text-red-500">*</span>}
            </Label>
            {field.description && (
              <p className="text-[11px] text-muted-foreground">{field.description}</p>
            )}
            {field.type === "textarea" ? (
              <Textarea
                value={String(values[field.name] ?? "")}
                onChange={(e) => set(field.name, e.currentTarget.value)}
                className="min-h-16 text-sm"
              />
            ) : field.type === "select" ? (
              <Select
                value={String(values[field.name] ?? "")}
                onValueChange={(v) => set(field.name, v)}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "checkbox" ? (
              <div className="flex items-center gap-2">
                <Switch
                  checked={Boolean(values[field.name])}
                  onCheckedChange={(v) => set(field.name, v)}
                />
              </div>
            ) : (
              <Input
                type={field.type === "number" ? "number" : "text"}
                value={String(values[field.name] ?? "")}
                onChange={(e) =>
                  set(
                    field.name,
                    field.type === "number" ? Number(e.currentTarget.value) : e.currentTarget.value,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={missingRequired}>
          {request.submitLabel ?? "Submit"}
          <ArrowUp />
        </Button>
      </div>
    </InputGroup>
  );
}
