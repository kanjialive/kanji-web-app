/**
 * The EJS frontend's routes — full pages and the results partial.
 * See index.ts for the mounts.
 */

import { Router, Request, Response } from "express";
import { Db, Collection, Filter } from "mongodb";
import * as search from "./search";
import * as grouping from "./grouping";
import { KanjiDocument } from "./types";
import { extendKanjiWithAssets } from "./kanji-assets";

/**
 * Render a number blank when it is the NaN sentinel, as production does.
 *
 * 229 kanji hold `grade: NaN` and 々 holds `rad_stroke: NaN`, meaning "no grade" / "no
 * radical strokes". The sentinel is LOAD-BEARING — search.ts turns `?grade=` into
 * `{ grade: NaN }` because Mongo matches NaN to NaN, and that is a real search. Never
 * clean it out of the data; only keep it off the page.
 *
 * Production is blank here by accident: its data crosses JSON, which has no NaN literal,
 * so the driver sends null. EJS renders from the Mongo document directly, where the value
 * is still a double — so `<%= doc.grade %>` prints the literal text "NaN".
 */
export const numberOrBlank = (value: unknown): unknown =>
  typeof value === "number" && Number.isNaN(value) ? "" : value;

/**
 * Read a query parameter as a string, or "" if it is anything else.
 *
 * `req.query.q as string` is a lie the compiler cannot catch: Express parses with `qs`,
 * which returns `string | string[] | object`. `?q=a&q=b` is an ARRAY and `?q[$ne]=x` an
 * OBJECT, and the cast erases both. parseColonSyntax() then calls `.includes(":")` BEFORE
 * the route's try/catch, so two unauthenticated GETs killed the process — Node terminates
 * on an unhandled rejection, and Heroku's crash backoff kept it down.
 *
 * search.ts's `typeof === "string"` guards do NOT cover this: they sit at the Mongo-filter
 * sink, and this happens one layer earlier, on the way there.
 *
 * Non-strings are IGNORED rather than 400'd — a nonsense `q` renders the welcome page,
 * which is what the same nonsense already does in production.
 */
const queryParam = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * The canonical URL for a legacy `/htmx/...` page URL. Exported ONLY so it can be tested —
 * importing index.ts runs the whole app.
 *
 * The leading-slash collapse is the load-bearing part: stripping the prefix off
 * `/htmx//evil.example/path` leaves `//evil.example/path`, which a browser reads as
 * PROTOCOL-RELATIVE and follows off-site. Backslashes normalise the same way, so both
 * are collapsed.
 */
export const canonicalHtmxUrl = (originalUrl: string): string =>
  "/" + originalUrl.replace(/^\/htmx/, "").replace(/^[/\\]+/, "");

let db: Db;

export const router = Router();

let gaWarned = false;

/**
 * The GA4 measurement ID, or "" when analytics is off. Read per request so a dyno's
 * config var takes effect on restart with no rebuild.
 *
 * The format check exists because the ID Google shows most prominently in its admin UI
 * is the numeric PROPERTY id, not this one — pasting that yields a tag that loads and
 * silently records nothing. Refusing it, loudly and once, is the only signal there is.
 */
export const gaMeasurementId = (): string => {
  const id = (process.env.GA_MEASUREMENT_ID ?? "").trim();
  if (!id) return "";
  if (!/^G-[A-Z0-9]+$/i.test(id)) {
    if (!gaWarned) {
      gaWarned = true;
      console.warn(
        `GA_MEASUREMENT_ID=${id} is not a GA4 measurement ID (expected G-XXXXXXXXXX). Analytics disabled.`
      );
    }
    return "";
  }
  return id;
};

/**
 * numberOrBlank reaches EVERY view this router renders, never passed render-by-render.
 * The invariant is "the NaN sentinel never reaches a page", so it must be in scope on
 * pages added later too — a helper that has to be remembered at each call site will
 * eventually be forgotten at one, which is how a results heading came to print "NaN".
 *
 * gaMeasurementId rides along for the same reason: a page added later is tracked by
 * default rather than by remembering.
 */
router.use((_req: Request, res: Response, next) => {
  res.locals.numberOrBlank = numberOrBlank;
  res.locals.gaMeasurementId = gaMeasurementId();
  next();
});

export const init = (database: Db) => {
  db = database;
};

// Advanced search keys, mirroring search.ts.
const ADVANCED_KEYS = ["ks", "rs", "grade", "kanji", "kem", "rem", "on", "kun", "rpos", "rjn", "text", "list"];

/**
 * The COMPLETE set of result view modes, and the only values the templates branch on.
 *
 * partials/results.ejs matches these three exactly and its final `else` is the no-results
 * partial, so any other value — `?mode=KANJI`, a typo, a stale bookmark — answers "No
 * kanji were found" with HTTP 200 and matches in hand. Normalise at the edge: an
 * unrecognised mode means "the default view", never "nothing".
 *
 * 'help' is deliberately NOT here. The SERVER sets it to render the welcome page; it must
 * not be reachable from the query string.
 */
const RESULT_MODES = ["kanji", "ksort", "rsort"];

const searchModeParam = (value: unknown): string =>
  typeof value === "string" && RESULT_MODES.includes(value) ? value : "kanji";

function hasAdvancedParams(query: Record<string, unknown>): boolean {
  return ADVANCED_KEYS.some((key) => key in query);
}

/**
 * The value to paint into the search box for an advanced query, keeping the raw keys so
 * users see what they typed: { ks: "3", on: "shin" } -> "ks:3 on:shin"
 */
function buildAdvancedSearchInput(query: Record<string, unknown>): string {
  const parts: string[] = [];
  // The QUERY's key order, not ADVANCED_KEYS order: Express preserves the URL's order,
  // which is the order the user typed. Iterating the fixed list repaints "grade:3 rs:5"
  // as "rs:5 grade:3".
  for (const key of Object.keys(query)) {
    if (!ADVANCED_KEYS.includes(key)) continue;
    // Same qs hazard as queryParam(). Neither shape crashes here, but both would paint
    // "on:a,b" / "on:[object Object]" into the box for a parameter search.ts DISCARDS.
    const value = queryParam(query[key]);
    if (value) parts.push(`${key}:${value}`);
  }
  return parts.join(" ");
}

/**
 * Parse colon syntax out of a basic query: "on:shin grade:3" -> { on: "shin", grade: "3" }
 * Returns null when no recognised advanced key is present.
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

  const hasAdvancedKey = Object.keys(result).some((k) =>
    ADVANCED_KEYS.includes(k)
  );
  return hasAdvancedKey ? result : null;
}

async function searchKanji(
  basicQuery: string,
  advancedParams?: Record<string, string>
): Promise<grouping.KanjiSearchResult[]> {
  let searchQuery: Record<string, unknown>;

  if (advancedParams && hasAdvancedParams(advancedParams)) {
    searchQuery = search.parseAdvancedQuery(advancedParams as search.StringDict);
  } else if (basicQuery) {
    searchQuery = search.generateBasicQuery(basicQuery);
  } else {
    return [];
  }

  if (Object.keys(searchQuery).length === 0) {
    return [];
  }

  const collection: Collection<KanjiDocument> = db.collection("kanji");
  // Never add a Mongo .sort(). Both frontends fetch the natural collection order and
  // stable-sort client-side; Mongo's sort is not stable and would break ties differently,
  // so the two would disagree. Fetch natural, stable-sort here.
  const results = (await collection
    .find(searchQuery as Filter<KanjiDocument>, {
      projection: {
        ka_id: 1,
        ka_utf: 1,
        kstroke: 1,
        rad_utf: 1,
        rad_stroke: 1,
        rad_order: 1,
        // Names the grey radical glyph for screen readers (results.ejs); omit them from
        // the projection and the label silently never renders.
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

/** Flatten the display order for prev/next navigation, unnesting the grouped modes. */
function buildResultsOrder(
  results: grouping.KanjiSearchResult[],
  mode: string,
  kanjiStrokeGroups: grouping.StrokeGroup[],
  radicalStrokeGroups: grouping.StrokeGroup[]
): string[] {
  if (mode === "ksort" && kanjiStrokeGroups.length > 0) {
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

  return results.map((k) => k.ka_utf);
}

/**
 * The search page, at the URL shapes production bookmarks already use: /search (welcome,
 * ?q= or advanced), /search/advanced?…, /search/:term. Also reachable under the /htmx
 * mount — redirects use req.baseUrl so they stay within whichever mount handled them.
 */
async function renderSearchPage(
  req: Request,
  res: Response,
  basicOverride?: string
) {
  const basicQuery = basicOverride ?? queryParam(req.query.q);
  const mode = searchModeParam(req.query.mode);
  const isAdvanced = hasAdvancedParams(req.query as Record<string, unknown>);

  // Colon syntax ("on:shin grade:3") redirects to the structured URL.
  if (basicQuery && !isAdvanced) {
    const parsed = parseColonSyntax(basicQuery);
    if (parsed) {
      const params = new URLSearchParams(parsed);
      if (mode !== "kanji") params.set("mode", mode);
      return res.redirect(`${req.baseUrl}/search?${params.toString()}`);
    }
  }

  const displayQuery = isAdvanced
    ? buildAdvancedSearchInput(req.query as Record<string, unknown>)
    : basicQuery;

  try {
    if (!basicQuery && !isAdvanced) {
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

    const kanjiStrokeGroups =
      mode === "ksort" ? grouping.groupByKanjiStrokes(results) : [];
    const radicalStrokeGroups =
      mode === "rsort" ? grouping.groupByRadicalStrokes(results) : [];

    const resultsOrder = buildResultsOrder(
      results,
      mode,
      kanjiStrokeGroups,
      radicalStrokeGroups
    );

    // Navigation links need the query string; /search/:term has none, so synthesise it.
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
    // Fail LOUDLY. A 200 with an empty result set makes a database outage
    // indistinguishable from a valid zero-match search, so nothing alerts and nobody
    // finds out. There is no monitoring here by design; the status code IS the signal.
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

// Before /search/:search, or "advanced" is treated as a search term.
router.get("/search/advanced", (req: Request, res: Response) =>
  renderSearchPage(req, res)
);

router.get("/search/:search", (req: Request, res: Response) =>
  renderSearchPage(req, res, req.params.search)
);

/**
 * The results partial — the XHR target for loadResults(), and the only surviving /htmx
 * path. Never appears in the address bar.
 */
router.get("/partials/results", async (req: Request, res: Response) => {
  const basicQuery = queryParam(req.query.q);
  const mode = searchModeParam(req.query.mode);
  const isAdvanced = hasAdvancedParams(req.query as Record<string, unknown>);
  let effectiveAdvancedParams: Record<string, string> | undefined;

  // Colon syntax redirects; loadResults() acts on the X-Redirect header.
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

  // loadResults() pushes this, so the address bar shows the page URL, not this endpoint.
  const queryString = new URL(req.url, "http://localhost").search;
  const pushUrl =
    basicQuery || isAdvanced ? "/search" + queryString : "/search";
  res.setHeader("X-Push-Url", pushUrl);

  // The matching title — query-first, the same string search.ejs renders on a full load.
  // Set for every outcome including zero results: the title names what was ASKED.
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
    // Fail loudly — see renderSearchPage(). no-results.ejs would tell the user
    // "0 kanji found" during a database outage.
    console.error("Search error:", err);
    res.status(500).render("partials/error", {
      error: "Sorry, the kanji database is unavailable. Please try again in a moment.",
    });
  }
});

/**
 * The API documentation page. The ONLY place the licensing restriction on mnemonic hints
 * and textbook search is written down, so it must exist server-side before Phase 7 deletes
 * Angular. Static render, no database. Pinned by html-routes.test.ts.
 */
router.get("/api/docs", (_req: Request, res: Response) => {
  res.render("pages/docs");
});

/** The kanji detail page, at the canonical URL (also under the /htmx testing alias). */
router.get("/:character", async (req: Request, res: Response, next) => {
  // Mounted at the app root, so this matches any single path segment: pass file-ish or
  // long paths (favicon.ico, robots.txt, …) to the fallback.
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
      // An unknown kanji shows the welcome page under a 404: the status carries the
      // signal, the UI stays as it ships. Deliberately passes no `error` — that local
      // renders a visible panel (for outages), which would change the interface here.
      return res.status(404).render("pages/search", {
        query: "",
        mode: "help",
        results: [],
        resultsOrder: [],
      });
    }

    const extendedDoc = extendKanjiWithAssets(doc);

    const searchQuery = queryParam(req.query.q);
    const searchMode = searchModeParam(req.query.mode);
    const isAdvanced = hasAdvancedParams(req.query as Record<string, unknown>);

    const displaySearchQuery = isAdvanced
      ? buildAdvancedSearchInput(req.query as Record<string, unknown>)
      : searchQuery;

    // Re-run the search to find this kanji's neighbours.
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
