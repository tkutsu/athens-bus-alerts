"use client";

import { Fragment, useState } from "react";

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
    <span className={`flap-detail ${state.down ? "flap-roll-down" : "flap-roll-up"}`}>
      {[...text].map((glyph, slot) => (
        // Keyed by its character, so only the ones that change mount and roll.
        <span
          className={state.previous !== null && state.previous[slot] !== glyph ? "flap-roll" : undefined}
          key={`${slot}:${glyph}`}
        >
          {glyph}
        </span>
      ))}
    </span>
  );
}

function FaceText({ title, detail, live }: Face & { live?: { value: number | null } }) {
  return (
    <span className="flap-face">
      <span className="flap-title">{title}</span>
      {live ? (
        <RollingText text={detail} value={live.value} />
      ) : (
        <span className="flap-detail">{detail}</span>
      )}
    </span>
  );
}

/**
 * A station-board name plate. A new title turns the whole plate over like
 * one flap of a departure board: the top half falls on its hinge, and the
 * new bottom half lands with a small bounce. The detail rolls in place.
 */
export function FlapPlate({
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
  // The face being turned away, while the flap falls.
  const [leaving, setLeaving] = useState<Face | null>(null);
  const [flips, setFlips] = useState(0);

  if (title !== shown.title || detail !== shown.detail) {
    if (title !== shown.title && !prefersReducedMotion()) {
      setLeaving(shown);
      setFlips(flips + 1);
    }
    setShown({ title, detail });
  }

  const live = { value: detailValue };
  return (
    <span aria-hidden="true" className="flap-plate">
      <span className="flap-half flap-half-top">
        <FaceText key={shown.title} {...shown} live={live} />
      </span>
      <span className="flap-half flap-half-bottom">
        {leaving ? (
          <FaceText {...leaving} />
        ) : (
          <FaceText key={shown.title} {...shown} live={live} />
        )}
      </span>
      {/* Direct children of the plate, so its perspective reaches them. */}
      {leaving && (
        <Fragment key={flips}>
          <span className="flap-half flap-half-top flap-leaf flap-leaf-falling">
            <FaceText {...leaving} />
          </span>
          <span
            className="flap-half flap-half-bottom flap-leaf flap-leaf-landing"
            onAnimationEnd={(event) => {
              // Its shading ends earlier, and reports on this element too.
              if (event.animationName === "flap-land") setLeaving(null);
            }}
          >
            <FaceText {...shown} />
          </span>
        </Fragment>
      )}
    </span>
  );
}
