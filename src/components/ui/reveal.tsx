"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Fades content up as it scrolls into view.
 *
 * Purely decorative: the content is in the DOM and readable regardless. If the
 * observer never fires — no IntersectionObserver, reduced motion, a bot — the element
 * is shown immediately rather than staying invisible. **An animation must never be the
 * thing that makes content appear**, and twice now that promise has been broken by
 * something invisible to inspection:
 *
 * `as` exists because the wrapper is not free of meaning. Wrapping each `<li>` of the
 * landing page's four-step list in a `<div>` put non-`li` children directly inside an
 * `<ol>`, which ends the list: a screen reader announced four unrelated paragraphs
 * instead of an ordered list of four steps. axe-core found it; looking at the page did
 * not.
 *
 * The sweep fallback exists because an IntersectionObserver reports *changes*. Jump
 * straight to the bottom of a page — the End key, an anchor link, a restored scroll
 * position — and an element goes from below the viewport to above it with no
 * intersecting frame in between. No callback fires, and that content stays at opacity
 * 0 for as long as the page is open. One shared passive scroll listener re-checks the
 * elements still waiting and reveals anything the viewport has already passed.
 */

/** Everything still waiting to be revealed, so the fallback costs one listener, not one per instance. */
const pending = new Set<{ node: Element; show: () => void }>();
let sweeping = false;

function sweep() {
  for (const entry of pending) {
    const rect = entry.node.getBoundingClientRect();
    // At or above the top of the viewport: the reader has already passed it.
    if (rect.bottom <= 0 || rect.top < window.innerHeight) {
      entry.show();
      pending.delete(entry);
    }
  }
  if (pending.size === 0 && sweeping) {
    window.removeEventListener("scroll", sweep);
    sweeping = false;
  }
}

function watch(entry: { node: Element; show: () => void }) {
  pending.add(entry);
  if (!sweeping) {
    window.addEventListener("scroll", sweep, { passive: true });
    sweeping = true;
  }
  return () => {
    pending.delete(entry);
  };
}

export function Reveal({
  children,
  delay = 0,
  className = "",
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  /** The element to render. Use the one the parent's content model requires. */
  as?: "div" | "li" | "section" | "article";
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!node || reduced || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Not only "it came into view": an element the viewport has already passed is
        // content the reader is entitled to, and it will get no further callback.
        if (entry.isIntersecting || entry.boundingClientRect.bottom <= 0) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    observer.observe(node);
    const unwatch = watch({
      node,
      show: () => {
        setShown(true);
        observer.disconnect();
      },
    });

    return () => {
      observer.disconnect();
      unwatch();
    };
  }, []);

  const Tag = as;

  return (
    <Tag
      ref={ref as React.Ref<never>}
      data-shown={shown}
      style={{ animationDelay: `${delay}ms` }}
      className={`novera-reveal ${className}`}
    >
      {children}
    </Tag>
  );
}
