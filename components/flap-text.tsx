"use client";

import { useEffect, useRef, useState } from "react";

/** Each slot starts this long after the one before it, so changes ripple left to right. */
const STAGGER_MS = 18;
/** How long each passing letter shows before the next one drops in. The CSS
    drop is shorter, so each letter lands and rests before the next one falls. */
const FLIP_MS = 60;
/** Letters a slot passes through before it lands. */
const FLIPS = 4;

const GREEK = "αβγδεζηθικλμνξοπρστυφχψω";
const LATIN = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/** A passing letter from the same script as where the slot is heading. */
function passing(target: string, slot: number, flip: number): string {
  const glyphs = /\d/.test(target) ? DIGITS : /[α-ωά-ώ]/i.test(target) ? GREEK : LATIN;
  return glyphs[(slot * 7 + flip * 11) % glyphs.length];
}

/** The slots `from` shows `elapsed` ms into flipping to `to`, and whether all have landed. */
export function frame(from: readonly string[], to: readonly string[], elapsed: number) {
  const slots: string[] = [];
  let landed = true;
  for (let slot = 0; slot < Math.max(from.length, to.length); slot++) {
    const source = from[slot] ?? "";
    const target = to[slot] ?? "";
    const flip = Math.floor((elapsed - slot * STAGGER_MS) / FLIP_MS);
    let glyph = target;
    if (source !== target && flip < FLIPS) {
      landed = false;
      glyph = flip < 0 ? source : passing(target, slot, flip);
    }
    // Slots past the end of the shorter text come and go.
    if (glyph) slots.push(glyph);
  }
  return { slots, landed };
}

/**
 * Text that changes like a split-flap departure board: each letter that
 * differs flips through a few others before landing on the new one.
 */
export function FlapText({ className, text }: { className?: string; text: string }) {
  const [slots, setSlots] = useState(() => [...text]);
  const slotsRef = useRef(slots);

  useEffect(() => {
    // Picks up from whatever shows now, so a change mid-flip carries on smoothly.
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
      show(next);
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
