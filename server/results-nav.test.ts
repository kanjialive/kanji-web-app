import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

//
// Why this file exists (2026-07-17).
//
// ArrowRight in a sorted view advanced currentGroup up to `groups.length - 1` — the last
// group that EXISTS. But the trailing groups start beyond maxScroll: the browser clamps the
// scroll, so they never reach the left inset. They are already fully on screen in the final
// viewport, with nothing left to scroll to.
//
// So the index desynchronised from the view. The view sat at the end while currentGroup
// kept climbing, and the next few ArrowLefts stepped back through groups that all clamped
// to the same scrollLeft and moved NOTHING. It read as though the extra ArrowRight presses
// had been cached and had to be paid back one for one. (grade:1 rsort: three such groups,
// so three dead presses, and a fourth to leave the group sitting exactly on maxScroll.)
//
// The bound must come from the SCROLLER (scrollWidth - offsetWidth), never from the element
// count. That is the whole fix, and it is one line, which is exactly why it needs a gate.
//
// The view layer has no test harness: this code is an inline <script> in an EJS template,
// and jsdom is a dependency this project will not take on for one function. So this reads
// the template that actually ships, lifts the function out of it, and runs it against plain
// objects — no DOM needed, because it only ever reads scrollWidth, offsetWidth and
// offsetLeft. Same spirit as stylesheet.test.ts: check the asset that ships, add nothing.
//

const EJS_PATH = path.join(__dirname, "views", "pages", "search.ejs");
const src = fs.readFileSync(EJS_PATH, "utf8");

type Scroller = { scrollWidth: number; offsetWidth: number };
type Group = { offsetLeft: number };

// Lift `_lastAlignableGroup(scroller, groups) { ... }` out of the template and make it
// callable. It closes over nothing, so this is the real shipped logic, not a copy of it.
function lift(name: string): (scroller: Scroller, groups: Group[]) => number {
  const m = src.match(new RegExp(`${name}\\(scroller, groups\\)\\s*\\{([\\s\\S]*?)\\n {6}\\},`));
  assert.ok(
    m,
    `could not find ${name}(scroller, groups) in views/pages/search.ejs. If it was renamed ` +
      `or reindented, update this pattern — do not delete the test.`,
  );
  return new Function("scroller", "groups", m![1]) as (s: Scroller, g: Group[]) => number;
}

const lastAlignableGroup = lift("_lastAlignableGroup");

// A viewport is always --content-width; the sheet is fixed at every window size.
const scroller = (scrollWidth: number): Scroller => ({ scrollWidth, offsetWidth: 1104 });
const groups = (...offsets: number[]): Group[] => offsets.map((offsetLeft) => ({ offsetLeft }));

test("nav stops at the last group that can reach the left inset, not the last that exists", () => {
  // grade:1 rsort, the geometry that was reported: 11 columns, 9 groups.
  // scrollWidth 3078, so maxScroll = 3078 - 1104 = 1974.
  const sc = scroller(3078);
  const gs = groups(0, 282, 564, 1128, 1692, 1974, 2256, 2538, 2820);

  assert.equal(
    lastAlignableGroup(sc, gs),
    5,
    'ArrowRight must stop at group "6" (offsetLeft 1974 = maxScroll). Groups 6, 7 and 8 ' +
      "start past maxScroll and can never be parked at the left inset — walking the index " +
      "into them is what banked the presses.",
  );
  assert.notEqual(lastAlignableGroup(sc, gs), gs.length - 1, "the old, wrong bound");
});

test("a group starting exactly on maxScroll is alignable", () => {
  // The boundary case, and the common one now that the grid is true: maxScroll always
  // lands on a column boundary, so the end group frequently starts exactly there.
  assert.equal(lastAlignableGroup(scroller(2208), groups(0, 282, 564, 846, 1104)), 4);
});

test("nav does not advance when everything already fits", () => {
  // maxScroll = 0: nothing to scroll, so the only alignable group is the first.
  assert.equal(lastAlignableGroup(scroller(1104), groups(0, 282, 564)), 0);
});

test("a single group is its own bound", () => {
  assert.equal(lastAlignableGroup(scroller(258), groups(0)), 0);
});
