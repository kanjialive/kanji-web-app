import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBasicQuery, parseAdvancedQuery, StringDict } from "./search";

test("generateBasicQuery builds an $or over the four search fields", () => {
  assert.deepEqual(generateBasicQuery("a"), {
    $or: [
      { meaning_search: { $in: ["a"] } },
      { ka_utf: "a" },
      { kunyomi_ja_search: { $in: ["a"] } },
      { onyomi_ja_search: { $in: ["a"] } },
    ],
  });
});

// An unusable numeric operand MATCHES NOTHING — it is never dropped. Dropping it
// silently broadens a combined query to the surviving terms (?grade=n/a&ks=3 ran as
// ?ks=3), while the search box repaints the term as though it had been searched.
test("parseAdvancedQuery turns an unusable numeric operand into a match-nothing clause", () => {
  assert.deepEqual(parseAdvancedQuery({ ks: "3" }), { kstroke: 3 });
  assert.deepEqual(parseAdvancedQuery({ ks: "abc" }), { kstroke: { $in: [] } });
  assert.deepEqual(parseAdvancedQuery({ grade: "n/a" }), { grade: { $in: [] } });
  assert.deepEqual(parseAdvancedQuery({ grade: "N/A" }), { grade: { $in: [] } });
});

// Full-string parse. parseInt reads digits until it hits a letter and calls that
// success, so grade:3abc and grade:3.5 ran as grade:3 — a documented-wrong search
// and a correct one giving the same answer. Whitespace is trimmed (copied URLs).
test("parseAdvancedQuery does not truncate a partial numeric operand", () => {
  assert.deepEqual(parseAdvancedQuery({ grade: "3abc" }), { grade: { $in: [] } });
  assert.deepEqual(parseAdvancedQuery({ grade: "3.5" }), { grade: { $in: [] } });
  assert.deepEqual(parseAdvancedQuery({ ks: " 3 " }), { kstroke: 3 });
});

// Pins the end of silent broadening: the unusable term stays in the filter and
// forces zero results, instead of vanishing and running the other term alone.
test("an unusable term in a combined query forces zero results, never a broadened search", () => {
  assert.deepEqual(parseAdvancedQuery({ grade: "n/a", ks: "3" }), {
    grade: { $in: [] },
    kstroke: 3,
  });
});

// The 229 gradeless kanji are stored with grade = NaN, and Mongo matches NaN to
// NaN, so { grade: NaN } IS the "no grade" search — production has served it for
// years via an unguarded parseInt(""). A previous hardening pass dropped the key
// instead, which collapsed the filter to {} and tripped the empty-query guard in
// private-api.ts, so ?grade= returned "No kanji found."
// ?key= is the ONE spelling for absence, on every key; n/a is an ordinary operand.
test("parseAdvancedQuery maps a valueless grade to NaN (the 229 gradeless kanji)", () => {
  const parsed = parseAdvancedQuery({ grade: "" }) as { grade?: number };
  assert.ok("grade" in parsed, "grade key must survive an empty operand");
  assert.ok(Number.isNaN(parsed.grade), `grade must be NaN, got ${String(parsed.grade)}`);
});

test("parseAdvancedQuery still parses a real grade", () => {
  assert.deepEqual(parseAdvancedQuery({ grade: "1" }), { grade: 1 });
});

// An empty array-key operand is an ABSENCE search and must bypass the suffix rule:
// "" has no alphanumerics, so the rule below would send it to the Japanese index —
// which does not exist for meaning or rad_meaning (0 of 1,235 docs), silently
// returning 0. The romaji index exists on all 1,235 and stores absence as "".
test("an empty array-key operand routes to the romaji _search index, never _ja_search", () => {
  const pairs: StringDict = {
    kem: "meaning",
    rem: "rad_meaning",
    on: "onyomi",
    kun: "kunyomi",
    rpos: "rad_position",
    rjn: "rad_name",
  };
  for (const key in pairs) {
    assert.deepEqual(
      parseAdvancedQuery({ [key]: "" }),
      { [`${pairs[key]}_search`]: { $in: [""] } },
      `?${key}= must ask the romaji index for the "" absence marker`
    );
  }
});

test("parseAdvancedQuery maps the string key (kanji) to ka_utf", () => {
  assert.deepEqual(parseAdvancedQuery({ kanji: "水" }), { ka_utf: "水" });
});

// Search is case-insensitive: the hidden *_search arrays are a lowercase index, so
// the operand is lower-cased to match. Before this, ?kem=Buddha and ?kem=Shinto
// returned nothing at all, and "Buddhist" found 坊 but not 寺.
test("parseAdvancedQuery lower-cases the operand (case-insensitive search)", () => {
  for (const typed of ["Buddha", "buddha", "BUDDHA", "bUdDhA"]) {
    assert.deepEqual(
      parseAdvancedQuery({ kem: typed }),
      { meaning_search: { $in: ["buddha"] } },
      `?kem=${typed} must search for "buddha"`
    );
  }
  assert.deepEqual(parseAdvancedQuery({ rem: "Katakana Tsu" }), {
    rad_meaning_search: { $in: ["katakana tsu"] },
  });
  assert.deepEqual(parseAdvancedQuery({ text: "GWK" }), {
    textbook_search: { $in: ["gwk"] },
  });
});

// Lower-casing is a no-op for kana and kanji — "みず".toLowerCase() === "みず" — which
// is precisely WHY it is safe here. It must not disturb Japanese matching.
//
// ⚠️ Do not "improve" this into a Mongo case-insensitive collation. Tested and
// rejected: {locale:"en", strength:2} treats hiragana and katakana as EQUAL (they
// differ only at the tertiary level, the same level as letter case), so a search for
// すい matched the katakana onyomi スイ — 6 hits where there should be 0. That would
// blur the on'yomi/kun'yomi distinction across the whole app.
test("lower-casing leaves Japanese operands byte-identical", () => {
  assert.deepEqual(parseAdvancedQuery({ kun: "みず" }), {
    kunyomi_ja_search: { $in: ["みず"] },
  });
  assert.deepEqual(parseAdvancedQuery({ on: "スイ" }), {
    onyomi_ja_search: { $in: ["スイ"] },
  });
  // hiragana must NOT be folded into katakana
  assert.notDeepEqual(parseAdvancedQuery({ on: "すい" }), {
    onyomi_ja_search: { $in: ["スイ"] },
  });
  // the kanji character itself is an exact match, not a text search
  assert.deepEqual(parseAdvancedQuery({ kanji: "画" }), { ka_utf: "画" });
});

test("generateBasicQuery lower-cases the English branch, leaves the rest exact", () => {
  assert.deepEqual(generateBasicQuery("Japan"), {
    $or: [
      { meaning_search: { $in: ["japan"] } },
      { ka_utf: "Japan" },
      { kunyomi_ja_search: { $in: ["japan"] } },
      { onyomi_ja_search: { $in: ["japan"] } },
    ],
  });
  // a Japanese basic search is untouched by the lower-casing
  assert.deepEqual(generateBasicQuery("みず"), {
    $or: [
      { meaning_search: { $in: ["みず"] } },
      { ka_utf: "みず" },
      { kunyomi_ja_search: { $in: ["みず"] } },
      { onyomi_ja_search: { $in: ["みず"] } },
    ],
  });
});

test("parseAdvancedQuery uses _search suffix for alphanumeric array operands", () => {
  assert.deepEqual(parseAdvancedQuery({ on: "shin" }), {
    onyomi_search: { $in: ["shin"] },
  });
});

test("parseAdvancedQuery uses _ja_search suffix for non-alphanumeric array operands", () => {
  assert.deepEqual(parseAdvancedQuery({ on: "しん" }), {
    onyomi_ja_search: { $in: ["しん"] },
  });
});

test("parseAdvancedQuery maps kem to meaning_search", () => {
  assert.deepEqual(parseAdvancedQuery({ kem: "water" }), {
    meaning_search: { $in: ["water"] },
  });
});

test("parseAdvancedQuery maps textbook key to textbook_search", () => {
  assert.deepEqual(parseAdvancedQuery({ text: "gwk" }), {
    textbook_search: { $in: ["gwk"] },
  });
});

// `text` and `list` write to the SAME field, so the OPERAND decides which one a
// query really is: ?list=gen:c3 reached a licensed textbook through the
// unrestricted key. Study lists (ap, mac) are public; the other codes are
// licence-restricted. A disallowed operand matches NOTHING, never drops.
test("list accepts only study-list operands; anything else matches nothing", () => {
  assert.deepEqual(parseAdvancedQuery({ list: "ap" }), {
    textbook_search: { $in: ["ap"] },
  });
  assert.deepEqual(parseAdvancedQuery({ list: "ap:c3" }), {
    textbook_search: { $in: ["ap:c3"] },
  });
  assert.deepEqual(parseAdvancedQuery({ list: "mac:c12" }), {
    textbook_search: { $in: ["mac:c12"] },
  });
  assert.deepEqual(parseAdvancedQuery({ list: "gen:c3" }), {
    textbook_search: { $in: [] },
  });
  // a bare prefix is not a study list
  assert.deepEqual(parseAdvancedQuery({ list: "apx" }), {
    textbook_search: { $in: [] },
  });
});

// The published public-API docs promise textbook search is unavailable. On the
// public surface `text` therefore matches nothing — for EVERY operand, so a
// combined ?text=gen&grade=1 honestly finds zero instead of running grade alone.
test("text matches nothing on the public surface, still works in the app", () => {
  assert.deepEqual(parseAdvancedQuery({ text: "gen:c3" }, "public"), {
    textbook_search: { $in: [] },
  });
  // even a study-list operand: list= is the documented public spelling
  assert.deepEqual(parseAdvancedQuery({ text: "ap:c3" }, "public"), {
    textbook_search: { $in: [] },
  });
  assert.deepEqual(parseAdvancedQuery({ text: "" }, "public"), {
    textbook_search: { $in: [] },
  });
  // the app surface (private API, EJS, Angular) keeps its textbook search
  assert.deepEqual(parseAdvancedQuery({ text: "gen:c3" }), {
    textbook_search: { $in: ["gen:c3"] },
  });
});

// ?list= stays the absence search (?key= is the ONE spelling for absence, on
// every advanced key) — on every surface, since study-list data is public.
test("?list= stays the absence search on both surfaces", () => {
  assert.deepEqual(parseAdvancedQuery({ list: "" }), {
    textbook_search: { $in: [""] },
  });
  assert.deepEqual(parseAdvancedQuery({ list: "" }, "public"), {
    textbook_search: { $in: [""] },
  });
});

test("parseAdvancedQuery returns an empty object for empty input", () => {
  assert.deepEqual(parseAdvancedQuery({}), {});
});

// Injection guards (plans/002): Express's qs parser can deliver operator objects
// (e.g. ?kanji[$ne]=x). Non-string operands must be dropped, never embedded in the
// Mongo filter. The `as unknown as StringDict` casts deliberately push a non-string
// operand past the parameter type to simulate that runtime shape.
test("parseAdvancedQuery ignores operator-object operands (injection guard)", () => {
  assert.deepEqual(
    parseAdvancedQuery({ kanji: { $ne: "x" } } as unknown as StringDict),
    {}
  );
  assert.deepEqual(
    parseAdvancedQuery({ on: { $regex: ".*" } } as unknown as StringDict),
    {}
  );
  assert.deepEqual(
    parseAdvancedQuery({ text: { $gt: "" } } as unknown as StringDict),
    {}
  );
});
