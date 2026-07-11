/**
 * HTML routes for the HTMX-powered frontend.
 * These routes render EJS templates and return HTML fragments or full pages.
 */

import { Router, Request, Response } from "express";
import { Db, Collection, Filter } from "mongodb";
import * as search from "./search";
import * as grouping from "./grouping";
import { KanjiDocument } from "./types";
import { extendKanjiWithAssets } from "./kanji-assets";

let db: Db;

export const router = Router();

export const init = (database: Db) => {
  db = database;
};

// Advanced search parameter keys (from search.ts)
const ADVANCED_KEYS = ["ks", "rs", "grade", "kanji", "kem", "rem", "on", "kun", "rpos", "rjn", "text", "list"];

/**
 * Check if request has advanced search parameters.
 */
function hasAdvancedParams(query: Record<string, unknown>): boolean {
  return ADVANCED_KEYS.some((key) => key in query);
}

/**
 * Build the search input value for advanced search queries.
 * Preserves the raw parameter keys so users see what they typed.
 * e.g., { ks: "3", on: "shin" } → "ks:3 on:shin"
 *
 * Angular's equivalent was: query.replace(/=/g, ':').replace(/&/g, ' ')
 */
function buildAdvancedSearchInput(query: Record<string, unknown>): string {
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
export function parseColonSyntax(query: string): Record<string, string> | null {
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
  let searchQuery: Record<string, unknown>;

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
    .find(searchQuery as Filter<KanjiDocument>, {
      projection: {
        ka_id: 1,
        ka_utf: 1,
        kstroke: 1,
        rad_utf: 1,
        rad_stroke: 1,
        rad_order: 1,
      },
    })
    .sort({ kstroke: 1, rad_stroke: 1, rad_order: 1 })
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
  const isAdvanced = hasAdvancedParams(req.query as Record<string, unknown>);

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
    ? buildAdvancedSearchInput(req.query as Record<string, unknown>)
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
  const basicQuery = (req.query.q as string) || "";
  const mode = (req.query.mode as string) || "kanji";
  const isAdvanced = hasAdvancedParams(req.query as Record<string, unknown>);
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

    // Get search context from query params
    const searchQuery = (req.query.q as string) || "";
    const searchMode = (req.query.mode as string) || "kanji";
    const isAdvanced = hasAdvancedParams(req.query as Record<string, unknown>);

    // Build display query for search input (show colon syntax for advanced searches)
    const displaySearchQuery = isAdvanced
      ? buildAdvancedSearchInput(req.query as Record<string, unknown>)
      : searchQuery;

    // Compute navigation from search results (re-run the search to find neighbors)
    let currentIndex = 0;
    let totalResults = 1;
    let prevKanji: string | null = null;
    let nextKanji: string | null = null;

    if (searchQuery || isAdvanced) {
      const results = await searchKanji(
        searchQuery,
        isAdvanced ? (req.query as Record<string, string>) : undefined
      );

      const kanjiStrokeGroups =
        searchMode === "ksort" ? grouping.groupByKanjiStrokes(results) : [];
      const radicalStrokeGroups =
        searchMode === "rsort" ? grouping.groupByRadicalStrokes(results) : [];
      const resultsOrder = buildResultsOrder(
        results,
        searchMode,
        kanjiStrokeGroups,
        radicalStrokeGroups
      );

      const idx = resultsOrder.indexOf(character);
      if (idx !== -1) {
        currentIndex = idx;
        totalResults = resultsOrder.length;
        prevKanji = resultsOrder[(idx - 1 + resultsOrder.length) % resultsOrder.length];
        nextKanji = resultsOrder[(idx + 1) % resultsOrder.length];
      }
    }

    // Build query string for navigation (search params only, no nav params)
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (["idx", "total", "prev", "next"].includes(key)) continue;
      if (typeof value === "string") {
        searchParams.set(key, value);
      }
    }
    const queryString = searchParams.toString()
      ? `?${searchParams.toString()}`
      : "";

    // Build "back to search" URL
    const lastSearch = queryString ? `/htmx/search${queryString}` : "";

    res.render("pages/detail", {
      doc: extendedDoc,
      lastSearch,
      searchQuery: displaySearchQuery,
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
