import { test } from "node:test";
import assert from "node:assert/strict";
import type { KanjiDocument } from "./types";
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
