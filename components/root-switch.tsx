"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

interface RootSwitchProps {
  /** The `data-*` attribute on <html> holding the choice; the head script sets it before paint. */
  attribute: string;
  storageKey: string;
  /** The attribute's off and on values. */
  values: readonly [off: string, on: string];
  /** Names the switch for CSS, which keys its on state off the root attribute. */
  className: string;
  /** The accessible name; `null` while the page hasn't hydrated. */
  label: (on: boolean | null) => string;
  icons: readonly [off: ReactNode, on: ReactNode];
}

/** A two-state preference applied to <html>, saved locally and shared by every reader. */
export function RootSwitch({
  attribute,
  storageKey,
  values,
  className,
  label,
  icons,
}: RootSwitchProps) {
  const changeEvent = `oasa-${attribute}-change`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      window.addEventListener(changeEvent, onChange);
      return () => window.removeEventListener(changeEvent, onChange);
    },
    [changeEvent],
  );
  const on = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset[attribute] === values[1],
    () => null,
  );

  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset[attribute] === values[1] ? values[0] : values[1];
    root.dataset[attribute] = next;
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
    window.dispatchEvent(new Event(changeEvent));
  };

  return (
    <button
      aria-checked={on === true}
      aria-label={label(on)}
      className={`root-switch ${className}`}
      onClick={toggle}
      role="switch"
      title={label(on)}
      type="button"
    >
      <span aria-hidden="true" className="root-switch-icon root-switch-off">
        {icons[0]}
      </span>
      <span aria-hidden="true" className="root-switch-icon root-switch-on">
        {icons[1]}
      </span>
      <span aria-hidden="true" className="root-switch-thumb" />
    </button>
  );
}
