import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * One definition of what a button looks like, shared by `Button` and `ButtonLink`.
 *
 * Kept outside button.tsx because that module is a client module: a function exported
 * from it cannot be called from a server component.
 */
const VARIANTS = {
  primary:
    "bg-ink text-on-ink hover:bg-ink-hover active:bg-ink-hover disabled:bg-ink-ghost",
  secondary:
    "border border-line-strong bg-surface text-ink hover:border-ink-ghost hover:bg-ground active:bg-sunken disabled:text-ink-ghost",
  danger:
    "border border-fail-border bg-surface text-fail-text hover:border-fail-text hover:bg-fail-surface active:bg-fail-surface disabled:text-fail-border",
} as const;

const SIZES = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2.5 text-sm",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

/**
 * A link that looks like a button. `<Link><Button/></Link>` put a button inside an
 * anchor — invalid HTML, and two stops on the same control for anyone using Tab.
 */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...rest} className={buttonClass(variant, size, className)} />;
}
