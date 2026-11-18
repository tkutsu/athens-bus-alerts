"use client";

import { useEffect, useRef, useState } from "react";

/** Changing letters turn one at a time, this far apart, left to right. */
const STAGGER_MS = 30;

/**
 * The slots `from` shows `elapsed` ms into turning to `to`, and whether all
 * have turned. Each letter that differs turns once, straight to its new one;
 * letters that stay the same don't hold up the ones after them.
 */
export function frame(from: readonly string[], to: readonly string[], elapsed: number) {
  const slots: string[] = [];
  let landed = true;
  let turn = 0;
  for (let slot = 0; slot < Math.max(from.length, to.length); slot++) {
    const source = from[slot] ?? "";
    const target = to[slot] ?? "";
    let glyph = target;
    if (source !== target) {
      if (elapsed < turn * STAGGER_MS) {
        landed = false;
        glyph = source;
      }
      turn++;
    }
    // Slots past the end of the shorter text come and go.
    if (glyph) slots.push(glyph);
  }
  return { slots, landed };
}

/**
 * Text that changes like a departure board: the letters that differ turn
 * over to their new ones one at a time, each dropping into its slot.
 */
export function FlapText({ className, text }: { className?: string; text: string }) {
  const [slots, setSlots] = useState(() => [...text]);
  const slotsRef = useRef(slots);

  useEffect(() => {
    // Picks up from whatever shows now, so a change mid-turn carries on smoothly.
    const from = slotsRef.current;
    const to = [...text];
    const show = (next: string[]) => {
      slotsRef.current = next;
      setSlots(next);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      show(to);
      return;
    }

    let request = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const { slots: next, landed } = frame(from, to, now - start);
      // Most frames fall between two turns and change nothing.
      if (next.join("") !== slotsRef.current.join("")) show(next);
      if (!landed) request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [text]);

  return (
    <span aria-hidden="true" className={`flap-text ${className ?? ""}`}>
      {slots.map((glyph, slot) => (
        // Keyed by its letter, so each new letter mounts and drops in.
        <span className="flap-glyph" key={`${slot}:${glyph}`}>
          {glyph}
        </span>
      ))}
    </span>
  );
}
