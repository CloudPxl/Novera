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
