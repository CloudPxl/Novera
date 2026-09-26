"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button-link.tsx";

type Props = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
      className={buttonClass(variant, size, className)}
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
  variant?: ButtonVariant;
  size?: ButtonSize;
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
