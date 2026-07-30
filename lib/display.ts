/** Lowercases stop and bus names without changing their stored identifiers. */
export function formatTransitName(name: string): string {
  return name.toLowerCase();
}
