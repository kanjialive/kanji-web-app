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

test("parseAdvancedQuery coerces numeric keys and drops unparseable ones", () => {
  assert.deepEqual(parseAdvancedQuery({ ks: "3" }), { kstroke: 3 });
  assert.deepEqual(parseAdvancedQuery({ ks: "abc" }), {});
});

// The 229 gradeless kanji are stored with grade = NaN, and Mongo matches NaN to
// NaN, so { grade: NaN } IS the "no grade" search — production has served it for
// years via an unguarded parseInt(""). A previous hardening pass dropped the key
// instead, which collapsed the filter to {} and tripped the empty-query guard in
// private-api.ts, so ?grade= and ?grade=n/a returned "No kanji found."
// The empty string and "n/a" are the two spellings the UI and the docs use.
test("parseAdvancedQuery maps a valueless grade to NaN (the 229 gradeless kanji)", () => {
  for (const operand of ["", "n/a", "N/A"]) {
    const parsed = parseAdvancedQuery({ grade: operand }) as { grade?: number };
    assert.ok(
      "grade" in parsed,
      `grade key must survive for operand ${JSON.stringify(operand)}`
    );
    assert.ok(
      Number.isNaN(parsed.grade),
      `grade must be NaN for operand ${JSON.stringify(operand)}, got ${String(
        parsed.grade
      )}`
    );
  }
});

test("parseAdvancedQuery still parses a real grade", () => {
  assert.deepEqual(parseAdvancedQuery({ grade: "1" }), { grade: 1 });
});

test("parseAdvancedQuery maps the string key (kanji) to ka_utf", () => {
  assert.deepEqual(parseAdvancedQuery({ kanji: "水" }), { ka_utf: "水" });
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
