import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Db } from "mongodb";
import type { KanjiDocument } from "./types";
import * as publicApi from "./public-api";
import { extendKanjiWithAssets } from "./public-api";

// Golden test for the PUBLIC (nested) enrichment contract. External RapidAPI
// consumers depend on these exact URL strings and object shape, so this locks
// them down: it must stay green, unchanged, across the CDN-constant refactor.
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
 * parseAdvancedQuery() silently drops every parameter it cannot recognise or coerce, so
 * `?foo=bar`, `?grade=abc` and a bare /api/public/search/advanced all reached this file
 * as `{}` — and `find({})` matches EVERYTHING. A typo'd parameter came back as 1,235
 * documents billed as a successful search. private-api.ts has always guarded this; the
 * public copy never did.
 *
 * ⚠️ Asserts the Mongo call is never MADE, not just that the body looks right. A guard
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
  { grade: "abc" }, // recognised key, uncoercible value — parseInt drops it
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

test("basic search is unaffected — its filter is never empty", async () => {
  const calls: object[] = [];
  publicApi.init(countingDb(calls));
  const res = captureRes();

  await publicApi.basicSearch(
    { params: { search: "water" } } as unknown as Request,
    res as unknown as Response
  );

  assert.equal(calls.length, 1, "a basic search must always reach Mongo");
  assert.equal((res.body as unknown[]).length, 3);
});
