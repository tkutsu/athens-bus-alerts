"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";

type Theme = "light" | "dark";
const THEME_CHANGE_EVENT = "oasa-theme-change";

function currentTheme(): Theme | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

function subscribeToTheme(onThemeChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
}

/** Applies and persists the user's explicit color-theme choice. */
export function ThemeSwitch() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    currentTheme,
    () => null,
  );

  const toggleTheme = () => {
    const root = document.documentElement;
    const currentTheme = root.dataset.theme === "dark" ? "dark" : "light";
    const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem("oasa-theme", nextTheme);
    } catch {
      // The active theme still works when storage is unavailable.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  const dark = theme === "dark";

  return (
    <button
      aria-checked={dark}
      aria-label={
        theme ? `Use ${dark ? "light" : "dark"} mode` : "Toggle color theme"
      }
      className="theme-switch"
      onClick={toggleTheme}
      role="switch"
      title={
        theme ? `Use ${dark ? "light" : "dark"} mode` : "Toggle color theme"
      }
      type="button"
    >
      <span aria-hidden="true" className="theme-switch-icon theme-switch-sun">
        <Icon className="size-3.5" name="sun" />
      </span>
      <span aria-hidden="true" className="theme-switch-icon theme-switch-moon">
        <Icon className="size-3.5" name="moon" />
      </span>
      <span aria-hidden="true" className="theme-switch-thumb" />
    </button>
  );
}
