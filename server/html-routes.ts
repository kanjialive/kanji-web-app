/**
 * HTML routes for the HTMX-powered frontend.
 * These routes render EJS templates and return HTML fragments or full pages.
 */

import { Router, Request, Response } from "express";
import { Db, Collection } from "mongodb";
import * as search from "./search";
import * as grouping from "./grouping";
import { KanjiDocument, ExtendedKanjiDocument } from "./types";

let db: Db;

export const router = Router();

export const init = (database: Db) => {
  db = database;
};

// CDN base URLs for assets
const baseURL = "https://media.kanjialive.com";
const examplesAudioBase = `${baseURL}/examples_audio`;
const animationPath = `${baseURL}/kanji_animations`;
const radAnimPath = `${baseURL}/rad_frames`;
const strokesPath = `${baseURL}/kanji_strokes`;
const typefacePath = `${baseURL}/ka_typefaces`;
const radCharPath = `${baseURL}/radical_character`;
const radPositionPath = `${baseURL}/rad_positions`;
const mnemonicHintsPath = `${baseURL}/mnemonic_hints`;

/**
 * Extends a kanji document with all asset URLs.
 */
function extendKanjiWithAssets(doc: KanjiDocument): ExtendedKanjiDocument {
  const alpha = "abcdefghijklmnopqrstuvwxyz".split("");
  const examples = doc.examples.map(([japanese, english], i) => {
    const filename = `${doc.kname}_06_${alpha[i]}`;
    return {
      japanese,
      english,
      filename,
      opus: `${examplesAudioBase}/audio-opus/${filename}.opus`,
      aac: `${examplesAudioBase}/audio-aac/${filename}.aac`,
      ogg: `${examplesAudioBase}/audio-ogg/${filename}.ogg`,
      mp3: `${examplesAudioBase}/audio-mp3/${filename}.mp3`,
    };
  });

  const strokes = Array.from(
    { length: doc.kstroke },
    (_, i) => `${strokesPath}/${doc.kname}_${i + 1}.svg`
  );

  const hint = doc.mn_hint.replace(
    /\[([0-9]+)\]/g,
    `<img src="${mnemonicHintsPath}/$1.svg" />`
  );

  const rad_position_file = doc.rad_position.split(",").pop()?.trim() || "";
  const paddedID = doc.ka_id.split("_")[1].padStart(4, "0");

  return {
    ...doc,
    rad_position_file: rad_position_file
      ? `${radPositionPath}/${rad_position_file}.svg`
      : undefined,
    rad_anim_source: `${radAnimPath}/${doc.rad_name}`,
    examples,
    strokes,
    poster_video_source: `${strokesPath}/${doc.kname}_${doc.kstroke}.svg`,
    mp4_video_source: `${animationPath}/kanji_mp4/${doc.kname}_00.mp4`,
    webm_video_source: `${animationPath}/kanji_webm/${doc.kname}_00.webm`,
    kyokasho_source: `${typefacePath}/kyokasho-svg/kyokasho_Page_${paddedID}.svg`,
    mincho_source: `${typefacePath}/mincho-svg/mincho_Page_${paddedID}.svg`,
    gothic_source: `${typefacePath}/gothic-svg/gothic_Page_${paddedID}.svg`,
    maru_source: `${typefacePath}/maru-svg/maru_Page_${paddedID}.svg`,
    shino_source: `${typefacePath}/shino-svg/shino_Page_${paddedID}.svg`,
    tensho_source: `${typefacePath}/tensho-svg/tensho_Page_${paddedID}.svg`,
    hiragino_source: `${typefacePath}/hiragino-svg/hiragino_Page_${paddedID}.svg`,
    kanteiryu_source: `${typefacePath}/kanteiryu-svg/kanteiryu_Page_${paddedID}.svg`,
    suzumushi_source: `${typefacePath}/suzumushi-svg/suzumushi_Page_${paddedID}.svg`,
    rad_char_source: `${radCharPath}/${doc.rad_name_file}.svg`,
    rad_anim_frame_0: `${radAnimPath}/${doc.rad_name_file}0.svg`,
    rad_anim_frame_1: `${radAnimPath}/${doc.rad_name_file}1.svg`,
    rad_anim_frame_2: `${radAnimPath}/${doc.rad_name_file}2.svg`,
    hint,
  } as ExtendedKanjiDocument;
}

/**
 * Search for kanji and return results.
 */
async function searchKanji(query: string): Promise<grouping.KanjiSearchResult[]> {
  const searchQuery = search.generateBasicQuery(query);

  if (Object.keys(searchQuery).length === 0) {
    return [];
  }

  const collection: Collection<KanjiDocument> = db.collection("kanji");
  const results = await collection
    .find(searchQuery, {
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

  return results as unknown as grouping.KanjiSearchResult[];
}

/**
 * GET /htmx/search - Search page (full page or with results)
 */
router.get("/search", async (req: Request, res: Response) => {
  const query = (req.query.q as string) || "";
  const mode = (req.query.mode as string) || "kanji";

  try {
    if (!query) {
      // No search query - show welcome page
      return res.render("pages/search", {
        query: "",
        mode: "help",
        results: [],
      });
    }

    const results = await searchKanji(query);

    // Generate grouped results based on mode
    const kanjiStrokeGroups =
      mode === "ksort" ? grouping.groupByKanjiStrokes(results) : [];
    const radicalStrokeGroups =
      mode === "rsort" ? grouping.groupByRadicalStrokes(results) : [];

    res.render("pages/search", {
      query,
      mode: results.length > 0 ? mode : "kanji",
      results,
      kanjiStrokeGroups,
      radicalStrokeGroups,
    });
  } catch (error) {
    console.error("Search error:", error);
    res.render("pages/search", {
      query,
      mode: "kanji",
      results: [],
      error: "An error occurred while searching.",
    });
  }
});

/**
 * GET /htmx/partials/results - HTMX partial for search results
 */
router.get("/partials/results", async (req: Request, res: Response) => {
  const query = (req.query.q as string) || "";
  const mode = (req.query.mode as string) || "kanji";

  try {
    if (!query) {
      return res.render("partials/welcome");
    }

    const results = await searchKanji(query);

    if (results.length === 0) {
      return res.render("partials/no-results");
    }

    const kanjiStrokeGroups =
      mode === "ksort" ? grouping.groupByKanjiStrokes(results) : [];
    const radicalStrokeGroups =
      mode === "rsort" ? grouping.groupByRadicalStrokes(results) : [];

    res.render("partials/results", {
      results,
      mode,
      kanjiStrokeGroups,
      radicalStrokeGroups,
    });
  } catch (error) {
    console.error("Search error:", error);
    res.render("partials/no-results");
  }
});

/**
 * GET /htmx/:character - Kanji detail page
 */
router.get("/:character", async (req: Request, res: Response) => {
  const character = decodeURIComponent(req.params.character);

  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const doc = await collection.findOne({ ka_utf: character });

    if (!doc) {
      return res.status(404).render("pages/search", {
        query: "",
        mode: "help",
        results: [],
        error: `Kanji "${character}" not found.`,
      });
    }

    const extendedDoc = extendKanjiWithAssets(doc);

    // Get navigation context from session/query if available
    const lastSearch = (req.query.from as string) || "";
    const currentIndex = parseInt(req.query.index as string) || 0;
    const totalResults = parseInt(req.query.total as string) || 1;

    res.render("pages/detail", {
      doc: extendedDoc,
      lastSearch,
      currentIndex,
      totalResults,
      prevKanji: null, // These would come from stored search context
      nextKanji: null,
    });
  } catch (error) {
    console.error("Detail error:", error);
    res.status(500).render("pages/search", {
      query: "",
      mode: "help",
      results: [],
      error: "An error occurred.",
    });
  }
});
