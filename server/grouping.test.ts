import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByKanjiStrokes } from "./grouping";

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
