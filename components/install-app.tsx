"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";

/** Chromium's install prompt event; not in the DOM typings yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallState = "installed" | "prompt" | "manual";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Chromium fires this once per page load, possibly before React hydrates, so
// catch it as soon as the module loads.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    justInstalled = true;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function installState(): InstallState {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone || justInstalled) return "installed";
  return deferredPrompt ? "prompt" : "manual";
}

/** Steps for browsers that never offer an install prompt to the page. */
function manualSteps(): string[] {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const android = ua.includes("Android");
  const firefox = /Firefox\/|FxiOS\//.test(ua);

  if (ios) {
    return [
      "Tap the Share button. In newer Safari it sits under the ⋯ menu.",
      "Scroll down and tap Add to Home Screen.",
      "Tap Add.",
    ];
  }
  if (android && firefox) {
    return [
      "Tap Firefox's ⋮ menu.",
      "Tap Add app to Home screen.",
      "Tap Add, or drag the icon to your home screen.",
    ];
  }
  if (android) {
    return [
      "Tap the browser's ⋮ menu.",
      "Tap Install app or Add to Home screen.",
      "Tap Install.",
    ];
  }
  if (firefox) {
    return [
      "Firefox on computers can't install web apps.",
      "Open this page in Chrome or Edge to install it, or bookmark it here.",
    ];
  }
  return [
    "Click the install icon at the right end of the address bar.",
    "Or open the browser menu and choose Install.",
  ];
}

/** Offers the native install prompt, or browser-specific steps where none exists. */
export function InstallApp() {
  const state = useSyncExternalStore(subscribe, installState, () => "installed");
  const [steps, setSteps] = useState<string[] | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (steps && !dialog.open) dialog.showModal();
    if (!steps && dialog.open) dialog.close();
  }, [steps]);

  if (state === "installed") return null;

  async function install() {
    if (!deferredPrompt) {
      setSteps(manualSteps());
      return;
    }
    const prompt = deferredPrompt;
    // A prompt can be shown only once; Chromium fires a fresh event if it's dismissed.
    deferredPrompt = null;
    notify();
    await prompt.prompt();
  }

  return (
    <>
      <button
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink/55 transition hover:text-signal"
        onClick={() => void install()}
        type="button"
      >
        Install
        <Icon name="install" className="size-4 shrink-0 -translate-y-px" />
      </button>

      <dialog
        aria-labelledby="install-heading"
        className="favorites-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setSteps(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSteps(null);
        }}
        onClose={() => setSteps(null)}
        ref={dialogRef}
      >
        <div className="favorites-sheet">
          <div className="flex items-center justify-between gap-3 border-b border-ink/15 pb-4">
            <div className="flex items-center gap-2">
              <Icon name="install" className="size-5 text-signal" />
              <h2 className="section-label text-signal" id="install-heading">
                Install the app
              </h2>
            </div>
            <button
              aria-label="Close install steps"
              className="flex size-10 items-center justify-center text-xl text-ink/60 hover:text-ink"
              onClick={() => setSteps(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <ol className="list-decimal space-y-2 py-4 pl-5 text-sm">
            {steps?.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <p className="text-xs text-ink/55">
            It opens full screen from your home screen, like any other app.
          </p>
        </div>
      </dialog>
    </>
  );
}
