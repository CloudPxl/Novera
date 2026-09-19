"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Fades content up as it scrolls into view.
 *
 * Purely decorative: the content is in the DOM and readable regardless. If the
 * observer never fires — no IntersectionObserver, reduced motion, a bot — the
 * element is shown immediately rather than staying invisible. An animation must
 * never be the thing that makes content appear.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-shown={shown}
      style={{ animationDelay: `${delay}ms` }}
      className={`novera-reveal ${className}`}
    >
      {children}
    </div>
  );
}
