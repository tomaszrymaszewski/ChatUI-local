import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function StepHeader({
  target,
  title,
  subtitle,
  children,
}: {
  target: HTMLElement | null;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  if (!target) return null;
  return createPortal(
    <div className="flex flex-col items-center gap-2 text-center">
      {children}
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {subtitle && (
        <p className="max-w-md text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>,
    target,
  );
}

export function StepFooter({
  target,
  children,
}: {
  target: HTMLElement | null;
  children: ReactNode;
}) {
  if (!target) return null;
  return createPortal(children, target);
}
