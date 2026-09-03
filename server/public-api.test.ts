import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Db } from "mongodb";
import type { KanjiDocument } from "./types";
import * as publicApi from "./public-api";
import { extendKanjiWithAssets } from "./public-api";

// Golden test for the PUBLIC (nested) enrichment contract. External RapidAPI
// consumers depend on these exact URL strings and object shape, so any refactor
// of the CDN URL building must leave this file green and unchanged.
const doc = {
  ka_id: "kanji_42",
  ka_utf: "水",
  kname: "water",
  kstroke: 4,
  meaning: "water",
  onyomi: "sui",
  onyomi_ja: "スイ",
  kunyomi: "mizu",
  kunyomi_ka_display: "みず",
  rad_utf: "水",
  rad_stroke: 4,
  rad_name: "mizu",
  rad_name_file: "water_rad",
  rad_name_ja: "みず",
  rad_meaning: "water",
  rad_position: "left",
  rad_position_ja: "へん",
  grade: 1,
  dick: 100,
  dicn: 200,
  stroketimes: [] as number[],
  examples: [
    ["みず", "water"],
    ["こおり", "ice"],
  ] as string[][],
} as unknown as KanjiDocument;

test("public extendKanjiWithAssets output is stable (golden)", () => {
  const out = extendKanjiWithAssets(doc);

  assert.equal(
    out.kanji.strokes.images[0],
    "https://media.kanjialive.com/kanji_strokes/water_1.svg"
  );
  assert.equal(
    out.kanji.video.mp4,
    "https://media.kanjialive.com/kanji_animations/kanji_mp4/water_00.mp4"
  );
  assert.equal(
    out.kanji.video.webm,
    "https://media.kanjialive.com/kanji_animations/kanji_webm/water_00.webm"
  );
  assert.equal(
    out.examples[0].audio.opus,
    "https://media.kanjialive.com/examples_audio/audio-opus/water_06_a.opus"
  );
  assert.equal(
    out.examples[1].audio.mp3,
    "https://media.kanjialive.com/examples_audio/audio-mp3/water_06_b.mp3"
  );
  assert.equal(
    out.radical.image,
    "https://media.kanjialive.com/radical_character/water_rad.svg"
  );
  assert.equal(
    out.radical.animation[0],
    "https://media.kanjialive.com/rad_frames/water_rad0.svg"
  );
  assert.equal(
    out.radical.position.icon,
    "https://media.kanjialive.com/rad_positions/left.svg"
  );

  // Lock the overall kanji sub-object shape and key order too.
  assert.deepEqual(Object.keys(out.kanji), [
    "character",
    "meaning",
    "strokes",
    "onyomi",
    "kunyomi",
    "video",
  ]);
});

/**
 * An unparseable advanced search must not return the whole collection.
 *
 * parseAdvancedQuery() silently drops every parameter it does not recognise, so
 * `?foo=bar` and a bare /api/public/search/advanced reached this file as `{}` — and
 * `find({})` matches EVERYTHING. A typo'd parameter came back as 1,235 documents dressed
 * up as a successful search. private-api.ts has always guarded this; the public copy never
 * did. (A RECOGNISED key with an unusable operand is different: it becomes a
 * match-nothing clause, tested separately below.)
 *
 * Asserts the Mongo call is never MADE, not just that the body looks right. A guard
 * that queried first and discarded the result afterwards would still be wrong.
 *
 * Seen red: removing the Object.keys() guard from getSearchResultsWithQuery() fails all
 * three unparseable cases and leaves ?grade=1 green.
 */
interface StubCursor {
  toArray(): Promise<KanjiDocument[]>;
}

function countingDb(calls: object[]): Db {
  const cursor: StubCursor = {
    toArray: async (): Promise<KanjiDocument[]> => [doc, doc, doc],
  };
  return {
    collection() {
      return {
        find: (filter: object): StubCursor => {
          calls.push(filter);
          return cursor;
        },
      };
    },
  } as unknown as Db;
}

function captureRes() {
  return {
    body: undefined as unknown,
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

const UNPARSEABLE = [
  {}, // no parameters at all
  { foo: "bar" }, // nothing search.ts recognises
];

for (const query of UNPARSEABLE) {
  test(`advanced search with ${JSON.stringify(query)} finds nothing, not everything`, async () => {
    const calls: object[] = [];
    publicApi.init(countingDb(calls));
    const res = captureRes();

    await publicApi.advancedSearch(
      { query } as unknown as Parameters<typeof publicApi.advancedSearch>[0],
      res as unknown as Response
    );

    assert.deepEqual(calls, [], "an empty filter must never reach Mongo");
    assert.deepEqual(res.body, { error: "No kanji found." });
  });
}

// A recognised key with an unusable operand is NOT dropped — that silently broadened
// ?grade=abc&ks=3 to ?ks=3. It reaches Mongo as a match-nothing clause and honestly
// finds zero. Only the filter shape is asserted; the stub answers every find with docs.
test("an unusable operand on a recognised key queries Mongo with a match-nothing clause", async () => {
  const calls: object[] = [];
  publicApi.init(countingDb(calls));
  const res = captureRes();

  await publicApi.advancedSearch(
    { query: { grade: "abc" } } as unknown as Parameters<typeof publicApi.advancedSearch>[0],
    res as unknown as Response
  );

  assert.deepEqual(calls, [{ grade: { $in: [] } }]);
});

test("a parseable advanced search still queries Mongo and returns results", async () => {
  const calls: object[] = [];
  publicApi.init(countingDb(calls));
  const res = captureRes();

  await publicApi.advancedSearch(
    { query: { grade: "1" } } as unknown as Parameters<typeof publicApi.advancedSearch>[0],
    res as unknown as Response
  );

  assert.deepEqual(calls, [{ grade: 1 }], "the guard must not swallow a real search");
  assert.equal((res.body as unknown[]).length, 3);
});

/**
 * LICENCE-RESTRICTED fields (CLAUDE.md "Key Patterns"): mn_hint, hint_group,
 * txt_books and textbook_search must never leave the public API — the published
 * docs promise they are unavailable, and for years the ...doc spread shipped them
 * anyway. Everything else keeps its shape: ~60 live RapidAPI consumers.
 *
 * Seen red: restoring the plain `...doc` spread fails the first test; removing the
 * "public" surface argument from advancedSearch fails the text/list ones.
 */
const LICENSED_FIELDS = [
  "mn_hint",
  "hint_group",
  "txt_books",
  "textbook_search",
];

test("licensed and retired fields never appear in the public kanji response", () => {
  const leakyDoc = {
    ...doc,
    mn_hint: "Between the rivers…",
    hint_group: 2,
    txt_books: [{ chapter: "19", txt_bk: "txtGenki" }],
    textbook_search: ["gen", "gen:c19"],
    luminous: "https://www.kenkyusha.co.jp/collab/KanjiAlive/index.php?field=水",
  } as unknown as KanjiDocument;

  const out = extendKanjiWithAssets(leakyDoc) as unknown as Record<
    string,
    unknown
  >;
  for (const field of LICENSED_FIELDS) {
    assert.ok(!(field in out), `${field} must not leave the public API`);
  }
  // The SPREAD layer on its own: this doc never went through a projection, so a dead
  // Luminous URL surviving here is exactly what a projection-only fix would ship.
  assert.ok(!("luminous" in out), "the retired luminous link must not leave the API");
  // deletion, not a DTO: the rest of the document keeps its shape
  assert.equal(out.ka_utf, "水");
  assert.equal(out.kname, "water");
  assert.equal(out.grade, 1);
});

test("both public kanji read paths project the withheld fields out at Mongo", async () => {
  const projections: unknown[] = [];
  const stubCollection = {
    findOne: async (
      _filter: object,
      options?: { projection?: object }
    ): Promise<KanjiDocument | null> => {
      projections.push(options?.projection);
      return null;
    },
    find: (_filter: object, options?: { projection?: object }): StubCursor => {
      projections.push(options?.projection);
      return { toArray: async (): Promise<KanjiDocument[]> => [] };
    },
  };
  const stubDb = {
    collection: (): typeof stubCollection => stubCollection,
  } as unknown as Db;
  publicApi.init(stubDb);

  await publicApi.getKanjiWithCharacter(
    { params: { character: "水" } } as unknown as Request,
    captureRes() as unknown as Response
  );
  await publicApi.getAllKanji(
    {} as Request,
    captureRes() as unknown as Response
  );

  assert.equal(projections.length, 2, "both read paths must hit the stub");
  for (const projection of projections) {
    // Exact, so a mistyped key fails here. The first four are licence-restricted; the
    // fifth is not — `luminous` is withheld because Kenkyusha retired Luminous and the
    // stored URL 404s. Don't let the two reasons merge.
    assert.deepEqual(projection, {
      mn_hint: 0,
      hint_group: 0,
      txt_books: 0,
      textbook_search: 0,
      luminous: 0,
    });
  }
});

// The filter is a read primitive: even with a clean body, an accepted ?text= or
// ?list= discloses the licensed mapping one query at a time. On the public route
// text matches NOTHING (never dropped — dropping broadens a combined query), and
// list accepts only the two public study lists.
const TEXTBOOK_FILTER_CASES: [Record<string, string>, object][] = [
  [{ text: "gen:c3" }, { textbook_search: { $in: [] } }],
  [{ list: "gen:c3" }, { textbook_search: { $in: [] } }],
  [{ list: "ap:c3" }, { textbook_search: { $in: ["ap:c3"] } }],
];

for (const [query, expected] of TEXTBOOK_FILTER_CASES) {
  test(`public advanced search ${JSON.stringify(query)} filters as ${JSON.stringify(expected)}`, async () => {
    const calls: object[] = [];
    publicApi.init(countingDb(calls));
    const res = captureRes();

    await publicApi.advancedSearch(
      { query } as unknown as Parameters<typeof publicApi.advancedSearch>[0],
      res as unknown as Response
    );

    assert.deepEqual(calls, [expected]);
  });
}

test("basic search is unaffected — its filter is never empty", async () => {
  const calls: object[] = [];
  publicApi.init(countingDb(calls));
  const res = captureRes();

  await publicApi.basicSearch(
    { params: { search: "water" } } as unknown as Request<{ search: string }>,
    res as unknown as Response
  );

  assert.equal(calls.length, 1, "a basic search must always reach Mongo");
  assert.equal((res.body as unknown[]).length, 3);
});
