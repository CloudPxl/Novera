import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

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
      className={`rounded-panel border border-line bg-surface shadow-card ${
        interactive
          ? "transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card-hover"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * One badge vocabulary for the whole app.
 *
 * Verdict tones (pass/fail/error) and severity tones (critical/high/medium/low)
 * live in the same map deliberately: a `critical` badge must never be mistaken
 * for a `fail` badge at a glance, so they are picked side by side rather than
 * invented at two different call sites.
 */
const BADGE_TONES = {
  pass: "bg-pass-surface text-pass-text ring-pass-border",
  fail: "bg-fail-surface text-fail-text ring-fail-border",
  error: "bg-warning-surface text-warning-text ring-warning-border",
  neutral: "bg-neutral-surface text-neutral-text ring-neutral-border",
  live: "bg-info-surface text-info-text ring-info-border",
  critical: "bg-fail-surface text-fail-text ring-fail-border",
  high: "bg-high-surface text-high-text ring-high-border",
  medium: "bg-warning-surface text-warning-text ring-warning-border",
  low: "bg-neutral-surface text-neutral-text ring-neutral-border",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

/** Severities carry a dot so they read as a scale, not as four unrelated colours. */
const DOTTED: ReadonlySet<BadgeTone> = new Set(["critical", "high", "medium", "low"]);

export function Badge({
  tone = "neutral",
  children,
  pulse = false,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  const dot = pulse || DOTTED.has(tone);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]} ${pulse ? "novera-live" : ""} ${className}`}
    >
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// Solid token fills: a gradient on a proportion adds shine, not information, and raw
// palette steps did not follow the operator's dark theme.
const BAR_FILLS = {
  pass: "bg-pass-text",
  fail: "bg-fail-text",
  warning: "bg-warning-text",
  neutral: "bg-ink-soft",
} as const;

/**
 * A proportion, drawn.
 *
 * `max` of 0 renders an empty track rather than a full one: nothing planned is
 * not the same as everything done, and a full green bar over zero scenarios is
 * the single most misleading thing this component could draw.
 */
export function ProgressBar({
  value,
  max,
  tone = "neutral",
  label,
  className = "",
}: {
  value: number;
  max: number;
  tone?: keyof typeof BAR_FILLS;
  label: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-sunken ${className}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className={`novera-bar h-full rounded-full ${BAR_FILLS[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A figure with its label above it. The figure is tabular so it cannot reflow. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div>
      <p className="type-pill text-ink-faint">{label}</p>
      <p className="mt-1 text-xl font-semibold tnum text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{hint}</p>}
    </div>
  );
}

/**
 * Explanatory text on hover *and* on focus, with no JavaScript.
 *
 * The tooltip is never the only place a fact appears — it explains a label that
 * is already on screen. A keyboard or screen-reader user who never triggers it
 * loses nothing load-bearing.
 */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex items-center">
      <span tabIndex={0} className="inline-flex items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink">
        {children}
      </span>
      {/*
        `hidden` until shown, not merely transparent.
        A transparent tooltip still takes part in layout, and a 224px box centred on a
        trigger near the right edge pushed the page 28px wider than the viewport at
        390 — an invisible element causing a real horizontal scrollbar on every page
        that uses one. The width is also capped against the viewport so that showing
        it cannot reintroduce the same overflow on a narrow screen.
      */}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-56 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-control bg-ink px-2.5 py-1.5 text-xs leading-relaxed text-on-ink shadow-modal group-hover/tip:block group-focus-within/tip:block"
      >
        {text}
      </span>
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
    <div className="rounded-panel border border-dashed border-line-strong bg-ground/60 px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-soft">{children}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * A labelled control with a hint that is actually attached to it.
 *
 * The hint carries the part a person needs — how long the message may be, that a key is
 * encrypted, what a model id looks like. Rendered as a loose paragraph it is read by
 * everyone except the people who most need it: a screen reader announces the label and
 * the input and skips straight past the sentence explaining them.
 *
 * So the hint gets an id and the control is given `aria-describedby`. Only a real form
 * control is cloned — putting the attribute on a wrapping `<div>` would describe nothing
 * — and an existing `aria-describedby` is kept rather than replaced.
 */
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
  const hintId = hint && htmlFor ? `${htmlFor}-hint` : undefined;

  const described =
    hintId && isValidElement(children) && CONTROLS.has(children.type as string)
      ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
          "aria-describedby": [
            (children.props as { "aria-describedby"?: string })["aria-describedby"],
            hintId,
          ]
            .filter(Boolean)
            .join(" "),
        })
      : children;

  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-xs leading-relaxed text-ink-faint">
          {hint}
        </p>
      )}
      <div className="mt-1.5">{described}</div>
    </div>
  );
}

const CONTROLS = new Set(["input", "textarea", "select"]);

export const inputClass =
  "w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-ink focus:ring-1 focus:ring-ink";

/**
 * What a page shows while its data is on the way — one definition, not one per page.
 *
 * Announced once as a polite status, so a screen reader hears that something is loading
 * rather than silence. The bars are placeholders for layout only; they carry no numbers,
 * because a figure that is not yet loaded must never look like one that is zero.
 */
export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="py-8">
      <span className="sr-only">{label}…</span>
      <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-3 w-24 rounded bg-sunken" />
        <div className="h-7 w-2/3 max-w-sm rounded bg-sunken" />
        <div className="h-4 w-full max-w-xl rounded bg-sunken" />
        <div className="mt-6 h-24 w-full rounded-panel bg-sunken" />
        <div className="h-24 w-full rounded-panel bg-sunken" />
      </div>
    </div>
  );
}

/**
 * A page that failed — the sibling of `EmptyState`, for the case where there should
 * have been something and the request broke.
 *
 * It never prints the error's message: in production a server error reaches the browser
 * as a generic string plus a digest, and a client error's message can contain anything.
 * The digest is shown instead, because it is what matches the server's log line.
 */
export function ErrorState({
  title,
  children,
  reference,
  action,
  level = 2,
}: {
  title: string;
  children: ReactNode;
  reference?: string;
  action?: ReactNode;
  /** 1 when the error replaces the whole page and is therefore its only heading. */
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div role="alert" className="rounded-panel border border-fail-border bg-fail-surface px-6 py-10 text-center">
      <Heading className="text-base font-medium text-fail-text">{title}</Heading>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-soft">{children}</p>
      {reference && (
        // ink-soft, not ink-faint: faint measured 4.33:1 on the fail surface.
        <p className="mt-3 text-xs text-ink-soft">
          Reference <span className="font-mono">{reference}</span>
        </p>
      )}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}
