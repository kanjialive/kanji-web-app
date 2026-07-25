/**
 * Server-side grouping logic for kanji search results.
 * Ported from static/js/services.js to TypeScript.
 */

export interface KanjiSearchResult {
  ka_id: string;
  ka_utf: string;
  kstroke: number;
  rad_utf: string;
  rad_stroke: number;
  rad_order: number;
  sortedIndex?: number;
}

export interface RadicalGroup {
  radical: string;
  rows: KanjiSearchResult[][];
}

export interface StrokeGroup {
  stroke: number;
  columns: RadicalGroup[][];
}

/**
 * Order two stroke counts, either of which may be the NaN sentinel.
 *
 * 🔴 `a - b` is NOT safe here. 々 holds `rad_stroke: NaN` meaning "no radical strokes"
 * (see html-routes.ts → numberOrBlank), and every comparison against it yields NaN.
 * `Array.prototype.sort` reads a NaN result as "not greater than zero", so the
 * comparator becomes INCONSISTENT: TimSort leaves runs unmerged and the sorted array
 * comes back in pieces. With 々 anywhere in a 229+ result set the rsort view printed
 * its stroke headings 1…17, NaN, then 1…17 all over again.
 *
 * Production never had to solve this: its data reaches AngularJS as JSON, NaN becomes
 * null, and `null - null` is 0 — a consistent comparator by accident. Rendering from
 * the Mongo document directly loses that accident, exactly as it does for display.
 *
 * ⚠️ Do NOT "fix" this by cleaning NaN out of the data. The sentinel is load-bearing:
 * search.ts turns `?rs=n/a` into `{ rad_stroke: NaN }` because Mongo matches NaN to
 * NaN, and that is a real search.
 *
 * NaN sorts LAST — "no radical strokes" belongs after every known count, not before
 * the 1-stroke radicals. Ties (both NaN) compare equal, which keeps the comparator
 * transitive and lets the caller's stable sort break them.
 */
function compareStrokes(a: number, b: number): number {
  const aUnknown = Number.isNaN(a);
  const bUnknown = Number.isNaN(b);
  if (aUnknown || bUnknown) {
    if (aUnknown && bUnknown) return 0;
    return aUnknown ? 1 : -1;
  }
  return a - b;
}

/**
 * Groups kanji by stroke count (either kanji strokes or radical strokes),
 * then subdivides by radical character.
 *
 * The algorithm creates a grid layout:
 * - Each stroke count is a group
 * - Within each group, kanji are organized into columns
 * - Each column contains up to 10 rows of radicals
 * - Each radical can have up to 6 kanji per row
 *
 * @param data - Array of kanji search results
 * @param strokeKey - 'kstroke' for kanji strokes, 'rad_stroke' for radical strokes
 * @returns Array of stroke groups with nested columns and rows
 */
function groupByStrokeAndRadical(
  data: KanjiSearchResult[],
  strokeKey: "kstroke" | "rad_stroke"
): StrokeGroup[] {
  const groups: StrokeGroup[] = [];
  let currentGroup: StrokeGroup | null = null;
  let previousRadical: RadicalGroup | null = null;
  let rowCount = 1;

  for (let i = 0; i < data.length; i++) {
    const kanji = data[i];
    kanji.sortedIndex = i;

    const strokeValue = kanji[strokeKey];

    // Check if we're still in the same stroke group.
    // Object.is, not ===, so the NaN sentinel groups with itself instead of
    // starting a fresh heading for every document that carries it.
    if (currentGroup && Object.is(strokeValue, currentGroup.stroke)) {
      // Check if radical character is the same as the previous one
      if (previousRadical && previousRadical.radical === kanji.rad_utf) {
        const lastRow = previousRadical.rows[previousRadical.rows.length - 1];

        // Try to add to the last row (max 6 kanji per row)
        if (lastRow.length < 6) {
          lastRow.push(kanji);
        } else {
          // Last row is full, try to create a new row
          if (rowCount < 10) {
            previousRadical.rows.push([kanji]);
            rowCount++;
          } else {
            // Need to move to a new column
            previousRadical = {
              radical: kanji.rad_utf,
              rows: [[kanji]],
            };
            currentGroup.columns.push([previousRadical]);
            rowCount = 1;
          }
        }
      } else {
        // Different radical character, create a new radical group
        previousRadical = {
          radical: kanji.rad_utf,
          rows: [[kanji]],
        };

        if (rowCount < 10) {
          // Add to the current column
          const lastColumn = currentGroup.columns[currentGroup.columns.length - 1];
          lastColumn.push(previousRadical);
          rowCount++;
        } else {
          // Need to move to a new column
          currentGroup.columns.push([previousRadical]);
          rowCount = 1;
        }
      }
    } else {
      // New stroke group
      currentGroup = {
        stroke: strokeValue,
        columns: [
          [
            {
              radical: kanji.rad_utf,
              rows: [[kanji]],
            },
          ],
        ],
      };
      groups.push(currentGroup);
      rowCount = 1;
      previousRadical = currentGroup.columns[0][0];
    }
  }

  return groups;
}

/**
 * Groups kanji by radical stroke count.
 * Results should be pre-sorted by rad_stroke, rad_order.
 */
export function groupByRadicalStrokes(
  data: KanjiSearchResult[]
): StrokeGroup[] {
  // Sort by radical strokes, then by radical order.
  // compareStrokes(), not a bare subtraction — 々's rad_stroke is NaN.
  const sorted = [...data].sort(
    (a, b) =>
      compareStrokes(a.rad_stroke, b.rad_stroke) ||
      compareStrokes(a.rad_order, b.rad_order)
  );

  return groupByStrokeAndRadical(sorted, "rad_stroke");
}

/**
 * Groups kanji by kanji stroke count.
 * Results should be pre-sorted by kstroke, rad_order.
 */
export function groupByKanjiStrokes(data: KanjiSearchResult[]): StrokeGroup[] {
  // Sort by kanji strokes, then by radical order.
  // No kanji currently holds kstroke: NaN, but the same comparator is used so a
  // future sentinel in this field cannot reopen the rsort bug in the ksort view.
  const sorted = [...data].sort(
    (a, b) =>
      compareStrokes(a.kstroke, b.kstroke) ||
      compareStrokes(a.rad_order, b.rad_order)
  );

  return groupByStrokeAndRadical(sorted, "kstroke");
}
