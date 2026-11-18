"use client";

import { Icon } from "@/components/icon";
import { RootSwitch } from "@/components/root-switch";

/** Switches between light and dark, defaulting to the system theme. */
export function ThemeSwitch() {
  return (
    <RootSwitch
      attribute="theme"
      className="theme-switch"
      icons={[
        <Icon className="size-3.5" key="sun" name="sun" />,
        <Icon className="size-3.5" key="moon" name="moon" />,
      ]}
      label={(dark) =>
        dark === null
          ? "Toggle color theme"
          : `Use ${dark ? "light" : "dark"} mode`
      }
      storageKey="oasa-theme"
      values={["light", "dark"]}
    />
  );
}

/** Shows or hides the metro layer: stop chips, the closest-metro line and its heads-up. */
export function MetroSwitch() {
  return (
    <RootSwitch
      attribute="metro"
      className="metro-switch"
      icons={[null, <Icon className="size-3.5" key="train" name="train" />]}
      label={() => "Show metro"}
      storageKey="oasa-metro"
      values={["off", "on"]}
    />
  );
}
