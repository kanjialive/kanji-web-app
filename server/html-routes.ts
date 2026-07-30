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

/**
 * Render a number the way production renders it, i.e. blank when it is the NaN sentinel.
 *
 * 229 kanji hold `grade: NaN` and 々 holds `rad_stroke: NaN`. That is a DELIBERATE sentinel
 * meaning "this kanji has no grade", and it is LOAD-BEARING: search.ts turns `?grade=n/a`
 * into `{ grade: NaN }` because Mongo matches NaN to NaN, and that is a real search which
 * returns those 229 kanji. **Never clean the sentinel out of the data** — only keep it off
 * the page.
 *
 * Production never had to think about this. Its data reaches AngularJS as JSON, and JSON has
 * no NaN literal, so the driver serialises NaN -> null and `{{doc.grade}}` renders as an
 * empty string. EJS renders server-side from the Mongo document itself, where the value is
 * still a double, so `<%= doc.grade %>` printed the literal text "NaN" onto 229 detail pages
 * (and into 々's radical block). This restores production's blank.
 */
export const numberOrBlank = (value: unknown): unknown =>
  typeof value === "number" && Number.isNaN(value) ? "" : value;

/**
 * Read a query parameter as a string, or as "" if it is anything else.
 *
 * 🔴 `req.query.q as string` is a LIE THE COMPILER CANNOT CATCH. Express parses the
 * query string with `qs`, which returns `string | string[] | object`: `?q=a&q=b` gives
 * an ARRAY and `?q[$ne]=x` gives an OBJECT. The cast asserts one of those three and
 * erases the other two, so the value reaches string methods that do not exist on it.
 *
 * That is not a theoretical tidy-up. `parseColonSyntax(basicQuery)` runs BEFORE the
 * route's try/catch and calls `.includes(":")`, so `GET /search?q[$ne]=x` threw
 * `TypeError: query.includes is not a function` out of an async handler — and Node
 * terminates the process on an unhandled rejection. Two unauthenticated GETs took the
 * staging dyno down and Heroku's crash backoff kept it down. Verified 2026-07-24; see
 * offline/code-review-evaluation-2026-07-24.md.
 *
 * ⚠️ The `typeof === "string"` guards in search.ts do NOT cover this. They sit at the
 * Mongo-filter sink; this crash happens in the route, one layer earlier, on the way there.
 * A guard at the sink protects nothing that touches the value before it.
 *
 * Non-strings are IGNORED rather than rejected with a 400: a nonsense `q` then renders
 * the welcome page, which is what the same nonsense already does in production.
 */
const queryParam = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * The canonical URL for a legacy `/htmx/...` page URL — used by the redirect in
 * index.ts, and exported ONLY so it can be tested (importing index.ts runs the whole
 * app: it connects to MongoDB and exits the process when the env vars are missing).
 *
 * 🔴 The leading-slash collapse is the load-bearing part. Stripping the prefix off
 * `/htmx//evil.example/path` leaves `//evil.example/path`, which a browser reads as
 * PROTOCOL-RELATIVE — the redirect then sends the visitor to another origin entirely.
 * Backslashes are equivalent for this purpose (browsers normalise `/\` to `//`), so
 * both are collapsed. Verified 2026-07-24, offline/code-review-evaluation-2026-07-24.md.
 */
export const canonicalHtmxUrl = (originalUrl: string): string =>
  "/" + originalUrl.replace(/^\/htmx/, "").replace(/^[/\\]+/, "");

let db: Db;

export const router = Router();

/**
 * numberOrBlank is available to EVERY view rendered by this router, not passed
 * render-by-render.
 *
 * 🔴 The invariant is "the NaN sentinel never reaches a page" — so the helper has to
 * be reachable from every page, including ones added later. It used to be an explicit
 * local on the detail render alone, which is how partials/results.ejs came to print a
 * results heading reading literally "NaN" for 々 (`rad_stroke: NaN`) while the helper
 * that fixes it sat one file away, fully unit-tested and simply not in scope there.
 * A helper that must be remembered at each call site will eventually be forgotten at one.
 */
router.use((_req: Request, res: Response, next) => {
  res.locals.numberOrBlank = numberOrBlank;
  next();
});

export const init = (database: Db) => {
  db = database;
};

// Advanced search parameter keys (from search.ts)
const ADVANCED_KEYS = ["ks", "rs", "grade", "kanji", "kem", "rem", "on", "kun", "rpos", "rjn", "text", "list"];

/**
 * The COMPLETE set of result view modes, and the only values the templates branch on.
 *
 * 🔴 partials/results.ejs matches these three exactly and its final `else` falls through
 * to no-results.ejs, so ANY other value reported "No kanji were found matching this
 * search" over a perfectly good result set — HTTP 200, with matches in hand. That is the
 * same silent-failure shape as a database outage rendering as an empty search (see the
 * outage tests in html-routes.test.ts): a wrong answer that looks exactly like a right one.
 *
 * `?mode=KANJI` did it, and so did any typo or stale bookmark. Normalise at the edge —
 * an unrecognised mode means "show me the default view", never "show me nothing".
 *
 * ⚠️ 'help' is deliberately NOT here. It is a mode the SERVER sets to render the welcome
 * page; it must not be reachable from the query string.
 */
const RESULT_MODES = ["kanji", "ksort", "rsort"];

const searchModeParam = (value: unknown): string =>
  typeof value === "string" && RESULT_MODES.includes(value) ? value : "kanji";

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
    // Same qs hazard as queryParam(): `?on=a&on=b` is an array and `?on[$ne]=x` an
    // object. Neither crashes here, but both would paint "on:a,b" / "on:[object
    // Object]" into the visible search box for a parameter search.ts then DISCARDS.
    // Showing only what was actually searched keeps the box honest.
    const value = queryParam(query[key]);
    if (value) parts.push(`${key}:${value}`);
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
  // No Mongo sort: the Angular app fetches the API's natural collection order
  // and stable-sorts client-side (orderBy keeps ties in fetch order), so a
  // Mongo sort breaks ties differently. Replicate: fetch natural, stable-sort.
  const results = (await collection
    .find(searchQuery as Filter<KanjiDocument>, {
      projection: {
        ka_id: 1,
        ka_utf: 1,
        kstroke: 1,
        rad_utf: 1,
        rad_stroke: 1,
        rad_order: 1,
        // Names the grey radical glyph for screen readers (results.ejs). Without
        // them in the projection the label silently never renders.
        rad_name_ja: 1,
        rad_name: 1,
      },
    })
    .toArray()) as unknown as grouping.KanjiSearchResult[];

  results.sort(
    (a, b) =>
      a.kstroke - b.kstroke ||
      a.rad_stroke - b.rad_stroke ||
      a.rad_order - b.rad_order
  );

  return results;
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
 * Search page (full page or with results). Served at the same URL shapes as
 * the AngularJS app so production bookmarks keep working unchanged:
 *   GET /search                    - welcome, or basic (?q=...) / advanced
 *                                    (?on=...&grade=...) search
 *   GET /search/advanced?...       - advanced search (renders directly; the
 *                                    URL stays in the address bar like Angular)
 *   GET /search/:search            - basic search with the term in the path
 * (Also mounted under /htmx for the Angular-mode testing alias; redirects
 * below use req.baseUrl so they stay within whichever mount handled them.)
 */
async function renderSearchPage(
  req: Request,
  res: Response,
  basicOverride?: string
) {
  const basicQuery = basicOverride ?? queryParam(req.query.q);
  const mode = searchModeParam(req.query.mode);
  const isAdvanced = hasAdvancedParams(req.query as Record<string, unknown>);

  // Parse colon syntax in basic query (e.g., "on:shin grade:3") → redirect
  if (basicQuery && !isAdvanced) {
    const parsed = parseColonSyntax(basicQuery);
    if (parsed) {
      const params = new URLSearchParams(parsed);
      if (mode !== "kanji") params.set("mode", mode);
      return res.redirect(`${req.baseUrl}/search?${params.toString()}`);
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

    // Preserve original query string for navigation links; the path-based
    // variant (/search/:search) has no query string, so synthesize one
    const queryString = basicOverride
      ? `?q=${encodeURIComponent(basicOverride)}`
      : new URL(req.url, "http://localhost").search;

    res.render("pages/search", {
      query: displayQuery,
      queryString,
      mode: results.length > 0 ? mode : "kanji",
      results,
      kanjiStrokeGroups,
      radicalStrokeGroups,
      resultsOrder,
    });
  } catch (err) {
    // Fail LOUDLY. Returning 200 with an empty result set makes a database
    // outage indistinguishable from a valid zero-match search, so nothing
    // alerts and nobody finds out. A 5xx is visible to uptime monitors and
    // Heroku logs. See offline/durability-plan-2026-07-12.md.
    console.error("Search error:", err);
    res.status(500).render("pages/search", {
      query: displayQuery,
      mode: "kanji",
      results: [],
      resultsOrder: [],
      error: "Sorry, the kanji database is unavailable. Please try again in a moment.",
    });
  }
}

router.get("/search", (req: Request, res: Response) =>
  renderSearchPage(req, res)
);

// Must be registered before /search/:search so "advanced" isn't treated as a term
router.get("/search/advanced", (req: Request, res: Response) =>
  renderSearchPage(req, res)
);

router.get("/search/:search", (req: Request, res: Response) =>
  renderSearchPage(req, res, req.params.search)
);

/**
 * GET /htmx/partials/results - HTMX partial for search results
 * Supports both basic search (?q=...) and advanced search (?on=...&grade=...)
 */
router.get("/partials/results", async (req: Request, res: Response) => {
  const basicQuery = queryParam(req.query.q);
  const mode = searchModeParam(req.query.mode);
  const isAdvanced = hasAdvancedParams(req.query as Record<string, unknown>);
  let effectiveAdvancedParams: Record<string, string> | undefined;

  // Parse colon syntax in basic query (e.g., "on:shin grade:3") → redirect
  if (basicQuery && !isAdvanced) {
    const parsed = parseColonSyntax(basicQuery);
    if (parsed) {
      const params = new URLSearchParams(parsed);
      if (mode !== "kanji") params.set("mode", mode);
      res.setHeader("X-Redirect", `/search?${params.toString()}`);
      return res.send("");
    }
  }

  if (isAdvanced) {
    effectiveAdvancedParams = req.query as Record<string, string>;
  }

  // Tell loadResults() to show the full-page URL, not the partial endpoint
  const queryString = new URL(req.url, "http://localhost").search;
  const pushUrl =
    basicQuery || isAdvanced ? "/search" + queryString : "/search";
  res.setHeader("X-Push-Url", pushUrl);

  // And the matching tab/bookmark title — query-first like the detail pages,
  // same string search.ejs renders into <title> on a full page load. Set for
  // every outcome including zero results: the title names what was ASKED.
  // Percent-encoded because headers cannot carry raw Japanese.
  const displayQuery = isAdvanced
    ? buildAdvancedSearchInput(req.query as Record<string, unknown>)
    : basicQuery;
  res.setHeader(
    "X-Title",
    encodeURIComponent(
      displayQuery ? `${displayQuery} - Kanji alive` : "Kanji alive Web Application"
    )
  );

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
  } catch (err) {
    // Fail loudly — see renderSearchPage() above. no-results.ejs would have
    // told the user "0 kanji found" during a database outage.
    console.error("Search error:", err);
    res.status(500).render("partials/error", {
      error: "Sorry, the kanji database is unavailable. Please try again in a moment.",
    });
  }
});

/**
 * GET /:character - Kanji detail page (canonical, same URL as the Angular app;
 * also served under the /htmx testing alias)
 */
router.get("/:character", async (req: Request, res: Response, next) => {
  // Mounted at the app root this matches any single path segment — pass
  // file-ish or long paths (favicon.ico, robots.txt, …) to the fallback
  let character: string;
  try {
    character = decodeURIComponent(req.params.character);
  } catch {
    return next();
  }
  if (character.includes(".") || character.length > 4) {
    return next();
  }

  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const doc = await collection.findOne({ ka_utf: character });

    if (!doc) {
      // An unknown kanji shows the welcome page under a 404 status — the status
      // carries the signal, the UI stays as it ships today. Deliberately does
      // NOT pass `error`: that local now renders a visible error panel (used for
      // database outages), and showing one here would change the interface.
      return res.status(404).render("pages/search", {
        query: "",
        mode: "help",
        results: [],
        resultsOrder: [],
      });
    }

    const extendedDoc = extendKanjiWithAssets(doc);

    // Get search context from query params
    const searchQuery = queryParam(req.query.q);
    const searchMode = searchModeParam(req.query.mode);
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
    const lastSearch = queryString ? `/search${queryString}` : "";

    res.render("pages/detail", {
      doc: extendedDoc,
      // numberOrBlank arrives via res.locals — see the router.use() above.
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
