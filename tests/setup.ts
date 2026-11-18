import "@testing-library/jest-dom/vitest";

// jsdom has no AnimationEvent, and without one React listens for the old
// prefixed event names instead of "animationend".
if (!("AnimationEvent" in window)) {
  class AnimationEvent extends Event {
    readonly animationName: string;

    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? "";
    }
  }
  Object.assign(window, { AnimationEvent });
}
