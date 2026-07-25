import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupByKanjiStrokes,
  groupByRadicalStrokes,
  KanjiSearchResult,
} from "./grouping";

// Characterization test: locks in the CURRENT output of the grid-packing
// algorithm, not a hand-derived ideal. If the algorithm is intentionally
// changed, rewrite these expectations wholesale (see plans/001).
const sample = [
  { ka_id: "kanji_1", ka_utf: "a", kstroke: 1, rad_utf: "R1", rad_stroke: 1, rad_order: 1 },
  { ka_id: "kanji_2", ka_utf: "b", kstroke: 1, rad_utf: "R1", rad_stroke: 1, rad_order: 1 },
  { ka_id: "kanji_3", ka_utf: "c", kstroke: 2, rad_utf: "R2", rad_stroke: 2, rad_order: 2 },
];

test("groupByKanjiStrokes produces one group per distinct stroke count", () => {
  const result = groupByKanjiStrokes(sample);
  assert.equal(result.length, 2);
  assert.equal(result[0].stroke, 1);
  assert.equal(result[1].stroke, 2);
});

test("groupByKanjiStrokes packs same-radical same-stroke kanji into one row", () => {
  const result = groupByKanjiStrokes(sample);
  const firstRadical = result[0].columns[0][0];
  assert.equal(firstRadical.radical, "R1");
  assert.deepEqual(
    firstRadical.rows[0].map((k) => k.ka_utf),
    ["a", "b"]
  );
});

test("groupByKanjiStrokes starts a new stroke group for a different radical", () => {
  const result = groupByKanjiStrokes(sample);
  assert.equal(result[1].columns[0][0].radical, "R2");
});

/**
 * The NaN sentinel must not corrupt the sort.
 *
 * 々 holds `rad_stroke: NaN` meaning "no radical strokes". A bare `a - b` comparator
 * returns NaN for every comparison against it, and Array.prototype.sort reads NaN as
 * "not greater than zero" — an INCONSISTENT comparator, which leaves TimSort's runs
 * unmerged and hands back an array sorted in pieces. The rsort view then printed its
 * stroke headings 1…17, NaN, and then 1…17 all over again.
 *
 * ⚠️ Reproduce at REAL SIZE. TimSort runs a plain insertion sort below 22 elements, so
 * a three-item fixture sorts correctly no matter how broken the comparator is and the
 * test passes while the app is visibly wrong. The corpus below is the size of the real
 * collection.
 *
 * Seen red: restoring `if (a.rad_stroke !== b.rad_stroke) return a.rad_stroke - b.rad_stroke`
 * fails "does not split the sorted list" with 35 groups where 17 are expected.
 */
function corpus(n: number): KanjiSearchResult[] {
  const data: KanjiSearchResult[] = [];
  for (let i = 0; i < n; i++) {
    data.push({
      ka_id: `kanji_${i}`,
      ka_utf: String.fromCharCode(0x4e00 + i),
      kstroke: (i % 20) + 1,
      rad_utf: `R${i % 40}`,
      rad_stroke: (i % 17) + 1,
      rad_order: (i % 40) + 1,
    });
  }
  return data;
}

// 々 as the collection actually stores it: a real kanji stroke count, no radical strokes.
const noma: KanjiSearchResult = {
  ka_id: "kanji_noma",
  ka_utf: "々",
  kstroke: 3,
  rad_utf: "々",
  rad_stroke: NaN,
  rad_order: -1,
};

// 々 sits in the MIDDLE of the input, which is where a search would put it — at either
// end the broken comparator has nothing to strand behind it and the bug hides.
function withNoma(n: number): KanjiSearchResult[] {
  const data = corpus(n);
  const half = Math.floor(n / 2);
  return [...data.slice(0, half), noma, ...data.slice(half)];
}

test("the NaN radical-stroke sentinel does not split the sorted list", () => {
  const groups = groupByRadicalStrokes(withNoma(1235));
  const headings = groups.map((g) => String(g.stroke));

  assert.deepEqual(
    headings.filter((h, i) => headings.indexOf(h) !== i),
    [],
    "a stroke heading repeated means the results came back sorted in pieces"
  );
  // 17 distinct radical-stroke counts in the corpus, plus 々's blank one.
  assert.equal(groups.length, 18);
});

test("々 forms exactly one group and sorts after every known stroke count", () => {
  const groups = groupByRadicalStrokes(withNoma(229));
  const nanGroups = groups.filter((g) => Number.isNaN(g.stroke));

  assert.equal(nanGroups.length, 1, "the sentinel must not fragment into a group each");
  assert.equal(
    groups[groups.length - 1],
    nanGroups[0],
    '"no radical strokes" belongs after the known counts, not before the 1-stroke radicals'
  );
  assert.equal(nanGroups[0].columns[0][0].rows[0][0].ka_utf, "々");
});

test("the ksort view is unaffected by a radical-stroke sentinel", () => {
  // 々's kstroke is a real number, so its ksort heading is 3 like any other kanji.
  const groups = groupByKanjiStrokes(withNoma(229));
  const headings = groups.map((g) => String(g.stroke));

  assert.deepEqual(
    headings.filter((h, i) => headings.indexOf(h) !== i),
    [],
    "ksort must not repeat a stroke heading either"
  );
  assert.ok(!headings.includes("NaN"), "no kanji holds kstroke: NaN");
});
