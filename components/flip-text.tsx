"use client";

import { useState } from "react";

interface Face {
  title: string;
  detail: string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Text whose changed characters roll one place, down when `value` falls and
 * up when it rises, like the drums of a counter.
 */
function RollingText({ text, value }: { text: string; value: number | null }) {
  const [state, setState] = useState({ text, value, previous: null as string | null, down: true });
  if (text !== state.text) {
    setState({
      text,
      value,
      previous: state.text,
      down: value === null || state.value === null || value <= state.value,
    });
  }

  return (
    <span className={`flip-detail ${state.down ? "flip-roll-down" : "flip-roll-up"}`}>
      {[...text].map((glyph, slot) => (
        // Keyed by its character, so only the ones that change mount and roll.
        <span
          className={state.previous !== null && state.previous[slot] !== glyph ? "flip-roll" : undefined}
          key={`${slot}:${glyph}`}
        >
          {glyph}
        </span>
      ))}
    </span>
  );
}

/**
 * A title and its detail, "ακροπολη · 300 meters". A new title turns over
 * like a card: the old one tips away, the new one turns in and settles.
 * The detail only rolls the characters that change.
 */
export function FlipText({
  title,
  detail,
  detailValue,
}: {
  title: string;
  detail: string;
  /** What `detail` measures, so its characters roll the right way. */
  detailValue: number | null;
}) {
  const [shown, setShown] = useState<Face>({ title, detail });
  // The face tipping away while the new one turns in.
  const [leaving, setLeaving] = useState<Face | null>(null);
  const [turns, setTurns] = useState(0);

  if (title !== shown.title || detail !== shown.detail) {
    if (title !== shown.title && !prefersReducedMotion()) {
      setLeaving(shown);
      setTurns(turns + 1);
    }
    setShown({ title, detail });
  }

  return (
    <span aria-hidden="true" className="flip-text">
      {leaving && (
        <span
          className="flip-face flip-out"
          key={`out-${turns}`}
          onAnimationEnd={() => setLeaving(null)}
        >
          <span className="flip-title">{leaving.title}</span>
          {leaving.detail && (
            <>
              <span className="flip-detail">·</span>
              <span className="flip-detail">{leaving.detail}</span>
            </>
          )}
        </span>
      )}
      {/* Keyed by title, so a new one mounts and turns in. */}
      <span className={`flip-face ${turns ? "flip-in" : ""}`} key={shown.title}>
        <span className="flip-title">{shown.title}</span>
        {shown.detail && (
          <>
            <span className="flip-detail">·</span>
            <RollingText text={shown.detail} value={detailValue} />
          </>
        )}
      </span>
    </span>
  );
}
