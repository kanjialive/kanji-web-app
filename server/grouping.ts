/**
 * Server-side grouping for the sorted (ksort / rsort) search views.
 */

export interface KanjiSearchResult {
  ka_id: string;
  ka_utf: string;
  kstroke: number;
  rad_utf: string;
  rad_stroke: number;
  rad_order: number;
  // Optional: only the grouped views project these, to name the grey radical glyph.
  rad_name_ja?: string;
  rad_name?: string;
  sortedIndex?: number;
}

export interface RadicalGroup {
  radical: string;
  rad_name_ja: string;
  rad_name: string;
  rows: KanjiSearchResult[][];
}

export interface StrokeGroup {
  stroke: number;
  columns: RadicalGroup[][];
}

/**
 * Order two stroke counts, either of which may be the NaN sentinel.
 *
 * `a - b` is NOT safe here. 々 holds `rad_stroke: NaN` meaning "no radical strokes", and
 * every comparison against it yields NaN. `Array.prototype.sort` reads a NaN result as
 * "not greater than zero", making the comparator INCONSISTENT: TimSort leaves runs
 * unmerged and the array comes back in pieces, so the rsort view restarts its stroke
 * headings mid-list. Reproduce at real size — V8 insertion-sorts below 22 elements, so a
 * small fixture passes while the page is wrong.
 *
 * Do NOT "fix" this by cleaning NaN out of the data. The sentinel is load-bearing:
 * search.ts turns `?rs=` into `{ rad_stroke: NaN }` because Mongo matches NaN to NaN,
 * and that is a real search.
 *
 * NaN sorts LAST — "no radical strokes" belongs after every known count. Ties compare
 * equal, keeping the comparator transitive so the caller's stable sort breaks them.
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
 * Group by stroke count, then subdivide by radical, into the grid the sorted views
 * render: one group per stroke count, each group a series of columns, each column up to
 * 10 rows of radicals, each radical up to 6 kanji per row.
 *
 * `data` must already be sorted — this walks it once and starts a new group whenever the
 * stroke value changes.
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

    // Object.is, not ===, so the NaN sentinel groups with itself instead of starting a
    // fresh heading for every document that carries it.
    if (currentGroup && Object.is(strokeValue, currentGroup.stroke)) {
      if (previousRadical && previousRadical.radical === kanji.rad_utf) {
        const lastRow = previousRadical.rows[previousRadical.rows.length - 1];

        if (lastRow.length < 6) {
          lastRow.push(kanji);
        } else {
          if (rowCount < 10) {
            previousRadical.rows.push([kanji]);
            rowCount++;
          } else {
            previousRadical = {
              radical: kanji.rad_utf,
              rad_name_ja: kanji.rad_name_ja,
              rad_name: kanji.rad_name,
              rows: [[kanji]],
            };
            currentGroup.columns.push([previousRadical]);
            rowCount = 1;
          }
        }
      } else {
        previousRadical = {
          radical: kanji.rad_utf,
          rad_name_ja: kanji.rad_name_ja,
          rad_name: kanji.rad_name,
          rows: [[kanji]],
        };

        if (rowCount < 10) {
          const lastColumn = currentGroup.columns[currentGroup.columns.length - 1];
          lastColumn.push(previousRadical);
          rowCount++;
        } else {
          currentGroup.columns.push([previousRadical]);
          rowCount = 1;
        }
      }
    } else {
      currentGroup = {
        stroke: strokeValue,
        columns: [
          [
            {
              radical: kanji.rad_utf,
              rad_name_ja: kanji.rad_name_ja,
              rad_name: kanji.rad_name,
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
 * Group by radical stroke count, then radical order.
 * compareStrokes(), not a bare subtraction — 々's rad_stroke is the NaN sentinel.
 */
export function groupByRadicalStrokes(
  data: KanjiSearchResult[]
): StrokeGroup[] {
  const sorted = [...data].sort(
    (a, b) =>
      compareStrokes(a.rad_stroke, b.rad_stroke) ||
      compareStrokes(a.rad_order, b.rad_order)
  );

  return groupByStrokeAndRadical(sorted, "rad_stroke");
}

/**
 * Group by kanji stroke count, then radical order.
 * No kanji holds kstroke: NaN today, but compareStrokes() is used anyway so a future
 * sentinel in this field cannot reopen the split-list bug in the ksort view.
 */
export function groupByKanjiStrokes(data: KanjiSearchResult[]): StrokeGroup[] {
  const sorted = [...data].sort(
    (a, b) =>
      compareStrokes(a.kstroke, b.kstroke) ||
      compareStrokes(a.rad_order, b.rad_order)
  );

  return groupByStrokeAndRadical(sorted, "kstroke");
}
