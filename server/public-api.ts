import { Db, Collection } from "mongodb";
import { Request, Response } from "express";
import * as search from "./search";
import {
  Example,
  LicensedField,
  SimpleExtendedKanjiDocument,
  Kanji,
  KanjiDocument,
  Radical,
} from "./types";
import {
  examplesAudioBase,
  animationPath,
  radAnimPath,
  strokesPath,
  radCharPath,
  radPositionPath,
} from "./kanji-assets";

let db: Db;

export const init = (database: Db) => {
  db = database;
};

/**
 * LICENCE-RESTRICTED fields (CLAUDE.md "Key Patterns") — the mnemonic hint and the
 * textbook mapping must never leave the public API. Excluded at the Mongo read AND
 * at the response spread, so neither a new read path nor a new spread leaks alone.
 */
const LICENSED_FIELDS_PROJECTION: Record<LicensedField, 0> = {
  mn_hint: 0,
  hint_group: 0,
  txt_books: 0,
  textbook_search: 0,
};

const withoutLicensedFields = (
  doc: KanjiDocument
): Omit<KanjiDocument, LicensedField> => {
  const copy: Partial<KanjiDocument> = { ...doc };
  for (const field of Object.keys(LICENSED_FIELDS_PROJECTION)) {
    delete copy[field as LicensedField];
  }
  return copy as Omit<KanjiDocument, LicensedField>;
};

/**
 * An empty filter is NOT "match everything". It means the caller gave us nothing we could
 * parse, and the honest answer is "no kanji found".
 *
 * parseAdvancedQuery() silently drops every parameter it cannot recognise or coerce, so
 * `?foo=bar`, `?grade=abc` and a bare `/api/public/search/advanced` all arrive as `{}` —
 * and find({}) returns all 1,235 documents as though everything matched a search that
 * specified nothing.
 *
 * private-api.ts guards this too. KEEP THE TWO IN STEP; the public copy lacked it for
 * years because nobody diffed them.
 */
const getSearchResultsWithQuery = async (
  query: object,
  req: Request,
  res: Response
) => {
  if (Object.keys(query).length === 0) {
    return res.send({ error: "No kanji found." });
  }
  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const results: KanjiDocument[] = await collection
      .find(query, {
        projection: {
          ka_id: 1,
          ka_utf: 1,
          kstroke: 1,
          rad_utf: 1,
          rad_stroke: 1,
          rad_order: 1,
        },
      })
      .toArray();

    const structured_results = results.map((doc) => ({
      kanji: {
        character: doc["ka_utf"],
        stroke: doc["kstroke"],
      },
      radical: {
        character: doc["rad_utf"],
        stroke: doc["rad_stroke"],
        order: doc["rad_order"],
      },
    }));
    res.send(structured_results);
  } catch (error) {
    console.error(error);
    res.send({ error: "No kanji found." });
  }
};

export const advancedSearch = async (
  req: Request<Record<string, string>, unknown, unknown, search.StringDict>,
  res: Response
) => {
  const query = search.parseAdvancedQuery(req.query, "public");
  await getSearchResultsWithQuery(query, req, res);
};

export const basicSearch = async (req: Request, res: Response) => {
  const query = search.generateBasicQuery(req.params.search);
  await getSearchResultsWithQuery(query, req, res);
};

export const getKanjiWithCharacter = async (req: Request, res: Response) => {
  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const result: KanjiDocument | null = await collection.findOne(
      { ka_utf: req.params.character },
      { projection: LICENSED_FIELDS_PROJECTION }
    );
    if (result) {
      res.send(extendKanjiWithAssets(result));
    } else {
      res.send({ error: "No kanji found." });
    }
  } catch (error) {
    console.error(error);
    res.send({ error: "No kanji found." });
  }
};

export const getAllKanji = async (req: Request, res: Response) => {
  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const results: KanjiDocument[] = await collection
      .find({}, { projection: LICENSED_FIELDS_PROJECTION })
      .toArray();
    const structured_results = results.map((doc) =>
      extendKanjiWithAssets(doc)
    );
    res.send(structured_results);
  } catch (error) {
    console.error(error);
    res.send({ error: "No kanji found." });
  }
};

export function extendKanjiWithAssets(
  doc: KanjiDocument
): SimpleExtendedKanjiDocument {
  const stroke_images: string[] = [];

  for (let i = 1; i <= doc.kstroke; i++) {
    stroke_images.push(strokesPath + "/" + doc.kname + "_" + i + ".svg");
  }

  // Kanji
  const kanji: Kanji = {
    character: doc.ka_utf,
    meaning: {
      english: doc.meaning,
    },
    strokes: {
      count: doc.kstroke,
      timings: doc.stroketimes,
      images: stroke_images,
    },
    onyomi: {
      romaji: doc.onyomi,
      katakana: doc.onyomi_ja,
    },
    kunyomi: {
      romaji: doc.kunyomi,
      hiragana: doc.kunyomi_ka_display,
    },
    video: {
      poster: strokesPath + "/" + doc.kname + "_" + doc.kstroke + ".svg",
      mp4: animationPath + "/kanji_mp4/" + doc.kname + "_00.mp4",
      webm: animationPath + "/kanji_webm/" + doc.kname + "_00.webm",
    },
  };


  // Radical
  let rad_position_file = "";
  if (doc.rad_position.length > 0) {
    const rad_positions = doc.rad_position.split(",");
    rad_position_file = rad_positions[rad_positions.length - 1].trim();
    rad_position_file = radPositionPath + "/" + rad_position_file + ".svg";
  }

  const radical: Radical = {
    character: doc.rad_utf,
    strokes: doc.rad_stroke,
    image: radCharPath + "/" + doc.rad_name_file + ".svg",
    position: {
      hiragana: doc.rad_position_ja,
      romaji: doc.rad_position,
      icon: rad_position_file,
    },
    name: {
      hiragana: doc.rad_name_ja,
      romaji: doc.rad_name,
    },
    meaning: {
      english: doc.rad_meaning,
    },
    animation: [
      radAnimPath + "/" + doc.rad_name_file + "0.svg",
      radAnimPath + "/" + doc.rad_name_file + "1.svg",
      radAnimPath + "/" + doc.rad_name_file + "2.svg",
    ],
  };

  // References
  const references = {
    grade: doc.grade,
    kodansha: doc.dick,
    classic_nelson: doc.dicn,
  };

  // Examples
  const alpha = [
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
  ];
  const examples: Example[] = [];

  for (let i = 0; i < doc.examples.length; i++) {
    const example: Example = {
      japanese: doc.examples[i][0],
      meaning: { english: doc.examples[i][1] },
      audio: {
        opus:
          examplesAudioBase +
          "/audio-opus/" +
          doc.kname +
          "_06_" +
          alpha[i] +
          ".opus",
        aac:
          examplesAudioBase +
          "/audio-aac/" +
          doc.kname +
          "_06_" +
          alpha[i] +
          ".aac",
        ogg:
          examplesAudioBase +
          "/audio-ogg/" +
          doc.kname +
          "_06_" +
          alpha[i] +
          ".ogg",
        mp3:
          examplesAudioBase +
          "/audio-mp3/" +
          doc.kname +
          "_06_" +
          alpha[i] +
          ".mp3",
      },
    };
    examples.push(example);
  }

  const extendedKanji: SimpleExtendedKanjiDocument = {
    ...withoutLicensedFields(doc),
    kanji: kanji,
    radical: radical,
    references: references,
    examples: examples,
  };

  return extendedKanji;
}
