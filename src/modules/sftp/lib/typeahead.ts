/** Traditional explorer typeahead: printable keys accumulate into a short
 *  buffer and jump the selection to the first entry with a matching prefix.
 *
 *  - Matching is case-insensitive and wraps around the end of the list.
 *  - Repeatedly pressing the SAME letter cycles through its matches
 *    (buffer "ddd" behaves like pressing "d" again from the next row),
 *    mirroring Finder / Windows Explorer.
 *  - Returns -1 when nothing matches; callers keep the current selection.
 */
export function findTypeaheadMatch(
  names: string[],
  buffer: string,
  anchorIndex: number | null,
): number {
  if (names.length === 0 || buffer.length === 0) return -1;
  const query = buffer.toLowerCase();

  const allSameChar =
    query.length > 1 && query.split("").every((c) => c === query[0]);
  const needle = allSameChar ? query[0] : query;
  const from =
    allSameChar && anchorIndex !== null
      ? (anchorIndex + 1) % names.length
      : 0;

  for (let step = 0; step < names.length; step++) {
    const i = (from + step) % names.length;
    if (names[i]?.toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

/** How long (ms) a pause may be before the typeahead buffer resets. */
export const TYPEAHEAD_RESET_MS = 1000;
