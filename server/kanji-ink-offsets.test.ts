import { test } from "node:test";
import assert from "node:assert/strict";
import { KANJI_INK_DX } from "./kanji-ink-offsets";
import { videoMarginLeft } from "./html-routes";

/**
 * Horizontal ink corrections for the 60 stroke stills the maintainer approved.
 *
 * These tests pin the CONTRACT, not the maintainer's judgement. The list itself is his and
 * it MOVES (he revised 55 -> 60 on a second look, with no new data), so nothing here
 * asserts a specific count or a specific dx for a specific kanji — that would turn his
 * next revision into a red build. What is pinned is what code depends on:
 *   - an absent kanji means 6px, i.e. today's untouched rendering
 *   - a present kanji means 6 + dx
 *   - 応 is never corrected (the one known-WRONG candidate of the 73)
 */

test("every offset is a usable, non-zero, finite number", () => {
  for (const [kaId, dx] of Object.entries(KANJI_INK_DX)) {
    assert.match(kaId, /^ka_\d+$/, `${kaId} is not a ka_id`);
    assert.equal(typeof dx, "number", `${kaId} dx is not a number`);
    assert.ok(Number.isFinite(dx), `${kaId} dx is not finite`);
    assert.notEqual(dx, 0, `${kaId} dx is 0 — an entry that does nothing`);
  }
});

/**
 * 応's first stroke — the 丶 atop 广 — is centred to 0.43px and is the anchor the whole
 * character hangs from. The estimators were fooled by 广 sweeping left and called +15px,
 * which would shove that anchor to 138.6. It is the one correction of the 73 known to be
 * wrong, and the generator refuses to emit it. Guard it here too.
 */
test("応 (ka_542) is never corrected — the one known-wrong candidate", () => {
  assert.equal(KANJI_INK_DX["ka_542"], undefined);
  assert.equal(videoMarginLeft("ka_542"), 6);
});

test("a kanji with no correction keeps the 2013 nudge (6px) exactly", () => {
  // 水 / any uncorrected id: absent from the map -> today's behaviour, untouched.
  assert.equal(videoMarginLeft("ka_999999"), 6);
  assert.equal(videoMarginLeft(""), 6);
});

test("a corrected kanji gets 6px + its dx", () => {
  const [kaId, dx] = Object.entries(KANJI_INK_DX)[0];
  assert.equal(videoMarginLeft(kaId), 6 + dx);
});

/**
 * The corrections are ink-placement nudges, not layout changes. A value large enough to
 * push the artwork out of its column would mean the map has been corrupted or regenerated
 * from something other than the maintainer's review.
 */
test("no correction is large enough to be a layout change", () => {
  for (const [kaId, dx] of Object.entries(KANJI_INK_DX)) {
    assert.ok(Math.abs(dx) <= 25, `${kaId} dx=${dx} is implausibly large`);
  }
});

test("the map is frozen — offsets cannot be mutated at runtime", () => {
  assert.throws(() => {
    (KANJI_INK_DX as Record<string, number>)["ka_542"] = 15;
  }, TypeError);
});
