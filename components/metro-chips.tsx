import { describeLines, type RailLine } from "@/lib/metro";

/**
 * Line roundels as riders know them from station signs: circles for the
 * metro, rounded squares for the tram, so shape tells them apart, not colour.
 */
export function MetroChips({
  lines,
  label = (description) => `near ${description}`,
}: {
  lines: readonly RailLine[];
  /** Screen-reader words; `null` when the surrounding control already says it. */
  label?: ((description: string) => string) | null;
}) {
  if (lines.length === 0) return null;

  return (
    <span className="metro-layer metro-chips">
      {lines.map((line) => (
        <span
          aria-hidden="true"
          className={`metro-chip metro-chip-${line.toLowerCase()}`}
          key={line}
        >
          {line.slice(1)}
        </span>
      ))}
      {label && <span className="sr-only">{label(describeLines(lines))}</span>}
    </span>
  );
}
