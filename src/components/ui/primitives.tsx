import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white ${
        interactive
          ? "transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_8px_24px_-12px_rgb(15_23_42/0.18)]"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

const BADGE_TONES = {
  pass: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  fail: "bg-rose-50 text-rose-700 ring-rose-600/20",
  error: "bg-amber-50 text-amber-800 ring-amber-600/20",
  neutral: "bg-slate-100 text-slate-700 ring-slate-500/20",
  live: "bg-sky-50 text-sky-700 ring-sky-600/20",
} as const;

export function Badge({
  tone = "neutral",
  children,
  pulse = false,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]} ${pulse ? "novera-live" : ""}`}
    >
      {pulse && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center">
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">{children}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-900">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900";
