"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatDistance } from "@/lib/distance";
import { formatTransitName } from "@/lib/display";
import type { StopSummary } from "@/lib/types";

interface StopComboboxProps {
  isLoading: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (stop: StopSummary) => void;
  options: StopSummary[];
  query: string;
  resultTotal: number | null;
}

/** Combines nearby-stop selection and live name search in one control. */
export function StopCombobox({
  isLoading,
  onQueryChange,
  onSelect,
  options,
  query,
  resultTotal,
}: StopComboboxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const trimmedQuery = query.trim();
  const isSearch = trimmedQuery.length >= 2;
  const safeActiveIndex = Math.min(
    activeIndex,
    Math.max(0, options.length - 1),
  );

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  function choose(stop: StopSummary) {
    onSelect(stop);
    setIsOpen(false);
  }

  return (
    <div className="relative z-10 mt-3 shrink-0" ref={rootRef}>
      <label className="relative block">
        <span className="sr-only">Search and choose a stop</span>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute top-3.5 left-3 size-4 text-ink/40"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          aria-activedescendant={
            isOpen && options[safeActiveIndex]
              ? `${listId}-${options[safeActiveIndex].code}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={isOpen}
          aria-label="Search and choose a stop"
          className="field pl-9"
          onChange={(event) => {
            onQueryChange(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onClick={() => setIsOpen(true)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsOpen(false);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) =>
                Math.min(current + 1, Math.max(0, options.length - 1)),
              );
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
              return;
            }
            if (
              event.key === "Enter" &&
              isOpen &&
              options[safeActiveIndex]
            ) {
              event.preventDefault();
              choose(options[safeActiveIndex]);
            }
          }}
          placeholder="Search stop name"
          role="combobox"
          value={query}
        />
      </label>

      {isOpen && (
        <div
          className="absolute right-0 bottom-full left-0 z-[600] max-h-[min(18rem,45dvh)] overflow-y-auto border border-ink/20 bg-paper shadow-lg"
          id={listId}
          role="listbox"
        >
          <p className="border-b border-ink/10 px-3 py-2 text-xs font-semibold text-ink/50">
            {isSearch ? "Search results" : "Closest stops"}
          </p>
          {isLoading ? (
            <p className="px-3 py-4 text-sm text-ink/50">
              {isSearch ? "Searching..." : "Finding nearby stops..."}
            </p>
          ) : trimmedQuery.length === 1 ? (
            <p className="px-3 py-4 text-sm text-ink/50">
              Type one more letter.
            </p>
          ) : options.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink/50">
              {isSearch ? "No matching stops." : "No nearby stops found."}
            </p>
          ) : (
            options.map((stop, index) => (
              <button
                aria-selected={index === activeIndex}
                className={`flex w-full items-baseline justify-between gap-3 border-b border-ink/8 px-3 py-3 text-left last:border-0 ${
                  index === activeIndex ? "bg-signal/8" : "hover:bg-ink/4"
                }`}
                id={`${listId}-${stop.code}`}
                key={stop.code}
                onClick={() => choose(stop)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span className="min-w-0 truncate font-semibold text-ink">
                  {!isSearch && `${index + 1}. `}
                  {formatTransitName(stop.name)}
                </span>
                <span className="shrink-0 font-mono text-xs text-ink/55">
                  {formatDistance(stop.distanceMeters)}
                </span>
              </button>
            ))
          )}
          {isSearch && resultTotal !== null && resultTotal > 0 && (
            <p className="border-t border-ink/10 px-3 py-2 text-xs text-ink/45">
              Showing {options.length} of {resultTotal}, nearest first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
