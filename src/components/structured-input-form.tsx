import { useEffect, useMemo, useState } from "react";
import { ArrowUp, FolderOpen, SquarePen } from "lucide-react";
import { toast } from "sonner";
import { open as openDirectoryPicker } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { InputGroup } from "@/components/ui/input-group";
import type { StructuredInputRequest } from "@/lib/agent/types";
import {
  CUSTOM_OPTION_VALUE,
  isMissingRequired,
  resolveFieldValue,
  selectItems,
} from "@/lib/structured-input";
import { cn } from "@/lib/utils";

/**
 * One-question-at-a-time stepper for request_structured_input. Each field is
 * its own step with all options visible right away (selects render as a
 * radio list ending in Custom…, never a dropdown); answering advances to the
 * next question. Shared by chat and agent-mode runs — the tool and this card
 * are profile-independent.
 */
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

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string | number | boolean>>(defaults);
  // Free text behind each select's trailing Custom… entry.
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});

  // A new request starts over from its first question.
  useEffect(() => {
    setStep(0);
    setValues(defaults);
    setCustomTexts({});
  }, [request, defaults]);

  const set = (name: string, value: string | number | boolean) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const resolved = (f: StructuredInputRequest["fields"][number]) =>
    resolveFieldValue(f, values[f.name], customTexts[f.name] ?? "");

  const answered = (f: StructuredInputRequest["fields"][number]) => {
    const v = resolved(f);
    return v !== undefined && v !== "" && v !== false;
  };

  const submit = () => {
    if (request.fields.some((f) => isMissingRequired(f, resolved(f)))) return;
    const out: Record<string, unknown> = {};
    for (const f of request.fields) {
      const v = resolved(f);
      if (v !== undefined && v !== "") out[f.name] = v;
    }
    onSubmit(out);
  };

  const fields = request.fields;
  const field = fields[Math.min(step, Math.max(fields.length - 1, 0))];
  const last = step >= fields.length - 1;

  const advance = () => {
    if (!field) {
      submit();
      return;
    }
    if (field.required && !answered(field)) return;
    if (last) submit();
    else setStep(step + 1);
  };

  const nextLabel = !field
    ? (request.submitLabel ?? "Submit")
    : last
      ? (request.submitLabel ?? "Submit")
      : !field.required && !answered(field)
        ? "Skip"
        : "Next";

  return (
    <InputGroup className="h-auto max-h-[50vh] flex-col items-stretch gap-3 overflow-y-auto p-3">
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

      {fields.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Question {step + 1} of {fields.length}
          </span>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${((step + 1) / fields.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {field && (
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
          ) : field.type === "directory" ? (
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="/absolute/path/to/folder"
                value={String(values[field.name] ?? "")}
                onChange={(e) => set(field.name, e.currentTarget.value)}
                className="font-mono text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    advance();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={async () => {
                  try {
                    const dir = await openDirectoryPicker({
                      directory: true,
                      title: field.label,
                    });
                    if (typeof dir === "string") set(field.name, dir);
                  } catch {
                    toast.error("Folder picker is only available in the desktop app");
                  }
                }}
              >
                <FolderOpen />
                Choose…
              </Button>
            </div>
          ) : field.type === "select" ? (
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={field.label}>
              {selectItems(field.options).map((item) => {
                const selected = values[field.name] === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      set(field.name, item.value);
                      // A picked option answers the question — move on (the
                      // last step stays put for an explicit Submit).
                      if (item.value !== CUSTOM_OPTION_VALUE && step < fields.length - 1) {
                        setStep(step + 1);
                      }
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors",
                      selected
                        ? "border-foreground/40 bg-muted/60"
                        : "hover:border-foreground/20 hover:bg-muted/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border",
                        selected ? "border-primary" : "border-muted-foreground/40",
                      )}
                    >
                      {selected && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0 flex-1">{item.label}</span>
                  </button>
                );
              })}
              {values[field.name] === CUSTOM_OPTION_VALUE && (
                <Input
                  autoFocus
                  type="text"
                  placeholder="Write your own answer…"
                  value={customTexts[field.name] ?? ""}
                  onChange={(e) => {
                    // Read the value now: the updater below may run after
                    // React nulls the event's currentTarget.
                    const next = e.currentTarget.value;
                    setCustomTexts((prev) => ({ ...prev, [field.name]: next }));
                  }}
                  className="text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      advance();
                    }
                  }}
                />
              )}
            </div>
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
                  advance();
                }
              }}
            />
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={step === 0}
          onClick={() => setStep(Math.max(step - 1, 0))}
        >
          Back
        </Button>
        <Button
          size="sm"
          onClick={advance}
          disabled={!!field && field.required && !answered(field)}
        >
          {nextLabel}
          <ArrowUp />
        </Button>
      </div>
    </InputGroup>
  );
}
