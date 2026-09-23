"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";

const VARIANTS = {
  primary:
    "bg-slate-900 text-white hover:bg-slate-700 active:bg-slate-800 disabled:bg-slate-400",
  secondary:
    "border border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-400",
  danger:
    "border border-rose-300 bg-white text-rose-700 hover:border-rose-400 hover:bg-rose-50 active:bg-rose-100 disabled:text-rose-300",
} as const;

const SIZES = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2.5 text-sm",
} as const;

type Props = ComponentProps<"button"> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A submit button that knows its own form is in flight.
 *
 * `pendingLabel` is a separate word, not a spinner over the old label: a person who
 * clicked should be told what is happening, not just that something is.
 */
export function SubmitButton({
  children,
  pendingLabel = "Working…",
  variant = "primary",
  size = "md",
  className = "",
  disabled,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
  disabled?: boolean;
  /**
   * Carried into the submitted form data, so one form can offer two decisions
   * without a hidden field the buttons have to keep in sync.
   */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit" variant={variant} size={size} className={className}
      disabled={pending || disabled} name={name} value={value}
    >
      {pending && <Spinner />}
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
