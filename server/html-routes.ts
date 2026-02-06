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

// Advanced search parameter keys (from search.ts)
const ADVANCED_KEYS = ["ks", "rs", "grade", "kanji", "kem", "rem", "on", "kun", "rpos", "rjn", "text", "list"];

/**
 * Check if request has advanced search parameters.
 */
function hasAdvancedParams(query: Record<string, any>): boolean {
  return ADVANCED_KEYS.some((key) => key in query);
}

/**
 * Build the search input value for advanced search queries.
 * Preserves the raw parameter keys so users see what they typed.
 * e.g., { ks: "3", on: "shin" } → "ks:3 on:shin"
 *
 * Angular's equivalent was: query.replace(/=/g, ':').replace(/&/g, ' ')
 */
function buildAdvancedSearchInput(query: Record<string, any>): string {
  const parts: string[] = [];
  for (const key of ADVANCED_KEYS) {
    if (query[key]) parts.push(`${key}:${query[key]}`);
  }
  return parts.join(" ");
}

/**
 * Parses colon-delimited advanced search syntax from a basic query string.
 * e.g., "on:shin grade:3" → { on: "shin", grade: "3" }
 * Returns null if the query doesn't contain recognized advanced keys.
 *
 * Ported from the Angular parseQuery() function in search-controller.js
 * and detail-controller.js, which converted user-typed colon syntax
 * into structured URL parameters.
 */
function parseColonSyntax(query: string): Record<string, string> | null {
  if (!query.includes(":")) return null;

  const result: Record<string, string> = {};
  let searchingForKey = true;
  let lastSpaceIndex = -1;
  let lastColonIndex = -1;
  let key: string | null = null;

  for (let i = 0; i < query.length; i++) {
    if (searchingForKey) {
      if (query.charAt(i) === ":") {
        if (lastColonIndex !== -1 && key !== null) {
          result[key] = query.substring(lastColonIndex + 1, lastSpaceIndex);
        }
        key = query.substring(lastSpaceIndex + 1, i).toLowerCase();
        searchingForKey = false;
        lastColonIndex = i;
      } else if (query.charAt(i) === " ") {
        lastSpaceIndex = i;
      }
    } else {
      if (query.charAt(i) === " ") {
        lastSpaceIndex = i;
        searchingForKey = true;
      }
    }
  }

  if (lastColonIndex !== -1 && key !== null) {
    result[key] = query.substring(lastColonIndex + 1);
  }

  // Only treat as advanced if at least one recognized key was found
  const hasAdvancedKey = Object.keys(result).some((k) =>
    ADVANCED_KEYS.includes(k)
  );
  return hasAdvancedKey ? result : null;
}

/**
 * Search for kanji using basic or advanced query.
 */
async function searchKanji(
  basicQuery: string,
  advancedParams?: Record<string, string>
): Promise<grouping.KanjiSearchResult[]> {
  let searchQuery: Record<string, any>;

  if (advancedParams && hasAdvancedParams(advancedParams)) {
    // Use advanced search
    searchQuery = search.parseAdvancedQuery(advancedParams as search.StringDict);
  } else if (basicQuery) {
    // Use basic search
    searchQuery = search.generateBasicQuery(basicQuery);
  } else {
    return [];
  }

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
 * Builds a flat array of kanji characters in display order for navigation.
 * For grouped modes, extracts kanji from the nested structure.
 */
function buildResultsOrder(
  results: grouping.KanjiSearchResult[],
  mode: string,
  kanjiStrokeGroups: grouping.StrokeGroup[],
  radicalStrokeGroups: grouping.StrokeGroup[]
): string[] {
  if (mode === "ksort" && kanjiStrokeGroups.length > 0) {
    // Extract from kanji stroke groups in display order
    const order: string[] = [];
    for (const group of kanjiStrokeGroups) {
      for (const column of group.columns) {
        for (const radical of column) {
          for (const row of radical.rows) {
            for (const kanji of row) {
              order.push(kanji.ka_utf);
            }
          }
        }
      }
    }
    return order;
  }

  if (mode === "rsort" && radicalStrokeGroups.length > 0) {
    // Extract from radical stroke groups in display order
    const order: string[] = [];
    for (const group of radicalStrokeGroups) {
      for (const column of group.columns) {
        for (const radical of column) {
          for (const row of radical.rows) {
            for (const kanji of row) {
              order.push(kanji.ka_utf);
            }
          }
        }
      }
    }
    return order;
  }

  // Default: simple kanji mode - use original order
  return results.map((k) => k.ka_utf);
}

/**
 * GET /htmx/search - Search page (full page or with results)
 * Supports both basic search (?q=...) and advanced search (?on=...&grade=...)
 */
router.get("/search", async (req: Request, res: Response) => {
  const basicQuery = (req.query.q as string) || "";
  const mode = (req.query.mode as string) || "kanji";
  const isAdvanced = hasAdvancedParams(req.query as Record<string, any>);

  // Parse colon syntax in basic query (e.g., "on:shin grade:3") → redirect
  if (basicQuery && !isAdvanced) {
    const parsed = parseColonSyntax(basicQuery);
    if (parsed) {
      const params = new URLSearchParams(parsed);
      if (mode !== "kanji") params.set("mode", mode);
      return res.redirect(`/htmx/search?${params.toString()}`);
    }
  }

  // Build display query for UI
  const displayQuery = isAdvanced
    ? buildAdvancedSearchInput(req.query as Record<string, any>)
    : basicQuery;

  try {
    if (!basicQuery && !isAdvanced) {
      // No search query - show welcome page
      return res.render("pages/search", {
        query: "",
        mode: "help",
        results: [],
        resultsOrder: [],
      });
    }

    const results = await searchKanji(
      basicQuery,
      isAdvanced ? (req.query as Record<string, string>) : undefined
    );

    // Generate grouped results based on mode
    const kanjiStrokeGroups =
      mode === "ksort" ? grouping.groupByKanjiStrokes(results) : [];
    const radicalStrokeGroups =
      mode === "rsort" ? grouping.groupByRadicalStrokes(results) : [];

    // Build flat array of kanji in display order for navigation links
    const resultsOrder = buildResultsOrder(
      results,
      mode,
      kanjiStrokeGroups,
      radicalStrokeGroups
    );

    // Preserve original query string for navigation links
    const queryString = new URL(req.url, "http://localhost").search;

    res.render("pages/search", {
      query: displayQuery,
      queryString,
      mode: results.length > 0 ? mode : "kanji",
      results,
      kanjiStrokeGroups,
      radicalStrokeGroups,
      resultsOrder,
    });
  } catch (error) {
    console.error("Search error:", error);
    res.render("pages/search", {
      query: displayQuery,
      mode: "kanji",
      results: [],
      resultsOrder: [],
      error: "An error occurred while searching.",
    });
  }
});

/**
 * GET /htmx/search/advanced - Advanced search (redirects to /htmx/search with params)
 */
router.get("/search/advanced", async (req: Request, res: Response) => {
  // Forward to main search route - it handles both basic and advanced
  const queryString = new URL(req.url, "http://localhost").search;
  res.redirect(`/htmx/search${queryString}`);
});

/**
 * GET /htmx/partials/results - HTMX partial for search results
 * Supports both basic search (?q=...) and advanced search (?on=...&grade=...)
 */
router.get("/partials/results", async (req: Request, res: Response) => {
  let basicQuery = (req.query.q as string) || "";
  const mode = (req.query.mode as string) || "kanji";
  let isAdvanced = hasAdvancedParams(req.query as Record<string, any>);
  let effectiveAdvancedParams: Record<string, string> | undefined;

  // Parse colon syntax in basic query (e.g., "on:shin grade:3") → redirect
  if (basicQuery && !isAdvanced) {
    const parsed = parseColonSyntax(basicQuery);
    if (parsed) {
      const params = new URLSearchParams(parsed);
      if (mode !== "kanji") params.set("mode", mode);
      res.setHeader("HX-Redirect", `/htmx/search?${params.toString()}`);
      return res.send("");
    }
  }

  if (isAdvanced) {
    effectiveAdvancedParams = req.query as Record<string, string>;
  }

  // Set HX-Push-Url so browser shows the full-page URL, not the partial endpoint
  const queryString = new URL(req.url, "http://localhost").search;
  const pushUrl =
    basicQuery || isAdvanced ? "/htmx/search" + queryString : "/htmx/search";
  res.setHeader("HX-Push-Url", pushUrl);

  try {
    if (!basicQuery && !isAdvanced) {
      return res.render("partials/welcome");
    }

    const results = await searchKanji(basicQuery, effectiveAdvancedParams);

    if (results.length === 0) {
      return res.render("partials/no-results");
    }

    const kanjiStrokeGroups =
      mode === "ksort" ? grouping.groupByKanjiStrokes(results) : [];
    const radicalStrokeGroups =
      mode === "rsort" ? grouping.groupByRadicalStrokes(results) : [];

    // Build flat array of kanji in display order for navigation links
    const resultsOrder = buildResultsOrder(
      results,
      mode,
      kanjiStrokeGroups,
      radicalStrokeGroups
    );

    res.render("partials/results", {
      query: basicQuery,
      queryString,
      results,
      mode,
      kanjiStrokeGroups,
      radicalStrokeGroups,
      resultsOrder,
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
        resultsOrder: [],
        error: `Kanji "${character}" not found.`,
      });
    }

    const extendedDoc = extendKanjiWithAssets(doc);

    // Get navigation context from query params
    const searchQuery = (req.query.q as string) || "";
    const searchMode = (req.query.mode as string) || "kanji";
    const currentIndex = parseInt(req.query.idx as string) || 0;
    const totalResults = parseInt(req.query.total as string) || 1;
    const prevKanji = (req.query.prev as string) || null;
    const nextKanji = (req.query.next as string) || null;

    // Check if this was an advanced search
    const isAdvanced = hasAdvancedParams(req.query as Record<string, any>);

    // Build the "back to search" URL - preserve all search params
    let lastSearch = "";
    if (searchQuery || isAdvanced) {
      // Extract search-related params (exclude navigation params)
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query)) {
        // Skip navigation-only params
        if (["idx", "total", "prev", "next"].includes(key)) continue;
        if (typeof value === "string") {
          searchParams.set(key, value);
        }
      }
      if (searchParams.toString()) {
        lastSearch = `/htmx/search?${searchParams.toString()}`;
      }
    }

    // Build query string for navigation (includes search params)
    const navParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (["idx", "total", "prev", "next"].includes(key)) continue;
      if (typeof value === "string") {
        navParams.set(key, value);
      }
    }
    const queryString = navParams.toString() ? `?${navParams.toString()}` : "";

    res.render("pages/detail", {
      doc: extendedDoc,
      lastSearch,
      searchQuery,
      searchMode,
      queryString,
      currentIndex,
      totalResults,
      prevKanji,
      nextKanji,
    });
  } catch (error) {
    console.error("Detail error:", error);
    res.status(500).render("pages/search", {
      query: "",
      mode: "help",
      results: [],
      resultsOrder: [],
      error: "An error occurred.",
    });
  }
});
