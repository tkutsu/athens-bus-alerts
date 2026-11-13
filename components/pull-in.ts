/** The hop from the rail onto the stop, and when its crouch ends and it lands. */
const HOP_MS = 520;
const TAKEOFF = 0.16;
const LANDING = 0.86;

/**
 * Your bus pulling into the stop: a copy of its circle leaves the timeline,
 * hops onto the stop marker, shrinks into it, and the marker squashes and
 * ripples to welcome it. The copy lives on <body>, so the timeline's scroll
 * area can't clip it on the way up. Its face squeezes shut to crouch, goes
 * wide-eyed in the air, squeezes again on impact and smiles as it sinks in.
 */
export function pullIntoStop(bus: HTMLElement, stop: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const from = bus.getBoundingClientRect();
  const to = stop.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const at = (x: number, y: number, scale: string) =>
    `translate(${x}px, ${y}px) scale(${scale})`;

  const flyer = bus.cloneNode(true) as HTMLElement;
  flyer.classList.add("stop-landing-bus");
  flyer.dataset.face = "squeeze";
  Object.assign(flyer.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  });
  document.body.append(flyer);
  bus.style.visibility = "hidden";
  const face = (expression: string, atMs: number) =>
    window.setTimeout(() => (flyer.dataset.face = expression), atMs);
  face("wide", HOP_MS * TAKEOFF);
  face("squeeze", HOP_MS * LANDING);

  // Crouch, arc up over the stop, drop onto it and squash.
  const hop = flyer.animate(
    [
      { transform: at(0, 0, "1"), easing: "cubic-bezier(0.2, 0.8, 0.4, 1)" },
      { transform: at(0, 0, "1.14, 0.84"), offset: TAKEOFF, easing: "cubic-bezier(0.2, 0.6, 0.4, 1)" },
      { transform: at(dx * 0.85, dy - 22, "0.92, 1.08"), offset: 0.62, easing: "cubic-bezier(0.6, 0, 0.9, 0.5)" },
      { transform: at(dx, dy, "1.18, 0.8"), offset: LANDING, easing: "ease-out" },
      { transform: at(dx, dy, "1") },
    ],
    { duration: HOP_MS },
  );
  void hop.finished.then(() => {
    // A happy beat on the stop, then it sinks into the centre dot.
    flyer.dataset.face = "happy";
    const sink = flyer.animate(
      [
        { transform: at(dx, dy, "1") },
        { transform: at(dx, dy, "1"), offset: 0.5 },
        { transform: at(dx, dy, "0.2"), opacity: 0 },
      ],
      { duration: 380, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
    );
    void sink.finished.then(() => {
      flyer.remove();
      welcome(stop);
    }, () => flyer.remove());
  }, () => flyer.remove());
}

function welcome(stop: HTMLElement) {
  const timing = { duration: 560, easing: "ease-out" };
  stop.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.35, 0.7)", offset: 0.15 },
      { transform: "scale(0.9, 1.12)", offset: 0.45 },
      { transform: "scale(1.04, 0.97)", offset: 0.7 },
      { transform: "scale(1)" },
    ],
    timing,
  );
  stop.animate(
    [
      { boxShadow: "0 0 0 3px var(--paper), 0 0 0 3px rgb(var(--signal-rgb) / 0.6)" },
      { boxShadow: "0 0 0 3px var(--paper), 0 0 0 16px rgb(var(--signal-rgb) / 0)" },
    ],
    timing,
  );
}
