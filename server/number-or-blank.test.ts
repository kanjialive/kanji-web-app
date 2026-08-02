import { test } from "node:test";
import assert from "node:assert/strict";
import { numberOrBlank } from "./html-routes";

/**
 * The NaN sentinel must never reach the page.
 *
 * 229 kanji hold `grade: NaN` and 々 holds `rad_stroke: NaN`, meaning "no grade" / "no
 * radical strokes". Production renders both blank — not because anyone chose that, but
 * because its data crosses JSON on the way to Angular and JSON has no NaN literal, so the
 * driver turns NaN into null. The EJS frontend renders from the Mongo document directly, so
 * `<%= doc.grade %>` printed the literal string "NaN" onto 229 detail pages until 2026-07-16.
 *
 * The fix belongs HERE, in the view layer, and NOWHERE ELSE. The sentinel is load-bearing:
 * search.ts turns `?grade=` into `{ grade: NaN }` because Mongo matches NaN to NaN, and
 * that is a real search returning those 229 kanji. Removing NaN from the data would render
 * the pages correctly and silently break the search.
 */

test("the NaN sentinel renders blank, as production does", () => {
  assert.equal(numberOrBlank(NaN), "");
  assert.equal(numberOrBlank(Number.NaN), "");
  assert.equal(numberOrBlank(0 / 0), "");
});

test("real values pass through untouched", () => {
  assert.equal(numberOrBlank(0), 0); // grade 0 is falsy — must NOT become blank
  assert.equal(numberOrBlank(1), 1);
  assert.equal(numberOrBlank(2), 2);
  assert.equal(numberOrBlank(5), 5);
  assert.equal(numberOrBlank(-1), -1); // 々's rad_order sentinel: not NaN, not ours to hide
});

test("non-numbers are left alone", () => {
  assert.equal(numberOrBlank("n/a"), "n/a");
  assert.equal(numberOrBlank(""), "");
  assert.equal(numberOrBlank(null), null);
  assert.equal(numberOrBlank(undefined), undefined);
});

/**
 * Guards the obvious wrong implementations. `isNaN("abc")` is true (it coerces), so a check
 * written with the global isNaN would blank out any non-numeric string it touched.
 */
test("a coercing isNaN check would break these — it must not coerce", () => {
  assert.equal(numberOrBlank("abc"), "abc");
  assert.equal(numberOrBlank("n/a"), "n/a");
  const obj = {};
  assert.equal(numberOrBlank(obj), obj); // same reference back, untouched
});
