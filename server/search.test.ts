import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBasicQuery, parseAdvancedQuery } from "./search";

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

test("parseAdvancedQuery coerces numeric keys and skips NaN", () => {
  assert.deepEqual(parseAdvancedQuery({ ks: "3" }), { kstroke: 3 });
  assert.deepEqual(parseAdvancedQuery({ ks: "abc" }), {});
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
// (e.g. ?kanji[$ne]=x). Non-string operands must be dropped, never embedded in
// the Mongo filter. Cast to `any` to simulate the runtime object past StringDict.
test("parseAdvancedQuery ignores operator-object operands (injection guard)", () => {
  assert.deepEqual(parseAdvancedQuery({ kanji: { $ne: "x" } } as any), {});
  assert.deepEqual(parseAdvancedQuery({ on: { $regex: ".*" } } as any), {});
  assert.deepEqual(parseAdvancedQuery({ text: { $gt: "" } } as any), {});
});
